import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from './app'

// Vercel serverless entry. Wraps the existing buildApp() (no listen) and hands
// each request to Fastify's HTTP server. app.ready() is awaited ONCE at module
// scope so plugins/routes register on the cold start and are reused warm; the
// shared promise means concurrent first requests all await the same readiness.
//
// This lives in the API workspace (NOT a root-level `api/` dir) on purpose: a
// root `api/` directory is auto-detected by Vercel as a zero-config function,
// which would shadow the prebuilt Build Output API function that scripts/build-vercel.mjs
// emits. esbuild bundles this entry into .vercel/output/functions/api/index.func.
const app = buildApp()
const ready = app.ready()

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready
  app.server.emit('request', req, res)
}
