import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildInvoicePdfModel,
  balanceDue,
  generateInvoicesPdf,
  pdfFileName,
  type PdfInvoiceInput,
  type PdfLandlord,
} from '@/lib/invoicePdf'

// Lazy-loading spies: the factories run only when jspdf is actually imported,
// which must not happen before generateInvoicesPdf is called (R12).
const jspdfImported = vi.hoisted(() => ({ value: false }))
const saveSpy = vi.hoisted(() => vi.fn())
const textSpy = vi.hoisted(() => vi.fn())
const autoTableSpy = vi.hoisted(() => vi.fn())
const rectSpy = vi.hoisted(() => vi.fn())

vi.mock('jspdf', () => {
  jspdfImported.value = true
  class FakeJsPdf {
    internal = { pageSize: { getWidth: () => 612 } }
    addPage = vi.fn()
    setFontSize = vi.fn()
    setFont = vi.fn()
    setTextColor = vi.fn()
    setFillColor = vi.fn()
    rect = rectSpy
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

const item = (
  over: Partial<{ description: string; quantity: number; total: string; sortOrder: number }> = {},
) => ({
  description: 'Fix sink',
  quantity: 1,
  total: '120.00',
  sortOrder: 0,
  ...over,
})

const inv = (over: Partial<PdfInvoiceInput> = {}): PdfInvoiceInput => ({
  id: 'inv-1',
  invoiceNumber: '1',
  items: [item()],
  vendorName: 'Acme Plumbing',
  vendorEmail: 'acme@example.com',
  amount: '120.00',
  status: 'PENDING',
  invoiceDate: '2026-03-05T00:00:00.000Z',
  propertyId: 'prop-1',
  vendor: null,
  ...over,
})

const addresses = new Map([['prop-1', '12 Main St']])
const landlord: PdfLandlord = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }

describe('buildInvoicePdfModel', () => {
  it('builds one page per invoice with address, items, status, balance', () => {
    const pages = buildInvoicePdfModel(
      [
        inv(),
        inv({
          id: 'inv-2',
          invoiceNumber: '2',
          items: [item({ description: 'Paint', total: '80.50' })],
          amount: '80.50',
        }),
      ],
      addresses,
      landlord,
    )
    expect(pages).toHaveLength(2)
    expect(pages[0]).toMatchObject({
      heading: 'Invoice 1',
      date: 'Mar 5, 2026',
      status: 'Pending',
      location: '12 Main St',
      items: [{ description: 'Fix sink', quantity: '1', total: '$120.00' }],
      balanceDue: '$120.00',
    })
    expect(pages[1].items).toEqual([{ description: 'Paint', quantity: '1', total: '$80.50' }])
  })

  it('every page carries the same Bill-To (the landlord), regardless of which invoice', () => {
    const pages = buildInvoicePdfModel([inv({ id: 'a' }), inv({ id: 'b' })], addresses, landlord)
    expect(pages[0].billTo).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
    expect(pages[1].billTo).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('Bill-To falls back to the email when the landlord has no name set', () => {
    const pages = buildInvoicePdfModel([inv()], addresses, {
      firstName: null,
      lastName: null,
      email: 'x@example.com',
    })
    expect(pages[0].billTo.name).toBe('x@example.com')
  })

  it('prefers the linked vendor over the invoice free text', () => {
    const pages = buildInvoicePdfModel(
      [
        inv({
          vendorName: 'Typed Name',
          vendorEmail: 'typed@x.com',
          vendor: { name: 'Ace Plumbing', phone: '555-0100', email: 'ace@x.com' },
        }),
      ],
      addresses,
      landlord,
    )
    expect(pages[0].sender).toEqual({ name: 'Ace Plumbing', lines: ['ace@x.com', '555-0100'] })
  })

  it('skips a blank phone rather than emitting an empty line', () => {
    const pages = buildInvoicePdfModel(
      [inv({ vendor: { name: 'Ace', phone: null, email: 'ace@x.com' } })],
      addresses,
      landlord,
    )
    expect(pages[0].sender.lines).toEqual(['ace@x.com'])
  })

  it('emits a name-only sender when the vendor has no contact details', () => {
    const pages = buildInvoicePdfModel(
      [inv({ vendor: { name: 'Ace', phone: null, email: null } })],
      addresses,
      landlord,
    )
    expect(pages[0].sender.lines).toEqual([])
  })

  it('falls back to the invoice free text for a legacy unlinked invoice', () => {
    const pages = buildInvoicePdfModel(
      [inv({ vendorName: 'Legacy Co', vendorEmail: 'legacy@x.com', vendor: null })],
      addresses,
      landlord,
    )
    expect(pages[0].sender).toEqual({ name: 'Legacy Co', lines: ['legacy@x.com'] })
  })

  it('omits the contact line entirely when a legacy invoice has no vendor email', () => {
    const pages = buildInvoicePdfModel(
      [inv({ vendorName: 'Legacy Co', vendorEmail: null, vendor: null })],
      addresses,
      landlord,
    )
    expect(pages[0].sender.lines).toEqual([])
  })

  it('renders items in sortOrder regardless of input order', () => {
    const pages = buildInvoicePdfModel(
      [
        inv({
          items: [
            item({ description: 'Second', sortOrder: 1 }),
            item({ description: 'First', sortOrder: 0 }),
          ],
        }),
      ],
      addresses,
      landlord,
    )
    expect(pages[0].items.map((i) => i.description)).toEqual(['First', 'Second'])
  })

  it('orders pages by natural invoice-number order regardless of selection order', () => {
    const pages = buildInvoicePdfModel(
      [inv({ id: 'a', invoiceNumber: '10' }), inv({ id: 'b', invoiceNumber: '9' })],
      addresses,
      landlord,
    )
    expect(pages.map((p) => p.heading)).toEqual(['Invoice 9', 'Invoice 10'])
  })

  it('sorts un-numbered invoices last and falls back their heading to —', () => {
    const pages = buildInvoicePdfModel(
      [inv({ id: 'a', invoiceNumber: null }), inv({ id: 'b', invoiceNumber: '3' })],
      addresses,
      landlord,
    )
    expect(pages.map((p) => p.heading)).toEqual(['Invoice 3', 'Invoice —'])
  })

  it('renders — for a null or unmatched propertyId', () => {
    const pages = buildInvoicePdfModel(
      [inv({ propertyId: null }), inv({ id: 'inv-2', propertyId: 'nope' })],
      addresses,
      landlord,
    )
    expect(pages[0].location).toBe('—')
    expect(pages[1].location).toBe('—')
  })

  it('falls back to — for an unparseable invoiceDate', () => {
    const pages = buildInvoicePdfModel([inv({ invoiceDate: 'not-a-date' })], addresses, landlord)
    expect(pages[0].date).toBe('—')
  })

  it('formats item totals as en-US USD and falls back to — on invalid input', () => {
    const pages = buildInvoicePdfModel(
      [
        inv({ items: [item({ total: '1234.5' })] }),
        inv({ id: 'inv-2', items: [item({ total: 'not-a-number' })] }),
      ],
      addresses,
      landlord,
    )
    expect(pages[0].items[0].total).toBe('$1,234.50')
    expect(pages[1].items[0].total).toBe('—')
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
    rectSpy.mockClear()
  })

  it('does not load jspdf at module import time', () => {
    // The vi.mock factory flips this flag on first real import of 'jspdf'.
    // Importing @/lib/invoicePdf (done at the top of this file) must not.
    expect(jspdfImported.value).toBe(false)
  })

  it('renders each page, draws the highlighted balance box, and saves under the dated filename', async () => {
    await generateInvoicesPdf(
      [inv(), inv({ id: 'inv-2', invoiceNumber: '2' })],
      addresses,
      landlord,
      new Date(2026, 7, 5, 12, 0),
    )
    expect(jspdfImported.value).toBe(true)
    expect(autoTableSpy).toHaveBeenCalledTimes(2)
    // The balance box is drawn once per page (right-aligned green highlight).
    expect(rectSpy).toHaveBeenCalledTimes(2)
    expect(textSpy.mock.calls.some((c) => c[0] === '$120.00')).toBe(true)
    expect(saveSpy).toHaveBeenCalledWith('invoices-2026-08-05.pdf')
  })

  // The items table's startY is computed from the sender block's actual line
  // count so a taller sender can't be overlapped by a table pinned at a
  // fixed offset (Bill-To is always two lines and sets the floor).
  it('starts the table at the Bill-To floor when the sender has zero contact lines', async () => {
    await generateInvoicesPdf(
      [inv({ vendorName: 'Legacy Co', vendorEmail: null, vendor: null })],
      addresses,
      landlord,
    )
    expect(autoTableSpy.mock.calls[0][1]).toMatchObject({ startY: 184 })
  })

  it('starts the table at the same Bill-To floor when the sender has one contact line', async () => {
    await generateInvoicesPdf(
      [inv({ vendor: { name: 'Ace', phone: null, email: 'ace@x.com' } })],
      addresses,
      landlord,
    )
    expect(autoTableSpy.mock.calls[0][1]).toMatchObject({ startY: 184 })
  })

  it('starts the table below a two-line sender (email + phone)', async () => {
    await generateInvoicesPdf(
      [inv({ vendor: { name: 'Ace', phone: '555-0100', email: 'ace@x.com' } })],
      addresses,
      landlord,
    )
    expect(autoTableSpy.mock.calls[0][1]).toMatchObject({ startY: 198 })
  })
})
