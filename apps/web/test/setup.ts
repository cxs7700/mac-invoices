import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18n from '../src/lib/i18n'

// Unmount React trees between tests so repeated renders don't accumulate in jsdom.
afterEach(cleanup)

// The suite asserts English copy; keep i18n pinned to 'en' so tests stay stable as
// strings migrate to t() keys (a test that switches language resets it here after).
beforeEach(() => {
  if (i18n.language !== 'en') i18n.changeLanguage('en')
})
