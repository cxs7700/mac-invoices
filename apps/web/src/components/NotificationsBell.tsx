import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { NotificationItem } from '@mac-invoices/shared'
import { useNotifications, useMarkNotificationsSeen } from '@/hooks/useNotifications'
import { formatDate } from '@/lib/format'

const PANEL_WIDTH = 320
const VIEWPORT_MARGIN = 8

/** Bell + unread badge with a dropdown of recent vendor activity. Opening
 * the panel marks the feed seen (clears the badge); each item links to its
 * invoice. */
export function NotificationsBell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number; maxHeight: number } | null>(
    null,
  )
  const feed = useNotifications()
  const markSeen = useMarkNotificationsSeen()
  const items = feed.data?.data ?? []
  const unread = feed.data?.unreadCount ?? 0

  /**
   * The panel is rendered in a portal and positioned from the bell's measured
   * rect. On desktop the bell sits inside the sidebar, which is `w-56` with
   * `overflow-y-auto` — an absolutely-positioned 320px panel inside a 224px
   * scroll container was clipped on both axes, which is why the notifications
   * appeared cut off. A portal escapes the clipping ancestor entirely.
   */
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // Prefer left-aligned with the bell, but never let the panel leave the
      // viewport on either side.
      const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))
      const top = rect.bottom + VIEWPORT_MARGIN
      setAnchor({ top, left, maxHeight: window.innerHeight - top - VIEWPORT_MARGIN })
    }
    place()
    // Reposition rather than drift: the sidebar scrolls, and so does the page.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Opening clears unread: stamp the server marker (the badge refetches to 0).
    if (next && unread > 0) markSeen.mutate()
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0 ? t('notifications.unreadAria', { count: unread }) : t('notifications.title')
        }
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-foreground hover:bg-accent"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path
            d="M10 3a4 4 0 0 0-4 4v2.5L4.5 13h11L14 9.5V7a4 4 0 0 0-4-4Z"
            strokeLinejoin="round"
          />
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

      {open &&
        anchor &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="dialog"
              aria-label={t('notifications.title')}
              style={{
                top: anchor.top,
                left: anchor.left,
                width: PANEL_WIDTH,
                maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                maxHeight: anchor.maxHeight,
              }}
              className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg"
            >
              <div className="shrink-0 border-b border-border px-4 py-2 text-sm font-semibold text-foreground">
                {t('notifications.title')}
              </div>
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {t('notifications.empty')}
                </p>
              ) : (
                // Bounded by the space actually left below the bell, not a fixed
                // 24rem that could run past the bottom of a short window.
                <ul className="divide-y divide-border overflow-auto">
                  {items.map((n) => (
                    <NotificationRow key={n.id} item={n} onNavigate={() => setOpen(false)} />
                  ))}
                </ul>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

function NotificationRow({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  const { t } = useTranslation()
  return (
    <li className={item.unread ? 'bg-accent/40' : undefined}>
      <Link
        to={`/invoices/${item.invoiceId}`}
        onClick={onNavigate}
        className="block px-4 py-3 text-sm hover:bg-accent"
      >
        <span className="text-foreground">
          <span className="font-medium">
            {item.vendorName ?? t('notifications.fallbackVendor')}
          </span>{' '}
          {item.summary}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatDate(item.createdAt)}
        </span>
      </Link>
    </li>
  )
}
