// The email-ready summary offered after a PDF export: one line per invoice
// plus a combined total, copied to the clipboard as both rich HTML (so the
// bold/underline survive a paste into a mail client) and plain text.
//
// Fixed English and en-US formatting for the same reason as the PDF itself
// (see ./invoicePdf): it goes to a third party alongside that PDF.

import { compareInvoiceOrder } from '@mac-invoices/shared'
import type { PdfInvoiceInput } from './invoicePdf'

export type SummaryInvoiceInput = Pick<
  PdfInvoiceInput,
  'id' | 'invoiceNumber' | 'invoiceDate' | 'amount'
>

export type InvoiceSummary = {
  intro: string
  lines: { label: string; detail: string }[]
  total: string
}

const EMPTY = '—'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Dollars-and-cents string → integer cents, so the total doesn't drift. */
function toCents(amount: string): number {
  const n = parseFloat(amount)
  return Number.isNaN(n) ? 0 : Math.round(n * 100)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? EMPTY
    : d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
}

const monthName = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })

/**
 * "September-December 2025" within one year, "September 2025" for a single
 * month, and "September 2025 - January 2026" when the range crosses a year.
 * Dates are calendar dates stored at UTC midnight, so they're read in UTC.
 */
export function summaryPeriod(invoiceDates: string[]): string {
  const times = invoiceDates.map((iso) => new Date(iso).getTime()).filter((t) => !Number.isNaN(t))
  if (times.length === 0) return EMPTY
  const start = new Date(Math.min(...times))
  const end = new Date(Math.max(...times))
  const startYear = start.getUTCFullYear()
  const endYear = end.getUTCFullYear()
  if (startYear !== endYear) {
    return `${monthName(start)} ${startYear} - ${monthName(end)} ${endYear}`
  }
  if (start.getUTCMonth() === end.getUTCMonth()) return `${monthName(start)} ${startYear}`
  return `${monthName(start)}-${monthName(end)} ${startYear}`
}

/** Pure model builder; lines follow the PDF's page order. */
export function buildInvoiceSummary(invoices: SummaryInvoiceInput[]): InvoiceSummary {
  const sorted = [...invoices].sort(compareInvoiceOrder)
  const totalCents = sorted.reduce((sum, inv) => sum + toCents(inv.amount), 0)
  return {
    intro: `These are the invoices for ${summaryPeriod(sorted.map((inv) => inv.invoiceDate))}. Thank you.`,
    lines: sorted.map((inv) => ({
      label: `Invoice #${inv.invoiceNumber ?? EMPTY}`,
      detail: `${formatDate(inv.invoiceDate)} = ${money.format(toCents(inv.amount) / 100)}`,
    })),
    total: `Total: ${money.format(totalCents / 100)}`,
  }
}

export function summaryToText(s: InvoiceSummary): string {
  const lines = s.lines.map((l) => `- ${l.label}: ${l.detail}`)
  return [s.intro, ...lines, '', s.total].join('\n')
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Invoice labels bold; the total line bold and underlined. */
export function summaryToHtml(s: InvoiceSummary): string {
  const items = s.lines
    .map((l) => `<li><b>${escapeHtml(l.label)}</b>: ${escapeHtml(l.detail)}</li>`)
    .join('')
  return (
    `<p>${escapeHtml(s.intro)}</p>` +
    `<ul>${items}</ul>` +
    `<p><b><u>${escapeHtml(s.total)}</u></b></p>`
  )
}

/**
 * Copy as rich text where the browser supports it (so formatting survives the
 * paste), falling back to plain text.
 */
export async function copyInvoiceSummary(s: InvoiceSummary): Promise<void> {
  const text = summaryToText(s)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([summaryToHtml(s)], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
    return
  }
  if (!navigator.clipboard) throw new Error('clipboard unavailable')
  await navigator.clipboard.writeText(text)
}
