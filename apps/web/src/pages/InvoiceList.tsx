import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, ClipboardCopy } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useInvoices, type InvoiceListItem } from '@/hooks/useInvoices'
import { useExportInvoices } from '@/hooks/useExportInvoices'
import { useProperties } from '@/hooks/useProperties'
import { useMe } from '@/hooks/useAuth'
import { InvoiceTable } from '@/components/InvoiceTable'
import { FilterBar } from '@/components/FilterBar'
import { StatusCounts } from '@/components/StatusCounts'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/apiClient'
import { generateInvoicesPdf } from '@/lib/invoicePdf'
import { buildInvoiceSummary, copyInvoiceSummary, type InvoiceSummary } from '@/lib/invoiceSummary'
import {
  PAGE_SIZE,
  parseListParams,
  toQueryParams,
  toSearchParams,
  hasActiveFilters,
  type ListFilters,
} from '@/lib/listParams'

/** Human-readable message for an export failure (null when there's no error). */
function exportErrorMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null
  if (!(error instanceof ApiError)) return t('invoiceList.exportFailed')
  if (error.code === 'EXPORT_NOT_CONFIGURED') return t('invoiceList.exportNotConfigured')
  // A 502 partial export carries how many rows made it durably.
  const exported = (error.details as { exported?: number } | undefined)?.exported
  if (error.status === 502 && typeof exported === 'number') {
    return t('invoiceList.exportPartial', { exported })
  }
  return error.message
}

type PdfMessage =
  | { kind: 'success'; count: number; summary: InvoiceSummary }
  | { kind: 'error' }
  | null

export default function InvoiceList() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseListParams(searchParams)
  const { data, isPending, isError, refetch } = useInvoices(toQueryParams(filters))

  // Filter changes reset to page 1; pagination keeps the current filters.
  const applyFilter = (patch: Partial<ListFilters>) =>
    setSearchParams(toSearchParams({ ...filters, ...patch, page: 1 }))
  const goToPage = (page: number) => setSearchParams(toSearchParams({ ...filters, page }))
  const clearAll = () => setSearchParams(new URLSearchParams())

  const total = data?.pagination.total ?? 0
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const filtersActive = hasActiveFilters(filters)

  const exportM = useExportInvoices()
  const exportError = exportErrorMessage(exportM.error, t)

  // PDF selection mode. Selection snapshots the row at check time (Map, not a
  // Set of ids) so cross-page selections don't depend on query-cache retention;
  // page/filter navigation leaves it untouched. Local state on purpose — URL
  // state is reserved for shareable filter/sort/page (DEC-020).
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlyMap<string, InvoiceListItem>>(new Map())
  const [generating, setGenerating] = useState(false)
  const [pdfMessage, setPdfMessage] = useState<PdfMessage>(null)
  const [summaryCopy, setSummaryCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // FilterBar also mounts this hook, so the ['properties'] query is warm; the
  // page-level call gives Confirm the same cache entry (no second fetch path).
  const propertiesQ = useProperties()
  // The PDF's Bill-To section is always the landlord — the nav shell already
  // mounts useMe(), so this reads the same warm cache entry.
  const meQ = useMe()

  const generatePdfBtnRef = useRef<HTMLButtonElement>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)

  const enterSelection = () => {
    // One status region, one export at a time: clear any lingering Sheets
    // message (Generate PDF is disabled while that export is in flight).
    exportM.reset()
    setPdfMessage(null)
    setSummaryCopy('idle')
    setSelectionMode(true)
  }
  const exitSelection = () => {
    setSelectionMode(false)
    setSelected(new Map())
  }
  const toggleSelected = (inv: InvoiceListItem) => {
    if (generating) return
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(inv.id)) next.delete(inv.id)
      else next.set(inv.id, inv)
      return next
    })
  }

  // Keyboard/focus lifecycle: focus the first checkbox on entry and return to
  // the Generate PDF button on exit; Esc cancels but is inert mid-generation.
  const prevModeRef = useRef(false)
  useEffect(() => {
    if (selectionMode && !prevModeRef.current) {
      tableWrapRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus()
    } else if (!selectionMode && prevModeRef.current) {
      generatePdfBtnRef.current?.focus()
    }
    prevModeRef.current = selectionMode
  }, [selectionMode])
  useEffect(() => {
    if (!selectionMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || generating || e.isComposing) return
      // Esc inside a filter control (or an IME cancel) means "clear that
      // input", not "throw away my cross-page selection".
      const t = e.target
      if (t instanceof HTMLElement && t.closest('input, select, textarea')) return
      exitSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectionMode, generating])

  const confirmPdf = async () => {
    if (generating || selected.size === 0) return
    setGenerating(true)
    setPdfMessage(null)
    // Snapshot at click time so mid-flight toggles can't mutate the export.
    const snapshot = [...selected.values()]
    try {
      let properties = propertiesQ.data?.data
      if (!properties) {
        const r = await propertiesQ.refetch()
        if (!r.data) throw r.error ?? new Error('properties unavailable')
        properties = r.data.data
      }
      let me = meQ.data
      if (!me) {
        const r = await meQ.refetch()
        if (!r.data) throw r.error ?? new Error('landlord identity unavailable')
        me = r.data
      }
      // Each invoice is billed to its property's owner (the payee), which may
      // not be the account holder; the account holder is only the fallback.
      const propertiesById = new Map(
        properties.map((p) => [
          p.id,
          {
            address: p.address,
            owner: {
              firstName: p.ownerFirstName,
              lastName: p.ownerLastName,
              email: p.ownerEmail,
              phone: p.ownerPhone,
            },
          },
        ]),
      )
      await generateInvoicesPdf(snapshot, propertiesById, {
        firstName: me.firstName,
        lastName: me.lastName,
        email: me.email,
      })
      setSummaryCopy('idle')
      setPdfMessage({
        kind: 'success',
        count: snapshot.length,
        summary: buildInvoiceSummary(snapshot),
      })
      exitSelection()
    } catch {
      // Failure keeps selection mode and the selection intact (R9).
      setPdfMessage({ kind: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  const copySummary = async (summary: InvoiceSummary) => {
    try {
      await copyInvoiceSummary(summary)
      setSummaryCopy('copied')
      setTimeout(() => setSummaryCopy((s) => (s === 'copied' ? 'idle' : s)), 2000)
    } catch {
      setSummaryCopy('failed')
    }
  }

  return (
    <div>
      {/* Wraps on a phone: the three actions total ~395px and ran off the right
          edge of a 375px screen, putting "New invoice" out of reach. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-foreground">{t('invoiceList.heading')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={exportM.isPending || selectionMode}
            onClick={() => {
              setPdfMessage(null)
              exportM.mutate()
            }}
          >
            {exportM.isPending ? t('invoiceList.exporting') : t('invoiceList.exportToSheets')}
          </Button>
          {selectionMode ? (
            <>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('invoiceList.selectedCount', { count: selected.size })}
              </span>
              <Button disabled={selected.size === 0 || generating} onClick={confirmPdf}>
                {generating ? t('invoiceList.generatingPdf') : t('invoiceList.confirm')}
              </Button>
              <Button variant="outline" disabled={generating} onClick={exitSelection}>
                {t('invoiceList.cancel')}
              </Button>
            </>
          ) : (
            <Button
              ref={generatePdfBtnRef}
              variant="outline"
              disabled={exportM.isPending || isPending || isError || !data?.data.length}
              onClick={enterSelection}
            >
              {t('invoiceList.generatePdf')}
            </Button>
          )}
          <Button asChild>
            <Link to="/invoices/new">{t('invoiceList.newInvoice')}</Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 min-h-5 text-sm" aria-live="polite">
        {exportM.isSuccess && (
          <span role="status" className="text-status-paid-foreground">
            {exportM.data.exported === 1
              ? t('invoiceList.exportSuccessOne', { exported: exportM.data.exported })
              : t('invoiceList.exportSuccessOther', { exported: exportM.data.exported })}
          </span>
        )}
        {exportError && (
          <span role="alert" className="text-destructive">
            {exportError}
          </span>
        )}
        {pdfMessage?.kind === 'success' && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span role="status" className="text-status-paid-foreground">
              {pdfMessage.count === 1
                ? t('invoiceList.pdfSuccessOne', { count: pdfMessage.count })
                : t('invoiceList.pdfSuccessOther', { count: pdfMessage.count })}
            </span>
            <button
              type="button"
              title={t('invoiceList.copySummary')}
              className="inline-flex items-center gap-1.5 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => void copySummary(pdfMessage.summary)}
            >
              {summaryCopy === 'copied' ? (
                <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{t('invoiceList.copyEmailTemplate')}</span>
            </button>
            {summaryCopy === 'copied' && (
              <span className="text-muted-foreground">{t('invoiceList.summaryCopied')}</span>
            )}
            {summaryCopy === 'failed' && (
              <span className="text-destructive">{t('invoiceList.summaryCopyFailed')}</span>
            )}
          </span>
        )}
        {pdfMessage?.kind === 'error' && (
          <span role="alert" className="text-destructive">
            {t('invoiceList.pdfFailed')}
          </span>
        )}
        {selectionMode && !pdfMessage && (
          <span role="status" className="text-muted-foreground">
            {t('invoiceList.selectionHint')}
          </span>
        )}
      </div>

      <StatusCounts activeStatus={filters.status} onSelect={(status) => applyFilter({ status })} />

      <FilterBar filters={filters} onChange={applyFilter} onClear={clearAll} />

      {isPending ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">{t('invoiceList.loadError')}</p>
          <Button variant="outline" className="mt-3" onClick={() => refetch()}>
            {t('invoiceList.retry')}
          </Button>
        </div>
      ) : data.data.length === 0 ? (
        filtersActive ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center">
            <p className="font-medium text-foreground">{t('invoiceList.noMatch')}</p>
            <button type="button" onClick={clearAll} className="mt-2 text-sm text-primary">
              {t('invoiceList.clearFilters')}
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-10 text-center">
            <p className="font-medium text-foreground">{t('invoiceList.noInvoicesYet')}</p>
            <Button asChild className="mt-3">
              <Link to="/invoices/new">{t('invoiceList.createInvoice')}</Link>
            </Button>
          </div>
        )
      ) : (
        <>
          <div ref={tableWrapRef}>
            <InvoiceTable
              invoices={data.data}
              selection={
                selectionMode
                  ? { selectedIds: selected, disabled: generating, onToggle: toggleSelected }
                  : undefined
              }
            />
          </div>
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm">
              <span className="text-muted-foreground">
                {t('invoiceList.pageOf', { page: filters.page, pageCount })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => goToPage(filters.page - 1)}
              >
                {t('invoiceList.prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page >= pageCount}
                onClick={() => goToPage(filters.page + 1)}
              >
                {t('invoiceList.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
