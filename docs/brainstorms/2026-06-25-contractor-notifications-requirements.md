---
date: 2026-06-25
topic: contractor-notifications
---

# Contractor Notifications — Requirements

## Summary

Notify the landlord when a contractor acts in the submission flow, instead of making them watch the review queue. When a contractor submits a new invoice or withdraws a pending one, those events accumulate in the existing InvoiceEvent ledger; a scheduled job periodically sweeps the un-notified ones into a single **digest email** to the landlord. In parallel, an **in-app notification feed** surfaces all recent contractor activity (including edits, which don't warrant an email) with an unread count that clears on view. v1 is **landlord-facing only** — the contractor, who has no account and only an unvalidated free-text contact, is not notified yet; that's deferred until their contact becomes a validated channel.

## Problem Frame

The contractor submission portal (PR #13) is in-app only: the landlord learns of a new submission by happening to look at the SUBMITTED queue, and a withdrawal silently changes the queue out from under them. Nothing pulls the landlord in when they're not already looking — which is the whole point of a notification. The asymmetry that shapes this feature: the **landlord is trivially reachable** (a logged-in `User` with a verified email), while the **contractor is not** (no session to push to; reachable only via their tokenized link or their `contact` field, which today is free-text, display-only, and could be a phone or an email). So the cheap, high-value half is landlord-facing email + in-app; the contractor-facing half is gated on a contact-field upgrade and is therefore deferred. Cost-aversion is binding: email has generous free tiers, SMS does not, and a scheduled flush runs free on Vercel Cron — so v1 can ship at $0 within free-tier limits.

A load-bearing fact: **the InvoiceEvent ledger already records every event this feature needs.** A submission writes a `CREATED` event (actor `contractor:<id>`, owner = landlord); a withdrawal writes a `STATUS_CHANGED` → `CANCELLED` event; an edit writes `FIELD_EDITED`. So notifications are a **read over the ledger plus a flush marker** — not new write-path instrumentation.

## Key Decisions

- **Landlord-facing only in v1.** The contractor is not notified yet. Notifying them requires turning the free-text `contact` field into a validated channel (email and/or phone) and handling contractors who supplied neither — out of scope here.
- **Two channels, complementary.** Email is the async pull (reaches the landlord when they're away); the in-app feed is the real-time surface (seen on next visit). Both read the same ledger events.
- **Email triggers: new submission + withdrawal only.** Edits to a still-pending submission are surfaced in the in-app feed but do **not** send email (low signal — the queue already shows current values — and the most likely spam source).
- **Digest, not per-event.** A scheduled job (Vercel Cron, free) periodically sweeps un-notified triggering events into **one** email per landlord ("Joe submitted 2 invoices and withdrew 1"). This caps spam from a contractor batching submissions; the trade-off is a short delay (target ~15 min) versus immediate delivery.
- **Email behind the integration seam.** Sending goes through a thin, mockable, error-sanitizing module (the established pattern — `apps/api/src/integrations/storage.ts`, `sheets.ts`; DEC-022 / CONV-016), using a free-tier transactional provider. No live calls in tests.
- **In-app feed is lightweight.** A notifications panel (bell / nav item) listing recent contractor activity — including the edits and withdrawals that don't appear in the SUBMITTED queue — with an unread count that clears on view.
- **Email is always on in v1; the on/off toggle is deferred.** A per-landlord email preference lands later, alongside the future Settings surface.

## Actors

- A1. Landlord — the only logged-in user and the only notified party in v1. Receives the digest email and sees the in-app feed.
- A2. Contractor — acts (submits / edits / withdraws) but is **not** notified in v1.
- A3. The scheduled flush — a periodic job that turns un-notified ledger events into a digest email and marks them notified.

## Requirements

**Email digest (landlord)**

- R1. When a contractor submits a new invoice or withdraws a pending one, that event becomes eligible for a landlord notification.
- R2. A scheduled job periodically (target ~15 min) collects a landlord's un-notified eligible events and sends a **single** digest email summarizing them (counts + a brief per-event line), with a link into the review queue.
- R3. Each event is emailed **at most once** — after a successful send it is marked notified and never re-sent (at-least-once delivery is acceptable; a duplicate digest is preferable to a dropped one, but a normal run sends each event once).
- R4. Edits to a pending submission do **not** trigger email.
- R5. Email sending is isolated behind a mockable integration module; a provider failure never crashes the flush and never leaks provider errors/secrets, and leaves the events un-notified so the next run retries.

**In-app feed (landlord)**

- R6. The landlord sees an in-app notifications feed listing recent contractor activity — new submissions, edits, and withdrawals — newest first, each linking to the relevant invoice.
- R7. An unread count is visible in the app chrome (e.g., a bell badge); opening/viewing the feed clears unread.

**Integrity & scope**

- R8. Notifications are derived from the InvoiceEvent ledger scoped to the landlord (the event's `ownerUserId`); a landlord is only ever notified about their own contractors' activity (no cross-owner leak).
- R9. No new event-capture is added for v1 — the existing ledger writes are the source of truth (DEC-001).

## Key Flows

- F1. New submission → digest
  - **Trigger:** A contractor submits; the ledger records a `CREATED` event.
  - **Steps:** The next scheduled flush picks up the un-notified event → sends/extends the landlord's digest email → marks it notified. The event also appears immediately in the in-app feed as unread.
  - **Covers:** R1, R2, R3, R6

- F2. Withdrawal → digest
  - **Trigger:** A contractor withdraws a pending submission (`STATUS_CHANGED` → CANCELLED).
  - **Steps:** Same flush path as F1; the digest line reads as a withdrawal.
  - **Covers:** R1, R2

- F3. Edit → in-app only
  - **Trigger:** A contractor edits a pending submission (`FIELD_EDITED`).
  - **Steps:** Appears in the in-app feed as unread; **no** email.
  - **Covers:** R4, R6

- F4. Landlord reviews the feed
  - **Trigger:** The landlord opens the notifications panel.
  - **Steps:** Sees recent contractor activity, clicks through to an invoice; unread clears.
  - **Covers:** R6, R7

- F5. Provider outage
  - **Trigger:** The email provider is down when the flush runs.
  - **Steps:** The send fails cleanly (no crash, no leaked error), events stay un-notified, the next run retries.
  - **Covers:** R5

## Acceptance Examples

- AE1. **Covers R2, R3.** **Given** a contractor submitted 2 invoices and withdrew 1 since the last flush, **when** the flush runs, **then** the landlord gets one digest email naming 3 events, and a second flush with no new events sends nothing.
- AE2. **Covers R4.** **Given** a contractor edits a pending submission, **when** the next flush runs, **then** no email is sent for the edit (but it shows in the in-app feed).
- AE3. **Covers R7.** **Given** unread contractor activity, **when** the landlord opens the feed, **then** the unread count clears.
- AE4. **Covers R5.** **Given** the email provider errors, **when** the flush runs, **then** the job completes without crashing, no provider error leaks, and the events remain eligible for the next run.
- AE5. **Covers R8.** **Given** two landlords each with their own contractors, **then** each landlord's digest and feed contain only their own contractors' events.

## Scope Boundaries

**Deferred for later**
- Contractor-facing notifications (email/SMS to the contractor on approve/reject/pay) — blocked on upgrading the `contact` field to a validated channel.
- A landlord email on/off preference (and the broader Settings surface).
- Per-event immediate email and configurable digest cadence.
- Emailing on contractor edits.

**Outside this product's identity**
- SMS notifications — recurring per-message cost with no free tier; conflicts with the cost-averse stance.
- A general notification/subscription framework — this is a focused landlord digest, not a notifications platform.

## Dependencies / Assumptions

- The InvoiceEvent ledger already records `CREATED` (submission), `STATUS_CHANGED`→`CANCELLED` (withdrawal), and `FIELD_EDITED` (edit) for contractor actors — **verified** (built in PR #13; `apps/api/src/invoices/writeService.ts`). Notifications read these; no new writes.
- A free-tier transactional email provider is acceptable (e.g., Resend-class). Recurring cost stays $0 within free-tier volume; **a verified sending domain / from-address is required** (configuration, not dollar cost) — surface this before go-live.
- Vercel Cron (free) provides the periodic flush trigger; the API already deploys on Vercel.
- A mechanism to mark an event "notified" is needed (a flag/timestamp tied to the event, or a small notification record) — exact representation is a planning detail.
- The landlord's email is on file (the seeded `User.email`); the digest sends there.
- Cost-aversion (defer paid deps / free-tier first) and Postgres source of truth (DEC-001) hold.

## Success Criteria

- The landlord finds out about a new submission (or withdrawal) without opening the app — within ~15 minutes, in one email, no spam from batched submissions.
- The in-app feed gives a quick "what have my contractors done lately" view, including edits/withdrawals the queue doesn't surface.
- v1 ships at $0 within free-tier limits, with email isolated behind a mockable seam (tests make no live calls).
- No landlord is ever notified about another landlord's contractors.

## Outstanding Questions

**Deferred to planning**
- The exact "notified" marker (a column/timestamp on `InvoiceEvent` vs a separate notification table) and how the flush queries un-notified events scoped per landlord.
- Digest cadence (the ~15-min target) and how the Vercel Cron endpoint is secured (it's a scheduled HTTP call — needs to reject public invocation).
- The in-app feed's read-state model (a per-landlord "last seen" timestamp vs per-event read flags) and where the bell/unread badge lives in the app chrome.
- Transactional email provider selection (free-tier fit, ToS, sending-domain setup) — a cost/setup decision to confirm before build.
- Digest email content/format and the exact link target (the SUBMITTED queue vs each invoice).
