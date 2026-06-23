import { Link, useNavigate, useParams } from 'react-router'
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
    description: invoice.description,
    amount: Number(invoice.amount),
    currency: invoice.currency,
    category: invoice.category as InvoiceCategory,
    propertyId: invoice.propertyId ?? undefined,
    invoiceDate: invoice.invoiceDate.slice(0, 10),
    dueDate: invoice.dueDate ? invoice.dueDate.slice(0, 10) : undefined,
    notes: invoice.notes ?? undefined,
  }
}

export default function InvoiceEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: invoice, isPending, isError } = useInvoice(id)
  const update = useUpdateInvoice(id!)

  if (isPending) return <div className="text-muted-foreground">Loading…</div>
  if (isError || !invoice)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/invoices">Back to invoices</Link>
        </Button>
      </div>
    )

  const serverError =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? 'Something went wrong'
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
        ← Back to invoice
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold text-foreground">
        Edit invoice {invoice.invoiceNumber}
      </h1>

      <InvoiceForm
        onSubmit={handleSubmit}
        defaultValues={toDefaults(invoice)}
        isSubmitting={update.isPending}
        serverError={serverError}
        submitLabel="Save changes"
      />
    </div>
  )
}
