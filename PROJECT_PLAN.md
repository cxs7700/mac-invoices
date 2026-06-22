# Invoice Manager — Claude Code Build Plan (Compound Engineering)

> **How to use this file:** Place it at the repo root. It is the single source of truth for
> Claude Code. Work the phases **in order**. At the end of every phase, run the
> **Definition of Done** checks and update the **Decision Log** + **Conventions** sections.
> Do not skip the "feedback loops" in Phase 0 — every later phase depends on them being green.

---

## 0. Compound Engineering Operating Rules (read first, every session)

Compound engineering = each unit of work makes the next unit cheaper. Obey these rules so the
codebase compounds instead of accumulating drift.

1. **Plan before code.** For any phase or feature, first write/extend a short spec in
   `/docs/specs/<feature>.md` (goal, API contract, acceptance criteria). Then implement.
2. **Feedback loops are sacred.** `lint`, `typecheck`, `test`, and `format` must pass before
   you consider any task done. If a loop is red, fixing it is the only task.
3. **Tests are the spec.** Write or update tests that encode the acceptance criteria *before or
   alongside* the implementation. A feature isn't done until its tests pass.
4. **Vertical slices, then replicate.** Build ONE feature fully through every layer
   (DB → API → UI → test) to establish the pattern. Every later feature copies that pattern.
5. **Conventions over cleverness.** When you make a reusable decision (how to add a route, a
   model field, a page), record it in **§11 Conventions**. Future work *must* follow it.
6. **Capture decisions.** Any non-obvious choice goes in **§12 Decision Log** with the
   reasoning, so it is never re-litigated.
7. **Small, verifiable commits.** One logical change per commit. Commit message states what +
   why. Never commit with a red feedback loop.
8. **Ask before guessing on ambiguity** that affects data model, auth, money handling, or
   external API contracts. Proceed autonomously on styling, naming, and internal structure.
9. **Leave the campsite cleaner.** When touching a file, fix obvious adjacent issues and update
   stale docs/comments in the same change.

---

## 1. Product Summary

A web app for a **landlord** to manage **invoices** submitted by a superintendent/contractor.

- Full **CRUD** on invoices.
- View invoice **history, status, and metadata** (filter/sort by status, date, vendor).
- **Google Sheets** integration as an **export destination** (and optional import source).
- This is an **MVP that must be able to scale later** — favor pragmatic, modern, solo-dev-friendly tooling.

**Primary user:** one landlord (single-tenant auth for MVP, designed to extend to many users).

---

## 2. Architecture (target state)

```
React SPA (Vite + TS)  ──HTTPS/REST──>  Fastify API (TS)  ──>  PostgreSQL (source of truth)
   hosted on Vercel                        hosted on Railway        hosted on Railway
                                               │
                                               └──> Google Sheets API (export destination)
```

**Source-of-truth principle:** PostgreSQL is authoritative. Google Sheets is a downstream
export/reporting surface, never the primary store. (See §12 DEC-001.)

**Data flow**
- Create/Update/Delete invoice: SPA → API → PostgreSQL.
- Export: API reads PostgreSQL → writes Google Sheet (manual trigger for MVP).
- (Later) Continuous sync via a background job after each mutation.

---

## 3. Tech Stack (locked for MVP)

| Layer | Choice | Why | Alt (and when) |
|---|---|---|---|
| Frontend build | **Vite + React 18 + TS** | Fast DX, small bundles | Next.js if you later want SSR |
| Routing | **React Router v6** | Standard | TanStack Router for type-safe routes |
| Server state | **TanStack Query v5** | Caching, optimistic updates | SWR (lighter, fewer features) |
| Forms | **React Hook Form + Zod** | Perf + shared validation | Formik (heavier) |
| UI | **Tailwind + shadcn/ui** | Own your components | MUI if you want batteries-included |
| Backend | **Fastify + TS** | Fast, schema-first | Express (more tutorials), tRPC (E2E types) |
| ORM | **Prisma** | Type-safe, great migrations | Drizzle (lighter, SQL-first) |
| Validation | **Zod** (shared pkg) | One schema, both sides | — |
| DB | **PostgreSQL** | ACID, JSON, scalable | SQLite for local-only prototyping |
| Auth | **Lucia (session-based)** | Self-hosted, simple, secure cookies | Clerk/Auth0 if you want managed |
| Sheets | **googleapis (service account)** | Server-to-server | — |
| Frontend host | **Vercel** | Zero-config, previews | Netlify |
| Backend + DB host | **Railway** | API + Postgres in one place | Render; Supabase if BaaS desired |
| CI | **GitHub Actions** | Free, ubiquitous | — |
| Errors (later) | **Sentry** | Free tier | — |

> If any choice is changed during the build, record it in §12 and update this table.

---

## 4. Repository Layout (create exactly this)

```
invoice-manager/
├── CLAUDE.md                 # symlink or copy of the "Conventions + Operating Rules" sections
├── PROJECT_PLAN.md           # this file
├── package.json              # npm workspaces root
├── docker-compose.yml        # local Postgres
├── .env.example
├── .github/workflows/ci.yml
├── docs/
│   ├── specs/                # one md per feature (written before coding)
│   ├── DECISIONS.md          # mirror of §12 Decision Log
│   └── CONVENTIONS.md        # mirror of §11 Conventions
├── packages/
│   └── shared/               # Zod schemas + TS types shared by web & api
│       ├── src/schemas/invoice.ts
│       └── src/index.ts
└── apps/
    ├── api/                  # Fastify backend
    │   ├── prisma/schema.prisma
    │   ├── src/
    │   │   ├── server.ts
    │   │   ├── lib/{prisma.ts,auth.ts,sheets.ts}
    │   │   ├── routes/{auth.ts,invoices.ts,export.ts}
    │   │   ├── middleware/{requireAuth.ts,errorHandler.ts}
    │   │   └── plugins/
    │   └── test/             # Vitest
    └── web/                  # React frontend
        ├── src/
        │   ├── main.tsx
        │   ├── lib/{apiClient.ts,queryClient.ts}
        │   ├── pages/{Login,InvoiceList,InvoiceNew,InvoiceDetail,InvoiceEdit}.tsx
        │   ├── components/{InvoiceTable,InvoiceForm,StatusBadge,FilterBar}.tsx
        │   └── hooks/{useInvoices.ts,useAuth.ts}
        └── test/
```

---

## 5. Data Model (Prisma — implement in Phase 2)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String?
  role         Role     @default(LANDLORD)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  invoices     Invoice[]
  sessions     Session[]
  @@map("users")
}

model Session {
  id        String   @id
  userId    String
  expiresAt DateTime
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("sessions")
}

model Invoice {
  id             String          @id @default(cuid())
  invoiceNumber  String          @unique
  vendorName     String
  vendorEmail    String?
  description    String
  amount         Decimal         @db.Decimal(10, 2)
  currency       String          @default("USD")
  category       InvoiceCategory
  propertyId     String?
  status         InvoiceStatus   @default(PENDING)
  invoiceDate    DateTime
  dueDate        DateTime?
  paidDate       DateTime?
  notes          String?
  attachmentUrl  String?
  sheetsSyncedAt DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  userId         String
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, status])
  @@index([userId, invoiceDate])
  @@map("invoices")
}

enum Role            { LANDLORD ADMIN }
enum InvoiceStatus   { PENDING APPROVED PAID REJECTED CANCELLED }
enum InvoiceCategory { MAINTENANCE REPAIRS UTILITIES SUPPLIES LABOR OTHER }
```

**Money rule:** store as `Decimal(10,2)`; never use JS `number` for currency math in the DB
layer. Validate as positive, 2-decimal in Zod. (See §12 DEC-002.)

---

## 6. Shared Validation (packages/shared — Phase 2)

```ts
import { z } from 'zod';

export const InvoiceStatus   = z.enum(['PENDING','APPROVED','PAID','REJECTED','CANCELLED']);
export const InvoiceCategory = z.enum(['MAINTENANCE','REPAIRS','UTILITIES','SUPPLIES','LABOR','OTHER']);

export const CreateInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(50),
  vendorName:    z.string().min(1).max(100),
  vendorEmail:   z.string().email().optional(),
  description:   z.string().min(1).max(500),
  amount:        z.number().positive().multipleOf(0.01),
  currency:      z.string().length(3).default('USD'),
  category:      InvoiceCategory,
  propertyId:    z.string().optional(),
  invoiceDate:   z.coerce.date(),
  dueDate:       z.coerce.date().optional(),
  notes:         z.string().max(1000).optional(),
  attachmentUrl: z.string().url().optional(),
});

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().extend({
  status:   InvoiceStatus.optional(),
  paidDate: z.coerce.date().optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;
```

The **same** schemas validate API request bodies (Fastify) and frontend forms (RHF resolver).

---

## 7. API Contract (build in Phase 2–3)

All routes are prefixed `/api`. All invoice routes require auth and are scoped to the session
user (`WHERE userId = session.user.id` — never trust client-supplied userId).

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | `{email,password}` | session cookie + user | rate-limited |
| POST | `/auth/logout` | — | 204 | clears session |
| GET  | `/auth/me` | — | user or 401 | |
| GET  | `/invoices` | query: `status,from,to,vendor,sort,order,limit,offset` | paginated list | filter+sort (Phase 4) |
| GET  | `/invoices/stats` | — | `{ counts: by-status, total }` | all-time, ownership-scoped (Phase 4) |
| POST | `/invoices` | `CreateInvoiceSchema` | created invoice | |
| GET  | `/invoices/:id` | — | invoice or 404 | ownership-checked |
| PATCH| `/invoices/:id` | `UpdateInvoiceSchema` | updated invoice | |
| DELETE | `/invoices/:id` | — | 204 | |
| POST | `/invoices/export` | `{spreadsheetId?}` | `{exported: n}` | Sheets export |

**Error shape (consistent everywhere):** `{ error: { code: string, message: string, details?: unknown } }`.

---

## 8. Google Sheets Integration (Phase 5)

- Use a **service account**; share the target sheet with the service account email.
- Credentials in `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON string) — never commit.
- MVP = **manual export** endpoint that reads Postgres and `values.append`s rows.
- Columns: `id, invoiceNumber, vendorName, amount, status, invoiceDate, dueDate, category, description`.
- On success, set `sheetsSyncedAt` on exported rows.
- Handle quota/429 with retry + backoff; batch writes; never block the request thread on a
  huge export — for >500 rows, chunk the writes.

```ts
import { google } from 'googleapis';
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
export const sheets = google.sheets({ version: 'v4', auth });
```

---

## 9. Auth (Phase 3)

- **Lucia** session-based auth, Prisma adapter, `Session` table (already in schema).
- Passwords hashed with **argon2**.
- Secure, httpOnly, sameSite cookies; `secure` in production.
- `requireAuth` middleware injects `req.user`; all invoice queries filter by `req.user.id`.
- MVP seeds **one** landlord account (no public registration). Registration can be added later.

---

## 10. Phased Roadmap with Definitions of Done

> Each phase: (a) write/extend spec, (b) implement, (c) make all feedback loops green,
> (d) update Conventions + Decision Log, (e) commit.

### Phase 0 — Foundation & Feedback Loops  ⛳ ✅ *complete (2026-06-20)*
- [x] Init npm workspaces (`apps/web`, `apps/api`, `packages/shared`).
- [x] TypeScript **strict** everywhere; shared code imported as `@mac-invoices/shared` (see DEC-008).
- [x] ESLint + Prettier + editorconfig; root scripts: `lint`, `format`, `typecheck`, `test`.
- [x] `docker-compose.yml` with Postgres; `.env.example` filled.
- [x] Vitest configured in `api` and `web` (one trivial passing test each).
- [x] GitHub Actions `ci.yml`: install → lint → typecheck → test on every PR.
- **DoD:** ✅ `npm run lint && npm run typecheck && npm run test` all green locally; CI workflow added. Execution plan: `docs/plans/2026-06-20-001-feat-invoice-manager-monorepo-foundation-plan.md`.

### Phase 1 — App Skeletons
- [ ] Fastify boots, `/api/health` returns 200, CORS + cookie plugins, error handler.
- [ ] Vite React app boots, router with placeholder pages, Tailwind + shadcn initialized.
- [ ] `apiClient.ts` (Axios, credentials: include) + TanStack Query provider.
- **DoD:** Both apps run with `npm run dev`; web can hit `/api/health`.

### Phase 2 — Data Layer + First Vertical Slice (CREATE invoice)  ✅ *complete (2026-06-21)*
- [x] Prisma schema (§5), migration, seed (landlord + 158 remapped 2025 invoices). Also added `InvoiceImage` + `CONTRACTOR` (see DEC-016).
- [x] `packages/shared` Zod schemas (§6) consumed by both apps.
- [x] `POST /api/invoices` with Zod validation + server-set owner (DEC-012) + integration tests.
- [x] Web: `InvoiceForm` + `InvoiceNew` page wired with RHF + Zod resolver + mutation.
- **DoD:** ✅ Create works end-to-end; API create test passes; pattern recorded in §11 / `docs/CONVENTIONS.md` (CONV-011/012). Execution plan: `docs/plans/2026-06-21-001-feat-data-layer-create-slice-plan.md`.
- **New (deferred):** per-invoice image upload pipeline + viewing UI — a future phase (model landed this phase; see DEC-016, §7 backlog).

### Phase 3 — Auth + Remaining CRUD (replicate the pattern)
- [ ] Lucia + argon2 + `requireAuth`; login/logout/me; seed login works.
- [ ] `GET /invoices` (filter: status/date/vendor, sort, pagination), `GET/:id`, `PATCH/:id`, `DELETE/:id` — all tested.
- [ ] Web: Login page + auth guard; `InvoiceList` (table + `FilterBar` + `StatusBadge`),
  `InvoiceDetail`, `InvoiceEdit`; optimistic status updates.
- **DoD:** All CRUD works through the UI behind auth; integration tests cover each route;
  unauthorized access returns 401.

### Phase 4 — History, Status & Metadata UX  ✅ *complete (2026-06-22)*
- [x] Sortable/filterable list; empty/loading/error states; status transitions; due-date display.
- [x] Basic dashboard counts (totals by status) — read-only.
- **DoD:** Landlord can find any invoice by status/date/vendor in ≤2 interactions.

### Phase 5 — Google Sheets Export  ✅ *complete (2026-06-22)*
- [x] Service account wired (§8); `POST /invoices/export`; `sheetsSyncedAt` set on success.
- [x] "Export to Sheets" button; retry/backoff on 429. (Operator setup: `docs/SHEETS_EXPORT.md`.)
- **DoD:** Clicking export writes current invoices to the sheet; test mocks the Sheets client.

### Phase 6 — Harden & Deploy
- [ ] Security headers, rate limiting on auth, request logging, input size limits.
- [ ] Deploy API + Postgres to Railway; web to Vercel; env wired; SSL verified.
- [ ] README: setup, env reference, run/deploy steps.
- **DoD:** Public URL works end-to-end; CI green; fresh clone runs with documented steps only.

### Phase 7 — Post-MVP (backlog, not required)
File attachments (R2/S3 presigned) — including the **per-invoice image** upload + viewing feature
whose data model (`InvoiceImage`, `ImageType`) landed in Phase 2 (DEC-016); continuous Sheets sync
via job queue, email reminders (Resend), analytics charts, multi-property model, contractor
submission portal, Sentry.

---

## 11. Conventions (LIVING — append as you establish patterns)

> Seed entries below. Add to this list whenever you make a reusable decision. Every new feature
> must conform to existing entries.

- **CONV-001 Adding an API route:** create `routes/<name>.ts` exporting a Fastify plugin;
  validate body with a shared Zod schema; scope all DB reads/writes to `req.user.id`; return
  the standard error shape; add a Vitest covering happy path + 1 failure + auth.
- **CONV-002 Adding a model field:** edit `schema.prisma` → create migration → extend the
  matching Zod schema in `packages/shared` → update form + table columns → update seed.
- **CONV-003 Adding a page:** create `pages/<Name>.tsx`, register route, fetch via a
  `hooks/use*.ts` TanStack Query hook (never call apiClient directly in components).
- **CONV-004 Money:** `Decimal(10,2)` in DB, `z.number().positive().multipleOf(0.01)` in Zod,
  format with `Intl.NumberFormat` in UI. No float math on currency.
- **CONV-005 Errors:** throw typed errors caught by the central `errorHandler`; never leak
  stack traces or raw Prisma errors to the client.

---

## 12. Decision Log (LIVING — append, never delete)

- **DEC-001 PostgreSQL is source of truth; Sheets is export-only.** Avoids Sheets rate limits,
  lack of transactions, and data-loss risk. Revisit only if requirements drop the DB.
- **DEC-002 Currency stored as `Decimal(10,2)`.** Prevents floating-point money bugs.
- **DEC-003 Session auth (Lucia) over JWT.** Simpler revocation, safer for a cookie-based web
  app; single-user MVP doesn't need stateless tokens.
- **DEC-004 Fastify over Express.** Schema-first + performance; acceptable smaller ecosystem.
- **DEC-005..011 (2026-06-20, Phase 0).** Keep installed versions (React 19 / RR7 / Prisma 7) over §3; migrate to the npm-workspaces monorepo as Phase 0 (behavior/schema preserving); adopt the §5 data model in Phase 2 not Phase 0; import shared code as `@mac-invoices/shared`; defer the auth library (Lucia is being sunset) to Phase 3; use Vitest 3 (rolldown-vite@7 needs it); single root `.env` loaded via `loadEnv.ts`; gitignore the generated Prisma client. Full text in `docs/DECISIONS.md`.
- **DEC-012..016 (2026-06-21, Phase 2).** Seeded-landlord + server-default `userId` until auth; §5 migration by dev reset + reseed (invoiceNumber user-supplied); CREATE-only validation this phase (Update schema defined); Zod-in-handler via `parseBody` (+ `@hookform/resolvers@5` on web); per-invoice images modeled now (`InvoiceImage`/`ImageType`, `CONTRACTOR` role) with the upload/view feature deferred. Full text in `docs/DECISIONS.md`.
- *(append new decisions here with date + reasoning)*

---

## 13. Environment Variables (`.env.example`)

```
# API
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/invoices
NODE_ENV=development
SESSION_SECRET=change-me
# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account", ...}   # JSON string, do NOT commit
GOOGLE_SHEET_ID=
# Web
VITE_API_URL=http://localhost:3000
```

---

## 14. First Command for Claude Code

> Start here:
>
> "Read `PROJECT_PLAN.md`. Execute **Phase 0** only. Create the workspace layout from §4, wire
> up lint/typecheck/test/format and GitHub Actions CI, stand up local Postgres via
> docker-compose, and add one trivial passing test in both `apps/api` and `apps/web`. Stop when
> the Phase 0 Definition of Done is green, then summarize what you did and update §11/§12 if you
> made any reusable decisions. Do not begin Phase 1."
