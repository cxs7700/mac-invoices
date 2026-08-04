# Rent Ops — design reference (Phase 3 UI)

Concise extract of the imported Claude Design "Invoice System — Hi-Fi" (project
`e6ecdcd1-5b4d-4cec-8b7a-802f77f97980`). Recreate in our Tailwind + shadcn system
— this is a visual spec, not code to port. Full handoff lives in the design project.

## Palette (adopted into `apps/web/src/index.css`)

Light and dark values live together in `index.css` via `light-dark()` (DEC-025).
The dark side keeps each token's hue and swaps luminance roles; status pills go
emissive — luminous text on a low-luminance tinted well — with overdue carrying
the brightest foreground (the actionable state reads first).

| Token | Light | Dark |
|---|---|---|
| Accent / primary | `#1d5fb0` | `#5b96e0` |
| Ink / foreground | `#0f2942` (also `#33475b`) | `#dce5ee` (also `#c2cdd9`) |
| Muted text | `#5a6b7b` / `#8a99a8` | `#8da0b3` |
| Page background | `#eef1f5` | `#10151c` |
| Card | `#ffffff` | `#171e28` |
| Surfaces | `#f2f5f9` / `#e8edf3` / `#eef2f7` | `#1c2430` / `#22314a` |
| Border | `#e4e9f0` | `#29323f` |
| Selection | `#cfe0f3` | `#2b4a72` |
| Destructive | `#b8442a` (text `#ffffff`) | `#c74c31` (text `#ffffff`) |
| Overlay (scrims) | `rgb(15 23 32 / 0.45)` | `rgb(0 0 0 / 0.6)` |
| Status — paid | text `#1f8a5b`, bg `#e6f4ec` | text `#4cc38a`, bg `#12291c` |
| Status — overdue / destructive | text `#b8442a`, bg `#fbeee9` | text `#f2916d`, bg `#331611` |
| Status — pending | neutral (`#5a6b7b` / `#eef2f7`) | text `#97a8ba`, bg `#1d2530` |
| Status — submitted | text `#1d5fb0`, bg `#e7eefc` | text `#6ba3e8`, bg `#142441` |

The lightbox photo backdrop (`bg-black/70`) is intentionally theme-invariant —
a cinema surface behind full-size photos. Printing is always light (print
media re-pins `color-scheme`).

Type: **Public Sans**. Radius ~6–10px. Spacing 8/12/16/22 rhythm.

## Screens implemented this phase

- **Auth** — centered card on a tinted background; logo + "Welcome to Rent Ops";
  email + password (wired); Google + sign-up toggle rendered **disabled "Soon"**.
- **App shell** — left sidebar (wordmark; nav: Invoices active; Dashboard/Expenses/
  Properties/Contractors/Settings disabled "Soon"; user chip + logout) + content outlet.
- **Invoice list** — header (title + "New invoice"); status filter; table (#, Job,
  Vendor, Date, Price, Status pill); prev/next pagination.
- **Invoice detail** — two columns: record (invoice #, status pill, dates, vendor,
  description, amount boxed, notes, attachments) left; action rail (Mark paid)
  + a data-backed status timeline right. (The design's Dispute / Send-reminder
  actions were later removed from the app.)
- **Create / edit** — single-column form; the "scan a note / line items" card renders
  **disabled "Soon"** (the OCR + line-items feature is deferred).

## Deferred (in the design, not this phase)
Landing page, dashboards, report builder, Sheets/PDF/Excel export, photo→invoice OCR,
structured line-items / "parts ordered", contractor app, Google OAuth + signup.
