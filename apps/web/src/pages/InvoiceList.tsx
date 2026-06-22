import { useState } from 'react'
import { Link } from 'react-router'
import { useInvoices } from '@/hooks/useInvoices'
import { InvoiceTable } from '@/components/InvoiceTable'
import { Button } from '@/components/ui/button'

const STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED']
const PAGE_SIZE = 20

export default function InvoiceList() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const { data, isPending, isError, refetch } = useInvoices({
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const total = data?.pagination.total ?? 0
  const pageCount = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
        <Button asChild>
          <Link to="/invoices/new">New invoice</Link>
        </Button>
      </div>

      <div className="mb-4">
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(0)
          }}
          className="rounded-md border border-input bg-card px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isPending ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Failed to load invoices.</p>
          <Button variant="outline" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : data.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <p className="font-medium text-foreground">
            {status ? 'No invoices match this filter' : 'No invoices yet'}
          </p>
          {status ? (
            <button
              type="button"
              onClick={() => setStatus('')}
              className="mt-2 text-sm text-primary"
            >
              Clear filter
            </button>
          ) : (
            <Button asChild className="mt-3">
              <Link to="/invoices/new">New invoice</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <InvoiceTable invoices={data.data} />
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {page + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
