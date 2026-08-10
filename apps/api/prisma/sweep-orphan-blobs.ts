import { pathToFileURL } from 'node:url'
import { prisma as defaultPrisma } from '../src/lib/prisma'
import {
  listAllBlobs as defaultListAllBlobs,
  deleteBlob as defaultDeleteBlob,
  toPathname,
  type StoredBlob,
} from '../src/integrations/storage'

// SEC-005: reclaim orphaned upload-token blobs — uploads that were never attached
// to an invoice (a landlord cancelled, a vendor abandoned a submission, or a
// 6th upload hit the cap). They are never row-referenced and otherwise accumulate
// forever. A blob is an orphan when no InvoiceImage row references its pathname.
//
// A grace window (default 24h) protects in-flight and just-completed uploads: a
// blob is uploaded BEFORE its row is written, so a brand-new blob with no row yet
// is not an orphan, just not-yet-attached. Only blobs older than the window are
// eligible. Defaults to a DRY RUN — pass `--apply` to actually delete.
//
// Run with `npm run db:sweep-orphan-blobs` (dry run) or `... -- --apply`. It is
// NOT a Prisma migration and does not run on `prisma migrate deploy`.

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000 // 24h

type Deps = {
  prisma: Pick<typeof defaultPrisma, 'invoiceImage'>
  listAllBlobs: (prefix?: string) => Promise<StoredBlob[]>
  deleteBlob: (url: string) => Promise<void>
}
type Opts = { apply?: boolean; minAgeMs?: number; now?: number }

export async function sweepOrphanBlobs(deps: Deps, opts: Opts = {}) {
  const { prisma, listAllBlobs, deleteBlob } = deps
  const { apply = false, minAgeMs = DEFAULT_MIN_AGE_MS, now = Date.now() } = opts

  const blobs = await listAllBlobs()
  const rows = await prisma.invoiceImage.findMany({ select: { url: true } })
  const referenced = new Set(rows.map((r) => toPathname(r.url)))

  const orphans = blobs.filter(
    (b) =>
      !referenced.has(toPathname(b.pathname)) && now - new Date(b.uploadedAt).getTime() >= minAgeMs,
  )

  let deleted = 0
  let failed = 0
  if (apply) {
    for (const o of orphans) {
      try {
        await deleteBlob(o.url)
        deleted++
      } catch {
        // Best-effort — a storage hiccup must not abort the sweep. The blob stays
        // an orphan and is re-reported next run, so count it honestly as failed.
        failed++
      }
    }
  }

  return {
    scanned: blobs.length,
    referenced: referenced.size,
    orphans: orphans.length,
    deleted,
    failed,
    orphanPathnames: orphans.map((o) => o.pathname),
  }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const apply = process.argv.includes('--apply')
  sweepOrphanBlobs(
    { prisma: defaultPrisma, listAllBlobs: defaultListAllBlobs, deleteBlob: defaultDeleteBlob },
    { apply },
  )
    .then(async (r) => {
      console.log(
        `Scanned ${r.scanned} blob(s); ${r.referenced} referenced; ${r.orphans} orphan(s).`,
      )
      if (apply) {
        console.log(
          `Deleted ${r.deleted} orphan blob(s)${r.failed ? `; ${r.failed} failed (will retry next run)` : ''}.`,
        )
      } else if (r.orphans > 0) {
        console.log('Dry run — pass `-- --apply` to reclaim these:')
        for (const p of r.orphanPathnames) console.log(`  ${p}`)
      }
      await defaultPrisma.$disconnect()
    })
    .catch(async (err) => {
      console.error(err)
      await defaultPrisma.$disconnect()
      process.exit(1)
    })
}
