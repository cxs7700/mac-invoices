import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EXPORT_COLUMNS, EXPORT_HEADER, invoiceToRow } from '../src/invoices/sheetRows'
import type { InvoiceRowInput } from '../src/invoices/sheetRows'

const inv: InvoiceRowInput = {
  id: 'inv_link_1',
  invoiceNumber: '160',
  vendorName: 'Vivien',
  amount: { toNumber: () => 1000 },
  status: 'PENDING',
  invoiceDate: new Date('2026-08-03T00:00:00Z'),
  category: 'REPAIRS',
  description: 'Repair entire building',
  partsOrdered: null,
  property: null,
}

describe('invoiceLink column', () => {
  const savedOrigin = process.env.WEB_ORIGIN
  beforeEach(() => {
    delete process.env.WEB_ORIGIN
  })
  afterEach(() => {
    if (savedOrigin === undefined) delete process.env.WEB_ORIGIN
    else process.env.WEB_ORIGIN = savedOrigin
  })

  it('is the LAST column so existing positional consumers keep their indexes', () => {
    expect(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1]).toBe('invoiceLink')
    expect(EXPORT_HEADER[EXPORT_HEADER.length - 1]).toBe('invoiceLink')
  })

  it('links to the app invoice-detail page under WEB_ORIGIN', () => {
    process.env.WEB_ORIGIN = 'https://app.example'
    const row = invoiceToRow(inv)
    expect(row[row.length - 1]).toBe('https://app.example/invoices/inv_link_1')
  })

  it('falls back to the localhost dev origin when WEB_ORIGIN is unset (codebase convention)', () => {
    const row = invoiceToRow(inv)
    expect(row[row.length - 1]).toBe('http://localhost:5173/invoices/inv_link_1')
  })

  it('does not shift the existing cells', () => {
    const row = invoiceToRow(inv)
    expect(row[0]).toBe('inv_link_1')
    expect(row[3]).toBe(1000)
    expect(row[9]).toBe('') // partsOrdered stays at index 9
  })
})
