import type { FastifyRequest, FastifyReply } from 'fastify'
import { SubmissionSchema, EditSubmissionSchema, ImageUploadTokenSchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { validateLinkToken } from '../contractors/token'
import { issueUploadToken } from '../integrations/storage'
import {
  createSubmission,
  contractorUpdateSubmission,
  contractorBlobOwner,
} from '../invoices/writeService'

// Public (no-session) endpoints authorized purely by the link token. Every
// failure to resolve the token returns the SAME opaque 404 ("link no longer
// active") — invalid, revoked, and unknown are indistinguishable (no existence
// leak). The token is re-checked at write time, so revoking between page load
// and submit is caught here.

export type TokenParams = { token: string }

/** Resolve the path token to a contractor, or throw the uniform dead-link 404. */
async function resolveLink(request: FastifyRequest<{ Params: TokenParams }>) {
  const link = await validateLinkToken(request.server.prisma, request.params.token)
  if (!link) throw new AppError('NOT_FOUND', 'This link is no longer active', 404)
  return link
}

/**
 * POST /api/submissions/:token — create a SUBMITTED invoice owned by the
 * landlord, attributed to the contractor. Vendor defaults to the contractor's
 * name; the photo is required and gated to the contractor's own uploads.
 */
export async function submit(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { contractorId, landlordId } = await resolveLink(request)
  const input = parseBody(SubmissionSchema, request.body)
  const contractor = await request.server.prisma.contractor.findUniqueOrThrow({
    where: { id: contractorId },
    select: { name: true },
  })
  const invoice = await createSubmission(
    request.server.prisma,
    { ownerUserId: landlordId, contractorId, vendorName: contractor.name },
    input,
  )
  return reply.code(201).send({ id: invoice.id, status: invoice.status })
}

/**
 * POST /api/submissions/:token/upload-token — mint a short-lived Vercel Blob
 * client token scoped to the contractor's own prefix (`c_<id>`), so the photo
 * the contractor uploads passes the submit gate and can never reference the
 * landlord's or another contractor's blobs.
 */
export async function createUploadToken(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { contractorId } = await resolveLink(request)
  const { contentType } = parseBody(ImageUploadTokenSchema, request.body)
  const result = await issueUploadToken(contractorBlobOwner(contractorId), contentType)
  return reply.send(result)
}

/**
 * GET /api/submissions/:token — the contractor's OWN submissions and statuses,
 * scoped to their contractor id. Safe fields only: never invoiceNumber, never
 * another contractor's or the landlord's invoices (no existence leak, AE4).
 */
export async function listOwn(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { contractorId } = await resolveLink(request)
  const rows = await request.server.prisma.invoice.findMany({
    where: { submittedByContractorId: contractorId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      amount: true,
      description: true,
      invoiceDate: true,
      rejectionReason: true,
      createdAt: true,
    },
  })
  return reply.send({
    data: rows.map((r) => ({ ...r, amount: r.amount.toFixed(2) })),
  })
}

type EditParams = TokenParams & { id: string }

/**
 * PATCH /api/submissions/:token/:id — edit a still-SUBMITTED submission. The
 * write is a compare-and-set scoped to this contractor; a reviewed (or foreign,
 * or absent) submission returns a uniform 409.
 */
export async function edit(
  request: FastifyRequest<{ Params: EditParams }>,
  reply: FastifyReply,
) {
  const { contractorId } = await resolveLink(request)
  const input = parseBody(EditSubmissionSchema, request.body)
  const inv = await contractorUpdateSubmission(
    request.server.prisma,
    { contractorId, invoiceId: request.params.id },
    input,
  )
  return reply.send({ id: inv.id, status: inv.status })
}

/**
 * POST /api/submissions/:token/:id/withdraw — withdraw a still-SUBMITTED
 * submission (→ CANCELLED), compare-and-set so a concurrent landlord review
 * wins. The landlord-owned invoice row and its photo survive — withdraw never
 * deletes them.
 */
export async function withdraw(
  request: FastifyRequest<{ Params: EditParams }>,
  reply: FastifyReply,
) {
  const { contractorId } = await resolveLink(request)
  const inv = await contractorUpdateSubmission(
    request.server.prisma,
    { contractorId, invoiceId: request.params.id },
    { withdraw: true },
  )
  return reply.send({ id: inv.id, status: inv.status })
}
