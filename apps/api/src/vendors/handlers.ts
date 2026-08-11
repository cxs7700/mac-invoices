import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  CreateVendorSchema,
  UpdateVendorSchema,
  SetVendorPropertiesSchema,
  formatPhone,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { buildLinkToken, newLookupId } from './token'
import type { PrismaClient } from '../../prisma/generated/client.ts'

type VendorRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  tokenLookupId: string
  tokenVersion: number
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  // Present only on the reads that ask for it; a freshly created vendor has no
  // assignments yet, so its absence correctly reads as zero.
  _count?: { properties: number }
}

/** Counts the vendor's assigned properties on any read that includes it. */
const withPropertyCount = { _count: { select: { properties: true } } } as const

/**
 * Landlord-facing shape. `link` is derived on every read so the landlord can
 * copy it whenever they like (DEC-034); it is null for a revoked vendor, where
 * handing back a string that no longer works would only mislead.
 */
function toVendor(v: VendorRow) {
  const active = v.revokedAt === null
  return {
    id: v.id,
    name: v.name,
    // Normalized on the way out as well as on the way in. Writes have gone
    // through formatPhone since DEC-034's wave, but rows created before that
    // still hold raw input, and formatPhone is idempotent — so reading through
    // it makes every consumer see one shape without a backfill.
    phone: formatPhone(v.phone) || null,
    email: v.email,
    linkActive: active,
    link: active ? linkUrl(buildLinkToken(v.tokenLookupId, v.tokenVersion)) : null,
    propertyCount: v._count?.properties ?? 0,
    lastUsedAt: v.lastUsedAt,
    createdAt: v.createdAt,
  }
}

/** The base path under which the vendor opens their link (the SPA route). */
function linkUrl(plaintext: string): string {
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
  return `${base}/submit/${plaintext}`
}

type Params = { id: string }

/** True for a Prisma unique-constraint violation (P2002) — shared with
 * writeService.resolveVendorId, which uses it to detect a concurrent
 * auto-create race on the (landlordId, lower(name)) index. */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'

/** Find a vendor scoped to the landlord, or 404 (no existence leak). */
async function ownVendor(prisma: PrismaClient, id: string, landlordId: string) {
  const v = await prisma.vendor.findFirst({ where: { id, landlordId } })
  if (!v) throw new AppError('NOT_FOUND', 'Vendor not found', 404)
  return v
}

/**
 * POST /api/vendors — add a vendor and mint their link in one step (the
 * row requires a lookup handle). The link comes back on the response like any
 * other read, since it is derived rather than shown once.
 */
export async function createVendor(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateVendorSchema, request.body)
  for (let attempt = 0; ; attempt++) {
    try {
      const v = await request.server.prisma.vendor.create({
        data: {
          landlordId: request.user.id,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          tokenLookupId: newLookupId(),
        },
      })
      return reply.code(201).send(toVendor(v))
    } catch (err) {
      // Retry only a lookupId collision; a duplicate vendor name is also P2002
      // and must surface to the caller rather than spin.
      const onLookupId =
        isUniqueViolation(err) &&
        JSON.stringify((err as { meta?: unknown }).meta ?? '').includes('tokenLookupId')
      if (onLookupId && attempt < 4) continue
      throw err
    }
  }
}

/** GET /api/vendors — the landlord's vendors, newest first. */
export async function listVendors(request: FastifyRequest, reply: FastifyReply) {
  const rows = await request.server.prisma.vendor.findMany({
    where: { landlordId: request.user.id },
    orderBy: { createdAt: 'desc' },
    include: withPropertyCount,
  })
  return reply.send({ data: rows.map(toVendor) })
}

/** GET /api/vendors/:id — one own vendor, or 404. */
export async function getVendor(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const v = await request.server.prisma.vendor.findUniqueOrThrow({
    where: { id: request.params.id },
    include: withPropertyCount,
  })
  return reply.send(toVendor(v))
}

/** PATCH /api/vendors/:id — edit name/phone/email (own only). */
export async function updateVendor(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateVendorSchema, request.body)
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const v = await request.server.prisma.vendor.update({
    where: { id: request.params.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email }),
    },
    include: withPropertyCount,
  })
  return reply.send(toVendor(v))
}

/**
 * DELETE /api/vendors/:id — remove a vendor (own only).
 *
 * Invoices are NOT deleted with them: both FKs (`vendorId`, `submittedByVendorId`)
 * are `onDelete: SetNull`, and `Invoice.vendorName` is a plain string column, so
 * a historical invoice keeps the name it was filed under and simply stops being
 * linked to a vendor row. The vendor's submission link dies with the row.
 */
export async function deleteVendor(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  await request.server.prisma.vendor.delete({ where: { id: request.params.id } })
  return reply.code(204).send()
}

/**
 * GET /api/vendors/:id/properties — the properties assigned to this vendor.
 *
 * This is the set the vendor's submission link offers. Same id/name/address
 * shape the properties list uses, so the checkbox UI can diff the two directly.
 */
export async function listVendorProperties(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const rows = await request.server.prisma.property.findMany({
    where: { landlordId: request.user.id, vendors: { some: { vendorId: request.params.id } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, address: true },
  })
  return reply.send({ data: rows })
}

/**
 * PUT /api/vendors/:id/properties — replace this vendor's whole assignment.
 *
 * A set, not a patch: the UI is a checkbox list that always knows the full
 * intended state, so replacing in one transaction avoids the interleaving an
 * add/remove pair would invite. An empty array unassigns everything, which is
 * legal — and means the vendor's link can no longer submit.
 *
 * Every id is re-checked against the caller's own properties before the write.
 * The join table's composite PK does not encode the tenant boundary, so without
 * this a landlord could pair another landlord's property to their own vendor
 * and, through the submission link, learn that property's name and address.
 */
export async function setVendorProperties(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const vendorId = request.params.id
  const landlordId = request.user.id
  await ownVendor(request.server.prisma, vendorId, landlordId)
  const { propertyIds } = parseBody(SetVendorPropertiesSchema, request.body)
  // Duplicates in the payload would make createMany trip the composite PK.
  const ids = [...new Set(propertyIds)]

  await request.server.prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      const owned = await tx.property.count({ where: { id: { in: ids }, landlordId } })
      // A count mismatch covers both "not yours" and "doesn't exist" with one
      // message, so this can't be used to probe for another landlord's ids.
      if (owned !== ids.length) {
        throw new AppError('VALIDATION_ERROR', 'One or more properties were not found', 400)
      }
    }
    await tx.vendorProperty.deleteMany({ where: { vendorId } })
    if (ids.length > 0) {
      await tx.vendorProperty.createMany({
        data: ids.map((propertyId) => ({ vendorId, propertyId })),
      })
    }
  })

  const rows = await request.server.prisma.property.findMany({
    where: { landlordId, vendors: { some: { vendorId } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, address: true },
  })
  return reply.send({ data: rows })
}

/**
 * POST /api/vendors/:id/revoke — invalidate the link (idempotent). A revoked
 * link can neither submit nor read; the vendor's existing (landlord-owned)
 * submissions are untouched.
 */
export async function revokeLink(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const v = await request.server.prisma.vendor.update({
    where: { id: request.params.id },
    data: { revokedAt: new Date() },
    include: withPropertyCount,
  })
  return reply.send(toVendor(v))
}

/**
 * POST /api/vendors/:id/regenerate — issue a replacement link: bumping
 * `tokenVersion` changes the derived secret, so the previous URL stops
 * validating, and any revocation is cleared in the same update.
 *
 * This is no longer part of the everyday flow — a vendor keeps one stable link
 * they can be sent again and again. It exists for the deliberate
 * revoke-then-reissue path, which is the only way to replace a leaked link.
 */
export async function regenerateLink(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const v = await request.server.prisma.vendor.update({
    where: { id: request.params.id },
    data: { tokenVersion: { increment: 1 }, revokedAt: null },
    include: withPropertyCount,
  })
  return reply.send(toVendor(v))
}
