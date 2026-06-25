import { describe, it, expect } from 'vitest'
import { UpdateProfileSchema } from '../src/schemas/settings'

describe('UpdateProfileSchema', () => {
  it('accepts a trimmed name', () => {
    const r = UpdateProfileSchema.safeParse({ name: '  Pat  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.name).toBe('Pat')
  })

  it('rejects empty and over-long names', () => {
    expect(UpdateProfileSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(UpdateProfileSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })
})
