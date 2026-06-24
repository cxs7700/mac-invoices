import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useInvoiceSummary } from '@/hooks/useInvoiceSummary'
import { useInvoices } from '@/hooks/useInvoices'
import { SpendBars } from '@/components/SpendBars'
import { InvoiceTable } from '@/components/InvoiceTable'
import { Button } from '@/components/ui/button'
import { formatMoney, STATUS_LABEL } from '@/lib/format'

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

export default function Dashboard() {
  const { data: summary, isPending, isError } = useInvoiceSummary()
  const recent = useInvoices({ limit: 5, sort: 'invoiceDate', order: 'desc' })

  if (isPending) return <div className="text-muted-foreground">Loading…</div>
  if (isError || !summary)
    return <div className="text-muted-foreground">Couldn't load the dashboard.</div>

  const outstanding = summary.byStatus
    .filter((s) => s.status === 'PENDING' || s.status === 'APPROVED')
    .reduce((sum, s) => sum + parseFloat(s.amount), 0)

  const catRows = summary.byCategory
    .filter((c) => c.count > 0)
    .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
    .map((c) => ({ key: c.category, label: titleCase(c.category), amount: c.amount, count: c.count }))

  const statRows = summary.byStatus
    .filter((s) => s.count > 0)
    .map((s) => ({ key: s.status, label: STATUS_LABEL[s.status] ?? s.status, amount: s.amount, count: s.count }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <Button asChild>
          <Link to="/invoices/new">New invoice</Link>
        </Button>
      </div>

      {summary.total.count === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">No invoices yet.</p>
          <Button asChild className="mt-3">
            <Link to="/invoices/new">Create your first invoice</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total spend" value={formatMoney(summary.total.amount)} />
            <Stat label="Outstanding" value={formatMoney(outstanding)} />
            <Stat label="Invoices" value={String(summary.total.count)} />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Spend by category">
              <SpendBars rows={catRows} />
            </Card>
            <Card title="By status">
              <SpendBars rows={statRows} />
            </Card>
          </div>

          <Card
            title="Recent invoices"
            action={
              <Link to="/invoices" className="text-sm text-primary">
                View all
              </Link>
            }
          >
            {recent.data && recent.data.data.length > 0 ? (
              <InvoiceTable invoices={recent.data.data} />
            ) : (
              <p className="text-sm text-muted-foreground">No invoices.</p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-foreground tabular-nums">{value}</div>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}
