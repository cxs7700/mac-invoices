import type { FastifyInstance } from 'fastify'
import { hashPassword } from '../../src/auth/password'

const EMAIL = process.env.LANDLORD_EMAIL ?? 'landlord@example.com'
const PASSWORD = process.env.LANDLORD_PASSWORD ?? 'changeme-dev'

/** Log in and return the `session=...` cookie string for replay on injects. */
export async function loginCookie(
  app: FastifyInstance,
  email = EMAIL,
  password = PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  if (res.statusCode !== 200) {
    throw new Error(`login failed (${res.statusCode}); reseed with LANDLORD_PASSWORD set`)
  }
  const raw = res.headers['set-cookie']
  const header = Array.isArray(raw) ? raw.join(';') : String(raw)
  return header
    .split(';')
    .find((p) => p.trim().startsWith('session='))!
    .trim()
}

/** Create a throwaway second user + their login cookie, with a cleanup fn. */
export async function createSecondUser(app: FastifyInstance) {
  // Random suffix as well as the timestamp: test files run in parallel and can
  // otherwise collide on the same millisecond (unique-email constraint).
  const email = `second-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`
  const password = 'second-user-pass'
  const user = await app.prisma.user.create({
    data: { email, name: 'Second', role: 'LANDLORD', passwordHash: await hashPassword(password) },
  })
  const cookie = await loginCookie(app, email, password)
  const cleanup = async () => {
    await app.prisma.session.deleteMany({ where: { userId: user.id } })
    await app.prisma.invoice.deleteMany({ where: { userId: user.id } })
    await app.prisma.user.delete({ where: { id: user.id } }).catch(() => {})
  }
  return { user, cookie, cleanup }
}
