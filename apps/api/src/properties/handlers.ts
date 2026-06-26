import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreatePropertySchema, UpdatePropertySchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { money } from '../lib/money'
import type { PrismaClient } from '../../prisma/generated/client.ts'

type PropertyRow = {
  id: string
  name: string
  address: string
  notes: string | null
  createdAt: Date
}

/** Landlord-facing shape for a property. */
function toProperty(p: PropertyRow) {
  return { id: p.id, name: p.name, address: p.address, notes: p.notes, createdAt: p.createdAt }
}

type Params = { id: string }

/** Find a property scoped to the landlord, or 404 (no existence leak). */
async function ownProperty(prisma: PrismaClient, id: string, landlordId: string) {
  const p = await prisma.property.findFirst({ where: { id, landlordId } })
  if (!p) throw new AppError('NOT_FOUND', 'Property not found', 404)
  return p
}

/** POST /api/properties — create a property for the landlord. */
export async function createProperty(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreatePropertySchema, request.body)
  const p = await request.server.prisma.property.create({
    data: {
      landlordId: request.user.id,
      // Name is optional; store '' when omitted so the column stays non-null and
      // the address is used as the display label (see `propertyLabel`).
      name: input.name ?? '',
      address: input.address,
      notes: input.notes ?? null,
    },
  })
  return reply.code(201).send(toProperty(p))
}

/** GET /api/properties — the landlord's properties, newest first. */
export async function listProperties(request: FastifyRequest, reply: FastifyReply) {
  const rows = await request.server.prisma.property.findMany({
    where: { landlordId: request.user.id },
    orderBy: { createdAt: 'desc' },
  })
  return reply.send({ data: rows.map(toProperty) })
}

/**
 * GET /api/properties/:id — one own property plus its total-spend rollup
 * (sum of its invoices' amounts excluding REJECTED/CANCELLED). The aggregate is
 * scoped to the landlord (userId) as defense-in-depth on top of ownProperty.
 */
export async function getProperty(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const landlordId = request.user.id
  const p = await ownProperty(request.server.prisma, request.params.id, landlordId)
  const agg = await request.server.prisma.invoice.aggregate({
    where: { propertyId: p.id, userId: landlordId, status: { notIn: ['REJECTED', 'CANCELLED'] } },
    _sum: { amount: true },
  })
  return reply.send({ ...toProperty(p), totalSpend: money(agg._sum.amount) })
}

/** PATCH /api/properties/:id — edit name/address/notes (own only). */
export async function updateProperty(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdatePropertySchema, request.body)
  await ownProperty(request.server.prisma, request.params.id, request.user.id)
  const p = await request.server.prisma.property.update({
    where: { id: request.params.id },
    data: {
      ...(input.name !== undefined && { name: input.name ?? '' }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  })
  return reply.send(toProperty(p))
}

/**
 * DELETE /api/properties/:id — delete a property, blocked while any invoice
 * references it. The pre-check is landlord-scoped and the message names the count
 * so the landlord can reassign first (the DB FK is Restrict as a backstop).
 */
export async function deleteProperty(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const landlordId = request.user.id
  await ownProperty(request.server.prisma, request.params.id, landlordId)
  const attached = await request.server.prisma.invoice.count({
    where: { propertyId: request.params.id, userId: landlordId },
  })
  if (attached > 0) {
    throw new AppError(
      'PROPERTY_HAS_INVOICES',
      `Can't delete: ${attached} invoice${attached === 1 ? '' : 's'} assigned. Reassign them first.`,
      422,
    )
  }
  await request.server.prisma.property.delete({ where: { id: request.params.id } })
  return reply.code(204).send()
}
