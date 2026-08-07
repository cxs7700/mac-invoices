import { describe, it, expect } from 'vitest'
import { UpdateProfileSchema } from '../src/schemas/settings'

describe('UpdateProfileSchema', () => {
  it('accepts a trimmed first/last name', () => {
    const r = UpdateProfileSchema.safeParse({ firstName: '  Pat  ', lastName: ' Doe ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.firstName).toBe('Pat')
      expect(r.data.lastName).toBe('Doe')
    }
  })

  it('rejects an empty or over-long firstName', () => {
    expect(UpdateProfileSchema.safeParse({ firstName: '   ' }).success).toBe(false)
    expect(UpdateProfileSchema.safeParse({ firstName: 'a'.repeat(51) }).success).toBe(false)
  })

  it('rejects an over-long lastName but accepts an empty one (clears the field)', () => {
    expect(UpdateProfileSchema.safeParse({ lastName: 'a'.repeat(51) }).success).toBe(false)
    const r = UpdateProfileSchema.safeParse({ lastName: '   ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.lastName).toBe('')
  })

  it('accepts a partial body with only one field (PATCH contract)', () => {
    expect(UpdateProfileSchema.safeParse({ email: 'new@example.com' }).success).toBe(true)
    expect(UpdateProfileSchema.safeParse({ firstName: 'Pat' }).success).toBe(true)
    expect(UpdateProfileSchema.safeParse({ locale: 'zh' }).success).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(UpdateProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })
})
