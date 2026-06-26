import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  ownerOf: (url: string) => /^owners\/([^/]+)\//.exec(url.replace(/^https?:\/\/[^/]+\//, ''))?.[1] ?? null,
  isOwnedBy: (url: string, owner: string) => url.replace(/^https?:\/\/[^/]+\//, '').startsWith(`owners/${owner}/`),
  deleteBlob: vi.fn(async () => {}),
  issueUploadToken: vi.fn(async (o: string) => ({ token: 't', pathname: `owners/${o}/p` })),
  signedReadUrl: vi.fn(() => 'https://signed/url'),
}))
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// AE4 (required acceptance gate): contractor A's link can only ever see/act on
// A's own submissions — never B's, never the landlord's other invoices — and
// failures are uniform so existence cannot be probed.
const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>
const tokenOf = (link: string) => link.split('/submit/')[1]

async function makeContractor(name: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/contractors',
    payload: { name, contact: 'x' },
    headers: { cookie: landlord.cookie },
  })
  return { id: r.json().id, token: tokenOf(r.json().link) }
}
async function submit(contractorId: string, token: string) {
  const r = await app.inject({
    method: 'POST',
    url: `/api/submissions/${token}`,
    payload: {
      amount: 100,
      description: 'work',
      invoiceDate: '2026-06-01',
      images: [{ url: `https://blob/owners/c_${contractorId}/p.jpg`, type: 'OTHER' }],
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
  A = await makeContractor('A')
  B = await makeContractor('B')
  aInvoice = await submit(A.id, A.token)
  bInvoice = await submit(B.id, B.token)
  // A landlord-typed invoice (no submitter).
  const inv = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: { vendorName: 'V', description: 'own', amount: 10, category: 'OTHER', invoiceDate: '2026-06-01' },
    headers: { cookie: landlord.cookie },
  })
  landlordInvoice = inv.json().id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('contractor read/act scope (AE4)', () => {
  it('A’s status list shows only A’s submissions', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/submissions/${A.token}` })).json().data
    const ids = list.map((r: { id: string }) => r.id)
    expect(ids).toContain(aInvoice)
    expect(ids).not.toContain(bInvoice)
    expect(ids).not.toContain(landlordInvoice)
  })

  it('A cannot edit B’s submission, the landlord’s invoice, or a guessed id — all uniform 409', async () => {
    const edit = (id: string) =>
      app.inject({ method: 'PATCH', url: `/api/submissions/${A.token}/${id}`, payload: { amount: 1 } })
    const onB = await edit(bInvoice)
    const onLandlord = await edit(landlordInvoice)
    const onGuess = await edit('does-not-exist-id')
    expect(onB.statusCode).toBe(409)
    expect(onLandlord.statusCode).toBe(409)
    expect(onGuess.statusCode).toBe(409)
    // Identical bodies — no distinction between "exists but not yours" and "absent".
    expect(onB.json().error.message).toBe(onLandlord.json().error.message)
    expect(onB.json().error.message).toBe(onGuess.json().error.message)
    // B's submission is untouched.
    expect(Number((await app.prisma.invoice.findUniqueOrThrow({ where: { id: bInvoice } })).amount)).toBe(100)
  })
})
