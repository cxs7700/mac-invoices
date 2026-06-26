import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

/**
 * The actionable "add a photo" affordance for an active, photo-less invoice
 * (R8/R9). On the list it's a compact pill linking to the invoice detail (where
 * the gallery's add control lives); on the detail page it's a fuller call-to-
 * action. Rendered only when `needsPhoto` is true — the caller gates it.
 */
export function AddPhotoIndicator({
  invoiceId,
  variant = 'pill',
}: {
  invoiceId: string
  variant?: 'pill' | 'cta'
}) {
  const { t } = useTranslation()

  if (variant === 'cta') {
    return (
      <Link
        to={`/invoices/${invoiceId}`}
        className="flex items-center gap-2 rounded-md border border-status-pending bg-status-pending/20 px-3 py-2 text-sm font-medium text-foreground hover:bg-status-pending/30"
      >
        <span aria-hidden>📷</span>
        {t('addPhoto.cta')}
      </Link>
    )
  }

  return (
    <Link
      to={`/invoices/${invoiceId}`}
      aria-label={t('addPhoto.ariaList')}
      className="inline-flex items-center gap-1 rounded-full border border-status-pending bg-status-pending/20 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-status-pending/30"
    >
      <span aria-hidden>＋</span>
      {t('addPhoto.badge')}
    </Link>
  )
}
