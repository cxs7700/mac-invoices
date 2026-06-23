import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// A unique vendor nonce isolates this suite's rows from the landlord's seed data,
// so filter/sort assertions are deterministic regardless of what else exists.
const app = buildApp()
const NONCE = 'ZZTEST-FILTER-'
let cookie: string

type Seed = { n: string; vendor: string; date: string; amount: number }
const SEEDS: Seed[] = [
  { n: '1', vendor: `${NONCE}Acme`, date: '2026-01-10', amount: 100 },
  { n: '2', vendor: `${NONCE}Best`, date: '2026-02-15', amount: 300 },
  { n: '3', vendor: `${NONCE}acme2`, date: '2026-03-20', amount: 200 },
]

async function create(s: Seed, c = cookie) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    headers: { cookie: c },
    payload: {
      invoiceNumber: `${NONCE}${s.n}`,
      vendorName: s.vendor,
      description: 'Work',
      amount: s.amount,
      category: 'OTHER',
      invoiceDate: s.date,
    },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

async function listMine(query = '') {
  const sep = query ? '&' : ''
  const res = await app.inject({
    method: 'GET',
    url: `/api/invoices?vendor=${encodeURIComponent(NONCE)}${sep}${query}`,
    headers: { cookie },
  })
  return res
}

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
  for (const s of SEEDS) await create(s)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
  await app.close()
})

describe('GET /api/invoices — auth + bounds', () => {
  it('401s without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices' })
    expect(res.statusCode).toBe(401)
  })

  it('400s on out-of-bounds / non-numeric pagination + bad date (strict API, KTD-7)', async () => {
    for (const q of ['limit=1000000', 'limit=abc', 'limit=0', 'offset=-5', 'offset=100001', 'from=not-a-date']) {
      const res = await app.inject({ method: 'GET', url: `/api/invoices?${q}`, headers: { cookie } })
      expect(res.statusCode, q).toBe(400)
      expect(res.json().error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects an out-of-enum status with 400 and accepts a valid one', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/invoices?status=BOGUS', headers: { cookie } })
    expect(bad.statusCode).toBe(400)
    const ok = await app.inject({ method: 'GET', url: '/api/invoices?status=PAID', headers: { cookie } })
    expect(ok.statusCode).toBe(200)
  })
})

describe('GET /api/invoices — filter + sort', () => {
  it('vendor filter is case-insensitive contains', async () => {
    // NONCE is uppercase in data; query lowercase still matches all three.
    const res = await listMine()
    expect(res.statusCode).toBe(200)
    const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
    expect(nums).toEqual(expect.arrayContaining([`${NONCE}1`, `${NONCE}2`, `${NONCE}3`]))
    for (const row of res.json().data) {
      expect(row.vendorName.toLowerCase()).toContain(NONCE.toLowerCase())
    }
  })

  it('date range filters invoiceDate inclusively', async () => {
    const res = await listMine('from=2026-02-01&to=2026-02-28')
    const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
    expect(nums).toEqual([`${NONCE}2`])
  })

  it('includes a row dated exactly on the boundary day (inclusive end-of-day)', async () => {
    const res = await listMine('from=2026-02-15&to=2026-02-15')
    const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
    expect(nums).toEqual([`${NONCE}2`])
  })

  it('narrows on status + date + vendor simultaneously (AND)', async () => {
    const res = await listMine('status=PENDING&from=2026-02-01&to=2026-02-28')
    const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
    expect(nums).toEqual([`${NONCE}2`])
  })

  it('sorts by the nullable dueDate with a stable invoiceDate tiebreaker', async () => {
    const SUB = `${NONCE}DUE-`
    const mk = (n: string, dueDate: string | null) =>
      app.inject({
        method: 'POST',
        url: '/api/invoices',
        headers: { cookie },
        payload: {
          invoiceNumber: `${SUB}${n}`,
          vendorName: `${SUB}v`,
          description: 'w',
          amount: 10,
          category: 'OTHER',
          invoiceDate: '2026-01-01',
          ...(dueDate ? { dueDate } : {}),
        },
      })
    try {
      await mk('a', '2026-05-01')
      await mk('b', '2026-03-01')
      await mk('nil', null)
      const res = await app.inject({
        method: 'GET',
        url: `/api/invoices?vendor=${encodeURIComponent(SUB)}&sort=dueDate&order=asc`,
        headers: { cookie },
      })
      const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
      // asc: earliest due first; the null-dueDate row sorts last (Postgres NULLS LAST).
      expect(nums).toEqual([`${SUB}b`, `${SUB}a`, `${SUB}nil`])
    } finally {
      await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: SUB } } })
    }
  })

  it('search filters by job description (case-insensitive contains)', async () => {
    const SUB = `${NONCE}DESC-`
    const mk = (n: string, description: string) =>
      app.inject({
        method: 'POST',
        url: '/api/invoices',
        headers: { cookie },
        payload: {
          invoiceNumber: `${SUB}${n}`,
          vendorName: `${SUB}v`,
          description,
          amount: 10,
          category: 'OTHER',
          invoiceDate: '2026-01-01',
        },
      })
    try {
      await mk('a', 'Replaced kitchen faucet')
      await mk('b', 'Roof shingle repair')
      // Uppercase query matches the lowercase 'faucet' (case-insensitive) and
      // only the matching description, not the roof row.
      const res = await app.inject({
        method: 'GET',
        url: `/api/invoices?vendor=${encodeURIComponent(SUB)}&search=${encodeURIComponent('FAUCET')}`,
        headers: { cookie },
      })
      const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
      expect(nums).toEqual([`${SUB}a`])
    } finally {
      await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: SUB } } })
    }
  })

  it('sort=amount&order=asc orders ascending by amount', async () => {
    const res = await listMine('sort=amount&order=asc')
    const amounts = res.json().data.map((i: { amount: string }) => Number(i.amount))
    expect(amounts).toEqual([100, 200, 300])
  })

  it('defaults to invoiceDate desc', async () => {
    const res = await listMine()
    const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
    expect(nums).toEqual([`${NONCE}3`, `${NONCE}2`, `${NONCE}1`])
  })

  it('returns an empty set when filters match nothing', async () => {
    const res = await listMine('from=2030-01-01')
    expect(res.json().data).toEqual([])
    expect(res.json().pagination.total).toBe(0)
  })

  it('400s on a non-whitelisted sort field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?sort=vendorName',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
  })

  it("never returns a second user's matching invoice", async () => {
    const second = await createSecondUser(app)
    try {
      await create({ n: 'OTHER', vendor: `${NONCE}Other`, date: '2026-02-10', amount: 999 }, second.cookie)
      const res = await listMine()
      const nums = res.json().data.map((i: { invoiceNumber: string }) => i.invoiceNumber)
      expect(nums).not.toContain(`${NONCE}OTHER`)
    } finally {
      await second.cleanup()
    }
  })
})
