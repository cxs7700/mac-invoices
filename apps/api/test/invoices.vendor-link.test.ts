import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'
import { resolveVendorId } from '../src/invoices/writeService'

// U6 invoice↔vendor linking: attribution (Invoice.vendorId), auto-create on an
// unknown vendorName, case-insensitive reuse scoped per landlord, and the
// vendor/submittedByVendor response-key split (a landlord-entered invoice's
// attribution vendor must not be shadowed by the submitter relation).
const app = buildApp()
let landlordCookie: string
let landlordId: string
let other: Awaited<ReturnType<typeof createSecondUser>>
let otherLandlordId: string

const post = (payload: object, cookie: string) =>
  app.inject({ method: 'POST', url: '/api/invoices', payload, headers: { cookie } })
const patch = (id: string, payload: object, cookie: string) =>
  app.inject({ method: 'PATCH', url: `/api/invoices/${id}`, payload, headers: { cookie } })

const invoiceIds: string[] = []
const vendorNames = [
  'Brand New Vendor',
  'Ace Plumbing',
  'ACE PLUMBING',
  'Shared Name',
  'Whatever',
  'Vendor Link Test',
  'Self Submit Vendor',
  'Race Vendor',
  'Patch Relink Old',
  'Patch Relink New',
  'Old Name',
  'New Name',
]

async function cleanup() {
  if (invoiceIds.length) {
    await app.prisma.invoice.deleteMany({ where: { id: { in: invoiceIds.splice(0) } } })
  }
  await app.prisma.vendor.deleteMany({ where: { name: { in: vendorNames } } })
}

beforeAll(async () => {
  await app.ready()
  landlordCookie = await loginCookie(app)
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: landlordCookie },
  })
  landlordId = me.json().id
  other = await createSecondUser(app)
  otherLandlordId = other.user.id
  await cleanup()
})
afterAll(async () => {
  await cleanup()
  await other.cleanup()
  await app.close()
})

describe('auto-create + resolve on invoice write', () => {
  it('auto-creates a vendor when the invoice names an unknown one', async () => {
    const res = await post(
      {
        vendorName: 'Brand New Vendor',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    expect(res.statusCode).toBe(201)
    invoiceIds.push(res.json().id)

    const vendor = await app.prisma.vendor.findFirst({
      where: { landlordId, name: 'Brand New Vendor' },
    })
    expect(vendor).not.toBeNull()
    // Auto-created vendors carry no contact details and no usable link.
    expect(vendor?.phone).toBeNull()
    expect(vendor?.email).toBeNull()
    expect(vendor?.revokedAt).not.toBeNull()
    expect(res.json().vendorId).toBe(vendor?.id)
  })

  it('reuses an existing vendor regardless of case, creating only one row', async () => {
    const payload = (name: string) => ({
      vendorName: name,
      category: 'REPAIRS',
      invoiceDate: '2026-02-01',
      items: [{ description: 'work', quantity: 1, total: 50 }],
    })

    const first = await post(payload('Ace Plumbing'), landlordCookie)
    const second = await post(payload('ACE PLUMBING'), landlordCookie)
    invoiceIds.push(first.json().id, second.json().id)

    const rows = await app.prisma.vendor.findMany({
      where: { landlordId, name: { equals: 'Ace Plumbing', mode: 'insensitive' } },
    })
    expect(rows).toHaveLength(1)
    expect(first.json().vendorId).toBe(rows[0].id)
    expect(second.json().vendorId).toBe(rows[0].id)
  })

  it('does not steal another landlord’s vendor of the same name', async () => {
    const otherRes = await post(
      {
        vendorName: 'Shared Name',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      other.cookie,
    )
    const res = await post(
      {
        vendorName: 'Shared Name',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    invoiceIds.push(otherRes.json().id, res.json().id)

    const rows = await app.prisma.vendor.findMany({ where: { name: 'Shared Name' } })
    expect(rows).toHaveLength(2)
    expect(res.json().vendorId).toBe(rows.find((r) => r.landlordId === landlordId)?.id)
  })

  it('rejects a vendorId belonging to another landlord', async () => {
    const otherRes = await post(
      {
        vendorName: 'Vendor Link Test',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      other.cookie,
    )
    invoiceIds.push(otherRes.json().id)
    const foreign = await app.prisma.vendor.findFirst({ where: { landlordId: otherLandlordId } })
    const res = await post(
      {
        vendorName: 'Whatever',
        vendorId: foreign!.id,
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    expect(res.statusCode).toBe(404)
  })
})

describe('vendor vs submittedByVendor response keys (list)', () => {
  it('a landlord-entered invoice attributed to a vendor comes back with vendor populated and submittedByVendor null', async () => {
    const created = await post(
      {
        vendorName: 'Vendor Link Test',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    invoiceIds.push(created.json().id)

    const list = await app.inject({
      method: 'GET',
      url: '/api/invoices?vendor=Vendor%20Link%20Test',
      headers: { cookie: landlordCookie },
    })
    const row = list.json().data.find((i: { id: string }) => i.id === created.json().id)
    expect(row).toBeDefined()
    expect(row.vendor).not.toBeNull()
    expect(row.vendor.name).toBe('Vendor Link Test')
    expect(row.submittedByVendor).toBeNull()
  })

  it('a self-submitted invoice comes back with both vendor and submittedByVendor populated', async () => {
    const vendor = await app.prisma.vendor.create({
      data: {
        landlordId,
        name: 'Self Submit Vendor',
        phone: '555-0000',
        tokenLookupId: `lk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tokenHash: 'hash',
      },
    })
    const invoice = await app.prisma.invoice.create({
      data: {
        vendorName: vendor.name,
        amount: '50.00',
        invoiceDate: new Date('2026-02-01'),
        status: 'SUBMITTED',
        userId: landlordId,
        vendorId: vendor.id,
        submittedByVendorId: vendor.id,
      },
    })
    invoiceIds.push(invoice.id)

    const list = await app.inject({
      method: 'GET',
      url: '/api/invoices?vendor=Self%20Submit%20Vendor',
      headers: { cookie: landlordCookie },
    })
    const row = list.json().data.find((i: { id: string }) => i.id === invoice.id)
    expect(row).toBeDefined()
    expect(row.vendor).not.toBeNull()
    expect(row.vendor.name).toBe('Self Submit Vendor')
    expect(row.submittedByVendor).not.toBeNull()
    expect(row.submittedByVendor.name).toBe('Self Submit Vendor')
  })
})

// Fix round 1/5, Finding 1: the auto-create find-then-create in resolveVendorId
// is now backed by a case-insensitive per-landlord unique index (migration
// 20260807200000_vendor_unique_name_per_landlord), so a concurrent race can no
// longer create two vendor rows. This test forces the real race: two genuinely
// concurrent `resolveVendorId` calls, each in its own `prisma.$transaction`,
// naming the SAME new vendor for the SAME landlord. At READ COMMITTED, both
// transactions' initial lookups can see no matching row and both attempt the
// INSERT; Postgres serializes the two INSERTs on the unique index, so the
// second to commit gets a real P2002 from the database — not a mocked one —
// and resolveVendorId's catch-and-reread branch must recover it to the
// winner's row rather than erroring or leaving a duplicate.
describe('concurrent auto-create race (TOCTOU, Fix round 1/5 Finding 1)', () => {
  it('two concurrent auto-creates of the same new vendor name resolve to one row', async () => {
    const prisma = app.prisma
    const [idA, idB] = await Promise.all([
      prisma.$transaction((tx) => resolveVendorId(tx, landlordId, undefined, 'Race Vendor')),
      prisma.$transaction((tx) => resolveVendorId(tx, landlordId, undefined, 'Race Vendor')),
    ])

    const rows = await prisma.vendor.findMany({
      where: { landlordId, name: { equals: 'Race Vendor', mode: 'insensitive' } },
    })
    expect(rows).toHaveLength(1)
    expect(idA).toBe(rows[0].id)
    expect(idB).toBe(rows[0].id)
  })
})

// Fix round 1/5, Finding 2: the updateInvoice re-link guard (writeService
// ~536-544) had no direct coverage. Positive case: a PATCH that changes
// vendorName re-links to the right (possibly auto-created) vendor. Negative
// case: a PATCH that touches something unrelated (a status transition) must
// leave vendorId exactly as it was — the regression this guards against is a
// status-only PATCH silently re-linking or spuriously auto-creating a vendor.
describe('PATCH re-link guard (Fix round 1/5 Finding 2)', () => {
  it('a PATCH that changes vendorName re-links the invoice, auto-creating a new vendor', async () => {
    const created = await post(
      {
        vendorName: 'Patch Relink Old',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    invoiceIds.push(created.json().id)
    const oldVendorId = created.json().vendorId

    const res = await patch(created.json().id, { vendorName: 'Patch Relink New' }, landlordCookie)
    expect(res.statusCode).toBe(200)

    const newVendor = await app.prisma.vendor.findFirst({
      where: { landlordId, name: 'Patch Relink New' },
    })
    expect(newVendor).not.toBeNull()
    expect(res.json().vendorId).toBe(newVendor?.id)
    expect(res.json().vendorId).not.toBe(oldVendorId)
  })

  // Fix round 2/5: a status-only PATCH must NOT re-resolve vendorId, but that
  // only diverges from "re-resolve with the unchanged name" when the invoice's
  // vendorName snapshot and the vendor's current name have drifted apart —
  // which is normal (vendorName is a historical snapshot, taken at write time;
  // renaming the vendor afterward doesn't retroactively update it). Without
  // that drift, re-resolving with the same name would just find the same
  // vendor again and the assertions would pass whether or not the guard
  // exists. So: create, rename the vendor out from under the stale snapshot,
  // THEN patch status-only — this fails loudly if the guard is removed (see
  // "Fix round 2/5" in the report for the guard-removed/-restored proof).
  it('a PATCH that only changes status leaves vendorId untouched even after the vendor was renamed (stale vendorName snapshot)', async () => {
    const created = await post(
      {
        vendorName: 'Old Name',
        category: 'REPAIRS',
        invoiceDate: '2026-02-01',
        items: [{ description: 'work', quantity: 1, total: 50 }],
      },
      landlordCookie,
    )
    invoiceIds.push(created.json().id)
    const vendorId = created.json().vendorId
    expect(vendorId).not.toBeNull()
    expect(created.json().vendorName).toBe('Old Name')

    // Rename the vendor directly. The invoice's vendorName column keeps
    // reading "Old Name" — a stale snapshot by design.
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/vendors/${vendorId}`,
      payload: { name: 'New Name' },
      headers: { cookie: landlordCookie },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().name).toBe('New Name')

    const res = await patch(created.json().id, { status: 'PAID' }, landlordCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('PAID')

    // The guard: resolveVendorId is never called on a status-only PATCH, so
    // vendorId is untouched — still X, the renamed vendor.
    expect(res.json().vendorId).toBe(vendorId)

    // Exactly one vendor exists across both names for this landlord: no
    // second "Old Name" row was auto-created from the stale snapshot.
    const landlordVendors = await app.prisma.vendor.findMany({
      where: { landlordId, name: { in: ['Old Name', 'New Name'] } },
    })
    expect(landlordVendors).toHaveLength(1)
    expect(landlordVendors[0].id).toBe(vendorId)
    expect(landlordVendors[0].name).toBe('New Name')

    const stale = await app.prisma.vendor.findFirst({
      where: { landlordId, name: { equals: 'Old Name', mode: 'insensitive' } },
    })
    expect(stale).toBeNull()
  })
})
