import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreateVendorSchema, UpdateVendorSchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { generateLinkToken } from './token'
import type { PrismaClient } from '../../prisma/generated/client.ts'

type VendorRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

/** Landlord-facing shape — never the token secret/hash, only whether it's live. */
function toVendor(v: VendorRow) {
  return {
    id: v.id,
    name: v.name,
    phone: v.phone,
    email: v.email,
    linkActive: v.revokedAt === null,
    lastUsedAt: v.lastUsedAt,
    createdAt: v.createdAt,
  }
}

/** The base path under which the vendor opens their link (the SPA route). */
function linkUrl(plaintext: string): string {
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
  return `${base}/submit/${plaintext}`
}

/** Build a fresh vendor link's stored columns. */
export function freshLinkData() {
  const link = generateLinkToken()
  return {
    columns: { tokenLookupId: link.lookupId, tokenHash: link.tokenHash },
    plaintext: link.plaintext,
  }
}

type Params = { id: string }

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'

/** Find a vendor scoped to the landlord, or 404 (no existence leak). */
async function ownVendor(prisma: PrismaClient, id: string, landlordId: string) {
  const v = await prisma.vendor.findFirst({ where: { id, landlordId } })
  if (!v) throw new AppError('NOT_FOUND', 'Vendor not found', 404)
  return v
}

/**
 * POST /api/vendors — add a vendor and mint their link in one step (the
 * row requires a token). Returns the vendor plus the one-time plaintext link.
 */
export async function createVendor(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateVendorSchema, request.body)
  const { columns, plaintext } = freshLinkData()
  const v = await request.server.prisma.vendor.create({
    data: {
      landlordId: request.user.id,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      ...columns,
    },
  })
  return reply.code(201).send({ ...toVendor(v), link: linkUrl(plaintext) })
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
 * POST /api/vendors/:id/regenerate — rotate the link: a new lookupId + hash
 * replace the old (which becomes inert) and any revocation is cleared, in one
 * update. Returns the new one-time plaintext link. Retries the rare lookupId
 * collision.
 */
export async function regenerateLink(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  for (let attempt = 0; ; attempt++) {
    const { columns, plaintext } = freshLinkData()
    try {
      const v = await request.server.prisma.vendor.update({
        where: { id: request.params.id },
        data: { ...columns, revokedAt: null },
      })
      return reply.send({ ...toVendor(v), link: linkUrl(plaintext) })
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue
      throw err
    }
  }
}
