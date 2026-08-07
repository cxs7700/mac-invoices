import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

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

const invoiceIds: string[] = []
const vendorNames = [
  'Brand New Vendor',
  'Ace Plumbing',
  'ACE PLUMBING',
  'Shared Name',
  'Whatever',
  'Vendor Link Test',
  'Self Submit Vendor',
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
