import { useTranslation } from 'react-i18next'
import { isOverdue } from '@/lib/format'

type Props = {
  status: string
  dueDate?: string | Date | null
}

/**
 * Renders an invoice status as a labeled pill. "Overdue" is derived (unpaid +
 * due date past), not a stored status. Always shows a text label + aria-label
 * so meaning isn't color-only.
 */
// Status-keyed tones (not a hardcoded ternary) so a new status reads distinctly.
// Unlisted statuses fall back to the neutral pending tone.
const TONE: Record<string, string> = {
  PAID: 'bg-status-paid text-status-paid-foreground',
  SUBMITTED: 'bg-status-submitted text-status-submitted-foreground',
  REJECTED: 'bg-status-overdue text-status-overdue-foreground',
}
const PENDING_TONE = 'bg-status-pending text-status-pending-foreground'

export function StatusBadge({ status, dueDate }: Props) {
  const { t } = useTranslation()
  const overdue = isOverdue(status, dueDate)
  const label = overdue ? t('status.overdue') : t(`status.${status}`, status)
  const tone = overdue
    ? 'bg-status-overdue text-status-overdue-foreground'
    : (TONE[status] ?? PENDING_TONE)

  return (
    <span
      role="status"
      aria-label={t('status.aria', { label })}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  )
}
