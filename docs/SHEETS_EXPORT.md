# Google Sheets Sync — operator setup

The landlord's connected Google Sheet is a **continuous full mirror** of their exportable invoices
(`PENDING`/`APPROVED`/`PAID`): new invoices appear, edits propagate, and deleted invoices disappear —
**automatically**, on a cron every ~15 min (or immediately via the "Sync now" button). Sync is via a
**service account**; Postgres stays the source of truth (one-way). See `docs/DECISIONS.md` DEC-021
(manual export) and DEC-024 (continuous full mirror) for the design.

> **The sheet is owned by the app.** Each mirror **clears the tab and rewrites it** (header + one row
> per invoice). Do not keep your own data or manual annotations on the mirror tab — they will be
> overwritten. Use a separate tab/workbook for anything hand-maintained.

## One-time setup

1. **Create a service account** in Google Cloud (any project): IAM & Admin → Service Accounts → Create.
   Then create a **JSON key** for it and download the file.
2. **Enable the Google Sheets API** for that project (APIs & Services → Library → Google Sheets API).
3. **Create the target spreadsheet** and note its ID (the long token in the URL
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
4. **Share the sheet as Editor** with the service account's `client_email` (from the key JSON). This is
   the #1 first-use failure — without it every sync returns a permission error.
5. **Connect the sheet in the app** — Settings → Sheets → paste the spreadsheet id and Save (then "Test
   connection"). **Both the manual "Sync now" button and continuous sync require this per-landlord
   setting**; there is no server-wide fallback (a shared-sheet clear+rewrite would let multiple landlords
   clobber each other). The header row is written by the mirror — no need to add one by hand.

## Environment variables

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the **entire JSON key** as a string (Sensitive — never commit). Note Vercel/env stores often need the `private_key`'s `\n` preserved. |
| `GOOGLE_SHEET_TAB` | optional; the tab to mirror (default `Invoices`) |
| `CRON_SECRET` | gates the `POST /api/cron/sync-sheets` flush (shared with the digest cron). See `docs/DEPLOYMENT.md`. |

Locally: set these in the repo-root `.env` (see `.env.example`). On Vercel: add them to the project's
Environment Variables (mark `GOOGLE_SERVICE_ACCOUNT_KEY` **Sensitive**), and include them in the deploy
env matrix in `docs/DEPLOYMENT.md`. The cron schedule lives in `.github/workflows/sync-sheets.yml`.

## Behavior notes

- **Full mirror.** Every sync clears the tab and rewrites the header + every exportable invoice, so the
  sheet always reflects the DB — including edits and deletions. `SUBMITTED`/`REJECTED`/`CANCELLED`
  invoices are never written.
- **Layout.** Columns: `Invoice #, Date, Description, Property, Amount, Category, Status, Notes,
  Parts Ordered, Invoice Link` — rows ascend by invoice number (un-numbered ones last). The internal
  id and vendor are not exported. Any personal formulas referencing the pre-2026-08 column letters
  need a one-time fix after the first re-mirror.
- **Dropdowns.** Status, Category, and Property carry in-sheet dropdowns, refreshed every sync
  (Property options = your property addresses). If the tab uses a Sheets *Table* with typed columns,
  those columns keep the table's own dropdowns/types — the mirror skips them (classic validation is
  not allowed on typed columns) and only applies rules to untyped columns. Picking a value in the sheet does NOT update the app —
  the next mirror overwrites manual edits; the dropdowns are a filtering/consistency aid. Empty rows
  below the data show dropdown chevrons; that's expected (the rules cover future rows).
- **Tables resize with the mirror.** If the Invoices tab holds a Sheets *Table* starting at cell **A1**,
  every sync resizes it to fit the exported invoices — new rows arrive already banded and typed, and the
  table shrinks when invoices are removed. A table that starts anywhere other than A1 is left untouched,
  and mirrored rows are written outside it; if a table's formatting isn't applying, move the table to A1.
- **Tab name matters.** The mirror pins the tab named by `GOOGLE_SHEET_TAB` (default `Invoices`),
  matched exactly (case-sensitive). If the tab is renamed or missing, syncs fail with
  `SHEET_TAB_NOT_FOUND` naming the expected tab — recreate/rename the tab and sync again.
- **Change-gated.** The cron skips a landlord whose data is unchanged since their last sync (tracked by
  `User.sheetSyncedAt`), so frequent pings don't burn the Google write quota.
- **At-least-once / idempotent.** If the rewrite lands but the DB stamp dies, the landlord stays "dirty"
  and the next pass re-mirrors — a clear+rewrite is idempotent, so a redundant pass is harmless.
- **Per-invoice badge.** An invoice edited since its last mirror shows "drifted" until the next pass
  re-syncs it (~15 min, or immediately via "Sync now").
- **Failures.** Not configured / malformed key → 503; sheet not shared / wrong id → a clear error. In the
  cron, one landlord's failure is isolated (counted, retried next run) and never blocks the others.
- **Rate limit.** The manual "Sync now" endpoint is capped (default 5 / 15 min per client); the cron is
  secret-gated, not session-rate-limited.
