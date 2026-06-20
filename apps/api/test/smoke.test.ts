import { describe, it, expect } from 'vitest'
import { SHARED_PACKAGE_VERSION } from '@mac-invoices/shared'

// Proves the api test runner works AND that the shared workspace resolves at
// runtime from the api (see plan KTD-2). Real API tests arrive in Phase 2.
describe('api smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2)
  })

  it('resolves the shared workspace package', () => {
    expect(SHARED_PACKAGE_VERSION).toBe('0.0.0')
  })
})
