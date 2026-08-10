import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_INVOICE_IMAGES, ImageType } from '@mac-invoices/shared'
import type { ImageType as ImageTypeT } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import {
  useInvoiceImages,
  useAddInvoiceImage,
  useRemoveInvoiceImage,
  useSetInvoiceImageType,
} from '@/hooks/useInvoiceImages'
import { PhotoAttach } from './PhotoAttach'
import { Button } from './ui/button'

/**
 * The landlord photo gallery on the invoice detail: a thumbnail grid (each opens
 * full-size, since a handwritten invoice must be legible as proof), a per-photo
 * type selector and remove (inline-confirmed — removal is permanent), and an add
 * control disabled at the cap. An expired signed URL refetches the list once.
 */
export function InvoiceImageGallery({ invoiceId }: { invoiceId: string }) {
  const { t } = useTranslation()
  const { data, isPending, isError, refetch } = useInvoiceImages(invoiceId)
  const add = useAddInvoiceImage(invoiceId)
  const remove = useRemoveInvoiceImage(invoiceId)
  const setType = useSetInvoiceImageType(invoiceId)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState(false)

  const images = data?.data ?? []
  const atCap = images.length >= MAX_INVOICE_IMAGES
  const capError =
    add.error instanceof ApiError && add.error.status === 422
      ? t('invoiceGallery.capError', { max: MAX_INVOICE_IMAGES })
      : null

  const onThumbError = () => {
    if (!refreshed) {
      setRefreshed(true)
      void refetch()
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t('invoiceGallery.heading')}</h2>

      {isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('invoiceGallery.loading')}
        </p>
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t('invoiceGallery.loadError')}
        </p>
      ) : (
        <div className="space-y-3">
          {images.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('invoiceGallery.empty')}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img) => (
                <li key={img.id} className="space-y-1.5 rounded-md border border-border p-2">
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => setLightbox(img.url)}
                    aria-label={t('invoiceGallery.viewFullSize')}
                  >
                    <img
                      src={img.url}
                      alt={t('invoiceGallery.alt')}
                      className="h-24 w-full rounded object-cover"
                      onError={onThumbError}
                    />
                  </button>
                  <select
                    aria-label={t('invoiceGallery.typeLabel')}
                    value={img.type}
                    disabled={setType.isPending}
                    onChange={(e) =>
                      setType.mutate({ imageId: img.id, type: e.target.value as ImageTypeT })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  >
                    {ImageType.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {t(`imageType.${opt}`)}
                      </option>
                    ))}
                  </select>
                  {confirmId === img.id ? (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="flex-1 text-xs"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate(img.id, { onSettled: () => setConfirmId(null) })
                        }
                      >
                        {t('invoiceGallery.confirmRemoveYes')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => setConfirmId(null)}
                      >
                        {t('invoiceGallery.confirmRemoveNo')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(img.id)}
                      className="w-full text-xs font-medium text-destructive underline"
                    >
                      {t('invoiceGallery.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {atCap ? (
            <p className="text-xs text-muted-foreground">
              {t('invoiceGallery.atCap', { max: MAX_INVOICE_IMAGES })}
            </p>
          ) : (
            <div className="space-y-1">
              <PhotoAttach onUploaded={(u) => add.mutate(u)} disabled={add.isPending} />
              <p className="text-xs text-muted-foreground">
                {t('invoiceGallery.count', { count: images.length, max: MAX_INVOICE_IMAGES })}
              </p>
            </div>
          )}
          {capError && (
            <p className="text-xs text-destructive" role="alert">
              {capError}
            </p>
          )}
        </div>
      )}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('invoiceGallery.fullSize')}
          // Intentionally theme-invariant (not the --overlay token): a cinema
          // surface behind full-size photos stays black in both themes.
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt={t('invoiceGallery.fullSize')}
            className="max-h-full max-w-full rounded-md"
          />
        </div>
      )}
    </div>
  )
}
