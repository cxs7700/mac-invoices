import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// U2 status-transition guard (KTD-3). SUBMITTED is the contractor-submission
// entry state: nothing moves *into* it, and from SUBMITTED the landlord may only
// approve (needs a category) or reject (needs a reason). Legacy transitions among
// the pre-existing statuses keep their prior freedom (R-8 — no regression of the
// landlord's existing flows, including reopening a PAID invoice).
const app = buildApp()
let u: Awaited<ReturnType<typeof createSecondUser>>
let cookie: string
let propId: string // a property the landlord assigns when approving (required-on-approval)

// Create a row directly (the public submit path is U6) so we can drive the
// landlord PATCH endpoint against a real SUBMITTED, owned invoice.
async function makeSubmitted(n: string) {
  return app.prisma.invoice.create({
    data: {
      vendorName: 'C',
      description: 'work',
      amount: '100.00',
      invoiceDate: new Date('2026-03-01'),
      status: 'SUBMITTED',
      userId: u.user.id,
      invoiceNumber: `T-TRANS-${n}`,
    },
  })
}

async function makePending(n: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: {
      invoiceNumber: `T-TRANS-${n}`,
      vendorName: 'V',
      items: [{ description: 'work', quantity: 1, total: 100 }],
      category: 'REPAIRS',
      invoiceDate: '2026-03-01',
    },
    headers: { cookie },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

const patch = (id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/api/invoices/${id}`, payload, headers: { cookie } })

beforeAll(async () => {
  await app.ready()
  u = await createSecondUser(app)
  cookie = u.cookie
  propId = (await app.prisma.property.create({ data: { landlordId: u.user.id, name: 'P', address: 'A' } })).id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: 'T-TRANS-' } } })
  await app.prisma.invoice.deleteMany({ where: { userId: u.user.id } })
  await u.cleanup()
  await app.close()
})

describe('U2 transition guard — SUBMITTED lifecycle', () => {
  it('approves a submission when a category is supplied in the same call', async () => {
    const inv = await makeSubmitted('approve')
    const res = await patch(inv.id, { status: 'APPROVED', category: 'LABOR', propertyId: propId })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('APPROVED')
    expect(res.json().category).toBe('LABOR')
  })

  it('blocks APPROVED when no category is set (422 CATEGORY_REQUIRED)', async () => {
    const inv = await makeSubmitted('nocat')
    const res = await patch(inv.id, { status: 'APPROVED' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('CATEGORY_REQUIRED')
  })

  it('rejects a submission with a reason, stores it', async () => {
    const inv = await makeSubmitted('reject')
    const res = await patch(inv.id, { status: 'REJECTED', rejectionReason: 'Amount looks wrong' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('REJECTED')
    expect(res.json().rejectionReason).toBe('Amount looks wrong')
  })

  it('blocks REJECTED with no reason (422 REASON_REQUIRED)', async () => {
    const inv = await makeSubmitted('noreason')
    const res = await patch(inv.id, { status: 'REJECTED' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('REASON_REQUIRED')
  })

  it('blocks a landlord paying a submission directly (SUBMITTED → PAID)', async () => {
    const inv = await makeSubmitted('pay')
    const res = await patch(inv.id, { status: 'PAID' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_TRANSITION')
  })

  it('blocks moving any invoice INTO SUBMITTED', async () => {
    const id = await makePending('intosub')
    const res = await patch(id, { status: 'SUBMITTED' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_TRANSITION')
  })

  it('allows a field-only edit on a SUBMITTED invoice (guard bypassed)', async () => {
    const inv = await makeSubmitted('fieldedit')
    const res = await patch(inv.id, { items: [{ description: 'work', quantity: 1, total: 250 }] })
    expect(res.statusCode).toBe(200)
    expect(Number(res.json().amount)).toBe(250)
    expect(res.json().status).toBe('SUBMITTED')
  })
})

describe('U2 transition guard — legacy landlord flows still pass (R-8)', () => {
  it('PENDING → PAID, then reopen PAID → PENDING clears paidDate', async () => {
    const id = await makePending('reopen')
    const paid = await patch(id, { status: 'PAID' })
    expect(paid.statusCode).toBe(200)
    expect(paid.json().paidDate).not.toBeNull()
    const reopened = await patch(id, { status: 'PENDING' })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json().status).toBe('PENDING')
    expect(reopened.json().paidDate).toBeNull()
  })

  it('PENDING → REJECTED needs no reason (legacy dispute path)', async () => {
    const id = await makePending('legacyreject')
    const res = await patch(id, { status: 'REJECTED' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('REJECTED')
  })

  it('PENDING → APPROVED passes (category + property set on approve)', async () => {
    const id = await makePending('legacyapprove')
    const res = await patch(id, { status: 'APPROVED', propertyId: propId })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('APPROVED')
  })

  it('REJECTED is terminal — no transition out (forward-only)', async () => {
    const id = await makePending('terminal')
    const rejected = await patch(id, { status: 'REJECTED' })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.json().rejectionReason).toBeNull() // legacy reject carries no reason
    const reopen = await patch(id, { status: 'PENDING' })
    expect(reopen.statusCode).toBe(422)
    expect(reopen.json().error.code).toBe('INVALID_TRANSITION')
  })
})
