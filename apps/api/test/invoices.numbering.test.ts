import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()

// Two throwaway tenants owned entirely by this file. `createSecondUser`
// randomizes the email, so calling it twice yields two independent landlords.
let a: Awaited<ReturnType<typeof createSecondUser>>
let b: Awaited<ReturnType<typeof createSecondUser>>

const body = (over: Record<string, unknown> = {}) => ({
  vendorName: 'Vendor',
  items: [{ description: 'Work', quantity: 1, total: 100 }],
  category: 'OTHER',
  invoiceDate: '2026-02-01',
  ...over,
})

async function create(cookie: string, over: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: body(over),
    headers: { cookie },
  })
}

/** Give a tenant pre-existing numbered invoices without going through the API. */
async function seedNumbers(userId: string, numbers: string[]) {
  for (const invoiceNumber of numbers) {
    await app.prisma.invoice.create({
      data: {
        invoiceNumber,
        vendorName: 'Seeded',
        amount: 100,
        invoiceDate: new Date('2026-02-01'),
        userId,
      },
    })
  }
}

beforeAll(async () => {
  await app.ready()
  a = await createSecondUser(app)
  b = await createSecondUser(app)
})

afterAll(async () => {
  // cleanup() deletes the tenant's invoices before the user, which matters:
  // Invoice.propertyId is onDelete Restrict, so properties must cascade from
  // the user only after its invoices are gone.
  await a.cleanup()
  await b.cleanup()
  await app.close()
})

describe('per-tenant invoice numbering', () => {
  it('gives a tenant with no numbered invoices the number 1', async () => {
    const res = await create(b.cookie)
    expect(res.statusCode).toBe(201)
    // Before scoping, this returned the GLOBAL max + 1 — the seeded landlord
    // has hundreds of invoices, so this came back in the hundreds.
    expect(res.json().invoiceNumber).toBe('1')
  })

  it("continues a tenant's own sequence, unaffected by another tenant", async () => {
    await seedNumbers(a.user.id, ['1', '2', '3'])

    // Tenant B creating invoices must not advance tenant A's sequence.
    await create(b.cookie)

    const next = await create(a.cookie)
    expect(next.statusCode).toBe(201)
    expect(next.json().invoiceNumber).toBe('4')
  })

  it('lets two tenants each hold the same invoice number', async () => {
    const first = await create(a.cookie, { invoiceNumber: 'SHARED-1' })
    expect(first.statusCode).toBe(201)

    // Same number, different owner: allowed, and B learns nothing about A.
    const second = await create(b.cookie, { invoiceNumber: 'SHARED-1' })
    expect(second.statusCode).toBe(201)
    expect(second.json().invoiceNumber).toBe('SHARED-1')
  })

  it('lets a tenant PATCH one of their invoices to a number another tenant already holds', async () => {
    const held = await create(a.cookie, { invoiceNumber: 'SHARED-2' })
    expect(held.statusCode).toBe(201)

    const mine = await create(b.cookie, { invoiceNumber: 'B-OWN-1' })
    expect(mine.statusCode).toBe(201)

    // R6 flow F3: edit path, not just create — B retargets their own invoice
    // to a number A already holds. Cross-tenant, so this must succeed.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${mine.json().id}`,
      payload: { invoiceNumber: 'SHARED-2' },
      headers: { cookie: b.cookie },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().invoiceNumber).toBe('SHARED-2')
  })

  it('still rejects a duplicate number within one tenant', async () => {
    const first = await create(b.cookie, { invoiceNumber: 'DUPE-1' })
    expect(first.statusCode).toBe(201)

    const dupe = await create(b.cookie, { invoiceNumber: 'DUPE-1' })
    expect(dupe.statusCode).toBe(409)
  })

  it('allows a tenant to hold many unnumbered invoices at once', async () => {
    // Contractor submissions are unnumbered until approved; the composite
    // unique must not collapse them (Postgres NULLs are never equal).
    for (const n of ['a', 'b', 'c']) {
      await app.prisma.invoice.create({
        data: {
          invoiceNumber: null,
          vendorName: `null-${n}`,
          amount: 100,
          invoiceDate: new Date('2026-02-01'),
          status: 'SUBMITTED',
          userId: b.user.id,
        },
      })
    }
    const unnumbered = await app.prisma.invoice.count({
      where: { userId: b.user.id, invoiceNumber: null },
    })
    expect(unnumbered).toBe(3)
  })

  it("stamps an approved submission with the owner's next number", async () => {
    // A fresh tenant so the expected number is deterministic: they own exactly
    // one numbered invoice ("7"), so approving a submission must yield "8".
    const c = await createSecondUser(app)
    try {
      await seedNumbers(c.user.id, ['7'])
      const property = await app.prisma.property.create({
        data: { landlordId: c.user.id, name: 'Prop', address: '1 Test St' },
      })
      const submission = await app.prisma.invoice.create({
        data: {
          invoiceNumber: null,
          vendorName: 'Submission',
          amount: 100,
          invoiceDate: new Date('2026-02-01'),
          status: 'SUBMITTED',
          category: 'OTHER',
          propertyId: property.id,
          userId: c.user.id,
          items: {
            createMany: { data: [{ description: 'Work', quantity: 1, total: 100, sortOrder: 0 }] },
          },
        },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/invoices/${submission.id}`,
        payload: { status: 'PAID' },
        headers: { cookie: c.cookie },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().invoiceNumber).toBe('8')
    } finally {
      await c.cleanup()
    }
  })
})
