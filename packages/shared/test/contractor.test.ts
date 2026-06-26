import { describe, it, expect } from 'vitest'
import {
  CreateContractorSchema,
  UpdateContractorSchema,
  SubmissionSchema,
} from '../src/schemas/contractor'
import { MAX_INVOICE_IMAGES } from '../src/schemas/invoice'

const baseSubmission = {
  amount: 100,
  description: 'Fixed a leak',
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

  it('rejects more than the cap', () => {
    const six = Array.from({ length: MAX_INVOICE_IMAGES + 1 }, (_, i) =>
      img(`https://b.example/${i}.jpg`),
    )
    expect(SubmissionSchema.safeParse({ ...baseSubmission, images: six }).success).toBe(false)
  })
})

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
