import '../../src/lib/loadEnv'

// Fail fast unless the test DB is local. The root .env's DATABASE_URL points at
// the hosted PRODUCTION Postgres; on 2026-08-03 a test run against it stamped
// the real landlord's invoices as sheets-synced (mocked Google client, real DB)
// and littered invoice_events with fixture rows. Integration tests must run
// against the docker-compose Postgres (README/CLAUDE.md: `docker compose up -d`,
// then DATABASE_URL=postgresql://postgres:postgres@localhost:5433/invoices).
// Escape hatch (deliberate remote runs only): ALLOW_REMOTE_TEST_DB=1.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const url = process.env.DATABASE_URL ?? ''
const host = hostOf(url)

if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  throw new Error(
    `Refusing to run tests against a non-local database (DATABASE_URL host: ${JSON.stringify(host)}). ` +
      'The root .env points at the hosted PRODUCTION DB. Point DATABASE_URL at the local docker ' +
      'Postgres (e.g. postgresql://postgres:postgres@localhost:5433/invoices) or, if you truly ' +
      'mean to hit a remote DB, set ALLOW_REMOTE_TEST_DB=1.',
  )
}
