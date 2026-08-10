import type { InvoiceStatus } from '../schemas/invoice'

/**
 * The six invoice statuses mapped to six visually distinct tones.
 *
 * This is the mapping — not the colours. Each medium supplies its own palette:
 * the web resolves a tone to CSS custom properties (which carry light and dark
 * variants), the PDF resolves it to fixed RGB (an exported artifact is always
 * light — DEC-025e). Sharing the *mapping* rather than the hex is what keeps a
 * status the same idea in both places while letting each render it correctly.
 *
 * Hues are chosen so no two statuses collide, and so the ones a landlord acts
 * on stand out from the ones they don't:
 *
 * - PENDING   amber  — entered, awaiting the landlord's own action
 * - SUBMITTED blue   — arrived from a vendor, needs review
 * - APPROVED  violet — accepted, money still owed
 * - PAID      green  — settled, nothing outstanding
 * - REJECTED  red    — refused
 * - CANCELLED slate  — withdrawn; deliberately the quietest, since a cancelled
 *                      invoice is not a state anyone needs drawn to
 */
export const STATUS_TONES = ['amber', 'blue', 'violet', 'green', 'red', 'slate'] as const
export type StatusTone = (typeof STATUS_TONES)[number]

export const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  PENDING: 'amber',
  SUBMITTED: 'blue',
  APPROVED: 'violet',
  PAID: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
}

/** Tone for a status string, falling back to the quietest for anything unknown. */
export function statusTone(status: string): StatusTone {
  return STATUS_TONE[status as InvoiceStatus] ?? 'slate'
}
