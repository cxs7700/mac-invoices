import type { FastifyRequest, FastifyReply } from 'fastify'
import { UpdateProfileSchema } from '@mac-invoices/shared'
import { parseBody } from '../lib/validate'

// Landlord self-serve settings, all scoped to the session user. Responses never
// include the password hash or any secret (DEC-019 / R10).

const accountSelect = { id: true, email: true, name: true, role: true } as const

/**
 * PATCH /api/settings/profile — edit the display name (email is read-only). Any
 * email field in the body is ignored. Returns the updated account.
 */
export async function updateProfile(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(UpdateProfileSchema, request.body)
  const account = await request.server.prisma.user.update({
    where: { id: request.user.id },
    data: { name: input.name },
    select: accountSelect,
  })
  return reply.send(account)
}
