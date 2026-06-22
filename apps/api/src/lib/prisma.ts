import './loadEnv.ts'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../prisma/generated/client.ts'

const connectionString = `${process.env.DATABASE_URL}`

// Reuse a single PrismaClient (and its pg pool) across warm serverless
// invocations (Vercel Fluid Compute) so we don't open a new pool per request.
// The module-scope const already survives warm reuse; the globalThis cache also
// covers module re-eval. Only assign the cache outside production (the standard
// guard) — in production the module-scope singleton is the source of truth.
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

const prisma =
  globalForPrisma.__prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma

export { prisma }
