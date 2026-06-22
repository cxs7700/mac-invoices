// Bundle the Vercel serverless API entry (api/index.ts) into a single ESM file
// that a stock Node runtime can run. esbuild resolves the `.ts`-extension imports,
// the `@/*` alias (via apps/api/tsconfig.json), and the @mac-invoices/shared
// workspace source. Native + Prisma runtime deps are EXTERNAL — their .node /
// .wasm files can't be inlined, so they're resolved from node_modules at runtime
// (Vercel installs the linux build of @node-rs/argon2 on its own builder).
import { build } from 'esbuild'

await build({
  entryPoints: ['api/index.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: 'apps/api/tsconfig.json',
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg', '@node-rs/argon2', '@node-rs/argon2-*'],
  // Some externalized CJS deps expect a CommonJS `require` in scope; provide one
  // for the ESM output.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
})

console.log('Bundled api/index.ts -> api/index.js')
