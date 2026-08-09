import { useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { ApiError } from '@/lib/apiClient'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoAttach } from '@/components/PhotoAttach'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { formatMoney, formatDate } from '@/lib/format'
import {
  useSubmissionStatus,
  useSubmit,
  useWithdraw,
  uploadSubmissionPhoto,
} from '@/hooks/useSubmission'
import { MAX_INVOICE_IMAGES, ImageType } from '@mac-invoices/shared'
import type { SubmissionStatus, ImageType as ImageTypeT } from '@mac-invoices/shared'

const itemFieldClass = 'w-full rounded-md border border-input bg-background px-2 py-2 text-sm'

/**
 * A line-item row while it is being typed. Quantity and total stay strings so a
 * half-typed value ("1.") is not coerced to NaN under the user's cursor; they
 * are converted once, on submit.
 */
type ItemRow = { id: string; description: string; quantity: string; total: string }

// A stable per-row key. Rows are added and removed, so the array index would
// re-key surviving rows and lose focus mid-edit.
let itemRowSeq = 0
function blankItem(): ItemRow {
  itemRowSeq += 1
  return { id: `row-${itemRowSeq}`, description: '', quantity: '1', total: '' }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{t('vendorSubmit.title')}</h1>
          {/* Public page: no session, so the toggle persists locally only. */}
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  )
}

export default function VendorSubmit() {
  const { token } = useParams()
  const { t } = useTranslation()
  const status = useSubmissionStatus(token!)
  const submit = useSubmit(token!)
  const withdraw = useWithdraw(token!)

  const [items, setItems] = useState<ItemRow[]>([blankItem()])
  const [invoiceDate, setInvoiceDate] = useState('')
  const [notes, setNotes] = useState('')
  const [partsOrdered, setPartsOrdered] = useState('')
  const [photos, setPhotos] = useState<{ url: string; type: ImageTypeT }[]>([])
  const [justSubmitted, setJustSubmitted] = useState(false)

  if (status.isPending) {
    return (
      <Shell>
        <p className="text-muted-foreground">{t('vendorSubmit.loading')}</p>
      </Shell>
    )
  }
  // A 404 (or any failure) on the status query means the token is invalid/revoked.
  if (status.isError) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="font-medium text-foreground">{t('vendorSubmit.inactiveTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('vendorSubmit.inactiveBody')}</p>
        </div>
      </Shell>
    )
  }

  const submissions = status.data.data
  const atCap = photos.length >= MAX_INVOICE_IMAGES
  const filledItems = items.filter((i) => i.description.trim() && Number(i.total) > 0)
  const computedTotal = filledItems.reduce((sum, i) => sum + Number(i.total), 0)
  const canSubmit = photos.length > 0 && !!invoiceDate && filledItems.length > 0

  const submitError =
    submit.error instanceof ApiError
      ? submit.error.status === 429
        ? t('vendorSubmit.rateLimited')
        : submit.error.message
      : submit.error
        ? t('vendorSubmit.genericError')
        : null

  const resetForm = () => {
    setItems([blankItem()])
    setInvoiceDate('')
    setNotes('')
    setPartsOrdered('')
    setPhotos([])
  }

  const updateItem = (id: string, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const addItem = () => setItems((prev) => [...prev, blankItem()])
  const removeItem = (id: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.id !== id)))

  const addPhoto = (url: string) =>
    setPhotos((prev) =>
      prev.length >= MAX_INVOICE_IMAGES ? prev : [...prev, { url, type: 'OTHER' }],
    )
  const removePhoto = (url: string) => setPhotos((prev) => prev.filter((p) => p.url !== url))
  const setPhotoType = (url: string, type: ImageTypeT) =>
    setPhotos((prev) => prev.map((p) => (p.url === url ? { ...p, type } : p)))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    submit.mutate(
      {
        items: filledItems.map((i) => ({
          description: i.description.trim(),
          quantity: Number(i.quantity) || 1,
          total: Number(i.total),
        })),
        invoiceDate,
        notes: notes.trim() || undefined,
        partsOrdered: partsOrdered.trim() || undefined,
        images: photos,
      },
      {
        onSuccess: () => {
          resetForm()
          setJustSubmitted(true)
        },
      },
    )
  }

  const startNew = () => {
    setJustSubmitted(false)
    resetForm()
  }

  return (
    <Shell>
      {justSubmitted ? (
        <div className="rounded-lg border border-status-paid bg-status-paid/30 p-5 text-center">
          <p className="font-medium text-foreground">{t('vendorSubmit.submittedTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('vendorSubmit.submittedBody')}</p>
          <Button className="mt-4" onClick={startNew}>
            {t('vendorSubmit.submitAnother')}
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('vendorSubmit.items.title')}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                {t('vendorSubmit.items.add')}
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((row, index) => (
                <div key={row.id} className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <label htmlFor={`item-desc-${row.id}`} className="sr-only">
                      {t('vendorSubmit.items.description')}
                    </label>
                    <input
                      id={`item-desc-${row.id}`}
                      placeholder={t('vendorSubmit.items.description')}
                      value={row.description}
                      onChange={(e) => updateItem(row.id, { description: e.target.value })}
                      className={itemFieldClass}
                    />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor={`item-qty-${row.id}`} className="sr-only">
                      {t('vendorSubmit.items.quantity')}
                    </label>
                    <input
                      id={`item-qty-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      placeholder={t('vendorSubmit.items.quantity')}
                      value={row.quantity}
                      onChange={(e) => updateItem(row.id, { quantity: e.target.value })}
                      className={itemFieldClass}
                    />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor={`item-total-${row.id}`} className="sr-only">
                      {t('vendorSubmit.items.total')}
                    </label>
                    <input
                      id={`item-total-${row.id}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder={t('vendorSubmit.items.total')}
                      value={row.total}
                      onChange={(e) => updateItem(row.id, { total: e.target.value })}
                      className={itemFieldClass}
                    />
                  </div>
                  <div className="col-span-1 flex items-center">
                    {items.length > 1 && (
                      <button
                        type="button"
                        aria-label={t('vendorSubmit.items.remove', { index: index + 1 })}
                        onClick={() => removeItem(row.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-right text-sm text-muted-foreground">
              {t('vendorSubmit.items.computedTotal')}:{' '}
              <span className="font-medium text-foreground tabular-nums">
                {formatMoney(computedTotal)}
              </span>
            </p>
          </div>
          <div>
            <label htmlFor="invoiceDate" className="text-sm font-medium text-foreground">
              {t('vendorSubmit.date')}
            </label>
            <input
              id="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="partsOrdered" className="text-sm font-medium text-foreground">
              {t('vendorSubmit.partsOrdered')}
            </label>
            <input
              id="partsOrdered"
              value={partsOrdered}
              onChange={(e) => setPartsOrdered(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="notes" className="text-sm font-medium text-foreground">
              {t('vendorSubmit.notes')}
            </label>
            <textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <span className="text-sm font-medium text-foreground">
              {t('vendorSubmit.photosLabel')}
            </span>
            {photos.length > 0 && (
              <ul className="mt-2 space-y-2">
                {photos.map((p, i) => (
                  <li
                    key={p.url}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="text-sm text-foreground">
                      {t('vendorSubmit.photoN', { n: i + 1 })}
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={t('vendorSubmit.photoTypeLabel', { n: i + 1 })}
                        value={p.type}
                        onChange={(e) => setPhotoType(p.url, e.target.value as ImageTypeT)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      >
                        {ImageType.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {t(`imageType.${opt}`)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removePhoto(p.url)}
                        className="text-xs font-medium text-destructive underline"
                      >
                        {t('vendorSubmit.removePhoto')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">
              <PhotoAttach
                onUploaded={addPhoto}
                disabled={atCap}
                upload={(file, onProgress) => uploadSubmissionPhoto(token!, file, onProgress)}
              />
            </div>
            {atCap ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photosAtCap', { max: MAX_INVOICE_IMAGES })}
              </p>
            ) : photos.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photoRequired')}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photosCount', { count: photos.length, max: MAX_INVOICE_IMAGES })}
              </p>
            )}
          </div>
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!canSubmit || submit.isPending}>
            {submit.isPending ? t('vendorSubmit.submitting') : t('vendorSubmit.submit')}
          </Button>
        </form>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          {t('vendorSubmit.yourSubmissions')}
        </h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('vendorSubmit.noSubmissions')}</p>
        ) : (
          <ul className="space-y-2">
            {submissions.map((s) => (
              <SubmissionRow
                key={s.id}
                submission={s}
                onWithdraw={() => withdraw.mutate(s.id)}
                onResubmit={startNew}
                withdrawing={withdraw.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}

function SubmissionRow({
  submission: s,
  onWithdraw,
  onResubmit,
  withdrawing,
}: {
  submission: SubmissionStatus
  onWithdraw: () => void
  onResubmit: () => void
  withdrawing: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground tabular-nums">{formatMoney(s.amount)}</span>
        <StatusBadge status={s.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatDate(s.invoiceDate)} · {s.description}
      </p>
      {s.status === 'REJECTED' && (
        <div className="mt-2 text-xs">
          {s.rejectionReason && (
            <p className="text-destructive">
              {t('vendorSubmit.rejectedPrefix')} {s.rejectionReason}
            </p>
          )}
          <button
            type="button"
            onClick={onResubmit}
            className="mt-1 font-medium text-primary underline"
          >
            {t('vendorSubmit.resubmit')}
          </button>
        </div>
      )}
      {s.status === 'SUBMITTED' && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={withdrawing}
          onClick={onWithdraw}
        >
          {t('vendorSubmit.withdraw')}
        </Button>
      )}
    </li>
  )
}
