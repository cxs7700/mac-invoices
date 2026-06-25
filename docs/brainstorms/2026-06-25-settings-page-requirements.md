---
date: 2026-06-25
topic: settings-page
---

# Settings Page — Requirements

## Summary

Fill the disabled "Settings" nav stub with a real landlord settings page covering four self-serve areas: **profile** (edit display name; email shown read-only), **change password** (verify current → set new, logging out all other sessions), **Sheets connection** (surface what is env-only today — status, a settable target spreadsheet ID, the service-account email to share with, and a test action), and **language** (switch the landlord app between English and Chinese, persisted as a saved preference). The first three are bounded account/integration work; the language switch is **app-wide internationalization** — the toggle lives in Settings, but the real weight is an i18n foundation plus extracting every landlord-app UI string and writing Chinese translations, so it is treated as its own larger phase. The public contractor page and emails stay English in v1.

## Problem Frame

The app is a single logged-in landlord with no way to manage their own account: there is no change-password or profile-update endpoint (only login/logout/me), the Google Sheets target + credentials are entirely server-env and invisible to the user (the export even accepts a spreadsheet override that is never surfaced), and the UI is English-only. "Settings" is the natural home for all of this. The four areas differ sharply in weight: profile/password/Sheets-config are standard, bounded additions over the existing auth + integration-seam patterns; **language is cross-cutting** — it touches every component that renders text. Bundling them is fine for the *page*, but the plan should phase the language work separately so it doesn't gate the quick account wins. Cost-aversion shapes two choices: the Sheets area surfaces the existing **shared service account** rather than building per-user Google OAuth, and i18n uses a free library, not a paid translation service.

## Key Decisions

- **Profile: name editable, email read-only.** Email is the unique login identifier and there is no email-verification flow, so editing it risks an unrecoverable lockout. Email change is deferred until a verify-email flow exists.
- **Change password: verify current, set new, log out other sessions.** Require the current password (argon2id verify), set the new one (reuse the existing password min-length rule), then invalidate every other session for the user while keeping the current one — a password change means "secure my account."
- **Sheets connection: surface the existing config, not OAuth.** Show connection status (configured? can the service account reach the target sheet?), let the landlord set and persist their target spreadsheet ID (replacing the env default + the unsurfaced override), display the service-account email they must share the sheet with as Editor, and offer a "test connection" action. Per-user Google OAuth is explicitly out of scope (architecture rework, conflicts with the shared-service-account design + cost-aversion).
- **Language: English + Chinese, landlord app only, saved preference.** A language switch in Settings changes the logged-in landlord surfaces and persists as the landlord's preference (so it follows them across devices/sessions). The public contractor page and notification emails remain English in v1.
- **Language is phased.** v1 ships the i18n foundation (a switch + persisted preference + the translation mechanism) and full coverage of the landlord app's strings. Because string extraction is large and mechanical, the plan may stage it (foundation + high-traffic screens first, then full coverage) rather than blocking the page on 100% translation.

## Actors

- A1. Landlord — the only user; manages their own profile, password, Sheets connection, and language. (Single landlord today; the page is per-user by design.)

## Requirements

**Profile**

- R1. The landlord can view their account (name, email) and edit their **display name**; email is shown read-only.

**Change password**

- R2. The landlord can change their password by supplying their **current** password and a new one (subject to the existing password strength rule); a wrong current password is rejected.
- R3. A successful password change **logs out all other sessions** and keeps the current one active.

**Sheets connection**

- R4. The settings page shows the Sheets connection **status**: whether credentials + a target sheet are configured, and whether the service account can actually reach the target sheet.
- R5. The landlord can **set and persist a target spreadsheet ID**; the export uses the saved ID (falling back to the server default when unset).
- R6. The page **displays the service-account email** so the landlord knows which address to share their sheet with (as Editor).
- R7. A **"test connection"** action verifies access to the current target sheet and reports success or a clear, non-leaking error.

**Language**

- R8. The landlord can switch the app language between **English and Chinese**; the choice is **persisted as their preference** and applied on next load.
- R9. The switch covers the **landlord app surfaces** (the logged-in pages); the public contractor page and emails stay English in v1.

**Integrity**

- R10. All settings reads/writes are scoped to the session user (no cross-user exposure); secrets (the service-account key, password hashes) are never returned to the client.

## Key Flows

- F1. Edit profile name
  - **Trigger:** Landlord opens Settings → Profile.
  - **Steps:** Edit name → save → the new name reflects in the app chrome. Email is visible but not editable.
  - **Covers:** R1

- F2. Change password
  - **Trigger:** Landlord opens Settings → Security.
  - **Steps:** Enter current + new password → on success, other sessions are invalidated and a confirmation shows; a wrong current password shows an inline error.
  - **Covers:** R2, R3

- F3. Connect / point a Sheet
  - **Trigger:** Landlord opens Settings → Sheets.
  - **Steps:** See status + the service-account email → paste/save a target spreadsheet ID → run "test connection" → status updates to connected (or shows the share-as-Editor hint on failure).
  - **Covers:** R4, R5, R6, R7

- F4. Switch language
  - **Trigger:** Landlord opens Settings → Language (or a quick switcher).
  - **Steps:** Pick English or Chinese → the app re-renders in that language and the preference is saved for next time.
  - **Covers:** R8, R9

## Acceptance Examples

- AE1. **Covers R2, R3.** **Given** the landlord is logged in on two devices, **when** they change their password with the correct current password, **then** the other device's session is logged out and the current one stays active; **when** the current password is wrong, **then** the change is rejected and no session is touched.
- AE2. **Covers R1.** **Given** the profile page, **when** the landlord edits their name, **then** it saves and the chrome reflects it; the email field is read-only.
- AE3. **Covers R4, R5, R7.** **Given** a saved target spreadsheet ID the service account can't access, **when** the landlord runs "test connection," **then** they see a clear "share the sheet with <service-account-email> as Editor" message, not a raw provider error.
- AE4. **Covers R8, R9.** **Given** the landlord picks Chinese, **when** they reload, **then** the landlord app renders in Chinese; the public contractor page they share still renders in English.
- AE5. **Covers R10.** **Then** no settings response ever includes the service-account key or a password hash.

## Scope Boundaries

**Deferred for later**
- Email change (needs a verify-email flow first).
- Per-user Google OAuth ("connect your own Google account") — v1 surfaces the shared service account instead.
- Translating the public contractor page and notification emails (contractor-facing i18n; the contractor has no account, so it needs auto-detect or a per-link locale).
- Additional languages beyond English + Chinese.
- A landlord notification on/off preference (tracked in the contractor-notifications brainstorm).

**Outside this product's identity**
- A general localization/translation-management platform (TMS, crowd translation) — v1 ships static EN/ZH resource files.
- Multi-tenant account administration — single landlord; this is a personal settings page.

## Dependencies / Assumptions

- The hand-rolled @oslojs session + argon2id auth (`apps/api/src/auth`) is the base for change-password and session invalidation — **verified**: `password.ts` exposes hashPassword/verifyPassword; sessions are per-user rows that can be deleted to log out.
- The Sheets integration seam (`apps/api/src/integrations/sheets.ts`, CONV-016) already throws a clear "share the sheet with the service-account email as Editor" error and never leaks the raw key — reuse it for the status/test call. The service-account email is derivable from the loaded credentials.
- The export currently targets `process.env.GOOGLE_SHEET_ID` with an unsurfaced `spreadsheetId` override — **verified**; R5 makes a persisted per-landlord ID the source, falling back to the env default.
- The landlord's language (and target spreadsheet ID) are per-user persisted settings — Postgres is the source of truth (DEC-001); the exact storage shape (columns on User vs a settings record) is a planning detail.
- i18n uses a free client-side library; no paid translation service. Chinese strings are authored as part of the work (machine-assisted then reviewed) — translation quality/coverage is an accepted iterative effort.
- Single landlord today; the page is built per-user so it generalizes if more landlords are ever added.

## Success Criteria

- The landlord can change their password and edit their name without touching the server env or the database directly.
- The landlord can point exports at their own sheet and confirm the connection works — with an actionable error (the share-as-Editor hint), never a raw provider error.
- The landlord can read the app in Chinese, and the choice sticks across reloads/devices.
- No secret (service-account key, password hash) is ever exposed to the client.

## Outstanding Questions

**Deferred to planning**
- Where the language + target-spreadsheet-ID preferences live (columns on `User` vs a small settings table) and how the language preference is applied on first paint (server-rendered hint vs a localStorage mirror to avoid a flash).
- The i18n library/approach and how strings are organized (namespaces), plus whether full landlord-app coverage ships in one pass or is staged (foundation + key screens first).
- Whether "test connection" reuses the existing export code path (a dry-run that doesn't append) or a dedicated lightweight metadata read.
- The exact session-invalidation mechanism for "log out other sessions" (delete-all-then-keep-current vs delete-all-except-current).
- Whether a quick language switcher also lives in the app chrome (not just the Settings page).
