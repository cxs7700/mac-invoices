import { useState } from 'react'
import { Link } from 'react-router'
import type { NotificationItem } from '@mac-invoices/shared'
import { useNotifications, useMarkNotificationsSeen } from '@/hooks/useNotifications'
import { formatDate } from '@/lib/format'

/** Bell + unread badge with a dropdown of recent contractor activity. Opening
 * the panel marks the feed seen (clears the badge); each item links to its
 * invoice. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const feed = useNotifications()
  const markSeen = useMarkNotificationsSeen()
  const items = feed.data?.data ?? []
  const unread = feed.data?.unreadCount ?? 0

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Opening clears unread: stamp the server marker (the badge refetches to 0).
    if (next && unread > 0) markSeen.mutate()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-foreground hover:bg-accent"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M10 3a4 4 0 0 0-4 4v2.5L4.5 13h11L14 9.5V7a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
          <path d="M8 16a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-card shadow-lg"
          >
            <div className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground">
              Notifications
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No contractor activity yet.
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-auto">
                {items.map((n) => (
                  <NotificationRow key={n.id} item={n} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NotificationRow({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  return (
    <li className={item.unread ? 'bg-accent/40' : undefined}>
      <Link
        to={`/invoices/${item.invoiceId}`}
        onClick={onNavigate}
        className="block px-4 py-3 text-sm hover:bg-accent"
      >
        <span className="text-foreground">
          <span className="font-medium">{item.contractorName ?? 'A contractor'}</span> {item.summary}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
      </Link>
    </li>
  )
}
