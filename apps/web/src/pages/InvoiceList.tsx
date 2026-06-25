import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useInvoices } from '@/hooks/useInvoices'
import { useExportInvoices } from '@/hooks/useExportInvoices'
import { InvoiceTable } from '@/components/InvoiceTable'
import { FilterBar } from '@/components/FilterBar'
import { StatusCounts } from '@/components/StatusCounts'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/apiClient'
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

export default function InvoiceList() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseListParams(searchParams)
  const { data, isPending, isError, refetch } = useInvoices(toQueryParams(filters))

  // Filter changes reset to page 1; pagination keeps the current filters.
  const applyFilter = (patch: Partial<ListFilters>) =>
    setSearchParams(toSearchParams({ ...filters, ...patch, page: 1 }))
  const goToPage = (page: number) =>
    setSearchParams(toSearchParams({ ...filters, page }))
  const clearAll = () => setSearchParams(new URLSearchParams())

  const total = data?.pagination.total ?? 0
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const filtersActive = hasActiveFilters(filters)

  const exportM = useExportInvoices()
  const exportError = exportErrorMessage(exportM.error, t)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t('invoiceList.heading')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={exportM.isPending}
            onClick={() => exportM.mutate()}
          >
            {exportM.isPending ? t('invoiceList.exporting') : t('invoiceList.exportToSheets')}
          </Button>
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
      </div>

      <StatusCounts
        activeStatus={filters.status}
        onSelect={(status) => applyFilter({ status })}
      />

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
          <InvoiceTable invoices={data.data} />
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
