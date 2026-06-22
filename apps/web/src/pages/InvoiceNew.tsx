import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/lib/apiClient'
import { InvoiceForm } from '@/components/InvoiceForm'
import { useCreateInvoice } from '@/hooks/useCreateInvoice'

export default function InvoiceNew() {
  const navigate = useNavigate()
  const { mutate, isPending, error } = useCreateInvoice()
  const serverError =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  return (
    <div className="max-w-2xl">
      <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
        ← Invoices
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-foreground">Create invoice</h1>
      <p className="text-muted-foreground mb-6">
        Fill in the details below to create a new invoice.
      </p>

      <InvoiceForm
        onSubmit={(values) =>
          mutate(values, {
            onSuccess: () => navigate('/invoices'),
          })
        }
        isSubmitting={isPending}
        serverError={serverError}
      />

      {/* Deferred: receipt scan + line items (photo-to-invoice OCR is a later phase). */}
      <div
        className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm text-muted-foreground"
        aria-disabled
      >
        <div className="font-medium text-foreground">
          Scan a receipt <span className="text-xs text-muted-foreground">Soon</span>
        </div>
        Snap a photo to auto-fill the amount, vendor, and line items. Coming in a later release.
      </div>
    </div>
  )
}
