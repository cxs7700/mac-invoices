// The add-photo indicator is derived, not stored (KTD-7): an *active* invoice
// (PENDING / PAID) with zero photos is the one place where "add a
// photo" is a sensible next step. Terminal invoices (REJECTED / CANCELLED) and
// any invoice that already has a photo show nothing. SUBMITTED always has >=1
// photo (the vendor proof) so it never qualifies.
const ACTIVE_STATUSES = new Set(['PENDING', 'PAID'])

export function needsPhoto(status: string, imageCount: number): boolean {
  return imageCount === 0 && ACTIVE_STATUSES.has(status)
}
