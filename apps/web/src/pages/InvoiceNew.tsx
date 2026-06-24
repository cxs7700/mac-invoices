import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/lib/apiClient'
import { InvoiceForm } from '@/components/InvoiceForm'
import { PhotoAttach } from '@/components/PhotoAttach'
import { Button } from '@/components/ui/button'
import { useCreateInvoice } from '@/hooks/useCreateInvoice'

export default function InvoiceNew() {
  const navigate = useNavigate()
  const { mutate, isPending, error } = useCreateInvoice()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
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

      {/* Attach the contractor's invoice photo as proof (optional). */}
      <div className="mb-6 rounded-lg border border-border bg-card p-5">
        <div className="mb-2 text-sm font-medium text-foreground">
          Invoice photo <span className="text-xs font-normal text-muted-foreground">optional</span>
        </div>
        {photoUrl ? (
          <div className="flex items-center gap-3 text-sm text-foreground">
            <span className="text-status-paid-foreground">✓ Photo attached</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPhotoUrl(null)}>
              Remove
            </Button>
          </div>
        ) : (
          <PhotoAttach onUploaded={setPhotoUrl} disabled={isPending} />
        )}
      </div>

      <InvoiceForm
        onSubmit={(values) =>
          mutate(
            { ...values, image: photoUrl ? { url: photoUrl, type: 'OTHER' } : undefined },
            { onSuccess: () => navigate('/invoices') },
          )
        }
        isSubmitting={isPending}
        serverError={serverError}
      />
    </div>
  )
}
