import { describe, it, expect, vi } from 'vitest'
import { sweepOrphanBlobs } from '../prisma/sweep-orphan-blobs'
import type { StoredBlob } from '../src/integrations/storage'

const NOW = new Date('2026-06-26T12:00:00.000Z').getTime()
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000)

// A referenced blob (has an InvoiceImage row), a stale orphan (old, no row), and a
// fresh not-yet-attached upload (no row but within the grace window).
const blobs: StoredBlob[] = [
  { url: 'https://blob/owners/u1/referenced.jpg', pathname: 'owners/u1/referenced.jpg', uploadedAt: hoursAgo(48) },
  { url: 'https://blob/owners/u1/stale-orphan.jpg', pathname: 'owners/u1/stale-orphan.jpg', uploadedAt: hoursAgo(48) },
  { url: 'https://blob/owners/u1/fresh-upload.jpg', pathname: 'owners/u1/fresh-upload.jpg', uploadedAt: hoursAgo(1) },
]

function deps(over: Partial<Parameters<typeof sweepOrphanBlobs>[0]> = {}) {
  return {
    prisma: {
      invoiceImage: {
        // Stored as a full URL — the sweep canonicalizes to pathname to compare.
        findMany: vi.fn(async () => [{ url: 'https://blob/owners/u1/referenced.jpg' }]),
      },
    },
    listAllBlobs: vi.fn(async () => blobs),
    deleteBlob: vi.fn(async () => {}),
    ...over,
  } as unknown as Parameters<typeof sweepOrphanBlobs>[0]
}

describe('sweepOrphanBlobs', () => {
  it('identifies only stale, unreferenced blobs (dry run deletes nothing)', async () => {
    const d = deps()
    const r = await sweepOrphanBlobs(d, { now: NOW })
    expect(r.scanned).toBe(3)
    expect(r.referenced).toBe(1)
    expect(r.orphans).toBe(1)
    expect(r.orphanPathnames).toEqual(['owners/u1/stale-orphan.jpg'])
    expect(r.deleted).toBe(0)
    expect(d.deleteBlob).not.toHaveBeenCalled() // dry run
  })

  it('does not sweep a fresh upload still inside the grace window', async () => {
    const r = await sweepOrphanBlobs(deps(), { now: NOW })
    // fresh-upload (1h old, no row) is NOT an orphan — it may be mid-attach.
    expect(r.orphanPathnames).not.toContain('owners/u1/fresh-upload.jpg')
  })

  it('reclaims orphans only with --apply (best-effort across failures)', async () => {
    const d = deps({
      listAllBlobs: vi.fn(async () => [
        { url: 'https://blob/owners/u1/a.jpg', pathname: 'owners/u1/a.jpg', uploadedAt: hoursAgo(48) },
        { url: 'https://blob/owners/u1/b.jpg', pathname: 'owners/u1/b.jpg', uploadedAt: hoursAgo(48) },
      ]),
      prisma: { invoiceImage: { findMany: vi.fn(async () => []) } },
      // First delete fails; the sweep must continue to the second.
      deleteBlob: vi.fn().mockRejectedValueOnce(new Error('storage down')).mockResolvedValue(undefined),
    } as unknown as Parameters<typeof sweepOrphanBlobs>[0])

    const r = await sweepOrphanBlobs(d, { apply: true, now: NOW })
    expect(r.orphans).toBe(2)
    // The first delete failed; the sweep continues and counts honestly.
    expect(r.deleted).toBe(1)
    expect(r.failed).toBe(1)
    expect(d.deleteBlob).toHaveBeenCalledTimes(2)
  })

  it('treats a blob referenced by a bare-pathname row as referenced (path canonicalization)', async () => {
    const d = deps({
      listAllBlobs: vi.fn(async () => [
        { url: 'https://blob/owners/u1/x.jpg', pathname: 'owners/u1/x.jpg', uploadedAt: hoursAgo(48) },
      ]),
      // Row stores a bare pathname rather than a full URL — must still match.
      prisma: { invoiceImage: { findMany: vi.fn(async () => [{ url: 'owners/u1/x.jpg' }]) } },
    } as unknown as Parameters<typeof sweepOrphanBlobs>[0])
    const r = await sweepOrphanBlobs(d, { now: NOW })
    expect(r.orphans).toBe(0)
  })
})
