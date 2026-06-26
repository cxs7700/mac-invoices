import { describe, it, expect } from 'vitest'
import {
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertySchema,
  PropertyDetailSchema,
  propertyLabel,
} from '../src/index'

describe('CreatePropertySchema', () => {
  it('parses a valid property', () => {
    const r = CreatePropertySchema.safeParse({ name: '123 Main St', address: 'Anytown', notes: 'duplex' })
    expect(r.success).toBe(true)
  })

  it('accepts a missing notes field', () => {
    expect(CreatePropertySchema.safeParse({ name: 'Maple', address: '1 Maple Ave' }).success).toBe(true)
  })

  it('accepts a missing or empty name (address is the only required field)', () => {
    expect(CreatePropertySchema.safeParse({ address: '1 Maple Ave' }).success).toBe(true)
    expect(CreatePropertySchema.safeParse({ name: '', address: 'x' }).success).toBe(true)
  })

  it('still rejects an empty address', () => {
    expect(CreatePropertySchema.safeParse({ name: 'x', address: '' }).success).toBe(false)
  })

  it('rejects over-long name (>100) and address (>200)', () => {
    expect(CreatePropertySchema.safeParse({ name: 'a'.repeat(101), address: 'x' }).success).toBe(false)
    expect(CreatePropertySchema.safeParse({ name: 'x', address: 'a'.repeat(201) }).success).toBe(false)
  })

  it('trims whitespace', () => {
    const r = CreatePropertySchema.parse({ name: '  Lake House  ', address: '  9 Lake Rd  ' })
    expect(r.name).toBe('Lake House')
    expect(r.address).toBe('9 Lake Rd')
  })
})

describe('UpdatePropertySchema', () => {
  it('allows a partial update', () => {
    expect(UpdatePropertySchema.safeParse({ name: 'Renamed' }).success).toBe(true)
    expect(UpdatePropertySchema.safeParse({}).success).toBe(true)
  })
})

describe('PropertySchema', () => {
  const valid = { id: 'p1', name: 'P', address: 'A', notes: null, createdAt: '2026-06-25T00:00:00.000Z' }
  it('coerces createdAt to a Date and accepts null notes', () => {
    const r = PropertySchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.createdAt).toBeInstanceOf(Date)
  })
})

describe('propertyLabel', () => {
  it('uses the name when present, else falls back to the address', () => {
    expect(propertyLabel({ name: 'Maple Duplex', address: '1 Maple Ave' })).toBe('Maple Duplex')
    expect(propertyLabel({ name: '', address: '1 Maple Ave' })).toBe('1 Maple Ave')
    expect(propertyLabel({ name: '   ', address: '1 Maple Ave' })).toBe('1 Maple Ave')
    expect(propertyLabel({ name: null, address: '1 Maple Ave' })).toBe('1 Maple Ave')
  })
})

describe('PropertyDetailSchema', () => {
  it('parses a detail with a string totalSpend', () => {
    const r = PropertyDetailSchema.safeParse({
      id: 'p1', name: 'P', address: 'A', notes: null,
      createdAt: '2026-06-25T00:00:00.000Z', totalSpend: '150.00',
    })
    expect(r.success).toBe(true)
  })
})
