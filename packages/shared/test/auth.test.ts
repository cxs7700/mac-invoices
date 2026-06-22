import { describe, it, expect } from 'vitest'
import { LoginSchema } from '../src/index'

describe('LoginSchema', () => {
  it('accepts a valid email + password', () => {
    expect(LoginSchema.safeParse({ email: 'landlord@example.com', password: 'secret' }).success).toBe(
      true,
    )
  })

  it('rejects a malformed email', () => {
    expect(LoginSchema.safeParse({ email: 'not-an-email', password: 'secret' }).success).toBe(false)
  })

  it('rejects an empty password', () => {
    expect(LoginSchema.safeParse({ email: 'landlord@example.com', password: '' }).success).toBe(false)
  })
})
