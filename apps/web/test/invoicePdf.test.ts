import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildInvoicePdfModel,
  balanceDue,
  generateInvoicesPdf,
  pdfFileName,
  type PdfInvoiceInput,
} from '@/lib/invoicePdf'

// Lazy-loading spies: the factories run only when jspdf is actually imported,
// which must not happen before generateInvoicesPdf is called (R12).
const jspdfImported = vi.hoisted(() => ({ value: false }))
const saveSpy = vi.hoisted(() => vi.fn())
const textSpy = vi.hoisted(() => vi.fn())
const autoTableSpy = vi.hoisted(() => vi.fn())

vi.mock('jspdf', () => {
  jspdfImported.value = true
  class FakeJsPdf {
    addPage = vi.fn()
    setFontSize = vi.fn()
    text = textSpy
    save = saveSpy
  }
  return { jsPDF: FakeJsPdf }
})

vi.mock('jspdf-autotable', () => ({
  default: autoTableSpy.mockImplementation((doc: { lastAutoTable?: { finalY: number } }) => {
    doc.lastAutoTable = { finalY: 130 }
  }),
}))

const inv = (over: Partial<PdfInvoiceInput> = {}): PdfInvoiceInput => ({
  id: 'inv-1',
  invoiceNumber: '1',
  description: 'Fix sink',
  amount: '120.00',
  status: 'PENDING',
  invoiceDate: '2026-03-05T00:00:00.000Z',
  propertyId: 'prop-1',
  ...over,
})

const addresses = new Map([['prop-1', '12 Main St']])

describe('buildInvoicePdfModel', () => {
  it('builds one page per invoice with address, description, amount, status, balance', () => {
    const pages = buildInvoicePdfModel(
      [inv(), inv({ id: 'inv-2', invoiceNumber: '2', description: 'Paint', amount: '80.50' })],
      addresses,
    )
    expect(pages).toHaveLength(2)
    expect(pages[0]).toMatchObject({
      heading: 'Invoice 1',
      date: 'Mar 5, 2026',
      status: 'Pending',
      table: { location: '12 Main St', description: 'Fix sink', amount: '$120.00' },
      balanceDue: '$120.00',
    })
    expect(pages[1].table.amount).toBe('$80.50')
  })

  it('orders pages by natural invoice-number order regardless of selection order', () => {
    const pages = buildInvoicePdfModel(
      [inv({ id: 'a', invoiceNumber: '10' }), inv({ id: 'b', invoiceNumber: '9' })],
      addresses,
    )
    expect(pages.map((p) => p.heading)).toEqual(['Invoice 9', 'Invoice 10'])
  })

  it('sorts un-numbered invoices last and falls back their heading to —', () => {
    const pages = buildInvoicePdfModel(
      [inv({ id: 'a', invoiceNumber: null }), inv({ id: 'b', invoiceNumber: '3' })],
      addresses,
    )
    expect(pages.map((p) => p.heading)).toEqual(['Invoice 3', 'Invoice —'])
  })

  it('renders — for a null or unmatched propertyId', () => {
    const pages = buildInvoicePdfModel(
      [inv({ propertyId: null }), inv({ id: 'inv-2', propertyId: 'nope' })],
      addresses,
    )
    expect(pages[0].table.location).toBe('—')
    expect(pages[1].table.location).toBe('—')
  })

  it('formats amounts as en-US USD and falls back to — on invalid input', () => {
    const pages = buildInvoicePdfModel(
      [inv({ amount: '1234.5' }), inv({ id: 'inv-2', amount: 'not-a-number' })],
      addresses,
    )
    expect(pages[0].table.amount).toBe('$1,234.50')
    expect(pages[1].table.amount).toBe('—')
  })
})

describe('balanceDue', () => {
  it.each(['PENDING', 'APPROVED', 'SUBMITTED'])('%s owes the full amount', (status) => {
    expect(balanceDue({ status, amount: '55.00' })).toBe('$55.00')
  })

  it.each(['PAID', 'REJECTED', 'CANCELLED'])('%s owes $0.00', (status) => {
    expect(balanceDue({ status, amount: '55.00' })).toBe('$0.00')
  })
})

describe('pdfFileName', () => {
  it('uses the local calendar date', () => {
    // Constructed via local-time parts, so this is 23:50 local on Dec 31.
    expect(pdfFileName(new Date(2026, 11, 31, 23, 50))).toBe('invoices-2026-12-31.pdf')
  })
})

describe('generateInvoicesPdf', () => {
  beforeEach(() => {
    saveSpy.mockClear()
    textSpy.mockClear()
    autoTableSpy.mockClear()
  })

  it('does not load jspdf at module import time', () => {
    // The vi.mock factory flips this flag on first real import of 'jspdf'.
    // Importing @/lib/invoicePdf (done at the top of this file) must not.
    expect(jspdfImported.value).toBe(false)
  })

  it('renders each page and saves under the dated filename', async () => {
    await generateInvoicesPdf(
      [inv(), inv({ id: 'inv-2', invoiceNumber: '2' })],
      addresses,
      new Date(2026, 7, 5, 12, 0),
    )
    expect(jspdfImported.value).toBe(true)
    expect(autoTableSpy).toHaveBeenCalledTimes(2)
    expect(textSpy).toHaveBeenCalledWith('Balance due: $120.00', expect.any(Number), 158)
    expect(saveSpy).toHaveBeenCalledWith('invoices-2026-08-05.pdf')
  })
})
