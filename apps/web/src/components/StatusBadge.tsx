import { isOverdue, STATUS_LABEL } from '@/lib/format'

type Props = {
  status: string
  dueDate?: string | Date | null
}

/**
 * Renders an invoice status as a labeled pill. "Overdue" is derived (unpaid +
 * due date past), not a stored status. Always shows a text label + aria-label
 * so meaning isn't color-only.
 */
export function StatusBadge({ status, dueDate }: Props) {
  const overdue = isOverdue(status, dueDate)
  const label = overdue ? 'Overdue' : (STATUS_LABEL[status] ?? status)
  const tone = overdue
    ? 'bg-status-overdue text-status-overdue-foreground'
    : status === 'PAID'
      ? 'bg-status-paid text-status-paid-foreground'
      : 'bg-status-pending text-status-pending-foreground'

  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  )
}
