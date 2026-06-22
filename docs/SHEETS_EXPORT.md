# Google Sheets Export — operator setup

The "Export to Sheets" button appends the landlord's **un-synced** invoices to a Google Sheet via a
**service account** and stamps `sheetsSyncedAt`. Postgres stays the source of truth (one-way export).
See `docs/DECISIONS.md` DEC-021 for the design.

## One-time setup

1. **Create a service account** in Google Cloud (any project): IAM & Admin → Service Accounts → Create.
   Then create a **JSON key** for it and download the file.
2. **Enable the Google Sheets API** for that project (APIs & Services → Library → Google Sheets API).
3. **Create the target spreadsheet** and note its ID (the long token in the URL
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
4. **Share the sheet as Editor** with the service account's `client_email` (from the key JSON). This is
   the #1 first-use failure — without it every export returns a permission error.
5. **Write the header row once** on the export tab (default tab name `Invoices`):
   `id, invoiceNumber, vendorName, amount, status, invoiceDate, dueDate, category, description`.

## Environment variables

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the **entire JSON key** as a string (Sensitive — never commit). Note Vercel/env stores often need the `private_key`'s `\n` preserved. |
| `GOOGLE_SHEET_ID` | the target spreadsheet id |
| `GOOGLE_SHEET_TAB` | optional; the tab to append to (default `Invoices`) |

Locally: set these in the repo-root `.env` (see `.env.example`). On Vercel: add them to the project's
Environment Variables (mark `GOOGLE_SERVICE_ACCOUNT_KEY` **Sensitive**), and include them in the deploy
env matrix in `docs/DEPLOYMENT.md`.

## Behavior notes

- **Un-synced only.** Each export sends invoices with `sheetsSyncedAt = null`, then stamps them — repeat
  exports don't duplicate. An invoice **edited** after export is not re-sent (append-only).
- **At-least-once.** If Google appends but the request/function dies before the stamp, those rows are in
  the sheet yet still un-synced and will re-append next time; they're identifiable by the `id` column.
- **Failures.** Not configured / malformed key → 503; sheet not shared / wrong id → a clear error; a
  mid-export chunk failure → 502 with the count that made it (a retry resumes the rest).
- **Rate limit.** The endpoint is capped (default 5 / 15 min per client) so a session can't burn the
  shared Google write quota.
