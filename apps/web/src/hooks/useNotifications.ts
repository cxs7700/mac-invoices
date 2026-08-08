import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationFeed } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// The landlord's in-app notification feed (vendor submissions, edits,
// withdrawals). Polls periodically so the unread badge stays roughly live
// without a websocket.

const FEED_KEY = ['notifications']
const POLL_MS = 60_000

export function useNotifications() {
  return useQuery<NotificationFeed>({
    queryKey: FEED_KEY,
    queryFn: () => apiClient<NotificationFeed>('/api/notifications'),
    retry: false,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  })
}

/** Mark the feed read (stamps the server-side seen marker), then refetch so the
 * unread badge clears. */
export function useMarkNotificationsSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient('/api/notifications/seen', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
  })
}
