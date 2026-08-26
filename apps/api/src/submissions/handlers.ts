import type { FastifyRequest, FastifyReply } from 'fastify'
import { SubmissionSchema, ImageUploadTokenSchema, summarizeItems } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { validateLinkToken, parseLinkToken } from '../vendors/token'
import { logEvent } from '../lib/log'
import { issueUploadToken, signedReadUrl } from '../integrations/storage'
import { createSubmission, withdrawSubmission, vendorBlobOwner } from '../invoices/writeService'

// Public (no-session) endpoints authorized purely by the link token. Every
// failure to resolve the token returns the SAME opaque 404 ("link no longer
// active") — invalid, revoked, and unknown are indistinguishable (no existence
// leak). The token is re-checked at write time, so revoking between page load
// and submit is caught here.

export type TokenParams = { token: string }

/** Resolve the path token to a vendor, or throw the uniform dead-link 404. */
async function resolveLink(request: FastifyRequest<{ Params: TokenParams }>) {
  const link = await validateLinkToken(request.server.prisma, request.params.token)
  if (!link) {
    // The one place every dead-link rejection passes through, so it is the one
    // place worth logging: repeated denials on a single lookupId are what a
    // brute-force or a leaked-then-revoked link looks like.
    //
    // Only the NON-SECRET lookupId is recorded — the same half `redactUrlToken`
    // keeps in the request URL. Logging the whole token would hand a log reader
    // a working credential. `validateLinkToken` deliberately cannot say WHICH
    // failure occurred (no existence leak), so there is no `reason` to give.
    logEvent(request.log, 'warn', {
      event: 'submission.link.denied',
      outcome: 'denied',
      tokenLookupId: parseLinkToken(request.params.token)?.lookupId,
    })
    throw new AppError('NOT_FOUND', 'This link is no longer active', 404)
  }
  return link
}

/**
 * POST /api/submissions/:token — create a SUBMITTED invoice owned by the
 * landlord, attributed to the vendor. Vendor name defaults to the vendor's
 * name; the photo is required and gated to the vendor's own uploads.
 */
export async function submit(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { vendorId, landlordId } = await resolveLink(request)
  const input = parseBody(SubmissionSchema, request.body)
  const vendor = await request.server.prisma.vendor.findUniqueOrThrow({
    where: { id: vendorId },
    select: { name: true },
  })
  const invoice = await createSubmission(
    request.server.prisma,
    { ownerUserId: landlordId, vendorId, vendorName: vendor.name },
    input,
  )
  return reply.code(201).send({ id: invoice.id, status: invoice.status })
}

/**
 * POST /api/submissions/:token/upload-token — mint a short-lived Vercel Blob
 * client token scoped to the vendor's own prefix (`c_<id>`), so the photo
 * the vendor uploads passes the submit gate and can never reference the
 * landlord's or another vendor's blobs.
 */
export async function createUploadToken(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { vendorId } = await resolveLink(request)
  const { contentType } = parseBody(ImageUploadTokenSchema, request.body)
  const result = await issueUploadToken(vendorBlobOwner(vendorId), contentType)
  return reply.send(result)
}

/**
 * GET /api/submissions/:token — the vendor's OWN submissions and statuses,
 * scoped to their vendor id. Safe fields only: never invoiceNumber, never
 * another vendor's or the landlord's invoices (no existence leak, AE4).
 */
/**
 * GET /api/submissions/:token/properties — the properties the landlord has
 * assigned to THIS vendor, so they can file their submission against one.
 *
 * Previously this returned every property the landlord owned. It is now scoped
 * to the vendor's assignment, which narrows what a link discloses: a vendor
 * working on one building no longer learns the addresses of the rest of the
 * portfolio. What remains disclosed — the name and address of properties the
 * landlord deliberately assigned to this vendor — is accepted, because the
 * alternative is the vendor typing an address in free text for the landlord to
 * re-key, and a link is already a bearer credential the landlord chooses who to
 * hand to. Revoking the link closes this along with everything else.
 *
 * An empty array is a normal result (nothing assigned yet), not an error; the
 * page renders a "contact your landlord" panel rather than an unusable form.
 *
 * Only id/name/address are returned — never notes.
 */
export async function listProperties(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { landlordId, vendorId } = await resolveLink(request)
  const rows = await request.server.prisma.property.findMany({
    // landlordId is redundant against the join row but kept as a belt-and-braces
    // tenant assertion: a mispaired assignment can never leak through this read.
    where: { landlordId, vendors: { some: { vendorId } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, address: true },
  })
  return reply.send({ data: rows })
}

export async function listOwn(
  request: FastifyRequest<{ Params: TokenParams }>,
  reply: FastifyReply,
) {
  const { vendorId } = await resolveLink(request)
  const rows = await request.server.prisma.invoice.findMany({
    where: { submittedByVendorId: vendorId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      amount: true,
      // Submissions are itemized, so the vendor's own list summarizes every
      // line rather than showing just the first — the same one-line treatment
      // the landlord's invoice table uses.
      items: { select: { description: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
      invoiceDate: true,
      rejectionReason: true,
      createdAt: true,
    },
  })
  return reply.send({
    data: rows.map(({ items, ...r }) => ({
      ...r,
      amount: r.amount.toFixed(2),
      description: summarizeItems(items),
    })),
  })
}

type EditParams = TokenParams & { id: string }

/**
 * GET /api/submissions/:token/:id — the vendor's read-only view of ONE of their
 * own submissions, in full: lines, property, notes, parts, photos (freshly
 * signed read URLs). Scoped by `submittedByVendorId`; a foreign or absent id is
 * the same uniform 404 the dead-link path uses (no existence probe). This is
 * view-only by design — submissions cannot be edited once filed; a vendor who
 * needs a change withdraws and resubmits.
 */
export async function detailOwn(
  request: FastifyRequest<{ Params: EditParams }>,
  reply: FastifyReply,
) {
  const { vendorId } = await resolveLink(request)
  const inv = await request.server.prisma.invoice.findFirst({
    where: { id: request.params.id, submittedByVendorId: vendorId },
    select: {
      id: true,
      status: true,
      amount: true,
      invoiceDate: true,
      category: true,
      notes: true,
      partsOrdered: true,
      rejectionReason: true,
      createdAt: true,
      property: { select: { name: true, address: true } },
      items: {
        select: { description: true, quantity: true, total: true },
        orderBy: { sortOrder: 'asc' },
      },
      images: {
        select: { id: true, url: true, type: true, caption: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!inv) throw new AppError('NOT_FOUND', 'Submission not found', 404)
  return reply.send({
    data: {
      ...inv,
      amount: inv.amount.toFixed(2),
      items: inv.items.map((i) => ({ ...i, total: i.total.toFixed(2) })),
      images: await Promise.all(
        inv.images.map(async (img) => ({ ...img, url: await signedReadUrl(img.url) })),
      ),
    },
  })
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
  const { vendorId } = await resolveLink(request)
  const inv = await withdrawSubmission(request.server.prisma, {
    vendorId,
    invoiceId: request.params.id,
  })
  return reply.send({ id: inv.id, status: inv.status })
}
