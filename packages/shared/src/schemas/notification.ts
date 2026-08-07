import { z } from 'zod'

// The landlord's in-app notification feed — recent vendor activity (incl.
// edits + withdrawals the SUBMITTED queue doesn't surface), with an unread count.
export const NotificationItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  contractorName: z.string().nullable(),
  invoiceId: z.string(),
  summary: z.string(),
  createdAt: z.coerce.date(),
  unread: z.boolean(),
})
export type NotificationItem = z.infer<typeof NotificationItemSchema>

export const NotificationFeedSchema = z.object({
  data: z.array(NotificationItemSchema),
  unreadCount: z.number(),
})
export type NotificationFeed = z.infer<typeof NotificationFeedSchema>
