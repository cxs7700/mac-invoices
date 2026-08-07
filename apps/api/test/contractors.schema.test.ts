import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'

// U1 schema spine: the Contractor model, the Invoice submitter/rejection columns,
// and the nullable category/invoiceNumber. These are Prisma-level integration
// tests (real Postgres) proving the relations behave as the lifecycle needs:
// contractor submissions persist categoryless, deleting a landlord cascades the
// contractor, and deleting a contractor never cascades into the landlord-owned
// invoice (SetNull keeps the row, only nulls the submitter).
const app = buildApp()

async function makeLandlord() {
  return app.prisma.user.create({
    data: {
      email: `u1-landlord-${Date.now()}-${Math.round(performance.now())}@example.com`,
      name: 'L',
      role: 'LANDLORD',
      passwordHash: await hashPassword('x'),
    },
  })
}

let landlordId: string

beforeAll(async () => {
  await app.ready()
  landlordId = (await makeLandlord()).id
})

afterAll(async () => {
  // Cascades clean up contractors + invoices owned by this landlord.
  await app.prisma.invoice.deleteMany({ where: { userId: landlordId } })
  await app.prisma.user.delete({ where: { id: landlordId } }).catch(() => {})
  await app.close()
})

describe('U1 schema: contractor + nullable invoice columns', () => {
  it('persists a categoryless, unnumbered submission with a submitter', async () => {
    const contractor = await app.prisma.contractor.create({
      data: { landlordId, name: 'Joe', contact: '555-1234', tokenLookupId: `lk-${Date.now()}-a`, tokenHash: 'h' },
    })
    const inv = await app.prisma.invoice.create({
      data: {
        vendorName: 'Joe',
        amount: '120.00',
        invoiceDate: new Date('2026-06-01'),
        status: 'PENDING',
        userId: landlordId,
        submittedByContractorId: contractor.id,
        // category and invoiceNumber intentionally omitted — both nullable now.
      },
    })
    const read = await app.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })
    expect(read.category).toBeNull()
    expect(read.invoiceNumber).toBeNull()
    expect(read.submittedByContractorId).toBe(contractor.id)
    expect(read.userId).toBe(landlordId)
  })

  it('enforces tokenLookupId uniqueness', async () => {
    const lk = `lk-dup-${Date.now()}`
    await app.prisma.contractor.create({ data: { landlordId, name: 'A', contact: 'a', tokenLookupId: lk, tokenHash: 'h' } })
    await expect(
      app.prisma.contractor.create({ data: { landlordId, name: 'B', contact: 'b', tokenLookupId: lk, tokenHash: 'h' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('SetNull: deleting a contractor keeps the landlord-owned invoice, nulls the submitter', async () => {
    const contractor = await app.prisma.contractor.create({
      data: { landlordId, name: 'Temp', contact: 't', tokenLookupId: `lk-${Date.now()}-b`, tokenHash: 'h' },
    })
    const inv = await app.prisma.invoice.create({
      data: {
        vendorName: 'Temp',
        amount: '50.00',
        invoiceDate: new Date('2026-06-01'),
        status: 'PENDING',
        userId: landlordId,
        submittedByContractorId: contractor.id,
      },
    })
    await app.prisma.contractor.delete({ where: { id: contractor.id } })
    const survived = await app.prisma.invoice.findUnique({ where: { id: inv.id } })
    expect(survived).not.toBeNull()
    expect(survived!.submittedByContractorId).toBeNull()
    expect(survived!.userId).toBe(landlordId)
  })

  it('Cascade: deleting a landlord removes their contractors', async () => {
    const tempLandlord = await makeLandlord()
    const c = await app.prisma.contractor.create({
      data: { landlordId: tempLandlord.id, name: 'C', contact: 'c', tokenLookupId: `lk-${Date.now()}-c`, tokenHash: 'h' },
    })
    await app.prisma.user.delete({ where: { id: tempLandlord.id } })
    expect(await app.prisma.contractor.findUnique({ where: { id: c.id } })).toBeNull()
  })
})
