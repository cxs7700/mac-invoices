import { useTranslation } from 'react-i18next'

type Props = {
  status: string
}

/**
 * Renders an invoice status as a labeled pill. Always shows a text label +
 * aria-label so meaning isn't color-only.
 */
// Status-keyed tones (not a hardcoded ternary) so a new status reads distinctly.
// Unlisted statuses fall back to the neutral pending tone.
const TONE: Record<string, string> = {
  PAID: 'bg-status-paid text-status-paid-foreground',
  SUBMITTED: 'bg-status-submitted text-status-submitted-foreground',
  REJECTED: 'bg-status-overdue text-status-overdue-foreground',
}
const PENDING_TONE = 'bg-status-pending text-status-pending-foreground'

export function StatusBadge({ status }: Props) {
  const { t } = useTranslation()
  const label = t(`status.${status}`, status)
  const tone = TONE[status] ?? PENDING_TONE

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
