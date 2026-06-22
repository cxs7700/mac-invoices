import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useInvoice, useUpdateInvoice, useDeleteInvoice } from '@/hooks/useInvoice'
import { StatusBadge } from '@/components/StatusBadge'
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
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: invoice, isPending, isError } = useInvoice(id)
  const update = useUpdateInvoice(id!)
  const del = useDeleteInvoice()
  const [confirmReject, setConfirmReject] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  return (
    <div>
      <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
        ← Invoices
      </Link>

      <div className="mt-3 grid gap-6 md:grid-cols-[1.6fr_1fr]">
        {/* Record */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold text-foreground">Invoice {invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} dueDate={invoice.dueDate} />
          </div>

          <div className="mb-6 rounded-md bg-muted p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {formatMoney(invoice.amount)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Vendor" value={invoice.vendorName} />
            <Field label="Category" value={invoice.category} />
            <Field label="Invoice date" value={formatDate(invoice.invoiceDate)} />
            <Field label="Due date" value={formatDate(invoice.dueDate)} />
            <Field label="Paid date" value={formatDate(invoice.paidDate)} />
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Description" value={invoice.description} />
            <Field label="Notes" value={invoice.notes} />
          </div>
        </div>

        {/* Action rail */}
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Actions</h2>
            <div className="space-y-2">
              <Button
                className="w-full"
                disabled={invoice.status === 'PAID' || update.isPending}
                onClick={() => update.mutate({ status: 'PAID' })}
              >
                Mark as paid
              </Button>

              <Button
                variant="outline"
                className="w-full"
                aria-label="Send reminder (coming soon)"
                title="Send reminder — coming soon"
                tabIndex={-1}
                disabled
              >
                Send reminder <span className="ml-1 text-xs text-muted-foreground">Soon</span>
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
                    Confirm reject
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmReject(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full text-destructive"
                  onClick={() => setConfirmReject(true)}
                >
                  Dispute / reject
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Timeline</h2>
            <InvoiceTimeline invoice={invoice} />
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
            <h3 className="font-semibold text-foreground">Delete invoice {invoice.invoiceNumber}?</h3>
            <p className="mt-1 text-sm text-muted-foreground">This can't be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  del.mutate(invoice.id, { onSuccess: () => navigate('/invoices', { replace: true }) })
                }
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
