import { useState } from 'react'
import {
  useInvoiceImageUrl,
  useAttachInvoiceImage,
  useRemoveInvoiceImage,
} from '@/hooks/useInvoiceImage'
import { PhotoAttach } from './PhotoAttach'
import { Button } from './ui/button'

/**
 * The invoice's photo on the detail page: a thumbnail that opens full-size (a
 * handwritten invoice must be legible as proof), with attach / replace / remove.
 * An expired signed URL is refreshed once before giving up.
 */
export function InvoicePhoto({ invoiceId }: { invoiceId: string }) {
  const { data, isError, refetch } = useInvoiceImageUrl(invoiceId)
  const attach = useAttachInvoiceImage(invoiceId)
  const remove = useRemoveInvoiceImage(invoiceId)
  const [lightbox, setLightbox] = useState(false)
  const [refreshed, setRefreshed] = useState(false)

  const url = data?.url
  const hasPhoto = !!url && !isError

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Photo</h2>
      {hasPhoto ? (
        <div className="space-y-3">
          <button
            type="button"
            className="block w-full"
            onClick={() => setLightbox(true)}
            aria-label="View full-size photo"
          >
            <img
              src={url}
              alt="Invoice photo"
              className="max-h-48 w-full rounded-md border border-border object-cover"
              onError={() => {
                if (!refreshed) {
                  setRefreshed(true)
                  void refetch()
                }
              }}
            />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <PhotoAttach label="replacement" onUploaded={(u) => attach.mutate(u)} disabled={attach.isPending} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <PhotoAttach onUploaded={(u) => attach.mutate(u)} disabled={attach.isPending} />
      )}

      {lightbox && url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Invoice photo full size"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightbox(false)}
        >
          <img src={url} alt="Invoice photo full size" className="max-h-full max-w-full rounded-md" />
        </div>
      )}
    </div>
  )
}
