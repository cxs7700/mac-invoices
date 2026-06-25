import { Link, useParams } from 'react-router'
import { useProperty } from '@/hooks/useProperties'
import { useInvoices } from '@/hooks/useInvoices'
import { InvoiceTable } from '@/components/InvoiceTable'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'

/** A property's detail: header + total-spend rollup, and the invoices assigned to
 * it (reusing the invoice list filtered by propertyId — no new endpoint). */
export default function PropertyDetail() {
  const { id } = useParams()
  const { data: property, isPending, isError } = useProperty(id!)
  const invoices = useInvoices({ propertyId: id })

  if (isPending) return <div className="text-muted-foreground">Loading…</div>
  if (isError || !property)
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Property not found.</p>
        <Button variant="outline" className="mt-3" asChild>
          <Link to="/properties">Back to properties</Link>
        </Button>
      </div>
    )

  const rows = invoices.data?.data ?? []

  return (
    <div className="max-w-4xl">
      <Link to="/properties" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to properties
      </Link>

      <div className="mt-2 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{property.name}</h1>
          <p className="text-sm text-muted-foreground">{property.address}</p>
          {property.notes && <p className="mt-1 text-sm text-muted-foreground">{property.notes}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total spend</div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {formatMoney(property.totalSpend)}
          </div>
          <Link to={`/properties/${property.id}/edit`} className="text-sm text-muted-foreground hover:text-foreground">
            Edit
          </Link>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-foreground">Invoices</h2>
      {invoices.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invoices.isError ? (
        <p className="text-sm text-destructive">Couldn't load invoices.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices assigned to this property yet.</p>
      ) : (
        <InvoiceTable invoices={rows} />
      )}
    </div>
  )
}
