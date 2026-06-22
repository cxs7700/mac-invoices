import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from '../apps/api/src/app'

// Vercel serverless entry. Wraps the existing buildApp() (no listen) and hands
// each request to Fastify's HTTP server. app.ready() is awaited ONCE at module
// scope so plugins/routes register on the cold start and are reused warm; the
// shared promise means concurrent first requests all await the same readiness.
const app = buildApp()
const ready = app.ready()

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready
  app.server.emit('request', req, res)
}
