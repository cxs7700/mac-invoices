import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { loadDraft, saveDraft, clearDraft } from '@/lib/submissionDraft'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoAttach } from '@/components/PhotoAttach'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { InstallPrompt } from '@/components/InstallPrompt'
import { installManifest, registerSubmitServiceWorker } from '@/lib/pwa'
import { Button } from '@/components/ui/button'
import { InvoiceFields, type ItemRowValue } from '@/components/InvoiceFields'
import { formatMoney, formatDate } from '@/lib/format'
import {
  useSubmissionStatus,
  useSubmit,
  useSubmissionProperties,
  useWithdraw,
  uploadSubmissionPhoto,
} from '@/hooks/useSubmission'
import { MAX_INVOICE_IMAGES, ImageType } from '@mac-invoices/shared'
import type { SubmissionStatus, ImageType as ImageTypeT } from '@mac-invoices/shared'

// A stable per-row key. Rows are added and removed, so the array index would
// re-key surviving rows and lose focus mid-edit.
let itemRowSeq = 0
function blankItem(): ItemRowValue {
  itemRowSeq += 1
  return { id: `row-${itemRowSeq}`, description: '', quantity: '1', total: '' }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    // Safe-area padding matters once installed: in standalone mode the page
    // owns the full screen, including the notch and the home indicator.
    <div
      className="min-h-screen bg-background px-4 py-8"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
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
  const { t, i18n } = useTranslation()

  // The submission link opens in English whatever the browser (or a previous
  // visitor on this device) asked for. Once per visit only — the in-page
  // switcher still wins afterwards, and a landlord who follows a vendor link
  // gets their own locale back from the server on their next login (AuthGuard
  // reconciles it).
  const localeForced = useRef(false)
  useEffect(() => {
    if (localeForced.current) return
    localeForced.current = true
    if (i18n.language !== 'en') i18n.changeLanguage('en')
  }, [i18n])

  // Installable to the vendor's home screen. The manifest is torn down on
  // unmount so the landlord app — same origin — never inherits it.
  const appName = t('install.appName')
  useEffect(() => installManifest(appName), [appName])
  useEffect(() => registerSubmitServiceWorker(), [])

  const status = useSubmissionStatus(token!)
  const submit = useSubmit(token!)
  const withdraw = useWithdraw(token!)
  const propertyList = useSubmissionProperties(token!)

  // Read once, in a lazy initialiser, so the restored values are the form's
  // FIRST render rather than a flash of empty fields that then repopulate.
  const [restored] = useState(() => (token ? loadDraft(token) : null))
  const [draftRestored, setDraftRestored] = useState(restored !== null)

  const [items, setItems] = useState<ItemRowValue[]>(restored?.items ?? [blankItem()])
  const [invoiceDate, setInvoiceDate] = useState(restored?.invoiceDate ?? '')
  const [notes, setNotes] = useState(restored?.notes ?? '')
  const [partsOrdered, setPartsOrdered] = useState(restored?.partsOrdered ?? '')
  const [category, setCategory] = useState(restored?.category ?? '')
  const [propertyId, setPropertyId] = useState(restored?.propertyId ?? '')
  const [photos, setPhotos] = useState<{ url: string; type: ImageTypeT }[]>(restored?.photos ?? [])
  const [justSubmitted, setJustSubmitted] = useState(false)

  // Save on every change rather than on an interval or on unload: `pagehide` is
  // the one lifecycle event iOS actually delivers reliably, and a vendor whose
  // battery dies never fires anything at all. Writing a few KB of JSON per
  // keystroke is cheap next to losing the form.
  useEffect(() => {
    if (!token) return
    saveDraft(token, { items, invoiceDate, notes, partsOrdered, category, propertyId, photos })
  }, [token, items, invoiceDate, notes, partsOrdered, category, propertyId, photos])

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
  const properties = propertyList.data?.data ?? []
  // A property is required to submit, and the dropdown only offers the ones the
  // landlord assigned to this vendor — so with none assigned there is nothing to
  // pick and the form could never be completed. Show why instead of a dead form.
  // Only once the fetch has actually succeeded: a failed request must not be
  // misread as "no properties assigned".
  const noPropertiesAssigned = propertyList.isSuccess && properties.length === 0
  const atCap = photos.length >= MAX_INVOICE_IMAGES
  const filledItems = items.filter((i) => i.description.trim() && Number(i.total) > 0)
  const computedTotal = filledItems.reduce((sum, i) => sum + Number(i.total), 0)
  // Photos, notes and parts are all optional — a submission needs only a dated
  // line item.
  // Property is required on both forms; notes, parts, category and photos are not.
  const canSubmit = !!invoiceDate && !!propertyId && filledItems.length > 0

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
    setCategory('')
    setPropertyId('')
    setPhotos([])
  }

  const updateItem = (id: string, patch: Partial<ItemRowValue>) =>
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
        category: category || undefined,
        propertyId: propertyId || undefined,
        images: photos.length > 0 ? photos : undefined,
      },
      {
        onSuccess: () => {
          // Clear before resetting: the save effect fires on the reset too, and
          // `saveDraft` clears on an empty form — but the submission is the
          // moment the draft stops being wanted, so say so explicitly rather
          // than relying on emptiness to imply it.
          if (token) clearDraft(token)
          resetForm()
          setDraftRestored(false)
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
      <InstallPrompt />

      {/*
        A restored draft must announce itself. Silently repopulating the form
        would leave a vendor unsure whether what they are looking at is this
        job's invoice or last week's, and the safe reaction to that doubt is to
        clear it and retype — which costs exactly what the draft just saved.
      */}
      {draftRestored && !justSubmitted && (
        <p
          role="status"
          className="mb-4 rounded-md border border-tone-blue bg-tone-blue px-3 py-2 text-sm text-tone-blue-foreground"
        >
          {t('vendorSubmit.draftRestored')}
        </p>
      )}

      {noPropertiesAssigned ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="font-medium text-foreground">{t('vendorSubmit.noPropertiesTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('vendorSubmit.noPropertiesBody')}</p>
        </div>
      ) : justSubmitted ? (
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
            <span className="text-sm font-medium text-foreground">
              {t('vendorSubmit.photosLabel')} {t('vendorSubmit.optionalSuffix')}
            </span>
            {photos.length > 0 && (
              <ul className="mt-2 space-y-2">
                {photos.map((p, i) => (
                  <li
                    key={p.url}
                    className="flex items-center gap-3 rounded-md border border-border bg-background p-2"
                  >
                    {/* A thumbnail, not just "Photo 3": after five shots on a
                        job site the numbers alone don't say which is the
                        receipt and which is the part. */}
                    <img
                      src={p.url}
                      alt={t('vendorSubmit.photoN', { n: i + 1 })}
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded object-cover"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <select
                        aria-label={t('vendorSubmit.photoTypeLabel', { n: i + 1 })}
                        value={p.type}
                        onChange={(e) => setPhotoType(p.url, e.target.value as ImageTypeT)}
                        className="min-h-11 w-full rounded-md border border-input bg-background px-2 py-1 text-base md:min-h-0 md:text-xs"
                      >
                        {ImageType.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {t(`imageType.${opt}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePhoto(p.url)}
                      className="min-h-11 shrink-0 px-2 text-xs font-medium text-destructive underline"
                    >
                      {t('vendorSubmit.removePhoto')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">
              {/*
                `remainingSlots` rather than `disabled={atCap}`: it keeps the
                capture buttons live while an upload is in flight, so a vendor
                can shoot the next receipt instead of waiting on field LTE, and
                it still refuses to start more uploads than there are slots —
                `addPhoto` drops anything past the cap, so an unbounded queue
                would push a file to storage and then discard it.
              */}
              <PhotoAttach
                onUploaded={addPhoto}
                remainingSlots={MAX_INVOICE_IMAGES - photos.length}
                upload={(file, onProgress) => uploadSubmissionPhoto(token!, file, onProgress)}
              />
            </div>
            {atCap ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photosAtCap', { max: MAX_INVOICE_IMAGES })}
              </p>
            ) : photos.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photosNoneYet')}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('vendorSubmit.photosCount', { count: photos.length, max: MAX_INVOICE_IMAGES })}
              </p>
            )}
          </div>
          <InvoiceFields
            items={items}
            onItemChange={updateItem}
            onItemAdd={addItem}
            onItemRemove={removeItem}
            computedTotal={computedTotal}
            invoiceDate={invoiceDate}
            onInvoiceDate={setInvoiceDate}
            propertyId={propertyId}
            onPropertyId={setPropertyId}
            properties={properties}
            category={category}
            onCategory={setCategory}
            notes={notes}
            onNotes={setNotes}
            partsOrdered={partsOrdered}
            onPartsOrdered={setPartsOrdered}
          />
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
