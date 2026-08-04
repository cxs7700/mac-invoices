---
date: 2026-08-04
topic: dark-mode
---

# Dark Mode: Zero-FOUC Delivery Ladder — Requirements

## Summary

Ship dark mode in two rungs. v0 is OS-following: a complete dark token block plus media-query activation — no JavaScript, structurally no first-paint flash — with the five verified dark-mode hazards fixed inside its definition of done. v1 adds a tri-state light/dark/system toggle in both chrome preference slots, persisted per device, with first paint honoring the stored choice.

---

## Problem Frame

The app is light-only. The theme infrastructure is half-wired: `apps/web/src/index.css` declares the Tailwind dark variant and 31 light-theme tokens (the Rent Ops palette, DEC-017), but no dark counterparts exist, so the variant is inert. The obvious build path — the official shadcn Vite guide — assumes a class toggle from day one, which creates a first-paint flash problem the guide itself does not solve.

Shipping dark mode also exposes latent bugs immediately: two modal scrims hardcode near-black and vanish on dark backgrounds, the destructive button hardcodes white text, `::selection` is hardcoded for light, and the app has no print styles — so printing from dark mode would produce dark-background invoices. OS-dark users hit all of these on day one of v0, which is why their fixes belong to v0 rather than a follow-up.

---

## Key Decisions

- **Sequence dark mode so the flash problem never exists unsolved.** v0 activates via media query, which resolves before any JavaScript runs — the flash surface only appears in v1, and v1 ships the boot-path fix with it.
- **Theme is a device preference, not a profile field.** Stored locally only, like OS appearance. This skips the server column, schema change, API plumbing, and post-login reconciliation, at the cost of per-device settings. Server sync can be added later if wanted.
- **The toggle lives in chrome, beside the language switcher.** Both existing preference slots (mobile header, sidebar footer), following the established convention. No Settings-page section.
- **Hazard fixes are v0 scope.** The scrim, destructive-text, selection, and print fixes ship with the palette, not as a fast-follow.
- **Tri-state from the first commit.** The stored value is `light` | `dark` | `system` (default `system`), never a boolean — a boolean would require migrating stored values when the third state arrives.
- **Status colors keep their meaning in dark.** The four status pairs (paid, overdue, pending, submitted) keep their hue and are redesigned for dark by swapping luminance roles — a luminous foreground on a low-luminance tinted well — rather than mechanical inversion. Chrome tokens may be derived mechanically; status pairs are designed.

---

## Requirements

**v0 — OS-following dark mode**

- R1. Every color token defined for light mode has a dark counterpart; no token silently falls back to its light value in dark mode.
- R2. Dark mode activates from the OS color-scheme preference with no JavaScript, and the first paint is in the correct theme.
- R3. The four status pairs keep their hue semantics in dark and meet WCAG contrast: 4.5:1 for normal text, 3:1 for large text and badges.
- R4. The known hardcoded-color hazards are fixed: modal/drawer scrims remain visible in dark mode, destructive-button text meets contrast in both themes, text selection is themed, and printing always renders in light values regardless of the active theme.
- R5. Native browser UI (scrollbars, form controls, dropdowns) renders to match the active theme.

**v1 — manual control**

- R6. A tri-state control offers light, dark, and system, with system as the default for users who have made no choice.
- R7. The control appears in both chrome preference slots (mobile header and sidebar footer) and is operable by keyboard and screen reader, announcing its current state.
- R8. The choice persists on the device and survives reloads and sessions; no server involvement.
- R9. First paint honors the stored choice — including browser chrome color on mobile — with no flash of the wrong theme, on every route.
- R10. An explicit choice overrides the OS preference in both directions; when system is selected, the app follows OS theme changes live, without a reload.

---

## Key Flows

- F1. Theme resolution at load
  - **Trigger:** Any cold load or reload.
  - **Steps:** Stored explicit choice → apply it. Stored `system` or nothing → apply the OS preference. Resolution completes before first paint.
  - **Covers:** R2, R9.
- F2. Changing theme
  - **Trigger:** User taps a segment on the toggle.
  - **Steps:** Theme applies immediately app-wide; the choice is stored on the device.
  - **Covers:** R6, R8, R10.

---

## Acceptance Examples

- AE1. **Covers R2.** Given an OS-dark device and v0 deployed, when the app cold-loads, the first rendered frame is dark — no light flash.
- AE2. **Covers R10.** Given an OS-dark device, when the user selects light, the app renders light immediately and on every subsequent load.
- AE3. **Covers R10.** Given system is selected, when the OS switches theme (e.g., scheduled at sunset) while the app is open, the app follows without a reload.
- AE4. **Covers R4.** Given dark mode is active, when the user prints an invoice, the output renders in light values on a white page.
- AE5. **Covers R9.** Given a stored dark choice on an OS-light device, when the app cold-loads, the first rendered frame is dark — no light flash.
- AE6. **Covers R4.** Given dark mode is active, when a modal or the mobile drawer opens, its backdrop scrim is visibly distinct from the page behind it.

---

## Scope Boundaries

Deferred for later:

- View Transitions theme-switch animation (the circular wipe) — polish rung, independent of everything above.
- Server-synced theme preference — add only if per-device settings ever become a real annoyance.
- Theme-invariant photo mat for invoice photo wells and the lightbox — separate follow-up; the lightbox backdrop is already near-black in both themes.
- Contrast-test and raw-color lint gates (the "theme integrity suite") — strong follow-up candidate once the dark palette exists.
- Role-aware theme defaults (contractors defaulting to light) — speculative without user feedback.

---

## Dependencies / Assumptions

- The dark palette design happens inside v0 — it is the critical path, not a prerequisite. The Rent Ops reference (`docs/design/rent-ops-reference.md`, DEC-017) is the light-side source of truth; the dark counterparts should be recorded the same way.
- All components except the five verified literals already consume color tokens, so a complete dark token block themes the whole app (verified this session).
- Per-device preference is acceptable for both personas; no cross-device continuity expectation.
- Media-query and OS-preference APIs are universally supported in the browsers this app targets; no fallback tier needed.

---

## Outstanding Questions

Deferred to planning:

- How the v0 media-query activation composes with v1's explicit-choice mechanism (variant strategy and override semantics) — R10 defines the required behavior; the mechanism is planning's.
- Whether the toggle is built by extracting a shared segmented control from the language switcher or as a sibling component.
- The dark hex values themselves — designed during v0 implementation under R3's contrast constraint.

---

## Sources / Research

- `docs/ideation/2026-08-04-dark-mode-toggle-ideation.html` — ranked ideation this brainstorm develops; includes the rejected alternatives (settings-only placement, server sync, media-query-only end state) and their reasons.
- Grounding dossier (verified quotes with file:line pointers): `/tmp/compound-engineering/ce-brainstorm/dm-ladder-1/grounding.md` — session-temporary; covers the token inventory, chrome mounts, boot path, and hazard sites.
- `docs/design/rent-ops-reference.md` and DEC-017 in `docs/DECISIONS.md` — the light palette this feature mirrors.
- `docs/DECISIONS.md` DEC-020 — preference-state conventions this feature follows.
- External: shadcn Vite dark-mode guide (reference implementation shape; omits the first-paint fix), notanumber.in on SPA theme flash, web.dev theme-switch component (accessibility pattern for R7).
