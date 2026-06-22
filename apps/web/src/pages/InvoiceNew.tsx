import { ApiError } from '@/lib/apiClient'
import { InvoiceForm } from '@/components/InvoiceForm'
import { useCreateInvoice } from '@/hooks/useCreateInvoice'

export default function InvoiceNew() {
  const { mutate, isPending, isSuccess, error } = useCreateInvoice()
  const serverError =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-foreground mb-2">Create invoice</h1>
      <p className="text-muted-foreground mb-6">
        Fill in the details below to create a new invoice.
      </p>

      {isSuccess && (
        <p className="mb-4 text-sm text-green-600" role="status">
          Invoice created.
        </p>
      )}

      <InvoiceForm
        onSubmit={(values) => mutate(values)}
        isSubmitting={isPending}
        serverError={serverError}
      />
    </div>
  )
}
