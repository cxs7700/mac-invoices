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
| `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON), `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` (default `Invoices`) | Google Sheets export | the export endpoint returns `503 *_NOT_CONFIGURED`; the rest of the app is unaffected. Share the target sheet as **Editor** with the key's `client_email`. |
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
2. **Per-landlord setup.** Each landlord connects their sheet in Settings → Sheets (continuous sync uses
   that saved id, **not** the server-wide `GOOGLE_SHEET_ID`). A landlord with no connected sheet is skipped.
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
