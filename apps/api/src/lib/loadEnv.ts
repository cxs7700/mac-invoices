import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The repo uses a single root-level .env (see PROJECT_PLAN.md §13). npm workspace
// scripts run with cwd set to apps/api, so `dotenv/config` (which reads ./.env from
// cwd) would miss it. Resolve the root .env relative to this file instead, so env
// loading works no matter where the process is launched from.
const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, '../../../../.env') })
