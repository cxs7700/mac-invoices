import type { TimelineEvent } from '@/hooks/useInvoiceEvents'
import { STATUS_LABEL, formatDate } from '@/lib/format'

type Tone = 'done' | 'current' | 'overdue' | 'terminal'

const statusLabel = (s: unknown) => STATUS_LABEL[String(s)] ?? String(s)

/** Derive the display label, optional sub-detail, and tone for one ledger event. */
function describe(e: TimelineEvent): { label: string; detail?: string; tone: Tone } {
  switch (e.type) {
    case 'CREATED':
      return { label: 'Created', tone: 'done' }
    case 'STATUS_CHANGED': {
      const { from, to } = e.detail as { from?: unknown; to?: unknown }
      const tone: Tone = to === 'PAID' ? 'done' : to === 'REJECTED' || to === 'CANCELLED' ? 'terminal' : 'current'
      return { label: from ? `${statusLabel(from)} → ${statusLabel(to)}` : `Marked ${statusLabel(to)}`, tone }
    }
    case 'FIELD_EDITED': {
      const { field, old: oldV, new: newV } = e.detail as { field?: unknown; old?: unknown; new?: unknown }
      const fmt = (v: unknown) => (v == null || v === '' ? '—' : String(v))
      return { label: `Edited ${String(field ?? 'field')}`, detail: `${fmt(oldV)} → ${fmt(newV)}`, tone: 'current' }
    }
    case 'DELETED':
      return { label: 'Deleted', tone: 'terminal' }
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
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No recorded history yet.</p>

  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const { label, detail, tone } = describe(e)
        return (
          <li key={e.id} className="flex items-start gap-3">
            <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot[tone]}`} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm text-foreground">{label}</span>
                {e.source === 'RECONSTRUCTED' && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    inferred
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
              </div>
              {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
              {e.actor.name && <div className="text-xs text-muted-foreground">by {e.actor.name}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
