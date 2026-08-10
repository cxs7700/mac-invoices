import { useTranslation } from 'react-i18next'
import { statusTone, type StatusTone } from '@mac-invoices/shared'

type Props = {
  status: string
}

/**
 * Renders an invoice status as a labeled pill. Always shows a text label +
 * aria-label so meaning isn't color-only.
 */
// Resolved through the shared status→tone mapping, so a status is the same
// colour on this pill, on the filter chips and on the exported PDF. Previously
// this file listed three statuses and swept PENDING, APPROVED and CANCELLED
// into one grey, which meant Approved read violet in the filters and grey here.
const TONE: Record<StatusTone, string> = {
  amber: 'bg-tone-amber text-tone-amber-foreground',
  blue: 'bg-tone-blue text-tone-blue-foreground',
  violet: 'bg-tone-violet text-tone-violet-foreground',
  green: 'bg-tone-green text-tone-green-foreground',
  red: 'bg-tone-red text-tone-red-foreground',
  slate: 'bg-tone-slate text-tone-slate-foreground',
}

export function StatusBadge({ status }: Props) {
  const { t } = useTranslation()
  const label = t(`status.${status}`, status)
  const tone = TONE[statusTone(status)]

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
