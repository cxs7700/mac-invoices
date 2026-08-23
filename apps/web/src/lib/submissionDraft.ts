import { z } from 'zod'
import { ImageType } from '@mac-invoices/shared'

/**
 * A vendor's unfinished submission, kept on their own device.
 *
 * The submission page held everything in `useState` alone, so a backgrounded
 * tab, a reload, a flat battery or a phone call mid-form discarded the lot —
 * silently, with no error and no recovery but retyping. That is the failure
 * this flow is most exposed to and the one that never gets reported: a vendor
 * who loses a half-filled invoice does not file a bug, they text the invoice
 * instead, exactly as they did before the submission link existed.
 *
 * Photos are worth more than the typing. They are uploaded before submit, so a
 * restored draft recovers minutes of field LTE, not just a few characters.
 */

const DraftSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        quantity: z.string(),
        total: z.string(),
      }),
    )
    .max(200),
  invoiceDate: z.string(),
  notes: z.string(),
  partsOrdered: z.string(),
  category: z.string(),
  propertyId: z.string(),
  photos: z.array(z.object({ url: z.string(), type: ImageType })).max(50),
  savedAt: z.number(),
})

export type SubmissionDraft = z.infer<typeof DraftSchema>
export type DraftFields = Omit<SubmissionDraft, 'savedAt'>

/**
 * Drafts older than this are dropped on read. A vendor returning a week later
 * is on a different job, and the uploaded blobs behind the draft are stale by
 * then — restoring it would be a confusing gift, not a rescue.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PREFIX = 'rentops.submission-draft.'

/**
 * The storage key is derived from the link token, never the token itself.
 * The token is the vendor's credential; it is already on the device in the URL
 * and history, but writing it into a localStorage key spreads it further for no
 * benefit. FNV-1a is not doing security work here — it only has to separate one
 * vendor link from another on a shared device, so a non-cryptographic hash is
 * the right tool and its collision odds across a handful of links are nil.
 */
function keyFor(token: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return PREFIX + hash.toString(16)
}

/** True when the form holds nothing worth keeping. */
export function isEmptyDraft(fields: DraftFields): boolean {
  return (
    !fields.invoiceDate &&
    !fields.propertyId &&
    !fields.category &&
    !fields.notes.trim() &&
    !fields.partsOrdered.trim() &&
    fields.photos.length === 0 &&
    fields.items.every((item) => !item.description.trim() && !item.total.trim())
  )
}

/** The stored draft for this link, or null if absent, unreadable, or stale. */
export function loadDraft(token: string, now = Date.now()): DraftFields | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(keyFor(token))
  } catch {
    return null // Private mode, or storage disabled.
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearDraft(token)
    return null
  }

  // Validated rather than trusted: this survives deploys, so a draft written by
  // an older shape must be dropped cleanly instead of crashing the page a
  // vendor is standing in a driveway trying to use.
  const result = DraftSchema.safeParse(parsed)
  if (!result.success) {
    clearDraft(token)
    return null
  }
  if (now - result.data.savedAt > MAX_AGE_MS) {
    clearDraft(token)
    return null
  }

  const { savedAt: _savedAt, ...fields } = result.data
  return fields
}

/** Persist the draft, or clear it when there is nothing left worth keeping. */
export function saveDraft(token: string, fields: DraftFields, now = Date.now()): void {
  if (isEmptyDraft(fields)) {
    clearDraft(token)
    return
  }
  try {
    localStorage.setItem(keyFor(token), JSON.stringify({ ...fields, savedAt: now }))
  } catch {
    // Quota or private mode. The form still works for this visit; it just will
    // not survive a reload — strictly the behaviour before drafts existed.
  }
}

export function clearDraft(token: string): void {
  try {
    localStorage.removeItem(keyFor(token))
  } catch {
    // Nothing to do; a draft we cannot remove is one we also could not write.
  }
}
