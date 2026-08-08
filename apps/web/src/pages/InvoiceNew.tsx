import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { InvoiceForm } from '@/components/InvoiceForm'
import { PhotoAttach } from '@/components/PhotoAttach'
import { Button } from '@/components/ui/button'
import { useCreateInvoice } from '@/hooks/useCreateInvoice'

export default function InvoiceNew() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { mutate, isPending, error } = useCreateInvoice()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const serverError =
    error instanceof ApiError ? error.message : error ? t('invoiceNew.genericError') : null

  return (
    <div className="max-w-2xl">
      <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
        {t('invoiceNew.backToInvoices')}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-foreground">{t('invoiceNew.title')}</h1>
      <p className="text-muted-foreground mb-6">{t('invoiceNew.subtitle')}</p>

      {/* Attach the vendor's invoice photo as proof (optional). */}
      <div className="mb-6 rounded-lg border border-border bg-card p-5">
        <div className="mb-2 text-sm font-medium text-foreground">
          {t('invoiceNew.invoicePhoto')}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {t('invoiceNew.optional')}
          </span>
        </div>
        {photoUrl ? (
          <div className="flex items-center gap-3 text-sm text-foreground">
            <span className="text-status-paid-foreground">{t('invoiceNew.photoAttached')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPhotoUrl(null)}>
              {t('invoiceNew.remove')}
            </Button>
          </div>
        ) : (
          <PhotoAttach onUploaded={setPhotoUrl} disabled={isPending} />
        )}
      </div>

      <InvoiceForm
        onSubmit={(values) =>
          mutate(
            { ...values, images: photoUrl ? [{ url: photoUrl, type: 'OTHER' }] : undefined },
            // Land on the new invoice's detail so the gallery + add-photo affordance
            // are right there (the "create now, photograph later" loop — F1).
            { onSuccess: (created) => navigate(`/invoices/${created.id}`) },
          )
        }
        isSubmitting={isPending}
        serverError={serverError}
      />
    </div>
  )
}
