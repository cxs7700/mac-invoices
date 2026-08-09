# Deploying Mac Invoices to Vercel

The app deploys as **one Vercel project**: the Vite SPA is the static output and the
Fastify API runs as a serverless function at `/api/*` on the **same origin**. Same-origin
is required — the session cookie is `httpOnly` + `sameSite=strict`, so a split web/API
origin silently 401s every authenticated request.

Plan of record: `docs/plans/2026-06-22-003-feat-vercel-deploy-plan.md`.

The repo is already deploy-ready (`vercel.json` + `scripts/build-vercel.mjs`, which esbuild-bundles
`apps/api/src/vercelEntry.ts` and emits a Vercel Build Output API tree — the function, the static
SPA, and routing — into `.vercel/output`; the same-origin client; `engines.node`). The steps below
are the **manual operator steps** — they need your Vercel account, a database, and secrets.

---

## 1. Choose a production database

| Option | When | Notes |
|---|---|---|
| **Reuse the current Prisma Postgres** (`db.prisma.io`) | Fastest — demo/staging | Already serverless-pooled, migrated, and seeded. **Single connection string** (no separate `DIRECT_URL`). **Landlord password:** originally `changeme-dev`, but **rotated to a strong value on 2026-06-30** (see §4), so this DB is no longer a known-credential login. A *fresh* DB still needs the step-4 rotation before going public. |
| **New managed Postgres** (Neon / Supabase / Vercel Postgres) | Clean production | Provision it, then use its **pooled** endpoint as `DATABASE_URL` (app) and its **direct** endpoint as `DIRECT_URL` (migrations). Run migrate + seed (steps 3–4). |

Serverless needs a **pooled** app connection (the function reuses one `PrismaClient`, but
the fleet still multiplies connections). Prisma Postgres is pooled already; for a managed
Postgres use the `-pooler` / transaction-pooling endpoint for `DATABASE_URL`.

## 2. Connect the repo to Vercel

1. `vercel login` (browser auth), then `vercel link` to link this directory to the project
   (writes `.vercel/project.json`). The dashboard's **New Project → import repo** flow also works.
2. **Root Directory = repo root** (not `apps/web` — `scripts/build-vercel.mjs` bundles the whole
   workspace and emits `.vercel/output`). Framework preset **Other**; don't override the
   build/output settings — `vercel.json` owns them.

**Deploys are manual:** `vercel --prod` builds and ships the **current local working tree** to
Production (`vercel` alone makes a Preview). Pushing to `main` does **not** auto-deploy — the
deployed code is whatever is checked out when you run the command, not `origin/main`.

## 3. Run migrations (before the code that needs them deploys)

Migrations must **not** run in the Vercel build (concurrent builds race the lock). Run them
as a one-off against the **direct** connection, **before** you `vercel --prod` code that depends
on a new migration (or keep the migration backward-compatible with the currently-deployed code):

```bash
# managed Postgres: point at the DIRECT (non-pooled) URL
DATABASE_URL="<DIRECT_URL>" npm run db:deploy
# Prisma Postgres: its single URL
DATABASE_URL="<prisma-postgres-url>" npm run db:deploy
```

(The current schema is already migrated on the Prisma Postgres DB — only needed for a fresh DB or new migrations.)

> **Destructive migrations (`DROP COLUMN` / `DROP TABLE`) invert this order.** The
> migrate-first rule above is correct only for *additive* changes (the old code
> tolerates a new column). A drop is **not** backward-compatible: the
> currently-deployed Prisma client still `SELECT`s the column by name, so dropping
> it *before* the new code is live throws `column "…" does not exist` on every read.
> For a drop: **deploy the new code first, confirm it's serving, then run `db:deploy`.**
> Re-verify the column is empty immediately before dropping, e.g. for
> `20260626000000_drop_invoice_attachment_url`:
> ```sql
> SELECT COUNT(*) FROM "invoices" WHERE "attachmentUrl" IS NOT NULL;  -- must be 0
> ```

> **`20260807120000_per_tenant_invoice_numbering` follows the normal order: migrate FIRST, then deploy.**
> It only swaps a unique index (global `invoiceNumber` → composite `(userId, invoiceNumber)`) and rewrites
> no rows. Between migrating and deploying, the still-running old code's global number scan yields a value
> that satisfies the new constraint, and same-tenant duplicates still conflict — so the window is safe.
> Contrast `drop_invoice_description`, which is destructive and inverts this rule.
>
> **Before applying, confirm the index name against the hosted DB** — the migration drops it by name
> (`DROP INDEX "invoices_invoiceNumber_key"`), and nobody has verified the hosted database uses that
> exact name (only the local dev DB has been checked). It almost certainly matches — the name traces to
> the original `20260621053731_phase2_v5_data_model` migration and Prisma applies migrations
> deterministically — but confirm before touching production:
> ```sql
> SELECT indexname FROM pg_indexes WHERE tablename = 'invoices';
> ```
> Look for `invoices_invoiceNumber_key` in the result. If it's missing or named differently, **stop and
> investigate before running `db:deploy`** — though a mismatch would fail the migration atomically inside
> its transaction, not corrupt anything.
>
> **Also check it's an index, not a constraint-backed index.** `pg_indexes` lists
> `invoices_invoiceNumber_key` identically whether it came from `CREATE UNIQUE INDEX` (our migration
> history) or from `ADD CONSTRAINT ... UNIQUE` (a hand-fix, or a `db push` against a differently-built
> database). In the second case `DROP INDEX` fails with `cannot drop index ... because constraint ...
> requires it` — after the query above has already told you everything looks fine. Rule it out:
> ```sql
> SELECT conname, contype FROM pg_constraint WHERE conrelid = 'invoices'::regclass;
> -- must NOT contain a contype='u' (unique) row for invoiceNumber
> ```
>
> **If `db:deploy` has already failed once, clear the ledger before retrying.** Prisma writes a
> **failed** row into `_prisma_migrations` on a failed apply; every subsequent `prisma migrate deploy`
> — including deploys of unrelated future migrations — then aborts with `migration ... failed to apply
> cleanly` until that row is cleared. The database itself is fine (the failed transaction rolled back
> entirely); it's only the migrations ledger that's stuck:
> ```bash
> DATABASE_URL="<hosted-url>" npx prisma migrate resolve --rolled-back 20260807120000_per_tenant_invoice_numbering
> ```
> Then investigate the mismatch and re-run `db:deploy` once it's resolved.
>
> **Lock hazard.** `DROP INDEX` takes an `ACCESS EXCLUSIVE` lock on `invoices` and holds it for the
> transaction. The work itself is milliseconds on a table this size, so duration isn't the risk —
> *acquisition* is. If any session holds a conflicting lock on `invoices` (including an idle-in-transaction
> serverless function), the DDL queues, and while it queues every new query against `invoices` queues
> behind it — turning a millisecond migration into an outage lasting as long as the blocker. For a
> personal-scale app with one active landlord the practical risk is low — but "low traffic" is exactly
> when this check gets skipped and an idle connection surprises you. Before running `db:deploy`, either
> set a short lock timeout so the migration fails fast instead of stalling the table:
> ```sql
> SET lock_timeout = '3s';
> ```
> and/or check for long-lived transactions first:
> ```sql
> SELECT pid, state, now()-xact_start AS age, query FROM pg_stat_activity
> WHERE xact_start IS NOT NULL ORDER BY xact_start LIMIT 10;
> ```
>
> **Rollback posture: no down migration, and none is needed.** The composite index permits a strict
> superset of what the old code writes, so rolling the *code* back with this migration still applied
> works fine — the old global-scan `nextInvoiceNumber` still finds unique numbers under the new
> constraint. Only a genuine schema rollback (re-adding the global unique index) would need reverse SQL,
> and that would correctly fail if a second tenant had by then reused a number that collides globally —
> which is the intended behavior, not a bug to work around.

## 4. Seed the landlord (one-off, strong password)

The seed upserts the landlord login and **fails closed** if `LANDLORD_PASSWORD` is unset, and
refuses the `changeme-dev` default when `NODE_ENV=production`. Run it once against the target
DB with a strong password (this also rotates the password if you reused the dev DB):

> **Live deploy (2026-06-30):** the production Prisma Postgres (`db.prisma.io`) landlord login —
> `landlord@example.com` — has already been rotated off `changeme-dev` to a strong random password.
> The value is **not** stored in this repo (it lives only as an argon2 hash in the DB) — keep it in
> a password manager. Re-run the command below to set your own value; it upserts the landlord and
> leaves invoices untouched. Requires Node 24 (`.nvmrc`).

```bash
DATABASE_URL="<target-db-url>" LANDLORD_PASSWORD="<strong-secret>" \
  LANDLORD_USER_ID=landlord_seed_user LANDLORD_EMAIL=you@example.com \
  npm run db:seed
```

> **`LANDLORD_EMAIL` must be lowercase.** Email is normalized to trimmed lowercase at the
> schema boundary for both login and signup, so an address seeded with uppercase cannot be
> logged into. If an existing deploy has uppercase in `LANDLORD_EMAIL`, lowercase it and
> re-run the seed when shipping this change.

### Contractor → Vendor rename (2026-08-07)

Two migrations, applied in order, ship the `Contractor` → `Vendor` rename (`docs/DECISIONS.md`
DEC-032). **The API and web deploys must go out together** — the renamed API routes
(`/api/vendors`) and the renamed columns land in the same release; running old web against the
new API (or vice versa) breaks the vendor picker and submission flow.

**Migration 1 — `20260807190000_rename_contractor_to_vendor`.** Data-preserving: table/column
`RENAME`s (never `DROP`+`CREATE`), splits `contact` into nullable `phone`/`email`, and rewrites
`invoice_events.actorId` values that carried a literal `'contractor:'` prefix to `'vendor:'`.

**Required pre-deploy audit — `contact` → `phone`/`email` routing.** The backfill predicate was
only ever proved against a scratch table of boundary cases, never against real data — both local
databases have zero `contractors` rows, so production is the first place it meets real rows.
Before migrating, run this read-only query against production and eyeball the routing:

```sql
SELECT name, contact,
       CASE WHEN contact LIKE '%_@_%.__%' THEN 'email' ELSE 'phone' END AS routes_to
FROM contractors ORDER BY name;
```

No row can be lost — the predicate and its complement are exhaustive, and the value is copied
verbatim either way. What the audit catches is *misfiling*: an address without a dot in the
domain (`bob@localhost`) routes to `phone`, and a phone number written as `555@home.com` would
route to `email`. Anything misfiled is corrected with a one-line `UPDATE` after the migration —
it is not a reason to block the deploy.

**Migration 2 — `20260807200000_vendor_unique_name_per_landlord`.** Adds a UNIQUE index on
`(landlordId, lower(name))` plus a P2002 catch-and-reread in `resolveVendorId`, closing a race
where two concurrent invoice saves could each auto-create a duplicate vendor.

**Required pre-deploy check — duplicate vendor names.** Unlike migration 1, this one **fails
outright** if production already holds two vendors with the same name (ignoring case) for one
landlord. Check first:

```sql
SELECT "landlordId", lower(name) AS name, count(*)
FROM contractors
GROUP BY "landlordId", lower(name)
HAVING count(*) > 1;
```

Any row returned must be merged or renamed by hand **before** migrating — decide which record
survives, repoint its invoices, and delete the loser. An empty result means the index will
create cleanly.

### Unique Sheets target (2026-08-09)

`20260809120000_unique_sheet_target` adds `UNIQUE (users."sheetSpreadsheetId")`.

**Pre-check — must return 0 rows, or the migration fails halfway:**

```sql
SELECT "sheetSpreadsheetId", count(*)
  FROM users
 WHERE "sheetSpreadsheetId" IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;
```

If it returns rows, two accounts are already sharing a spreadsheet and one of
them has been having its ledger overwritten. Resolve by hand — decide which
account keeps the sheet and null the other's target — before migrating. Do not
work around the constraint.

The index builds instantly at current scale (a single-digit number of
connected users), so a plain `CREATE UNIQUE INDEX` inside the migration
transaction is correct; `CONCURRENTLY` is not needed and would prevent the
migration from being transactional.

**Rollback:** `DROP INDEX "users_sheetSpreadsheetId_key";` then
`prisma migrate resolve --rolled-back 20260809120000_unique_sheet_target`.
Dropping it reopens the cross-tenant wipe, so treat rollback as a last resort.

## 5. Set environment variables in Vercel

Project → **Settings → Environment Variables**. Set for **Production** (and **Preview** if
previews hit a DB). Mark secrets **Sensitive**.

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | pooled connection string | the app's runtime DB |
| `DIRECT_URL` | direct connection string | **managed-Postgres only**; for `db:deploy`. Not needed for Prisma Postgres |
| `LANDLORD_PASSWORD` | the strong secret from step 4 | sensitive |
| `LANDLORD_USER_ID` | `landlord_seed_user` | must match what was seeded |
| `LANDLORD_EMAIL` | the seeded email | |
| `COOKIE_SECURE` | `true` | sends the session cookie only over HTTPS — **set for Preview too** |
| `NODE_ENV` | *(do **not** set)* | Vercel sets `production` in the function runtime automatically; adding it as a project env var makes the build's `npm install` skip devDependencies → the web build fails with exit 2 |
| `VITE_API_URL` | *(empty / unset)* | same-origin; baked into the SPA at build |

Notes:
- Env vars are **baked at build** — changing one needs a redeploy.
- Only `VITE_*` vars reach the browser bundle; the sole one here is `VITE_API_URL` (safe). No
  server secret is `VITE_*`, so nothing sensitive ships to the client.
- Each **Preview** deploy (`vercel` without `--prod`) is its own HTTPS `*.vercel.app` origin; the
  strict cookie works per-origin, so login is exercised per preview (hence `COOKIE_SECURE=true` on Preview).
- `WEB_ORIGIN` is not required for CORS on this same-origin deploy (the SPA and API share one
  origin, so the browser never runs CORS on `/api` calls; the strict cookie depends on the real
  request origins, not this var). **It IS required for correct outbound links**, though: the Sheets
  export `invoiceLink` column, digest-email links, and contractor magic links all build URLs from it
  and fall back to `http://localhost:5173` when unset. Set it to the production origin
  (`https://mac-invoices.vercel.app`).
- `SESSION_SECRET` is **not** used — sessions are opaque `@oslojs` tokens (a SHA-256 lookup id),
  so there is no signing secret to configure. It is intentionally absent from `.env.example`.

### Optional — set only to enable a feature

Each of these has a safe "off" behavior; add them when you turn the feature on. None block a first deploy.

| Variable(s) | Enables | Behavior if unset |
|---|---|---|
| `SIGNUP_INVITE_CODE` | invite-gated signup at `/login` → Sign up | **unset = signup is disabled** (`503 SIGNUP_DISABLED`), which is the default. One shared code for everyone; rotating it invalidates it for all invitees. Treat as sensitive. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON), `GOOGLE_SHEET_TAB` (default `Invoices`) | Google Sheets export | the export endpoint returns `503 *_NOT_CONFIGURED`; the rest of the app is unaffected. The export target itself is per-user, set in Settings → Sheets — not an env var. Share the target sheet as **Editor** with the key's `client_email`. |
| `BLOB_READ_WRITE_TOKEN` | invoice photo capture (upload + view) | auto-injected once a **Vercel Blob store** is linked to the project; photo upload fails until then. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` | the landlord notification digest | see [Contractor notifications](#contractor-notifications-landlord-digest) below — the in-app feed works regardless; email no-ops without `RESEND_API_KEY`. |

Tuning knobs (`EXPORT_RATE_LIMIT_MAX`, `EXPORT_CHUNK_SIZE`, `SHEETS_RETRY_BASE_MS`, `PASSWORD_RATE_LIMIT_MAX`, `SUBMISSION_RATE_LIMIT_MAX`, `SUBMISSION_READ_RATE_LIMIT_MAX`, `SUBMISSION_UPLOAD_RATE_LIMIT_MAX`, `EMAIL_RETRY_BASE_MS`) have safe defaults — leave unset.

## 6. Deploy + smoke test

Run `vercel --prod` (or promote a verified Preview). Then run the smoke checklist against the URL:

- `GET /api/health` → `200 {"status":"ok"}` over HTTPS.
- **Login** as the landlord → the `Set-Cookie` carries `Secure`, `HttpOnly`, `SameSite=Strict`;
  `GET /api/auth/me` returns the user with the cookie.
- Unauthenticated `GET /api/invoices` → `401`.
- CRUD + filters (`status`/`from`/`to`/`vendor`/`sort`) + `GET /api/invoices/stats` work and are
  ownership-scoped.
- SPA deep link (`/invoices/:id`) loads via the index.html rewrite; FilterBar URL state survives
  a refresh.
- Function logs are clean — no `Failed to load native binding` (argon2), no
  `Prisma did not initialize` / missing `query_compiler` (WASM), no per-request connection growth.

## 7. Rollback

Vercel deployments are immutable. To roll back, **promote the previous production deployment**
(dashboard → Deployments → ⋯ → *Promote to Production*, or `vercel rollback`). A bad **migration**
is the only non-instant case — keep migrations backward-compatible across the deploy window, and
keep `DIRECT_URL` access to revert by hand if needed.

---

## Contractor notifications (landlord digest)

The landlord digest email is sent by a scheduled flush hitting a secret-gated
endpoint. To enable it in production:

1. **Vercel env vars** (Project → Settings → Environment Variables):
   - `RESEND_API_KEY` — a Resend API key (free tier). Unset → notifications no-op (the in-app feed still works).
   - `EMAIL_FROM` — the sender. `onboarding@resend.dev` works with no DNS for testing; a verified-domain address (SPF + 2 DKIM CNAMEs in Resend) for real mail.
   - `CRON_SECRET` — a random string (`openssl rand -base64 32`). The flush endpoint rejects any call without `Authorization: Bearer <CRON_SECRET>`, and fails closed if unset.
2. **GitHub Actions scheduler** (`.github/workflows/notify-digest.yml`, runs every ~15 min) — set in repo Settings → Secrets and variables → Actions:
   - Variable `APP_URL` = the production base URL.
   - Secret `CRON_SECRET` = the same value as the Vercel env var.
   - (Vercel's free Hobby cron is daily-only, which is why the schedule lives in GitHub Actions; cron-job.org is a drop-in alternative.)
3. **Enable the workflow.** The schedule is disabled before the first deploy (it would fail every ~15 min against an un-deployed app). Turn it on once the app is live: `gh workflow enable "Contractor notification digest"` (or the Actions tab). Disable again with `gh workflow disable "…"`.

## Continuous Sheets sync

The connected Google Sheet is a continuous full mirror of each landlord's invoices, driven by the same
cron pattern as the digest. To enable it in production:

1. **Sheets env vars** — `GOOGLE_SERVICE_ACCOUNT_KEY` (+ optional `GOOGLE_SHEET_TAB`); see `docs/SHEETS_EXPORT.md`.
   Reuses the **same `CRON_SECRET`** as the digest — nothing new to add if that's already set.
2. **Per-landlord setup.** Each landlord connects their sheet in Settings → Sheets — that saved id is the
   only export target (no server-wide fallback exists). A landlord with no connected sheet is skipped.
3. **GitHub Actions scheduler** (`.github/workflows/sync-sheets.yml`, runs every ~15 min) — uses the same
   `APP_URL` variable and `CRON_SECRET` secret as the digest workflow.
4. **Enable the workflow** once the app is live: `gh workflow enable "Continuous Sheets sync"` (disabled
   before the first deploy, same as the digest). Endpoint: `POST /api/cron/sync-sheets`, `CRON_SECRET`-gated.

## Known limitations (tracked)

- **Login rate-limit** uses an in-process store → per-warm-instance on serverless, not fleet-wide.
  A shared store (Redis/Upstash) is the real fix; deferred. The argon2 verify cost still bounds throughput.
- **Reusing the dev Prisma DB** for production data is fine for a demo URL once the password is
  rotated; migrating to a dedicated production Postgres is the clean follow-up.
- A **CI gate** that runs `db:deploy` before production promotion is a recommended follow-up
  (today migrations are the manual step in §3).
