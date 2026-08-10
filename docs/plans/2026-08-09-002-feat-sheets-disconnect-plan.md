# Sheets Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a landlord disconnect their Google spreadsheet, and make any target change actually trigger a sync so a newly connected sheet is populated instead of sitting empty.

**Architecture:** A new `DELETE /api/settings/sheets` alongside the existing `PATCH`, returning the same status body so the client refreshes through one path. `SaveSheetSchema` is untouched — because disconnecting has its own verb and its own button, no save payload ever needs to mean "clear", so an accidental disconnect cannot be spelled in a save request. Both the save and the disconnect writes also null `User.sheetSyncedAt`, which is what makes the next cron run treat the landlord as dirty and mirror in full.

**Tech Stack:** Fastify 5, Prisma + PostgreSQL, Zod 4, React 19 + TanStack Query, Vitest.

**Spec:** `docs/brainstorms/2026-08-09-sheets-disconnect-requirements.md`

## Global Constraints

- **Node 20 is the shell default and breaks Prisma and the test tooling.** Start any shell with:
  `export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"` — confirm `node -v` prints `v24.12.0`.
- **NEVER run the api suite without the local DATABASE_URL override.** The repo-root `.env` `DATABASE_URL` points at the **production** database. Only correct form:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
- **Never run `npm run test` from the repo root.** Shared and web are safe alone: `npm test -w @mac-invoices/shared`, `npm test -w @mac-invoices/web`.
- **Never run migrations, `db:deploy`, or `db:push` in this plan.** No schema change is needed — `sheetSpreadsheetId` and `sheetSyncedAt` are both already nullable.
- **Local Postgres** runs on port **5433** (`docker compose up -d`); a native host Postgres shadows 5432. It is currently migrated to head; if you see Prisma error **P2022** ("column does not exist"), the local DB has fallen behind — run `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" npm run db:deploy` followed by the same-prefixed `npm run db:generate`, and say so in your report.
- **Commits go directly on `main`.** No feature branch. Do not push — the user pushes when they ask.
- **Do not `git add -A`.** A `.claude/` and a `.superpowers/` directory exist in this tree and must never be committed.
- Definition of Done: `npm run lint && npm run typecheck` green, plus the api and web suites.
- **`users.sheetSpreadsheetId` is UNIQUE** (DEC-033). Every literal spreadsheet id in a test file must be distinct from every other, or an aborted run poisons the shared dev database.
- **Known pre-existing test noise, not yours to fix:** the api suite flakes on a shared-landlord race (a parallel file mutates the landlord's email so another file's login 401s; parallel invoice creates hit P2002 on `invoices_userId_invoiceNumber_key`). If a failure is in a file you did not touch, re-run that file in isolation before investigating — if it passes alone, it is the flake.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/settings/handlers.ts` | **Modify.** Add `disconnectSheet`; add the `sheetSyncedAt` reset to `saveSheet`. |
| `apps/api/src/settings/routes.ts:28` | **Modify.** Register `DELETE /api/settings/sheets`. |
| `apps/api/test/settings.sheets.test.ts` | **Modify.** AE1–AE6, AE9. |
| `apps/web/src/hooks/useSettings.ts` | **Modify.** Add `useDisconnectSheet`. |
| `apps/web/src/pages/Settings.tsx` | **Modify.** Disconnect button, shown only when connected. |
| `apps/web/test/Settings.test.tsx` | **Modify.** AE7, AE8, and the click path. |
| `docs/DECISIONS.md` | **Modify.** Append DEC-034. |

**Two spec questions resolved here:**
1. *Shared status helper, or call `getSheets`?* **Call `getSheets`**, exactly as `saveSheet` already does. It is one line and keeps a single definition of the status shape.
2. *Dedicated hook or extend `useSaveSheet`?* **A dedicated `useDisconnectSheet`.** `useSaveSheet`'s `mutationFn` takes a `SaveSheetInput`; a disconnect takes nothing. Overloading one hook to mean both would make the argument's presence the switch between "save" and "clear" — reintroducing at the client exactly the ambiguity the `DELETE` verb removes at the API.

---

### Task 1: Disconnect endpoint and the sync-high-water reset

**Files:**
- Modify: `apps/api/src/settings/handlers.ts:150-181` (`saveSheet`) and append `disconnectSheet` after it
- Modify: `apps/api/src/settings/routes.ts:28`
- Modify: `apps/api/test/settings.sheets.test.ts`

**Interfaces:**
- Consumes: `getSheets(request, reply)` — the existing handler in the same file, which sends `{ configured, serviceAccountEmail, targetSpreadsheetId, reachable }`.
- Produces: `disconnectSheet(request, reply)` — exported from `apps/api/src/settings/handlers.ts`, served at `DELETE /api/settings/sheets`, responding with the same status body `PATCH` returns.

- [ ] **Step 1: Add the test helper**

In `apps/api/test/settings.sheets.test.ts`, beside the existing `get` / `save` / `test` helpers near the top of the file, add:

```ts
const disconnect = () =>
  app.inject({ method: 'DELETE', url: '/api/settings/sheets', headers: { cookie: cookie() } })
```

And beside the existing `ID_*` constants add the ids this task needs. They must be distinct from every other literal in the file (the column is UNIQUE):

```ts
const ID_DISCONNECT = '1SettingsSheetsDisconnectKKKKKKKKKKKKKKKKKK'
const ID_RELEASED = '1SettingsSheetsReleasedLLLLLLLLLLLLLLLLLLLL'
const ID_UNAUTH = '1SettingsSheetsUnauthMMMMMMMMMMMMMMMMMMMMMM'
const ID_RESET_SAVE = '1SettingsSheetsResetOnSaveNNNNNNNNNNNNNNNNN'
const ID_RESET_DISC = '1SettingsSheetsResetOnDiscOOOOOOOOOOOOOOOOO'
const ID_NO_TARGET = '1SettingsSheetsNoTargetPPPPPPPPPPPPPPPPPPPP'
```

- [ ] **Step 2: Write the failing tests**

Add inside the existing `describe('Sheets settings')` block:

```ts
  it('disconnects a connected spreadsheet (AE1)', async () => {
    expect((await save(ID_DISCONNECT)).statusCode).toBe(200)
    const res = await disconnect()
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBeNull()
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSpreadsheetId).toBeNull()
  })

  it('releases the spreadsheet for another account (AE2)', async () => {
    await save(ID_RELEASED)
    await disconnect()
    const other = await createSecondUser(app)
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/sheets',
        payload: { spreadsheetId: ID_RELEASED },
        headers: { cookie: other.cookie },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().targetSpreadsheetId).toBe(ID_RELEASED)
    } finally {
      await other.cleanup()
    }
  })

  it('is idempotent when nothing is connected (AE3)', async () => {
    await disconnect()
    const res = await disconnect()
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBeNull()
  })

  it('rejects an unauthenticated disconnect and changes nothing (AE4)', async () => {
    await save(ID_UNAUTH)
    const res = await app.inject({ method: 'DELETE', url: '/api/settings/sheets' })
    expect(res.statusCode).toBe(401)
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSpreadsheetId).toBe(ID_UNAUTH)
  })

  // AE5/AE6 are the tests that would have caught the stale-sync bug: without
  // the reset, runSheetsSyncFlush compares invoice/property timestamps against
  // sheetSyncedAt, neither of which a target change touches — so the landlord
  // reads as clean and the newly connected sheet is never populated.
  it('clears the sync high-water mark when a target is saved (AE5)', async () => {
    await app.prisma.user.update({
      where: { id: u.user.id },
      data: { sheetSyncedAt: new Date('2026-01-01T00:00:00Z') },
    })
    await save(ID_RESET_SAVE)
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSyncedAt).toBeNull()
  })

  it('clears the sync high-water mark on disconnect (AE6)', async () => {
    await save(ID_RESET_DISC)
    await app.prisma.user.update({
      where: { id: u.user.id },
      data: { sheetSyncedAt: new Date('2026-01-01T00:00:00Z') },
    })
    await disconnect()
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSyncedAt).toBeNull()
  })

  it('export and test both report no sheet connected after a disconnect (AE9)', async () => {
    await save(ID_NO_TARGET)
    await disconnect()

    const exported = await app.inject({
      method: 'POST',
      url: '/api/invoices/export',
      payload: {},
      headers: { cookie: cookie() },
    })
    expect(exported.statusCode).toBe(400)
    expect(exported.json().error.code).toBe('SHEET_NOT_CONNECTED')

    const tested = await test()
    expect(tested.statusCode).toBe(400)
    expect(tested.json().error.message).toMatch(/No target spreadsheet set/)
  })
```

Note the existing `"Sync now"` test in this file saves its own target before asserting. Vitest runs tests in a file sequentially, so these additions are safe as long as every test that needs a target saves one first — which each of the above does. Do not reorder the existing tests.

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets
```
Expected: AE1–AE4 and AE9 FAIL with **404** (the route does not exist — Fastify's not-found handler). AE5 and AE6 FAIL on `sheetSyncedAt` still holding the 2026-01-01 date.

- [ ] **Step 4: Add the sheetSyncedAt reset to saveSheet**

In `apps/api/src/settings/handlers.ts`, in `saveSheet`, change the update's `data` to also clear the high-water mark:

```ts
    await request.server.prisma.user.update({
      where: { id: request.user.id },
      data: {
        sheetSpreadsheetId: spreadsheetId,
        // Clearing the high-water mark is what makes the next cron run mirror
        // into this sheet. `runSheetsSyncFlush` decides dirtiness by comparing
        // invoice/property timestamps against `sheetSyncedAt`, and changing the
        // target touches neither — so without this, switching sheets leaves the
        // new one empty until something unrelated marks the landlord dirty.
        //
        // Unconditional, not "only when the id changed": that would need a
        // read-then-write, and if two saves interleave the loser skips the reset
        // and the bug returns. The cost is one redundant mirror when the same id
        // is saved twice, which is harmless — the mirror is idempotent (DEC-001)
        // — and arguably correct, since pressing Save means "make this current".
        sheetSyncedAt: null,
      },
    })
```

Leave the surrounding `try`/`catch` and the P2002 translation exactly as they are.

- [ ] **Step 5: Add the disconnect handler**

Append to `apps/api/src/settings/handlers.ts`, directly after `saveSheet`:

```ts
/**
 * DELETE /api/settings/sheets — disconnect the target spreadsheet.
 *
 * A distinct verb rather than a nullable PATCH body. Because the UI is an
 * explicit Disconnect button, no save payload ever needs to mean "clear", so
 * `SaveSheetSchema` keeps rejecting empty and an accidental disconnect cannot
 * be spelled in a save request at all (DEC-034).
 *
 * Idempotent: disconnecting with nothing connected succeeds and changes
 * nothing. Clearing the id releases it under the unique index added in
 * DEC-033 — Postgres treats NULLs as distinct — so another account can then
 * connect that spreadsheet. `sheetSyncedAt` is cleared for the same reason as
 * in `saveSheet`: whatever is connected next must be mirrored in full.
 */
export async function disconnectSheet(request: FastifyRequest, reply: FastifyReply) {
  await request.server.prisma.user.update({
    where: { id: request.user.id },
    data: { sheetSpreadsheetId: null, sheetSyncedAt: null },
  })
  return getSheets(request, reply)
}
```

No `try`/`catch` here: writing `null` cannot violate the unique index, so there is no P2002 to translate.

- [ ] **Step 6: Register the route**

In `apps/api/src/settings/routes.ts`, directly after the existing `fastify.patch('/api/settings/sheets', ...)` line:

```ts
  fastify.delete('/api/settings/sheets', auth, handlers.disconnectSheet)
```

`auth` is the `{ preHandler: requireAuth }` object already defined at the top of that function — this is what makes AE4 return 401.

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets
```
Expected: PASS, every test in the file.

- [ ] **Step 8: Run lint, typecheck, and the full api suite**

Run:
```bash
npm run lint && npm run typecheck
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api
```
Expected: green. Watch `sheets.sync.test.ts` in particular — it exercises `runSheetsSyncFlush`, the job whose dirtiness rule this task's reset is designed to trip. If a failure appears in a file you did not touch, re-run that file alone before investigating.

That file also already covers spec requirement R11 ("the sync job continues to skip landlords with no target") — see the existing assertion that no mirror call can target a user with no `sheetSpreadsheetId` (`sheets.sync.test.ts:309`). No new test is needed for R11; just confirm that one still passes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/settings/handlers.ts apps/api/src/settings/routes.ts apps/api/test/settings.sheets.test.ts
git commit -m "feat(api): disconnect a Sheets target; reset the sync high-water mark

A connected spreadsheet could only be replaced, never cleared — so pasting the
wrong id could only be undone by deleting the account, and under the unique
index it also denied that id to everyone else.

DELETE rather than a nullable PATCH body: with disconnect as its own verb, no
save payload can express 'clear', so an accidental disconnect is unspellable
rather than merely unlikely.

Also clears sheetSyncedAt on both paths. runSheetsSyncFlush judges dirtiness
from invoice and property timestamps, neither of which a target change touches,
so switching sheets previously left the new one empty until something unrelated
marked the landlord dirty."
```

---

### Task 2: Disconnect button, and record the decision

**Files:**
- Modify: `apps/web/src/hooks/useSettings.ts`
- Modify: `apps/web/src/pages/Settings.tsx:176-266`
- Modify: `apps/web/test/Settings.test.tsx`
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- Consumes: `DELETE /api/settings/sheets` from Task 1, returning the `SheetsStatus` body `{ configured, serviceAccountEmail, targetSpreadsheetId, reachable }`.
- Produces: `useDisconnectSheet()` — exported from `apps/web/src/hooks/useSettings.ts`, a TanStack mutation taking no variables and writing the returned status into the `['sheets-status']` query cache.

- [ ] **Step 1: Write the failing web tests**

`apps/web/test/Settings.test.tsx` mocks `@/hooks/useSettings` wholesale, so the new hook must be added to the mock or the component will throw on an undefined import.

Add `useDisconnectSheet: vi.fn(),` to the `vi.hoisted` object `h`, add `useDisconnectSheet: h.useDisconnectSheet,` to the `vi.mock('@/hooks/useSettings', ...)` factory, and add `h.useDisconnectSheet.mockReturnValue(idle())` to `beforeEach` beside the other hook defaults.

Then add these tests inside `describe('Settings page')`:

```ts
  it('offers no disconnect control when no sheet is connected (AE8)', () => {
    h.useSheetsStatus.mockReturnValue({
      data: {
        configured: true,
        serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
        targetSpreadsheetId: null,
        reachable: false,
      },
      isPending: false,
    })
    render(<Settings />)
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('disconnects the connected sheet and empties the field', () => {
    // Same shape as the existing "shows the normalized bare id after a
    // successful save" test: mimic the real hook by updating what
    // useSheetsStatus returns, then firing onSuccess.
    const mutate = vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => {
      h.useSheetsStatus.mockReturnValue({
        data: {
          configured: true,
          serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
          targetSpreadsheetId: null,
          reachable: false,
        },
        isPending: false,
      })
      opts?.onSuccess?.()
    })
    h.useDisconnectSheet.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    const input = screen.getByLabelText('Target spreadsheet ID or URL') as HTMLInputElement
    expect(input.value).toBe('SID') // the connected id from beforeEach
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(mutate).toHaveBeenCalled()
    // The local override is dropped on success, so the field falls back to the
    // refreshed status — empty — rather than still showing the disconnected id.
    expect(input.value).toBe('')
  })

  it('will not let an emptied field clear the connection (AE7)', () => {
    render(<Settings />)
    const input = screen.getByLabelText('Target spreadsheet ID or URL') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    // Save stays disabled on empty — clearing the field is not a disconnect.
    expect((screen.getByRole('button', { name: 'Save target' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @mac-invoices/web -- Settings`
Expected: the AE8 and click tests FAIL — no button named `Disconnect` exists. The AE7 test should already PASS (Save is already disabled on empty); it is a regression guard, not a red-to-green step.

- [ ] **Step 3: Add the hook**

In `apps/web/src/hooks/useSettings.ts`, directly after `useSaveSheet`:

```ts
/** Disconnect the target spreadsheet. Takes no variables — the whole point of
 * the DELETE verb is that "clear" cannot be expressed as a save payload. */
export function useDisconnectSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient<SheetsStatus>('/api/settings/sheets', { method: 'DELETE' }),
    onSuccess: (status) => qc.setQueryData(['sheets-status'], status),
  })
}
```

`useQueryClient`, `useMutation`, `apiClient`, and the `SheetsStatus` type are all already imported in this file for `useSaveSheet` — do not add duplicate imports.

- [ ] **Step 4: Add the button**

In `apps/web/src/pages/Settings.tsx`, add the hook alongside the existing ones in `SheetsSection`:

```tsx
  const disconnect = useDisconnectSheet()
```

and add it to the existing import from `@/hooks/useSettings` rather than writing a second import statement.

Add its error line beside the existing `errOf(test.error)` block:

```tsx
          {errOf(disconnect.error) && (
            <p className="text-sm text-destructive" role="alert">
              {errOf(disconnect.error)}
            </p>
          )}
```

And add the button inside the existing `<div className="flex gap-2">`, after `Test connection`:

```tsx
            {status?.targetSpreadsheetId && (
              <Button
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, { onSuccess: () => setSheetId(null) })
                }
              >
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
```

`setSheetId(null)` drops the local input override so the field falls back to the refreshed status — the same reset `Save target` already does. Without it the input would keep displaying the id that was just disconnected.

- [ ] **Step 5: Run the web tests to verify they pass**

Run: `npm test -w @mac-invoices/web -- Settings`
Expected: PASS, every test in the file.

- [ ] **Step 6: Record DEC-034**

Append to `docs/DECISIONS.md`, matching the existing flat bullet format (`- **DEC-0NN — Title** (plan: ..., spec: ...). (a) ... (b) ...` — dense prose, one bullet per decision; the most recent entry is DEC-033):

```markdown
- **DEC-034 — Disconnecting a Sheets target is its own verb; any target change resets the sync high-water mark** (plan: `docs/plans/2026-08-09-002-feat-sheets-disconnect-plan.md`, spec: `docs/brainstorms/2026-08-09-sheets-disconnect-requirements.md`). **Closes the follow-up DEC-033(g) named as outstanding.** (a) **`DELETE /api/settings/sheets`, not a nullable `PATCH` body.** Rejected: accepting `null` or `""` on the save path. Because the UI is an explicit Disconnect button rather than an empty save, no save payload ever needs to mean "clear" — so `SaveSheetSchema` keeps rejecting empty and an accidental disconnect becomes unspellable in a save request rather than merely unlikely. Rejected for the same reason: supporting both, which keeps the accidental-clear risk while adding a second path to test. (b) **The response is the same status body `PATCH` returns** (`getSheets`), so the client refreshes through one path. (c) **Any successful save or disconnect clears `User.sheetSyncedAt`, unconditionally.** This fixes a pre-existing bug, not one introduced here: `runSheetsSyncFlush` judges dirtiness by comparing the newest invoice/property change against `sheetSyncedAt`, and changing `sheetSpreadsheetId` touches neither — so a landlord who switched sheets without editing an invoice was judged clean and **the new spreadsheet was never populated**, which from their side is indistinguishable from the integration being broken. Rejected: resetting only when the id actually changed, which needs a read-then-write — if two saves interleave, the loser skips the reset and the bug returns. Unconditional needs no read and has no race; its cost is one redundant mirror when the same id is saved twice, harmless because the mirror is idempotent (DEC-001) and arguably correct, since pressing Save means "make this sheet current". (d) **Disconnecting releases the id** under the DEC-033 unique index (Postgres treats NULLs as distinct), so an ordinary mistake — connecting the wrong sheet — no longer requires deleting an account to undo. (e) **Squatting is softened, not solved.** A landlord who grabbed the wrong sheet can now release it; a hostile holder still will not press the button, so the remedy for that case is unchanged. `PATCH`/`DELETE /api/settings/sheets` also remain unrate-limited — the gap DEC-033(g) records on that point stands. (f) **No confirmation dialog**: the action is explicitly named and reversible by re-saving. (g) **Per-invoice `sheetsSyncedAt` stamps are not reset** on a target change; they drive the SyncBadge only and the full mirror that follows re-stamps them, so a badge may briefly overstate how current the new sheet is (accepted).
```

- [ ] **Step 7: Run everything**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
npm run lint && npm run typecheck
npm test -w @mac-invoices/web
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api
```
Expected: green. `npm run format:check` currently fails on ~70 files for reasons that predate this work and CI does not gate on it — but any file YOU create or that was clean before you touched it must stay clean. Check yours with `npx prettier --check <file>` and fix only those.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/useSettings.ts apps/web/src/pages/Settings.tsx apps/web/test/Settings.test.tsx docs/DECISIONS.md
git commit -m "feat(web): disconnect a connected spreadsheet from Settings

An explicit button rather than 'empty the field and Save', so a stray
select-all-delete cannot drop a connection. Shown only when a sheet is
connected, and clears the local input override on success so the field reflects
what the server now holds.

DEC-034 records the reasoning, including why the sync high-water mark is reset
unconditionally, and closes the follow-up DEC-033(g) named."
```

---

## Verification Notes

No migration is involved, so there is no production runbook step for this change and nothing to pre-check.

Worth one manual check after deploying, because it is the behavior this plan exists to fix and no automated test exercises the real cron: connect a spreadsheet, confirm the next sync populates it without editing an invoice first.
