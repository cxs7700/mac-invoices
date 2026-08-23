import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18n from '../src/lib/i18n'

// jsdom keeps one localStorage for the whole file, so anything a test persists
// is still there for the next one. That is not hypothetical: the vendor
// submission draft restores a half-filled form, so without this a test that
// typed two line items hands the next test a form that already has them.
//
// Registered BEFORE `cleanup` deliberately. Vitest runs afterEach hooks in
// reverse registration order, so this one runs LAST — after unmount. That
// ordering is load-bearing: unmounting flushes state updates still queued from
// a resolved upload, which re-runs the draft's save effect. Clearing first
// would be undone by the very teardown meant to isolate the test.
afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    // Not every environment exposes it; nothing to clean up if so.
  }
})

// Unmount React trees between tests so repeated renders don't accumulate in jsdom.
afterEach(cleanup)

// jsdom implements neither of these, and both are ordinary browser APIs the app
// uses unguarded: matchMedia for the theme and the PWA's display-mode check,
// createObjectURL for the runtime-generated submission manifest (src/lib/pwa.ts).
// Stubbed here rather than guarded in the source — a browser always has them.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
}

// The suite asserts English copy; keep i18n pinned to 'en' so tests stay stable as
// strings migrate to t() keys (a test that switches language resets it here after).
beforeEach(() => {
  if (i18n.language !== 'en') i18n.changeLanguage('en')
})
