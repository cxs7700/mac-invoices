import { describe, it, expect } from 'vitest'
import { CreateVendorSchema, UpdateVendorSchema, SubmissionSchema } from '../src/schemas/vendor'
import { MAX_INVOICE_IMAGES } from '../src/schemas/invoice'

const baseSubmission = {
  items: [{ description: 'Fixed a leak', quantity: 1, total: 100 }],
  invoiceDate: new Date().toISOString(),
}
const img = (url: string) => ({ url })

describe('SubmissionSchema images', () => {
  it('requires at least one photo (the proof)', () => {
    expect(SubmissionSchema.safeParse({ ...baseSubmission, images: [] }).success).toBe(false)
    expect(SubmissionSchema.safeParse({ ...baseSubmission }).success).toBe(false)
  })

  it('accepts 1 up to the cap', () => {
    expect(
      SubmissionSchema.safeParse({ ...baseSubmission, images: [img('https://b.example/1.jpg')] })
        .success,
    ).toBe(true)
    const five = Array.from({ length: MAX_INVOICE_IMAGES }, (_, i) =>
      img(`https://b.example/${i}.jpg`),
    )
    expect(SubmissionSchema.safeParse({ ...baseSubmission, images: five }).success).toBe(true)
  })

  it('requires at least one line item', () => {
    const images = [img('https://b.example/1.jpg')]
    expect(SubmissionSchema.safeParse({ ...baseSubmission, items: [], images }).success).toBe(false)
  })

  it('accepts optional notes and partsOrdered', () => {
    const images = [img('https://b.example/1.jpg')]
    const parsed = SubmissionSchema.safeParse({
      ...baseSubmission,
      images,
      notes: 'Gate code 1234',
      partsOrdered: 'Moen cartridge',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.notes).toBe('Gate code 1234')
      expect(parsed.data.partsOrdered).toBe('Moen cartridge')
    }
    // Both are optional — a submission without them still parses.
    expect(SubmissionSchema.safeParse({ ...baseSubmission, images }).success).toBe(true)
  })

  it('rejects more than the cap', () => {
    const six = Array.from({ length: MAX_INVOICE_IMAGES + 1 }, (_, i) =>
      img(`https://b.example/${i}.jpg`),
    )
    expect(SubmissionSchema.safeParse({ ...baseSubmission, images: six }).success).toBe(false)
  })
})

describe('CreateVendorSchema', () => {
  it('accepts a name + email', () => {
    const r = CreateVendorSchema.safeParse({ name: 'Joe Plumber', email: 'a@b.com' })
    expect(r.success).toBe(true)
  })

  it('trims and rejects an empty name', () => {
    expect(CreateVendorSchema.safeParse({ name: '   ', email: 'a@b.com' }).success).toBe(false)
  })

  it('rejects a name over 100 chars (must fit vendorName)', () => {
    expect(CreateVendorSchema.safeParse({ name: 'a'.repeat(101), email: 'a@b.com' }).success).toBe(
      false,
    )
    expect(CreateVendorSchema.safeParse({ name: 'a'.repeat(100), email: 'a@b.com' }).success).toBe(
      true,
    )
  })

  it('rejects an email over 200 chars', () => {
    const longEmail = `${'a'.repeat(195)}@b.com`
    expect(longEmail.length).toBeGreaterThan(200)
    expect(CreateVendorSchema.safeParse({ name: 'A', email: longEmail }).success).toBe(false)
  })

  it('UpdateVendorSchema allows partial fields', () => {
    expect(UpdateVendorSchema.safeParse({ name: 'New' }).success).toBe(true)
    expect(UpdateVendorSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a vendor with only an email', () => {
    const parsed = CreateVendorSchema.parse({ name: 'Ace Plumbing', email: 'ace@example.com' })
    expect(parsed).toEqual({ name: 'Ace Plumbing', email: 'ace@example.com' })
  })

  it('accepts a vendor with only a phone', () => {
    const parsed = CreateVendorSchema.parse({ name: 'Ace Plumbing', phone: '555-0100' })
    expect(parsed.phone).toBe('555-0100')
  })

  it('rejects a vendor with neither phone nor email', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace Plumbing' })
    expect(result.success).toBe(false)
  })

  it('rejects a vendor whose phone and email are blank strings', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace', phone: '   ', email: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed email', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace', email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a name longer than 100 characters', () => {
    const result = CreateVendorSchema.safeParse({ name: 'a'.repeat(101), email: 'a@b.com' })
    expect(result.success).toBe(false)
  })

  it('allows a partial update that clears neither field', () => {
    expect(UpdateVendorSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
})
