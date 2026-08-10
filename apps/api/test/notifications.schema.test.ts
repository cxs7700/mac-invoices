import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'

// U1 — notification markers: InvoiceEvent.notifiedAt + User.notificationsSeenAt,
// both additive nullable columns (no FK change to the ledger).
const app = buildApp()
let userId: string

beforeAll(async () => {
  await app.ready()
  const u = await app.prisma.user.create({
    data: {
      email: `notif-${Date.now()}@example.com`,
      role: 'LANDLORD',
      passwordHash: await hashPassword('x'),
    },
  })
  userId = u.id
})
afterAll(async () => {
  await app.prisma.invoiceEvent.deleteMany({ where: { ownerUserId: userId } })
  await app.prisma.invoice.deleteMany({ where: { userId } })
  await app.prisma.user.delete({ where: { id: userId } }).catch(() => {})
  await app.close()
})

describe('U1 notification markers', () => {
  it('User.notificationsSeenAt defaults to null', async () => {
    expect(
      (await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).notificationsSeenAt,
    ).toBeNull()
  })

  it('InvoiceEvent persists notifiedAt null and can be stamped', async () => {
    const ev = await app.prisma.invoiceEvent.create({
      data: {
        invoiceId: 'inv-x',
        actorId: `vendor:c1`,
        ownerUserId: userId,
        type: 'CREATED',
        detail: {},
      },
    })
    expect(ev.notifiedAt).toBeNull()
    const stamped = await app.prisma.invoiceEvent.update({
      where: { id: ev.id },
      data: { notifiedAt: new Date() },
    })
    expect(stamped.notifiedAt).not.toBeNull()
  })
})
