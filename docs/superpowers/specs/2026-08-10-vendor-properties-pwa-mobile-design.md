# Vendor↔Property assignment, submission-link PWA, and mobile fixes

Date: 2026-08-10

## Goal

Three related changes to the vendor submission flow:

1. A landlord assigns a set of properties to each vendor. The vendor's no-login
   submission link offers only those properties.
2. The submission link installs to a phone home screen as a PWA.
3. Close the real responsive defects on the submission page and the landlord's
   invoice create/edit form.

## What already exists (and is therefore out of scope)

- **Photo capture is already mobile-correct.** `PhotoAttach` renders two file
  inputs — one with `capture="environment"` (camera) and one without (photo
  library / file browser) — behind two buttons. Both the landlord form and the
  submission page use it. No change needed.
- **The mobile shell exists.** `Sidebar` is `hidden md:flex`; `AppShell` renders
  a top bar with a slide-out drawer under `md:`. No change needed.
- **The submission page already has a property dropdown**, fed by
  `GET /api/submissions/:token/properties`. It currently returns *all* of the
  landlord's properties. This spec narrows it; it does not add it.

## 1. Data model

```prisma
model VendorProperty {
  vendorId   String
  propertyId String
  vendor     Vendor   @relation(fields: [vendorId],   references: [id], onDelete: Cascade)
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@id([vendorId, propertyId])
  @@index([propertyId])
  @@map("vendor_properties")
}
```

An explicit join model rather than Prisma's implicit many-to-many: the migration
is legible, and the row can carry `createdAt`.

`onDelete: Cascade` on both sides. Unassigning is not a data-loss event —
`Invoice.propertyId` is an independent column and keeps its spend history
regardless of whether the vendor is still assigned to that property.

**Tenant boundary.** The composite PK does not prevent assigning landlord A's
property to landlord B's vendor. That is enforced in the handler: every
`propertyId` in a write must belong to the same `landlordId` as the vendor.
This matches how every other tenant boundary in this codebase is enforced.

## 2. API

### New (authed landlord)

- `GET /api/vendors/:id/properties` → `{ data: Property[] }`, the assigned set.
- `PUT /api/vendors/:id/properties` — body `{ propertyIds: string[] }`. Replaces
  the whole set inside one transaction. Idempotent; deliberately not an
  add/remove pair, because the UI is a checkbox list that submits a whole state.
  - 404 if the vendor is not the caller's.
  - 400 if any `propertyId` is not one of the caller's properties.

### Changed

- `GET /api/vendors` — each row gains `propertyCount: number`.
- `GET /api/submissions/:token/properties` — returns only the properties
  assigned to the token's vendor. Response *shape* is unchanged, so the client
  contract is stable.
- `POST /api/submissions/:token` — rejects a `propertyId` that is not assigned
  to this vendor (400).

That last change is load-bearing. The dropdown is client-side; without a
server-side check the narrowing is cosmetic and a vendor could post any
`propertyId` belonging to the landlord.

## 3. Landlord UI

`Vendors.tsx`: each vendor row gains an expandable **Properties** section — a
checkbox list of the landlord's properties (a landlord has a handful, so a plain
list beats a combobox) with a Save button issuing the `PUT`.

When `propertyCount === 0`, the row shows a warning pill: *"No properties
assigned — this vendor can't submit."*

**Accepted consequence.** The chosen rule is strict: no assignment means no
options, and `propertyId` is required to submit. After the migration every
existing vendor has zero properties, so **every existing submission link stops
accepting invoices until the landlord assigns properties.** This was chosen
deliberately over the permissive "unassigned sees all" alternative. The warning
pill is what makes the state visible rather than a silent breakage.

## 4. Vendor submission page

The dropdown reads the now-narrowed endpoint — no component change beyond the
empty case.

When the vendor has no assigned properties, the form is replaced by a panel
reading *"No properties have been assigned to you yet. Please contact your
landlord."* — rather than rendering a form whose submit button can never enable.
Translated in both `en` and `zh`.

The existing submissions list still renders, so a vendor in this state can still
see and withdraw prior submissions.

## 5. PWA (submission link only)

### Assets

`apps/web/public/` — `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`,
`sw.js`. Vite copies `public/` into `dist/`, and `scripts/build-vercel.mjs`
already copies all of `dist` into `static` with `handle: filesystem` ordered
ahead of the SPA fallback. No build-script change is required.

### Manifest is generated at runtime

The manifest is built as a Blob URL on the VendorSubmit page, with `start_url`
and `scope` set to the current `/submit/:token`, and injected as
`<link rel="manifest">` in an effect (removed on unmount).

A static manifest cannot work here: the token is per-vendor, and the point of
the feature is that the vendor's home-screen icon opens *their own* link. A
static `start_url` would open a dead route.

### iOS

iOS ignores the manifest for Add-to-Home-Screen and captures the current URL —
which is exactly the desired behaviour. It needs meta tags instead:
`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and
`apple-touch-icon`.

### Service worker

Registered **only from the VendorSubmit route**. Served from `/sw.js`, so its
scope is `/`, but the `fetch` handler is network-only (no `respondWith`) for
anything outside the submission flow. The landlord app is therefore never
cached — this avoids the whole stale-dashboard class of bug.

- Precaches the built JS/CSS shell and the icons.
- Navigation requests fall back to the cached shell when offline.
- API requests are never cached.
- Versioned cache name; `skipWaiting` + `clients.claim` so a deploy does not
  strand a vendor on stale JS.

Hand-written rather than `vite-plugin-pwa`: the plugin's default is a whole-app
precache, which is the behaviour explicitly ruled out, and the asset list here
is small. No new dependency.

### Viewport

`viewport-fit=cover` plus safe-area padding on the submission shell, so the
standalone window does not sit under the notch or the home indicator.

## 6. Mobile fixes

Concrete defects, not a speculative sweep:

1. **iOS zoom-on-focus.** Every input in `InvoiceFields` and `InvoiceForm` is
   `text-sm` (14px). Mobile Safari force-zooms any focused input under 16px and
   does not zoom back out. This is the worst mobile defect on both forms today.
   Fix: `text-base md:text-sm` on the shared field classes.
2. **Tap targets.** The quantity −/+ steppers and the item-remove X are ~28px,
   under the 44px touch minimum. Enlarge on small screens.
3. **Photo list has no thumbnails.** It renders "Photo 1", "Photo 2" — after
   five site photos a vendor cannot tell which is which when assigning types.
   Render the uploaded image as a thumbnail.
4. **375px pass** over `InvoiceTable`, Dashboard, and Properties for horizontal
   overflow; fix what it turns up.

## 7. Testing

**API**
- `PUT /api/vendors/:id/properties` replaces the set; is idempotent.
- Rejects a property belonging to another landlord (400).
- Rejects a vendor belonging to another landlord (404).
- `GET /api/submissions/:token/properties` returns only assigned properties.
- `POST /api/submissions/:token` rejects an unassigned `propertyId`.
- `GET /api/vendors` reports `propertyCount`.

**Web**
- Submission page renders the empty-state panel when no properties are assigned.
- Dropdown lists exactly the assigned properties.

**Definition of done:** `npm run lint && npm run typecheck && npm run test` green.

Note: the `apps/api` suite has a known pre-existing flake (~1 run in 3) from a
race on the shared landlord row. A failure there must be confirmed against
`main` before being treated as a regression.
