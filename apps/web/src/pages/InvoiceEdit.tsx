import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { CreateInvoiceInput, InvoiceCategory } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { InvoiceForm } from '@/components/InvoiceForm'
import { Button } from '@/components/ui/button'
import { useInvoice, useUpdateInvoice } from '@/hooks/useInvoice'
import type { Invoice } from '@/hooks/useInvoice'

/** Map a fetched invoice onto the form's default values (dates → yyyy-mm-dd).
 * The invoice number is system-assigned and immutable, so it's not a form field
 * (it stays visible in the page heading below). */
function toDefaults(invoice: Invoice) {
  return {
    vendorName: invoice.vendorName,
    vendorEmail: invoice.vendorEmail ?? undefined,
    vendorId: invoice.vendorId ?? undefined,
    items: [...invoice.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ description: i.description, quantity: i.quantity, total: Number(i.total) })),
    currency: invoice.currency,
    // A vendor submission may be uncategorized; default the form to OTHER so
    // the required category select has a valid value (the landlord can change it).
    category: (invoice.category ?? 'OTHER') as InvoiceCategory,
    propertyId: invoice.propertyId ?? undefined,
    invoiceDate: invoice.invoiceDate.slice(0, 10),
    notes: invoice.notes ?? undefined,
    partsOrdered: invoice.partsOrdered ?? undefined,
  }
}

export default function InvoiceEdit() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: invoice, isPending, isError } = useInvoice(id)
  const update = useUpdateInvoice(id!)

  if (isPending) return <div className="text-muted-foreground">{t('invoiceEdit.loading')}</div>
  if (isError || !invoice)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">{t('invoiceEdit.notFound')}</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/invoices">{t('invoiceEdit.backToInvoices')}</Link>
        </Button>
      </div>
    )

  const serverError =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? t('invoiceEdit.genericError')
        : null

  const handleSubmit = (values: CreateInvoiceInput) =>
    update.mutate(values, {
      onSuccess: () => navigate(`/invoices/${invoice.id}`),
    })

  return (
    <div className="max-w-2xl">
      <Link
        to={`/invoices/${invoice.id}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t('invoiceEdit.backToInvoice')}
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-foreground">
        {t('invoiceEdit.title', { number: invoice.invoiceNumber })}
      </h1>

      <InvoiceForm
        onSubmit={handleSubmit}
        defaultValues={toDefaults(invoice)}
        isSubmitting={update.isPending}
        serverError={serverError}
        submitLabel={t('invoiceEdit.saveChanges')}
      />
    </div>
  )
}
