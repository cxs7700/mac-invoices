import { Link, useSearchParams } from 'react-router'
import { useInvoices } from '@/hooks/useInvoices'
import { InvoiceTable } from '@/components/InvoiceTable'
import { FilterBar } from '@/components/FilterBar'
import { Button } from '@/components/ui/button'
import {
  PAGE_SIZE,
  parseListParams,
  toQueryParams,
  toSearchParams,
  hasActiveFilters,
  type ListFilters,
} from '@/lib/listParams'

export default function InvoiceList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseListParams(searchParams)
  const { data, isPending, isError, refetch } = useInvoices(toQueryParams(filters))

  // Filter changes reset to page 1; pagination keeps the current filters.
  const applyFilter = (patch: Partial<ListFilters>) =>
    setSearchParams(toSearchParams({ ...filters, ...patch, page: 1 }))
  const goToPage = (page: number) =>
    setSearchParams(toSearchParams({ ...filters, page }))
  const clearAll = () => setSearchParams(new URLSearchParams())

  const total = data?.pagination.total ?? 0
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const filtersActive = hasActiveFilters(filters)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
        <Button asChild>
          <Link to="/invoices/new">New invoice</Link>
        </Button>
      </div>

      <FilterBar filters={filters} onChange={applyFilter} onClear={clearAll} />

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
        filtersActive ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center">
            <p className="font-medium text-foreground">No invoices match your filters</p>
            <button type="button" onClick={clearAll} className="mt-2 text-sm text-primary">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-10 text-center">
            <p className="font-medium text-foreground">No invoices yet</p>
            <Button asChild className="mt-3">
              <Link to="/invoices/new">Create invoice</Link>
            </Button>
          </div>
        )
      ) : (
        <>
          <InvoiceTable invoices={data.data} />
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {filters.page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => goToPage(filters.page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page >= pageCount}
                onClick={() => goToPage(filters.page + 1)}
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
