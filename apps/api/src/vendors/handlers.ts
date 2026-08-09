import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreateVendorSchema, UpdateVendorSchema } from '@mac-invoices/shared'
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
}

/**
 * Landlord-facing shape. `link` is derived on every read so the landlord can
 * copy it whenever they like (DEC-033); it is null for a revoked vendor, where
 * handing back a string that no longer works would only mislead.
 */
function toVendor(v: VendorRow) {
  const active = v.revokedAt === null
  return {
    id: v.id,
    name: v.name,
    phone: v.phone,
    email: v.email,
    linkActive: active,
    link: active ? linkUrl(buildLinkToken(v.tokenLookupId, v.tokenVersion)) : null,
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
  })
  return reply.send({ data: rows.map(toVendor) })
}

/** GET /api/vendors/:id — one own vendor, or 404. */
export async function getVendor(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
  const v = await ownVendor(request.server.prisma, request.params.id, request.user.id)
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
  })
  return reply.send(toVendor(v))
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
  })
  return reply.send(toVendor(v))
}
