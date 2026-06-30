// Build the Vercel deployment via the Build Output API (.vercel/output).
//
// Why not zero-config `api/` functions? The serverless entry (api/index.ts) pulls
// in the whole Fastify app, which uses workspace TS source (@mac-invoices/shared)
// and a mix of extensionless + `.ts`-extension imports. Vercel's native @vercel/node
// builder does NOT bundle those (it leaves `../apps/api/src/app` as an unresolved
// runtime import → ERR_MODULE_NOT_FOUND). So we esbuild the entry into one
// self-contained ESM file and emit a prebuilt function via the Build Output API,
// which skips zero-config detection entirely (works for both CLI and git-push deploys).
//
// Native/engine deps that can't be inlined (Prisma client, pg, @node-rs/argon2) stay
// EXTERNAL and are traced into the function with @vercel/nft (handles transitive deps
// and the platform-specific argon2 .node binary on the Linux builder).
import { build } from 'esbuild'
import { nodeFileTrace } from '@vercel/nft'
import { cp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const root = process.cwd()
const outDir = join(root, '.vercel', 'output')
const funcDir = join(outDir, 'functions', 'api', 'index.func')

await rm(outDir, { recursive: true, force: true })
await mkdir(funcDir, { recursive: true })

// 1. Bundle the serverless entry into a single self-contained ESM file.
const EXTERNAL = ['@prisma/client', '@prisma/adapter-pg', 'pg', '@node-rs/argon2', '@node-rs/argon2-*']
const bundlePath = join(funcDir, 'index.mjs')
await build({
  entryPoints: ['apps/api/src/vercelEntry.ts'],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: 'apps/api/tsconfig.json',
  external: EXTERNAL,
  loader: { '.wasm': 'copy' },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
})

// 2. Trace the external deps the bundle still requires at runtime and copy them
//    (with transitive deps + native binaries) into the function's node_modules tree.
const { fileList } = await nodeFileTrace([bundlePath], { base: root })
let copied = 0
for (const rel of fileList) {
  if (!rel.startsWith('node_modules/')) continue // first-party code is already bundled
  const dest = join(funcDir, rel)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(join(root, rel), dest).catch(() => {})
  copied++
}
console.log(`Traced + copied ${copied} dependency files into the function.`)

// 3. Ship the Prisma generated client dir too, so any runtime path-based lookup of
//    the query-compiler wasm/engine (relative to /var/task) resolves.
await cp(
  join(root, 'apps/api/prisma/generated'),
  join(funcDir, 'apps/api/prisma/generated'),
  { recursive: true },
)

// 4. Function runtime config (Node launcher invokes the default export (req, res)).
await writeFile(
  join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 60,
    },
    null,
    2,
  ),
)

// 5. Static assets = the built SPA.
await cp(join(root, 'apps/web/dist'), join(outDir, 'static'), { recursive: true })

// 6. Top-level routing: /api/* -> the function; everything else falls through to the
//    static filesystem, with an SPA fallback to index.html for client-side routes.
await writeFile(
  join(outDir, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/api/(.*)', dest: '/api/index' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)

console.log('Build Output API tree written to .vercel/output')
