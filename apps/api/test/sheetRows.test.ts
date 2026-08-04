import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  EXPORT_COLUMNS,
  EXPORT_HEADER,
  EXPORTABLE_STATUSES,
  compareForExport,
  dropdownSpecs,
  invoiceToRow,
} from '../src/invoices/sheetRows'
import type { InvoiceRowInput } from '../src/invoices/sheetRows'
import { SheetFormula } from '../src/integrations/sheetCells'

const inv: InvoiceRowInput = {
  id: 'inv_link_1',
  invoiceNumber: '160',
  amount: { toNumber: () => 1000 },
  status: 'PENDING',
  invoiceDate: new Date('2026-08-03T00:00:00Z'),
  category: 'REPAIRS',
  description: 'Repair entire building',
  notes: null,
  partsOrdered: null,
  property: null,
}

describe('export layout', () => {
  it('labels every column with the ledger header in EXPORT_COLUMNS order', () => {
    expect(EXPORT_HEADER).toEqual([
      'Invoice #',
      'Date',
      'Description',
      'Property',
      'Amount',
      'Category',
      'Status',
      'Notes',
      'Parts Ordered',
      'Invoice Link',
    ])
  })

  it('no longer exports the internal id or vendor columns', () => {
    expect(EXPORT_COLUMNS).not.toContain('id')
    expect(EXPORT_COLUMNS).not.toContain('vendorName')
  })

  it('keeps invoiceLink as the LAST column', () => {
    expect(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1]).toBe('invoiceLink')
    expect(EXPORT_HEADER[EXPORT_HEADER.length - 1]).toBe('Invoice Link')
  })

  it('places each field at its new index', () => {
    const row = invoiceToRow({ ...inv, notes: 'call first', partsOrdered: 'PVC elbow' })
    expect(row[0]).toBe('160') // invoiceNumber
    expect(row[1]).toBe('2026-08-03') // invoiceDate
    expect(row[2]).toBe('Repair entire building') // description
    expect(row[3]).toBe('') // propertyAddress (none assigned)
    expect(row[4]).toBe(1000) // amount
    expect(row[5]).toBe('REPAIRS') // category
    expect(row[6]).toBe('PENDING') // status
    expect(row[7]).toBe('call first') // notes
    expect(row[8]).toBe('PVC elbow') // partsOrdered
  })

  it('renders null notes/category/partsOrdered/number as empty strings', () => {
    const row = invoiceToRow({ ...inv, invoiceNumber: null, category: null })
    expect(row[0]).toBe('')
    expect(row[5]).toBe('')
    expect(row[7]).toBe('')
    expect(row[8]).toBe('')
  })

  it('passes note text through untouched — neutralization happens downstream, newlines survive', () => {
    const row = invoiceToRow({ ...inv, notes: '- fix sink\n=SUM(A1)' })
    // sheetRows stays pure; sheets.safeCell neutralizes the leading dash at write time.
    expect(row[7]).toBe('- fix sink\n=SUM(A1)')
  })
})

describe('invoiceLink column', () => {
  const savedOrigin = process.env.WEB_ORIGIN
  beforeEach(() => {
    delete process.env.WEB_ORIGIN
  })
  afterEach(() => {
    if (savedOrigin === undefined) delete process.env.WEB_ORIGIN
    else process.env.WEB_ORIGIN = savedOrigin
  })

  it('is a HYPERLINK formula showing "Link" that targets the detail page under WEB_ORIGIN', () => {
    process.env.WEB_ORIGIN = 'https://app.example'
    const row = invoiceToRow(inv)
    expect(row[row.length - 1]).toEqual(
      new SheetFormula('=HYPERLINK("https://app.example/invoices/inv_link_1", "Link")'),
    )
  })

  it('falls back to the localhost dev origin when WEB_ORIGIN is unset (codebase convention)', () => {
    const row = invoiceToRow(inv)
    expect(row[row.length - 1]).toEqual(
      new SheetFormula('=HYPERLINK("http://localhost:5173/invoices/inv_link_1", "Link")'),
    )
  })

  it('escapes double quotes from WEB_ORIGIN so the formula stays well-formed', () => {
    process.env.WEB_ORIGIN = 'https://app.example/"x'
    const row = invoiceToRow(inv)
    expect((row[row.length - 1] as SheetFormula).formula).toBe(
      '=HYPERLINK("https://app.example/""x/invoices/inv_link_1", "Link")',
    )
  })
})

describe('compareForExport (invoice-number ledger order)', () => {
  const at = (n: string | null, date = '2026-01-01', id = 'a') => ({
    id,
    invoiceNumber: n,
    invoiceDate: new Date(`${date}T00:00:00Z`),
  })

  it('sorts numerically, not lexicographically ("9" < "10")', () => {
    expect(compareForExport(at('9'), at('10'))).toBeLessThan(0)
    expect(compareForExport(at('10'), at('9'))).toBeGreaterThan(0)
  })

  it('orders a shuffled list "2" < "9" < "10"', () => {
    const sorted = [at('10'), at('2'), at('9')].sort(compareForExport)
    expect(sorted.map((i) => i.invoiceNumber)).toEqual(['2', '9', '10'])
  })

  it('handles mixed alphanumeric numbers deterministically', () => {
    const forward = [at('A-102'), at('12')].sort(compareForExport)
    const backward = [at('12'), at('A-102')].sort(compareForExport)
    expect(forward.map((i) => i.invoiceNumber)).toEqual(backward.map((i) => i.invoiceNumber))
  })

  it('sorts un-numbered invoices last', () => {
    const sorted = [at(null, '2020-01-01'), at('7')].sort(compareForExport)
    expect(sorted.map((i) => i.invoiceNumber)).toEqual(['7', null])
  })

  it('orders the un-numbered group by invoice date, then id', () => {
    const sorted = [
      at(null, '2026-03-01', 'z'),
      at(null, '2026-02-01', 'b'),
      at(null, '2026-03-01', 'a'),
    ].sort(compareForExport)
    expect(sorted.map((i) => `${i.invoiceDate.toISOString().slice(0, 10)}/${i.id}`)).toEqual([
      '2026-02-01/b',
      '2026-03-01/a',
      '2026-03-01/z',
    ])
  })
})

describe('dropdownSpecs', () => {
  it('status spec offers exactly the exportable statuses at the status column index', () => {
    const spec = dropdownSpecs([]).find((s) => s.columnIndex === EXPORT_COLUMNS.indexOf('status'))
    expect(spec?.values).toEqual(['PENDING', 'APPROVED', 'PAID'])
    expect(EXPORTABLE_STATUSES).toEqual(['PENDING', 'APPROVED', 'PAID'])
  })

  it('category spec offers the six categories at the category column index', () => {
    const spec = dropdownSpecs([]).find(
      (s) => s.columnIndex === EXPORT_COLUMNS.indexOf('category'),
    )
    expect(spec?.values).toEqual([
      'MAINTENANCE',
      'REPAIRS',
      'UTILITIES',
      'SUPPLIES',
      'LABOR',
      'OTHER',
    ])
  })

  it('property spec trims, drops empties, dedupes, and natural-sorts the addresses', () => {
    const spec = dropdownSpecs([
      ' 12 Main St ',
      '12 Main St',
      '',
      '   ',
      '9 Oak Ave',
      '10 Oak Ave',
    ]).find((s) => s.columnIndex === EXPORT_COLUMNS.indexOf('propertyAddress'))
    expect(spec?.values).toEqual(['9 Oak Ave', '10 Oak Ave', '12 Main St'])
  })

  it('a landlord with zero properties yields an empty property values list', () => {
    const spec = dropdownSpecs([]).find(
      (s) => s.columnIndex === EXPORT_COLUMNS.indexOf('propertyAddress'),
    )
    expect(spec?.values).toEqual([])
  })

  it('every spec column index points at the intended EXPORT_COLUMNS position', () => {
    const indices = dropdownSpecs([]).map((s) => s.columnIndex)
    expect(indices).toEqual([
      EXPORT_COLUMNS.indexOf('status'),
      EXPORT_COLUMNS.indexOf('category'),
      EXPORT_COLUMNS.indexOf('propertyAddress'),
    ])
    expect(indices.every((i) => i >= 0)).toBe(true)
  })
})
