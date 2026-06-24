import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreateContractorSchema, UpdateContractorSchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { generateLinkToken } from './token'
import type { PrismaClient } from '../../prisma/generated/client.ts'

type ContractorRow = {
  id: string
  name: string
  contact: string
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

/** Landlord-facing shape — never the token secret/hash, only whether it's live. */
function toContractor(c: ContractorRow) {
  return {
    id: c.id,
    name: c.name,
    contact: c.contact,
    linkActive: c.revokedAt === null,
    lastUsedAt: c.lastUsedAt,
    createdAt: c.createdAt,
  }
}

/** The base path under which the contractor opens their link (the SPA route). */
function linkUrl(plaintext: string): string {
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
  return `${base}/submit/${plaintext}`
}

/** Build a fresh contractor link's stored columns. */
export function freshLinkData() {
  const link = generateLinkToken()
  return { columns: { tokenLookupId: link.lookupId, tokenHash: link.tokenHash }, plaintext: link.plaintext }
}

type Params = { id: string }

/** Find a contractor scoped to the landlord, or 404 (no existence leak). */
async function ownContractor(prisma: PrismaClient, id: string, landlordId: string) {
  const c = await prisma.contractor.findFirst({ where: { id, landlordId } })
  if (!c) throw new AppError('NOT_FOUND', 'Contractor not found', 404)
  return c
}

/**
 * POST /api/contractors — add a contractor and mint their link in one step (the
 * row requires a token). Returns the contractor plus the one-time plaintext link.
 */
export async function createContractor(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateContractorSchema, request.body)
  const { columns, plaintext } = freshLinkData()
  const c = await request.server.prisma.contractor.create({
    data: { landlordId: request.user.id, name: input.name, contact: input.contact, ...columns },
  })
  return reply.code(201).send({ ...toContractor(c), link: linkUrl(plaintext) })
}

/** GET /api/contractors — the landlord's contractors, newest first. */
export async function listContractors(request: FastifyRequest, reply: FastifyReply) {
  const rows = await request.server.prisma.contractor.findMany({
    where: { landlordId: request.user.id },
    orderBy: { createdAt: 'desc' },
  })
  return reply.send({ data: rows.map(toContractor) })
}

/** GET /api/contractors/:id — one own contractor, or 404. */
export async function getContractor(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const c = await ownContractor(request.server.prisma, request.params.id, request.user.id)
  return reply.send(toContractor(c))
}

/** PATCH /api/contractors/:id — edit name/contact (own only). */
export async function updateContractor(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateContractorSchema, request.body)
  await ownContractor(request.server.prisma, request.params.id, request.user.id)
  const c = await request.server.prisma.contractor.update({
    where: { id: request.params.id },
    data: { ...(input.name !== undefined && { name: input.name }), ...(input.contact !== undefined && { contact: input.contact }) },
  })
  return reply.send(toContractor(c))
}
