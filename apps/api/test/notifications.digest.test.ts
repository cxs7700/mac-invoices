import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('../src/integrations/email', () => ({ sendEmail }))

import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { runDigestFlush } from '../src/notifications/digest'

const app = buildApp()
const created: string[] = [] // landlord user ids to clean up

async function makeLandlord() {
  const u = await app.prisma.user.create({
    data: { email: `dg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`, role: 'LANDLORD', passwordHash: await hashPassword('x') },
  })
  created.push(u.id)
  return u
}
async function makeVendor(landlordId: string, name: string) {
  return app.prisma.vendor.create({
    data: { landlordId, name, phone: 'x', tokenLookupId: `lk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
}
const ev = (ownerUserId: string, vendorId: string, type: string, detail: object = {}) =>
  app.prisma.invoiceEvent.create({
    data: { invoiceId: `inv-${Math.random().toString(36).slice(2)}`, actorId: `vendor:${vendorId}`, ownerUserId, type: type as never, detail },
  })
const notifiedCount = (ownerUserId: string) =>
  app.prisma.invoiceEvent.count({ where: { ownerUserId, notifiedAt: { not: null } } })

beforeAll(async () => { await app.ready() })
beforeEach(() => { vi.clearAllMocks(); sendEmail.mockResolvedValue(undefined) })
afterAll(async () => {
  for (const id of created) {
    await app.prisma.invoiceEvent.deleteMany({ where: { ownerUserId: id } })
    await app.prisma.invoice.deleteMany({ where: { userId: id } })
    await app.prisma.user.delete({ where: { id } }).catch(() => {})
  }
  await app.close()
})

describe('digest flush', () => {
  it('sends one digest covering submissions + withdrawals, then stamps them (AE1)', async () => {
    const l = await makeLandlord()
    const c = await makeVendor(l.id, 'Joe')
    await ev(l.id, c.id, 'CREATED')
    await ev(l.id, c.id, 'CREATED')
    await ev(l.id, c.id, 'STATUS_CHANGED', { from: 'SUBMITTED', to: 'CANCELLED' })

    // Scoped to this landlord (other test files run in parallel against the same DB).
    await runDigestFlush(app.prisma)
    const myCall = sendEmail.mock.calls.find((c) => c[0].to === l.email)
    expect(myCall).toBeDefined()
    expect(myCall![0].subject).toMatch(/2 new submissions and 1 withdrawal/)
    expect(await notifiedCount(l.id)).toBe(3)

    // A second flush does not re-send to this landlord (their events are stamped).
    sendEmail.mockClear()
    await runDigestFlush(app.prisma)
    expect(sendEmail.mock.calls.every((c) => c[0].to !== l.email)).toBe(true)
  })

  it('does NOT email a vendor edit (FIELD_EDITED) and leaves it un-notified (AE2/R4)', async () => {
    const l = await makeLandlord()
    const c = await makeVendor(l.id, 'Pat')
    const edit = await ev(l.id, c.id, 'FIELD_EDITED', { field: 'amount', old: '1', new: '2' })
    await runDigestFlush(app.prisma)
    expect(sendEmail.mock.calls.every((c) => c[0].to !== l.email)).toBe(true)
    expect((await app.prisma.invoiceEvent.findUniqueOrThrow({ where: { id: edit.id } })).notifiedAt).toBeNull()
  })

  it('excludes landlord-authored events (only vendor activity notifies)', async () => {
    const l = await makeLandlord()
    // A landlord-authored status change (actorId is the landlord user id, not vendor:).
    await app.prisma.invoiceEvent.create({
      data: { invoiceId: 'inv-x', actorId: l.id, ownerUserId: l.id, type: 'STATUS_CHANGED', detail: { from: 'SUBMITTED', to: 'APPROVED' } },
    })
    await runDigestFlush(app.prisma)
    expect(sendEmail.mock.calls.every((c) => c[0].to !== l.email)).toBe(true)
  })

  it('a provider failure for one landlord does not crash the job or block others (AE4 + at-least-once)', async () => {
    const a = await makeLandlord()
    const b = await makeLandlord()
    const ca = await makeVendor(a.id, 'A-con')
    const cb = await makeVendor(b.id, 'B-con')
    await ev(a.id, ca.id, 'CREATED')
    await ev(b.id, cb.id, 'CREATED')
    // Fail only landlord B's send.
    sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === b.email) throw new Error('provider down')
    })

    await runDigestFlush(app.prisma)
    // A's event stamped (sent); B's left un-notified (re-sent next run — at-least-once).
    expect(await notifiedCount(a.id)).toBe(1)
    expect(await notifiedCount(b.id)).toBe(0)
  })

  it('per-landlord isolation: each digest contains only that landlord’s vendor (AE5)', async () => {
    const a = await makeLandlord()
    const b = await makeLandlord()
    await ev(a.id, (await makeVendor(a.id, 'Alice')).id, 'CREATED')
    await ev(b.id, (await makeVendor(b.id, 'Bob')).id, 'CREATED')

    await runDigestFlush(app.prisma)
    const calls = Object.fromEntries(sendEmail.mock.calls.map((c) => [c[0].to, c[0].html as string]))
    expect(calls[a.email]).toMatch(/Alice/)
    expect(calls[a.email]).not.toMatch(/Bob/)
    expect(calls[b.email]).toMatch(/Bob/)
    expect(calls[b.email]).not.toMatch(/Alice/)
  })

  it('HTML-escapes vendor names in the digest (no raw markup injected)', async () => {
    const l = await makeLandlord()
    const c = await makeVendor(l.id, '<img src=x onerror=alert(1)>')
    await ev(l.id, c.id, 'CREATED')

    await runDigestFlush(app.prisma)
    const myCall = sendEmail.mock.calls.find((c) => c[0].to === l.email)
    expect(myCall).toBeDefined()
    const html = myCall![0].html as string
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
