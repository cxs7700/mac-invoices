import { useQuery } from '@tanstack/react-query'
import type { EventType, EventSource } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// The wire shape of a ledger event (createdAt is a JSON string here, not a Date).
// `detail` is an open record; the timeline narrows it per `type` when rendering.
export type TimelineEvent = {
  id: string
  invoiceId: string
  type: EventType
  source: EventSource
  detail: Record<string, unknown>
  actor: { id: string; name: string | null }
  createdAt: string
}

/** The invoice's ledger history (oldest-first), driving the detail timeline. */
export function useInvoiceEvents(id: string | undefined) {
  return useQuery<TimelineEvent[]>({
    queryKey: ['invoice-events', id],
    queryFn: async () =>
      (await apiClient<{ data: TimelineEvent[] }>(`/api/invoices/${id}/events`)).data,
    enabled: !!id,
    retry: false,
  })
}
