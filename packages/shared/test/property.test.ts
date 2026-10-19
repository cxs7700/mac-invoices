import { describe, it, expect } from 'vitest'
import {
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertySchema,
  PropertyDetailSchema,
  propertyLabel,
  ownerFullName,
} from '../src/index'

// Every create must name the owner (payee); spread into payloads that aren't
// about the owner.
const OWNER = { ownerFirstName: 'Olive', ownerLastName: 'Owner', ownerEmail: 'olive@example.com' }
const NULL_OWNER = { ownerFirstName: null, ownerLastName: null, ownerEmail: null, ownerPhone: null }

describe('CreatePropertySchema', () => {
  it('parses a valid property', () => {
    const r = CreatePropertySchema.safeParse({
      name: '123 Main St',
      address: 'Anytown',
      notes: 'duplex',
      ...OWNER,
    })
    expect(r.success).toBe(true)
  })

  it('accepts a missing notes field', () => {
    expect(
      CreatePropertySchema.safeParse({ name: 'Maple', address: '1 Maple Ave', ...OWNER }).success,
    ).toBe(true)
  })

  it('accepts a missing or empty name (address is the only required field)', () => {
    expect(CreatePropertySchema.safeParse({ address: '1 Maple Ave', ...OWNER }).success).toBe(true)
    expect(CreatePropertySchema.safeParse({ name: '', address: 'x', ...OWNER }).success).toBe(true)
  })

  it('still rejects an empty address', () => {
    expect(CreatePropertySchema.safeParse({ name: 'x', address: '' }).success).toBe(false)
  })

  it('rejects over-long name (>100) and address (>200)', () => {
    expect(CreatePropertySchema.safeParse({ name: 'a'.repeat(101), address: 'x' }).success).toBe(
      false,
    )
    expect(CreatePropertySchema.safeParse({ name: 'x', address: 'a'.repeat(201) }).success).toBe(
      false,
    )
  })

  it('trims whitespace', () => {
    const r = CreatePropertySchema.parse({
      name: '  Lake House  ',
      address: '  9 Lake Rd  ',
      ...OWNER,
    })
    expect(r.name).toBe('Lake House')
    expect(r.address).toBe('9 Lake Rd')
  })
})

describe('CreatePropertySchema owner', () => {
  it('requires owner first name, last name and a valid email', () => {
    for (const key of ['ownerFirstName', 'ownerLastName', 'ownerEmail'] as const) {
      expect(
        CreatePropertySchema.safeParse({ address: 'x', ...OWNER, [key]: undefined }).success,
      ).toBe(false)
      expect(CreatePropertySchema.safeParse({ address: 'x', ...OWNER, [key]: '  ' }).success).toBe(
        false,
      )
    }
    expect(
      CreatePropertySchema.safeParse({ address: 'x', ...OWNER, ownerEmail: 'nope' }).success,
    ).toBe(false)
  })

  it('lowercases the email, normalizes an optional phone', () => {
    const r = CreatePropertySchema.parse({
      address: 'x',
      ...OWNER,
      ownerEmail: ' Olive@Example.COM ',
      ownerPhone: '(555) 123-4567',
    })
    expect(r.ownerEmail).toBe('olive@example.com')
    expect(r.ownerPhone).toBe('555-123-4567')
    expect(CreatePropertySchema.parse({ address: 'x', ...OWNER }).ownerPhone).toBeUndefined()
  })
})

describe('UpdatePropertySchema', () => {
  it('allows a partial update', () => {
    expect(UpdatePropertySchema.safeParse({ name: 'Renamed' }).success).toBe(true)
    expect(UpdatePropertySchema.safeParse({}).success).toBe(true)
  })

  it('null clears the optional phone, but not a required owner field', () => {
    expect(UpdatePropertySchema.parse({ ownerPhone: null }).ownerPhone).toBeNull()
    expect(UpdatePropertySchema.safeParse({ ownerEmail: null }).success).toBe(false)
    expect(UpdatePropertySchema.safeParse({ ownerFirstName: '' }).success).toBe(false)
  })
})

describe('ownerFullName', () => {
  it('joins the set parts', () => {
    expect(ownerFullName({ ownerFirstName: 'Jane', ownerLastName: 'Doe' })).toBe('Jane Doe')
    expect(ownerFullName({ ownerFirstName: 'Jane', ownerLastName: null })).toBe('Jane')
    expect(ownerFullName({ ownerFirstName: null, ownerLastName: null })).toBe('')
  })
})

describe('PropertySchema', () => {
  const valid = {
    id: 'p1',
    name: 'P',
    address: 'A',
    notes: null,
    ...NULL_OWNER,
    createdAt: '2026-06-25T00:00:00.000Z',
  }
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
      id: 'p1',
      name: 'P',
      address: 'A',
      notes: null,
      ...NULL_OWNER,
      createdAt: '2026-06-25T00:00:00.000Z',
      totalSpend: '150.00',
    })
    expect(r.success).toBe(true)
  })
})
