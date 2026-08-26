import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  ownerOf: (url: string) =>
    /^owners\/([^/]+)\//.exec(url.replace(/^https?:\/\/[^/]+\//, ''))?.[1] ?? null,
  isOwnedBy: (url: string, owner: string) =>
    url.replace(/^https?:\/\/[^/]+\//, '').startsWith(`owners/${owner}/`),
  deleteBlob: vi.fn(async () => {}),
  issueUploadToken: vi.fn(async (o: string) => ({ token: 't', pathname: `owners/${o}/p` })),
  signedReadUrl: vi.fn(() => 'https://signed/url'),
}))
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// AE4 (required acceptance gate): vendor A's link can only ever see/act on
// A's own submissions — never B's, never the landlord's other invoices — and
// failures are uniform so existence cannot be probed.
const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>
const tokenOf = (link: string) => link.split('/submit/')[1]

async function makeVendor(name: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    payload: { name, phone: 'x' },
    headers: { cookie: landlord.cookie },
  })
  return { id: r.json().id, token: tokenOf(r.json().link) }
}
async function submit(vendorId: string, token: string) {
  const r = await app.inject({
    method: 'POST',
    url: `/api/submissions/${token}`,
    payload: {
      items: [{ description: 'work', quantity: 1, total: 100 }],
      invoiceDate: '2026-06-01',
      images: [{ url: `https://blob/owners/c_${vendorId}/p.jpg`, type: 'OTHER' }],
    },
  })
  return r.json().id as string
}

let A: { id: string; token: string }
let B: { id: string; token: string }
let aInvoice: string
let bInvoice: string
let landlordInvoice: string

beforeAll(async () => {
  await app.ready()
  landlord = await createSecondUser(app)
  A = await makeVendor('A')
  B = await makeVendor('B')
  aInvoice = await submit(A.id, A.token)
  bInvoice = await submit(B.id, B.token)
  // A landlord-typed invoice (no submitter).
  const inv = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: {
      vendorName: 'V',
      items: [{ description: 'own', quantity: 1, total: 10 }],
      category: 'OTHER',
      invoiceDate: '2026-06-01',
    },
    headers: { cookie: landlord.cookie },
  })
  landlordInvoice = inv.json().id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('vendor read/act scope (AE4)', () => {
  it('A’s status list shows only A’s submissions', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/submissions/${A.token}` })).json()
      .data
    const ids = list.map((r: { id: string }) => r.id)
    expect(ids).toContain(aInvoice)
    expect(ids).not.toContain(bInvoice)
    expect(ids).not.toContain(landlordInvoice)
  })

  it('A cannot act on B’s submission, the landlord’s invoice, or a guessed id — all uniform', async () => {
    // Withdraw is the only vendor mutation left (edit was removed); every
    // out-of-scope target is a uniform 409.
    const withdraw = (id: string) =>
      app.inject({ method: 'POST', url: `/api/submissions/${A.token}/${id}/withdraw` })
    const onB = await withdraw(bInvoice)
    const onLandlord = await withdraw(landlordInvoice)
    const onGuess = await withdraw('does-not-exist-id')
    expect(onB.statusCode).toBe(409)
    expect(onLandlord.statusCode).toBe(409)
    expect(onGuess.statusCode).toBe(409)
    // Identical bodies — no distinction between "exists but not yours" and "absent".
    expect(onB.json().error.message).toBe(onLandlord.json().error.message)
    expect(onB.json().error.message).toBe(onGuess.json().error.message)
    // The detail view is scoped the same way: everything out of scope is 404.
    const detail = (id: string) =>
      app.inject({ method: 'GET', url: `/api/submissions/${A.token}/${id}` })
    expect((await detail(bInvoice)).statusCode).toBe(404)
    expect((await detail(landlordInvoice)).statusCode).toBe(404)
    expect((await detail('does-not-exist-id')).statusCode).toBe(404)
    // B's submission is untouched (still SUBMITTED, amount intact).
    const b = await app.prisma.invoice.findUniqueOrThrow({ where: { id: bInvoice } })
    expect(b.status).toBe('SUBMITTED')
    expect(Number(b.amount)).toBe(100)
  })

  it('a link holder cannot read an invoice merely ATTRIBUTED to them', async () => {
    // The landlord enters an invoice themselves and attributes it to the vendor
    // (vendorId), but the vendor did NOT submit it (submittedByVendorId is null).
    // The vendor's no-login link must not reach it.
    const invoice = await app.prisma.invoice.create({
      data: {
        invoiceNumber: 'ATTR-1',
        vendorName: 'Ace Plumbing',
        amount: 100,
        currency: 'USD',
        category: 'REPAIRS',
        invoiceDate: new Date('2026-01-15'),
        status: 'PAID',
        userId: landlord.user.id,
        vendorId: A.id,
        submittedByVendorId: null,
        items: {
          createMany: { data: [{ description: 'x', quantity: 1, total: 100, sortOrder: 0 }] },
        },
      },
    })

    const list = await app.inject({ method: 'GET', url: `/api/submissions/${A.token}` })
    expect(list.statusCode).toBe(200)
    expect(list.json().data.map((r: { id: string }) => r.id)).not.toContain(invoice.id)

    const withdraw = await app.inject({
      method: 'POST',
      url: `/api/submissions/${A.token}/${invoice.id}/withdraw`,
    })
    expect(withdraw.statusCode).toBe(409)
    const detail = await app.inject({
      method: 'GET',
      url: `/api/submissions/${A.token}/${invoice.id}`,
    })
    expect(detail.statusCode).toBe(404)
  })
})
