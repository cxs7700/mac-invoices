import type { Invoice } from '@/hooks/useInvoice'
import { formatDate, isOverdue } from '@/lib/format'

type Node = { label: string; date?: string | null; tone: 'done' | 'current' | 'overdue' | 'terminal' }

/** A data-backed status progression (no fabricated "Viewed" step). */
function nodesFor(invoice: Invoice): Node[] {
  const nodes: Node[] = [{ label: 'Created', date: invoice.createdAt, tone: 'done' }]
  if (isOverdue(invoice.status, invoice.dueDate)) {
    nodes.push({ label: 'Overdue', date: invoice.dueDate, tone: 'overdue' })
  }
  if (invoice.status === 'PAID') {
    nodes.push({ label: 'Paid', date: invoice.paidDate, tone: 'done' })
  } else if (invoice.status === 'REJECTED') {
    nodes.push({ label: 'Rejected', tone: 'terminal' })
  } else if (invoice.status === 'CANCELLED') {
    nodes.push({ label: 'Cancelled', tone: 'terminal' })
  } else {
    nodes.push({ label: 'Awaiting payment', tone: 'current' })
  }
  return nodes
}

const dot: Record<Node['tone'], string> = {
  done: 'bg-status-paid-foreground',
  current: 'ring-2 ring-primary bg-card',
  overdue: 'bg-status-overdue-foreground',
  terminal: 'bg-status-overdue-foreground',
}

export function InvoiceTimeline({ invoice }: { invoice: Invoice }) {
  return (
    <ol className="space-y-3">
      {nodesFor(invoice).map((n, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot[n.tone]}`} aria-hidden />
          <span className="text-sm text-foreground">{n.label}</span>
          {n.date && <span className="text-xs text-muted-foreground">{formatDate(n.date)}</span>}
        </li>
      ))}
    </ol>
  )
}
