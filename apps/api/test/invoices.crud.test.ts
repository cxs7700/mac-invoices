import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// Ownership + write-path integration tests. The landlord must never see or mutate
// a second user's invoice; non-owned ids read as 404 (no existence leak).
const app = buildApp()
const PREFIX = 'TEST-CRUD-'
let cookie: string

const body = (n: string) => ({
  invoiceNumber: `${PREFIX}${n}`,
  vendorName: 'Vendor',
  items: [{ description: 'Work', quantity: 1, total: 100 }],
  category: 'OTHER',
  invoiceDate: '2026-02-01',
})

async function createOwn(n: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: body(n),
    headers: { cookie },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id
}

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await app.close()
})

describe('GET /api/invoices/:id', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices/x' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /api/invoices/:id', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/invoices/x', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the unchanged invoiceNumber without a self-collision 409', async () => {
    // The edit form resubmits the full record incl. the original invoiceNumber;
    // updating a row to its own unique value must not trip the unique constraint.
    const id = await createOwn('selfedit')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: {
        invoiceNumber: `${PREFIX}selfedit`,
        items: [{ description: 'Work', quantity: 1, total: 250 }],
      },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().invoiceNumber).toBe(`${PREFIX}selfedit`)
    expect(Number(res.json().amount)).toBe(250)
  })

  it('replaces the full item list and recomputes amount, and records a FIELD_EDITED amount event', async () => {
    const id = await createOwn('items-replace')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: {
        items: [
          { description: 'New line 1', quantity: 1, total: 30 },
          { description: 'New line 2', quantity: 2, total: 20 },
        ],
      },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(Number(res.json().amount)).toBe(50)
    expect(res.json().items).toHaveLength(2)
    expect(res.json().items.map((i: { description: string }) => i.description)).toEqual([
      'New line 1',
      'New line 2',
    ])

    const events = await app.inject({
      method: 'GET',
      url: `/api/invoices/${id}/events`,
      headers: { cookie },
    })
    const detail = events
      .json()
      .data.find((e: { type: string; detail: { field?: string } }) => e.detail?.field === 'amount')
    expect(detail).toBeDefined()
  })

  it('a PATCH that omits items leaves the existing items and amount untouched', async () => {
    const id = await createOwn('items-untouched')
    const before = (
      await app.inject({ method: 'GET', url: `/api/invoices/${id}`, headers: { cookie } })
    ).json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: { vendorName: 'Renamed Vendor' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().amount).toBe(before.amount)
    expect(res.json().items).toEqual(before.items)
  })

  it('marks paid (sets paidDate) and clears paidDate when leaving PAID', async () => {
    const id = await createOwn('patch')

    const paid = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: { status: 'PAID' },
      headers: { cookie },
    })
    expect(paid.statusCode).toBe(200)
    expect(paid.json().status).toBe('PAID')
    expect(paid.json().paidDate).not.toBeNull()

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      payload: { status: 'PENDING' },
      headers: { cookie },
    })
    expect(reopened.json().status).toBe('PENDING')
    expect(reopened.json().paidDate).toBeNull()
  })

  it('404s when patching an unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/invoices/does-not-exist',
      payload: { status: 'PAID' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/invoices/:id', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/invoices/x' })
    expect(res.statusCode).toBe(401)
  })

  it('deletes an own invoice (204) and 404s an unknown id', async () => {
    const id = await createOwn('del')
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/invoices/${id}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(204)
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/invoices/${id}`,
      headers: { cookie },
    })
    expect(again.statusCode).toBe(404)
  })
})

describe('ownership isolation', () => {
  it("a second user's invoice is invisible to the landlord (404 on get/patch/delete, absent from list)", async () => {
    const second = await createSecondUser(app)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: body('second'),
        headers: { cookie: second.cookie },
      })
      expect(created.statusCode).toBe(201)
      const otherId = created.json().id

      // Landlord cannot read, patch, or delete it.
      expect(
        (await app.inject({ method: 'GET', url: `/api/invoices/${otherId}`, headers: { cookie } }))
          .statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/invoices/${otherId}`,
            payload: { status: 'PAID' },
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/invoices/${otherId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404)

      // And it never appears in the landlord's list.
      const list = await app.inject({
        method: 'GET',
        url: '/api/invoices?limit=100',
        headers: { cookie },
      })
      const ids = list.json().data.map((i: { id: string }) => i.id)
      expect(ids).not.toContain(otherId)
    } finally {
      await second.cleanup()
    }
  })
})
