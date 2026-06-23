import { describe, it, expect } from 'vitest'
import { CreateInvoiceSchema, UpdateInvoiceSchema } from '../src/index'

const valid = {
  invoiceNumber: 'INV-001',
  vendorName: 'Acme Plumbing',
  description: 'Fixed a leak',
  amount: 149.99,
  category: 'REPAIRS',
  invoiceDate: '2026-01-15',
}

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

  it('rejects a non-positive amount', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(CreateInvoiceSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false)
  })

  it('rejects an amount with more than two decimals', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, amount: 1.234 }).success).toBe(false)
  })

  it('rejects an amount that overflows Decimal(10,2)', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, amount: 100_000_000 }).success).toBe(false)
    expect(CreateInvoiceSchema.safeParse({ ...valid, amount: 99_999_999.99 }).success).toBe(true)
  })

  it('rejects an invalid category enum', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, category: 'NOPE' }).success).toBe(false)
  })

  it('rejects a malformed vendorEmail', () => {
    expect(CreateInvoiceSchema.safeParse({ ...valid, vendorEmail: 'not-an-email' }).success).toBe(
      false,
    )
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
