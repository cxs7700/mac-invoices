import { describe, it, expect } from 'vitest'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  InvoiceItemInputSchema,
  InvoiceImageSchema,
  AttachImageSchema,
  MAX_INVOICE_IMAGES,
  MAX_INVOICE_ITEMS,
} from '../src/index'

const oneItem = [{ description: 'Fixed a leak', quantity: 1, total: 149.99 }]

const valid = {
  invoiceNumber: 'INV-001',
  vendorName: 'Acme Plumbing',
  items: oneItem,
  category: 'REPAIRS',
  invoiceDate: '2026-01-15',
}

const img = (url: string) => ({ url })

describe('InvoiceItemInputSchema', () => {
  it('accepts a valid item', () => {
    expect(InvoiceItemInputSchema.safeParse(oneItem[0]).success).toBe(true)
  })

  it('rejects a zero/negative quantity', () => {
    expect(InvoiceItemInputSchema.safeParse({ ...oneItem[0], quantity: 0 }).success).toBe(false)
    expect(InvoiceItemInputSchema.safeParse({ ...oneItem[0], quantity: -1 }).success).toBe(false)
  })

  it('rejects a non-integer quantity', () => {
    expect(InvoiceItemInputSchema.safeParse({ ...oneItem[0], quantity: 1.5 }).success).toBe(false)
  })

  it('rejects a total with more than two decimals', () => {
    expect(InvoiceItemInputSchema.safeParse({ ...oneItem[0], total: 1.234 }).success).toBe(false)
  })

  it('rejects a total that overflows Decimal(10,2)', () => {
    expect(InvoiceItemInputSchema.safeParse({ ...oneItem[0], total: 100_000_000 }).success).toBe(
      false,
    )
    expect(
      InvoiceItemInputSchema.safeParse({ ...oneItem[0], total: 99_999_999.99 }).success,
    ).toBe(true)
  })
})

describe('CreateInvoiceSchema', () => {
  it('accepts a valid invoice and defaults currency to USD', () => {
    const result = CreateInvoiceSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.currency).toBe('USD')
      expect(result.data.invoiceDate).toBeInstanceOf(Date)
    }
  })

  it('allows a missing invoiceNumber (server auto-assigns the next number)', () => {
    const { invoiceNumber, ...rest } = valid
    void invoiceNumber
    expect(CreateInvoiceSchema.safeParse(rest).success).toBe(true)
  })

  it('rejects an empty items array', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, items: [] }).success).toBe(false)
  })

  it('accepts up to the item cap and rejects beyond it', () => {
    const many = Array.from({ length: MAX_INVOICE_ITEMS }, (_, i) => ({
      description: `Item ${i}`,
      quantity: 1,
      total: 1,
    }))
    expect(CreateInvoiceSchema.safeParse({ ...valid, items: many }).success).toBe(true)
    expect(
      CreateInvoiceSchema.safeParse({
        ...valid,
        items: [...many, { description: 'One too many', quantity: 1, total: 1 }],
      }).success,
    ).toBe(false)
  })

  it('does not accept a top-level amount or description (stripped, not required)', () => {
    const r = CreateInvoiceSchema.safeParse({ ...valid, description: 'ignored', amount: 999 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('description' in r.data).toBe(false)
      expect('amount' in r.data).toBe(false)
    }
  })

  it('rejects an invalid category enum', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, category: 'NOPE' }).success).toBe(false)
  })

  it('rejects a malformed vendorEmail', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, vendorEmail: 'not-an-email' }).success).toBe(
      false,
    )
  })

  it('accepts 0 images (create now, photograph later) and up to the cap', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, images: [] }).success).toBe(true)
    expect(CreateInvoiceSchema.safeParse({ ...valid }).success).toBe(true)
    const five = Array.from({ length: MAX_INVOICE_IMAGES }, (_, i) =>
      img(`https://blob.example/p${i}.jpg`),
    )
    expect(CreateInvoiceSchema.safeParse({ ...valid, images: five }).success).toBe(true)
  })

  it('rejects more than the cap of images', () => {
    const six = Array.from({ length: MAX_INVOICE_IMAGES + 1 }, (_, i) =>
      img(`https://blob.example/p${i}.jpg`),
    )
    expect(CreateInvoiceSchema.safeParse({ ...valid, images: six }).success).toBe(false)
  })

  it('no longer accepts the legacy attachmentUrl input (stripped)', () => {
    const r = CreateInvoiceSchema.safeParse({ ...valid, attachmentUrl: 'https://x.example/a.jpg' })
    expect(r.success).toBe(true)
    if (r.success) expect('attachmentUrl' in r.data).toBe(false)
  })
})

describe('InvoiceImageSchema / AttachImageSchema', () => {
  it('defaults an attach image type to OTHER when omitted', () => {
    const r = AttachImageSchema.safeParse({ url: 'https://blob.example/p.jpg' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.type).toBe('OTHER')
  })

  it('coerces createdAt to a Date on the response shape', () => {
    const r = InvoiceImageSchema.safeParse({
      id: 'img_1',
      url: 'https://blob.example/signed.jpg',
      type: 'CASH',
      caption: null,
      createdAt: '2026-06-25T00:00:00.000Z',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.createdAt).toBeInstanceOf(Date)
  })
})

describe('UpdateInvoiceSchema', () => {
  it('accepts a partial body with only status', () => {
    const result = UpdateInvoiceSchema.safeParse({ status: 'PAID' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status enum', () => {
    expect(UpdateInvoiceSchema.safeParse({ status: 'DONE' }).success).toBe(false)
  })
})
