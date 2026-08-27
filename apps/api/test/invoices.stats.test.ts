import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

const app = buildApp()
const NONCE = 'ZZTEST-STATS-'
let cookie: string

async function create(n: string, status: 'PENDING' | 'PAID', c = cookie) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    headers: { cookie: c },
    payload: {
      invoiceNumber: `${NONCE}${n}`,
      vendorName: `${NONCE}v`,
      items: [{ description: 'Work', quantity: 1, total: 10 }],
      category: 'OTHER',
      invoiceDate: '2026-02-01',
    },
  })
  expect(res.statusCode).toBe(201)
  const id = res.json().id
  if (status === 'PAID') {
    await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      headers: { cookie: c },
      payload: { status: 'PAID' },
    })
  }
  return id
}

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
  await app.close()
})

describe('GET /api/invoices/stats', () => {
  it('401s without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices/stats' })
    expect(res.statusCode).toBe(401)
  })

  it('returns a zero-filled counts map whose values sum to total', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices/stats', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Every status key is present (zero-filled), even with no rows in some.
    for (const s of ['PENDING', 'PAID', 'REJECTED', 'CANCELLED']) {
      expect(body.counts).toHaveProperty(s)
    }
    const sum = Object.values(body.counts as Record<string, number>).reduce((a, b) => a + b, 0)
    expect(sum).toBe(body.total)
  })

  it('counts only the session user, excluding others', async () => {
    // The landlord's global counts are mutated by other suites running in
    // parallel against the shared dev DB, so assert on a freshly-created second
    // user whose invoice set is fully owned by this test (deterministic).
    const second = await createSecondUser(app)
    try {
      // Landlord rows that must NOT leak into the second user's counts.
      await create('p1', 'PENDING')
      await create('paid1', 'PAID')
      // The second user's only invoice.
      await create('other', 'PAID', second.cookie)

      const stats = (
        await app.inject({
          method: 'GET',
          url: '/api/invoices/stats',
          headers: { cookie: second.cookie },
        })
      ).json()

      expect(stats.total).toBe(1)
      expect(stats.counts.PAID).toBe(1)
      expect(stats.counts.PENDING).toBe(0)
    } finally {
      await second.cleanup()
    }
  })
})
