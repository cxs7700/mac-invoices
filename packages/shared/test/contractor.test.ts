import { describe, it, expect } from 'vitest'
import { CreateContractorSchema, UpdateContractorSchema } from '../src/schemas/contractor'

describe('CreateContractorSchema', () => {
  it('accepts a name + contact', () => {
    const r = CreateContractorSchema.safeParse({ name: 'Joe Plumber', contact: '555-1234' })
    expect(r.success).toBe(true)
  })

  it('trims and rejects empty name/contact', () => {
    expect(CreateContractorSchema.safeParse({ name: '   ', contact: 'x' }).success).toBe(false)
    expect(CreateContractorSchema.safeParse({ name: 'A', contact: '' }).success).toBe(false)
  })

  it('rejects a name over 100 chars (must fit vendorName)', () => {
    expect(CreateContractorSchema.safeParse({ name: 'a'.repeat(101), contact: 'x' }).success).toBe(false)
    expect(CreateContractorSchema.safeParse({ name: 'a'.repeat(100), contact: 'x' }).success).toBe(true)
  })

  it('rejects a contact over 200 chars', () => {
    expect(CreateContractorSchema.safeParse({ name: 'A', contact: 'a'.repeat(201) }).success).toBe(false)
  })

  it('UpdateContractorSchema allows partial fields', () => {
    expect(UpdateContractorSchema.safeParse({ name: 'New' }).success).toBe(true)
    expect(UpdateContractorSchema.safeParse({}).success).toBe(true)
  })
})
