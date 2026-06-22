const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Display labels for invoice statuses — the single source for status text. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

/** Format an invoice amount (a string from the API, per CONV-013) for display. */
export function formatMoney(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return Number.isNaN(n) ? '—' : money.format(n)
}

/** Format a date (ISO string or Date) as e.g. "Jan 15, 2026" (UTC, date-only stable). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
}

/** Whether an invoice should display as overdue (unpaid + due date past). */
export function isOverdue(status: string, dueDate: string | Date | null | undefined): boolean {
  if (status !== 'PENDING' && status !== 'APPROVED') return false
  if (dueDate == null) return false
  return new Date(dueDate).getTime() < Date.now()
}
