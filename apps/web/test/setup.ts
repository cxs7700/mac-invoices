import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18n from '../src/lib/i18n'

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
