import { describe, it, expect } from 'vitest'
import { LoginSchema, SignupSchema } from '../src/index'

describe('LoginSchema', () => {
  it('accepts a valid email + password', () => {
    expect(
      LoginSchema.safeParse({ email: 'landlord@example.com', password: 'secret' }).success,
    ).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(LoginSchema.safeParse({ email: 'not-an-email', password: 'secret' }).success).toBe(false)
  })

  it('rejects an empty password', () => {
    expect(LoginSchema.safeParse({ email: 'landlord@example.com', password: '' }).success).toBe(
      false,
    )
  })
})

describe('LoginSchema email normalization', () => {
  it('trims and lowercases the email so casing never blocks login', () => {
    const parsed = LoginSchema.parse({ email: '  Foo@Bar.COM ', password: 'secret' })
    expect(parsed.email).toBe('foo@bar.com')
  })
})

describe('SignupSchema', () => {
  const valid = {
    inviteCode: 'code',
    email: 'new@example.com',
    password: 'longenough',
    firstName: 'Ada',
    lastName: 'Lovelace',
  }

  it('accepts a complete valid payload', () => {
    expect(SignupSchema.safeParse(valid).success).toBe(true)
  })

  it('normalizes the email to trimmed lowercase', () => {
    expect(SignupSchema.parse({ ...valid, email: ' New@Example.COM ' }).email).toBe(
      'new@example.com',
    )
  })

  it('rejects a password shorter than 8 characters', () => {
    expect(SignupSchema.safeParse({ ...valid, password: '1234567' }).success).toBe(false)
  })

  it('accepts a password of exactly 8 characters', () => {
    expect(SignupSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true)
  })

  it('rejects a missing invite code', () => {
    expect(SignupSchema.safeParse({ ...valid, inviteCode: '' }).success).toBe(false)
  })

  it('rejects blank or whitespace-only names', () => {
    expect(SignupSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false)
    expect(SignupSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false)
  })

  it('trims surrounding whitespace from names', () => {
    const parsed = SignupSchema.parse({ ...valid, firstName: '  Ada  ', lastName: ' Lovelace ' })
    expect(parsed.firstName).toBe('Ada')
    expect(parsed.lastName).toBe('Lovelace')
  })

  it('rejects a malformed email', () => {
    expect(SignupSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })
})
