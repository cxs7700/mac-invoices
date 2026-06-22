# Rent Ops — design reference (Phase 3 UI)

Concise extract of the imported Claude Design "Invoice System — Hi-Fi" (project
`e6ecdcd1-5b4d-4cec-8b7a-802f77f97980`). Recreate in our Tailwind + shadcn system
— this is a visual spec, not code to port. Full handoff lives in the design project.

## Palette (adopted into `apps/web/src/index.css`)

| Token | Hex |
|---|---|
| Accent / primary | `#1d5fb0` |
| Ink / foreground | `#0f2942` (also `#33475b`) |
| Muted text | `#5a6b7b` / `#8a99a8` |
| Page background | `#eef1f5` |
| Card | `#ffffff` |
| Surfaces | `#f2f5f9` / `#e8edf3` / `#eef2f7` |
| Border | `#e4e9f0` |
| Selection | `#cfe0f3` |
| Status — paid | text `#1f8a5b`, bg `#e6f4ec` |
| Status — overdue / destructive | text `#b8442a`, bg `#fbeee9` |
| Status — pending | neutral (`#5a6b7b` / `#eef2f7`) |

Type: **Public Sans**. Radius ~6–10px. Spacing 8/12/16/22 rhythm.

## Screens implemented this phase

- **Auth** — centered card on a tinted background; logo + "Welcome to Rent Ops";
  email + password (wired); Google + sign-up toggle rendered **disabled "Soon"**.
- **App shell** — left sidebar (wordmark; nav: Invoices active; Dashboard/Expenses/
  Properties/Contractors/Settings disabled "Soon"; user chip + logout) + content outlet.
- **Invoice list** — header (title + "New invoice"); status filter; table (#, Job,
  Vendor, Date, Price, Status pill); prev/next pagination.
- **Invoice detail** — two columns: record (invoice #, status pill, dates, vendor,
  description, amount boxed, notes, attachments) left; action rail (Mark paid /
  Dispute / Send-reminder-disabled) + a data-backed status timeline right.
- **Create / edit** — single-column form; the "scan a note / line items" card renders
  **disabled "Soon"** (the OCR + line-items feature is deferred).

## Deferred (in the design, not this phase)
Landing page, dashboards, report builder, Sheets/PDF/Excel export, photo→invoice OCR,
structured line-items / "parts ordered", contractor app, Google OAuth + signup.
