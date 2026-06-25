import { useTranslation } from 'react-i18next'
import type { TimelineEvent } from '@/hooks/useInvoiceEvents'
import { formatDate } from '@/lib/format'

type Tone = 'done' | 'current' | 'overdue' | 'terminal'

type TFn = (key: string) => string

const statusLabel = (t: TFn, s: unknown) => t(`status.${String(s)}`)

/** Derive the display label, optional sub-detail, and tone for one ledger event. */
function describe(e: TimelineEvent, t: TFn): { label: string; detail?: string; tone: Tone } {
  switch (e.type) {
    case 'CREATED':
      return { label: t('timeline.created'), tone: 'done' }
    case 'STATUS_CHANGED': {
      const { from, to } = e.detail as { from?: unknown; to?: unknown }
      const tone: Tone = to === 'PAID' ? 'done' : to === 'REJECTED' || to === 'CANCELLED' ? 'terminal' : 'current'
      return {
        label: from
          ? `${statusLabel(t, from)} → ${statusLabel(t, to)}`
          : `${t('timeline.marked')} ${statusLabel(t, to)}`,
        tone,
      }
    }
    case 'FIELD_EDITED': {
      const { field, old: oldV, new: newV } = e.detail as { field?: unknown; old?: unknown; new?: unknown }
      const fmt = (v: unknown) => (v == null || v === '' ? '—' : String(v))
      return {
        label: `${t('timeline.edited')} ${String(field ?? t('timeline.field'))}`,
        detail: `${fmt(oldV)} → ${fmt(newV)}`,
        tone: 'current',
      }
    }
    case 'DELETED':
      return { label: t('timeline.deleted'), tone: 'terminal' }
    case 'IMAGE_ATTACHED':
      return { label: t('timeline.photoAttached'), tone: 'done' }
    case 'IMAGE_REMOVED':
      return { label: t('timeline.photoRemoved'), tone: 'terminal' }
    default:
      return { label: e.type, tone: 'current' }
  }
}

const dot: Record<Tone, string> = {
  done: 'bg-status-paid-foreground',
  current: 'ring-2 ring-primary bg-card',
  overdue: 'bg-status-overdue-foreground',
  terminal: 'bg-status-overdue-foreground',
}

/**
 * Renders the invoice's real, recorded history from the event ledger. Events
 * marked RECONSTRUCTED (backfilled from an invoice's fields for rows that
 * predate the ledger) are labelled "inferred".
 */
export function InvoiceTimeline({
  events,
  isLoading,
}: {
  events: TimelineEvent[]
  isLoading?: boolean
}) {
  const { t } = useTranslation()
  if (isLoading) return <p className="text-sm text-muted-foreground">{t('timeline.loadingHistory')}</p>
  if (events.length === 0)
    return <p className="text-sm text-muted-foreground">{t('timeline.noHistory')}</p>

  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const { label, detail, tone } = describe(e, t)
        return (
          <li key={e.id} className="flex items-start gap-3">
            <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot[tone]}`} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm text-foreground">{label}</span>
                {e.source === 'RECONSTRUCTED' && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('timeline.inferred')}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
              </div>
              {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
              {e.actor.name && (
                <div className="text-xs text-muted-foreground">
                  {t('timeline.by')} {e.actor.name}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
