import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// Dashboard spend summary: total + per-category + per-status sums, ownership-scoped.
// Runs as a fresh throwaway user so the all-time totals are isolated from the
// landlord's existing invoices.
const app = buildApp()
const PREFIX = 'TEST-SUM-'
let user: Awaited<ReturnType<typeof createSecondUser>>
let cookie: string

const body = (n: string, amount: number, category: string) => ({
  invoiceNumber: `${PREFIX}${n}`,
  vendorName: 'Vendor',
  items: [{ description: 'Work', quantity: 1, total: amount }],
  category,
  invoiceDate: '2026-02-01',
})

async function create(n: string, amount: number, category: string, c = cookie) {
  const res = await app.inject({ method: 'POST', url: '/api/invoices', payload: body(n, amount, category), headers: { cookie: c } })
  expect(res.statusCode).toBe(201)
}

beforeAll(async () => {
  await app.ready()
  user = await createSecondUser(app)
  cookie = user.cookie
  await create('a', 100, 'REPAIRS')
  await create('b', 50, 'REPAIRS')
  await create('c', 200, 'UTILITIES')
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await user.cleanup()
  await app.close()
})

describe('GET /api/invoices/summary', () => {
  it('401s without auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/invoices/summary' })).statusCode).toBe(401)
  })

  it('returns total + per-category + per-status spend (zero-filled, Decimal-safe)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices/summary', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.total).toEqual({ count: 3, amount: '350.00' })

    const cat = Object.fromEntries(data.byCategory.map((r: { category: string }) => [r.category, r]))
    expect(cat.REPAIRS).toEqual({ category: 'REPAIRS', count: 2, amount: '150.00' })
    expect(cat.UTILITIES).toEqual({ category: 'UTILITIES', count: 1, amount: '200.00' })
    expect(cat.LABOR).toEqual({ category: 'LABOR', count: 0, amount: '0.00' }) // zero-filled
    expect(data.byCategory).toHaveLength(6)

    const stat = Object.fromEntries(data.byStatus.map((r: { status: string }) => [r.status, r]))
    expect(stat.PENDING).toEqual({ status: 'PENDING', count: 3, amount: '350.00' })
    expect(stat.SUBMITTED).toEqual({ status: 'SUBMITTED', count: 0, amount: '0.00' }) // zero-filled
    expect(data.byStatus).toHaveLength(6)
  })

  it('excludes SUBMITTED/REJECTED/CANCELLED from spend, keeps SUBMITTED in byStatus, and byCategory reconciles (KTD-9)', async () => {
    // A SUBMITTED submission and a withdrawn (CANCELLED) one both carry a null
    // category and are not "spend": neither moves the total nor appears in
    // byCategory — so the per-category breakdown still reconciles to the total.
    const submitted = await app.prisma.invoice.create({
      data: {
        vendorName: 'Contractor', description: 'Submitted work', amount: '999.00',
        invoiceDate: new Date('2026-03-01'), status: 'SUBMITTED', userId: user.user.id, invoiceNumber: `${PREFIX}sub`,
      },
    })
    const cancelled = await app.prisma.invoice.create({
      data: {
        vendorName: 'Contractor', description: 'Withdrawn work', amount: '777.00',
        invoiceDate: new Date('2026-03-01'), status: 'CANCELLED', userId: user.user.id, invoiceNumber: `${PREFIX}wd`,
      },
    })
    const data = (await app.inject({ method: 'GET', url: '/api/invoices/summary', headers: { cookie } })).json()
    // total unchanged (still the 3 PENDING = 350); the 999 + 777 are excluded.
    expect(data.total).toEqual({ count: 3, amount: '350.00' })
    // byCategory reconciles to the total — no stray null-category bucket.
    const catSum = data.byCategory.reduce((s: number, r: { amount: string }) => s + Number(r.amount), 0)
    expect(catSum.toFixed(2)).toBe('350.00')
    // byStatus still surfaces the SUBMITTED count (the "to review" signal).
    const stat = Object.fromEntries(data.byStatus.map((r: { status: string }) => [r.status, r]))
    expect(stat.SUBMITTED).toEqual({ status: 'SUBMITTED', count: 1, amount: '999.00' })
    await app.prisma.invoice.deleteMany({ where: { id: { in: [submitted.id, cancelled.id] } } })
  })

  it("excludes another user's invoices", async () => {
    const landlord = await loginCookie(app)
    // The landlord's all-time total is whatever it is; the throwaway user's stays 350.
    const mine = await app.inject({ method: 'GET', url: '/api/invoices/summary', headers: { cookie } })
    const theirs = await app.inject({ method: 'GET', url: '/api/invoices/summary', headers: { cookie: landlord } })
    expect(mine.json().total.amount).toBe('350.00')
    expect(theirs.json().total.amount).not.toBe('350.00')
  })
})
