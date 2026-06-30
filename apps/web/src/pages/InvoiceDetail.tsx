import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import type { InvoiceCategory } from '@mac-invoices/shared'
import { useInvoice, useUpdateInvoice, useDeleteInvoice } from '@/hooks/useInvoice'
import { useInvoiceEvents } from '@/hooks/useInvoiceEvents'
import { StatusBadge } from '@/components/StatusBadge'
import { SyncBadge } from '@/components/SyncBadge'
import { ReviewActions } from '@/components/ReviewActions'
import { InvoiceImageGallery } from '@/components/InvoiceImageGallery'
import { AddPhotoIndicator } from '@/components/AddPhotoIndicator'
import { needsPhoto } from '@/lib/needsPhoto'
import { InvoiceTimeline } from '@/components/InvoiceTimeline'
import { formatMoney, formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value || '—'}</div>
    </div>
  )
}

export default function InvoiceDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: invoice, isPending, isError } = useInvoice(id)
  const { data: events, isPending: eventsPending } = useInvoiceEvents(id)
  const update = useUpdateInvoice(id!)
  const del = useDeleteInvoice()
  const [confirmReject, setConfirmReject] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (isPending) return <div className="text-muted-foreground">{t('invoiceDetail.loading')}</div>
  if (isError || !invoice)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">{t('invoiceDetail.notFound')}</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/invoices">{t('invoiceDetail.backToInvoices')}</Link>
        </Button>
      </div>
    )

  return (
    <div>
      <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
        {t('invoiceDetail.invoicesBack')}
      </Link>

      <div className="mt-3 grid gap-6 md:grid-cols-[1.6fr_1fr]">
        {/* Record */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold text-foreground">
              {invoice.invoiceNumber
                ? `${t('invoiceDetail.invoice')} ${invoice.invoiceNumber}`
                : t('invoiceDetail.submission')}
            </h1>
            <div className="flex items-center gap-2">
              <SyncBadge sheetsSyncedAt={invoice.sheetsSyncedAt} updatedAt={invoice.updatedAt} />
              <StatusBadge status={invoice.status} />
            </div>
          </div>

          <div className="mb-6 rounded-md bg-muted p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('invoiceDetail.amount')}
            </div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {formatMoney(invoice.amount)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('invoiceDetail.vendor')} value={invoice.vendorName} />
            <Field
              label={t('invoiceDetail.category')}
              value={invoice.category ? t(`category.${invoice.category}`) : t('invoiceDetail.uncategorized')}
            />
            {invoice.submitterName && (
              <Field label={t('invoiceDetail.submittedBy')} value={invoice.submitterName} />
            )}
            <Field label={t('invoiceDetail.invoiceDate')} value={formatDate(invoice.invoiceDate)} />
            <Field label={t('invoiceDetail.paidDate')} value={formatDate(invoice.paidDate)} />
          </div>

          {invoice.status === 'REJECTED' && invoice.rejectionReason && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="text-xs uppercase tracking-wide text-destructive">
                {t('invoiceDetail.rejectionReason')}
              </div>
              <div className="text-sm text-foreground">{invoice.rejectionReason}</div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            <Field label={t('invoiceDetail.description')} value={invoice.description} />
            <Field label={t('invoiceDetail.notes')} value={invoice.notes} />
            <Field label={t('invoiceDetail.partsOrdered')} value={invoice.partsOrdered} />
          </div>
        </div>

        {/* Action rail */}
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t('invoiceDetail.actions')}</h2>
            <div className="space-y-2">
              {invoice.status === 'SUBMITTED' ? (
                <ReviewActions
                  isPending={update.isPending}
                  onApprove={(category, propertyId) =>
                    update.mutate({ status: 'APPROVED', category: category as InvoiceCategory, propertyId })
                  }
                  onReject={(reason) => update.mutate({ status: 'REJECTED', rejectionReason: reason })}
                />
              ) : (
                <>
                  <Button
                    className="w-full"
                    disabled={invoice.status === 'PAID' || update.isPending}
                    onClick={() => update.mutate({ status: 'PAID' })}
                  >
                    {t('invoiceDetail.markAsPaid')}
                  </Button>

                  {confirmReject ? (
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => {
                          update.mutate({ status: 'REJECTED' })
                          setConfirmReject(false)
                        }}
                      >
                        {t('invoiceDetail.confirmReject')}
                      </Button>
                      <Button variant="outline" className="flex-1" onClick={() => setConfirmReject(false)}>
                        {t('invoiceDetail.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full text-destructive"
                      onClick={() => setConfirmReject(true)}
                    >
                      {t('invoiceDetail.disputeReject')}
                    </Button>
                  )}
                </>
              )}

              <Button variant="outline" className="w-full" asChild>
                <Link to={`/invoices/${invoice.id}/edit`}>{t('invoiceDetail.edit')}</Link>
              </Button>

              <Button
                variant="outline"
                className="w-full"
                aria-label={t('invoiceDetail.sendReminderAria')}
                title={t('invoiceDetail.sendReminderTitle')}
                tabIndex={-1}
                disabled
              >
                {t('invoiceDetail.sendReminder')}{' '}
                <span className="ml-1 text-xs text-muted-foreground">{t('invoiceDetail.soon')}</span>
              </Button>

              <Button
                variant="outline"
                className="w-full text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                {t('invoiceDetail.delete')}
              </Button>
            </div>
          </div>

          {needsPhoto(invoice.status, invoice.imageCount) && (
            <AddPhotoIndicator invoiceId={invoice.id} variant="cta" />
          )}

          <InvoiceImageGallery invoiceId={invoice.id} />

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t('invoiceDetail.timeline')}</h2>
            <InvoiceTimeline events={events ?? []} isLoading={eventsPending} />
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold text-foreground">
              {t('invoiceDetail.deleteConfirmPrefix')} {invoice.invoiceNumber}
              {t('invoiceDetail.deleteConfirmSuffix')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('invoiceDetail.deleteUndone')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                {t('invoiceDetail.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  del.mutate(invoice.id, { onSuccess: () => navigate('/invoices', { replace: true }) })
                }
              >
                {t('invoiceDetail.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
