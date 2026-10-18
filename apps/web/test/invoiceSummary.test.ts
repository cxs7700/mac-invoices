import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildInvoiceSummary,
  copyInvoiceSummary,
  summaryPeriod,
  summaryToHtml,
  summaryToText,
  type SummaryInvoiceInput,
} from '@/lib/invoiceSummary'

const inv = (over: Partial<SummaryInvoiceInput> = {}): SummaryInvoiceInput => ({
  id: 'inv-1',
  invoiceNumber: '101',
  invoiceDate: '2025-09-05T00:00:00.000Z',
  amount: '120.00',
  ...over,
})

describe('summaryPeriod', () => {
  it('collapses a single month', () => {
    expect(summaryPeriod(['2025-09-05T00:00:00Z', '2025-09-28T00:00:00Z'])).toBe('September 2025')
  })

  it('uses a month range within one year', () => {
    expect(summaryPeriod(['2025-12-01T00:00:00Z', '2025-09-05T00:00:00Z'])).toBe(
      'September-December 2025',
    )
  })

  it('spells out both years when the range crosses a year', () => {
    expect(summaryPeriod(['2026-01-03T00:00:00Z', '2025-09-05T00:00:00Z'])).toBe(
      'September 2025 - January 2026',
    )
  })

  it('reads dates in UTC so a midnight date does not slip a month', () => {
    expect(summaryPeriod(['2025-10-01T00:00:00Z'])).toBe('October 2025')
  })
})

describe('buildInvoiceSummary', () => {
  const summary = buildInvoiceSummary([
    inv({ id: 'b', invoiceNumber: '10', invoiceDate: '2025-11-02T00:00:00Z', amount: '0.20' }),
    inv({ id: 'a', invoiceNumber: '9', invoiceDate: '2025-09-05T00:00:00Z', amount: '1250.10' }),
  ])

  it('orders lines like the PDF and sums to the cent', () => {
    expect(summary).toEqual({
      intro: 'These are the invoices for September-November 2025. Thank you.',
      lines: [
        { label: 'Invoice #9', detail: 'Sep 5, 2025 = $1,250.10' },
        { label: 'Invoice #10', detail: 'Nov 2, 2025 = $0.20' },
      ],
      total: 'Total: $1,250.30',
    })
  })

  it('renders plain text in the email template shape', () => {
    expect(summaryToText(summary)).toBe(
      [
        'These are the invoices for September-November 2025. Thank you.',
        '- Invoice #9: Sep 5, 2025 = $1,250.10',
        '- Invoice #10: Nov 2, 2025 = $0.20',
        '',
        'Total: $1,250.30',
      ].join('\n'),
    )
  })

  it('bolds invoice labels and bolds + underlines the total in HTML', () => {
    const html = summaryToHtml(summary)
    expect(html).toContain('<li><b>Invoice #9</b>: Sep 5, 2025 = $1,250.10</li>')
    expect(html).toContain('<p><b><u>Total: $1,250.30</u></b></p>')
  })

  it('escapes invoice numbers in HTML', () => {
    const html = summaryToHtml(buildInvoiceSummary([inv({ invoiceNumber: '<i>1</i>' })]))
    expect(html).toContain('<b>Invoice #&lt;i&gt;1&lt;/i&gt;</b>')
  })
})

describe('copyInvoiceSummary', () => {
  afterEach(() => vi.unstubAllGlobals())
  const summary = buildInvoiceSummary([inv()])

  it('writes HTML and plain text when ClipboardItem is supported', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    class FakeItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeItem)
    vi.stubGlobal('navigator', { clipboard: { write } })
    await copyInvoiceSummary(summary)
    const item = write.mock.calls[0][0][0] as FakeItem
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain'])
    expect(item.items['text/html'].type).toBe('text/html')
    expect(item.items['text/plain'].size).toBe(summaryToText(summary).length)
  })

  it('falls back to plain text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyInvoiceSummary(summary)
    expect(writeText).toHaveBeenCalledWith(summaryToText(summary))
  })
})
