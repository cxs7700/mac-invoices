import { describe, expect, it } from 'vitest'
import { compareInvoiceOrder, type InvoiceOrderKey } from '../src/lib/invoiceOrder'

const key = (
  id: string,
  invoiceNumber: string | null,
  invoiceDate: Date | string = new Date('2025-06-01'),
): InvoiceOrderKey => ({ id, invoiceNumber, invoiceDate })

describe('compareInvoiceOrder', () => {
  it('sorts numeric-aware, not lexicographic ("9" before "10")', () => {
    const sorted = [key('a', '10'), key('b', '9')].sort(compareInvoiceOrder)
    expect(sorted.map((k) => k.invoiceNumber)).toEqual(['9', '10'])
  })

  it('sorts prefixed numbers numeric-aware ("INV-9" before "INV-10")', () => {
    const sorted = [key('a', 'INV-10'), key('b', 'INV-9')].sort(compareInvoiceOrder)
    expect(sorted.map((k) => k.invoiceNumber)).toEqual(['INV-9', 'INV-10'])
  })

  it('sorts un-numbered invoices after all numbered ones', () => {
    const sorted = [key('a', null), key('b', '2'), key('c', '1')].sort(compareInvoiceOrder)
    expect(sorted.map((k) => k.invoiceNumber)).toEqual(['1', '2', null])
  })

  it('orders un-numbered invoices by date then id', () => {
    const sorted = [
      key('z', null, '2025-03-02'),
      key('b', null, '2025-03-01'),
      key('a', null, '2025-03-01'),
    ].sort(compareInvoiceOrder)
    expect(sorted.map((k) => k.id)).toEqual(['a', 'b', 'z'])
  })

  it('produces the same order for ISO-string and Date inputs', () => {
    const asStrings = [
      key('a', null, '2025-03-02T00:00:00.000Z'),
      key('b', null, '2025-03-01T00:00:00.000Z'),
    ].sort(compareInvoiceOrder)
    const asDates = [
      key('a', null, new Date('2025-03-02T00:00:00.000Z')),
      key('b', null, new Date('2025-03-01T00:00:00.000Z')),
    ].sort(compareInvoiceOrder)
    expect(asStrings.map((k) => k.id)).toEqual(asDates.map((k) => k.id))
    expect(asStrings.map((k) => k.id)).toEqual(['b', 'a'])
  })

  it('mixed Date and string dates compare on the same axis', () => {
    expect(
      compareInvoiceOrder(
        key('a', null, new Date('2025-03-01')),
        key('b', null, '2025-03-02'),
      ),
    ).toBeLessThan(0)
  })
})
