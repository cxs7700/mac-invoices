// Client-side multi-invoice PDF export. Split in two layers: a pure page-model
// builder (unit-testable, no jsPDF) and a render wrapper that loads jsPDF via
// dynamic import so the library stays out of the initial bundle.
//
// The PDF is a fixed-English artifact (labels and en-US formatting regardless
// of UI locale — it's handed to third parties and must not flip languages with
// the landlord's setting; jsPDF's built-in fonts are Latin-only anyway). Labels
// live in a frozen map here, not the i18n catalogs, so UI copy edits can't
// silently reword a financial document.

import { compareInvoiceOrder } from '@mac-invoices/shared'

/** The fields a PDF page needs — a subset of the invoice list row. */
export type PdfInvoiceInput = {
  id: string
  invoiceNumber: string | null
  description: string
  amount: string
  status: string
  invoiceDate: string
  propertyId: string | null
}

/** One rendered page per invoice; long table cells may spill to a
 * continuation page (autotable paginates; no data is truncated). */
export type InvoicePdfPage = {
  heading: string
  date: string
  status: string
  table: { location: string; description: string; amount: string }
  balanceDue: string
}

/** Single source of truth for the per-page table layout — the future
 * sender/recipient sections extend this module, not call sites. */
export const PDF_TABLE_COLUMNS = [
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount' },
] as const

const PDF_LABELS = {
  invoice: 'Invoice',
  date: 'Date',
  status: 'Status',
  balanceDue: 'Balance due',
} as const

const EMPTY = '—'

// Statuses that owe nothing: PAID is settled; REJECTED/CANCELLED are "not real
// spend" (same rationale as the Sheets NON_EXPORTABLE_STATUSES). SUBMITTED
// keeps its full amount — an un-vetted but live claim the user chose to include.
const ZERO_BALANCE_STATUSES = new Set(['PAID', 'REJECTED', 'CANCELLED'])

// en-US formatters, deliberately not the locale-bound helpers in ./format.
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function formatPdfMoney(amount: string): string {
  const n = parseFloat(amount)
  return Number.isNaN(n) ? EMPTY : money.format(n)
}

function formatPdfDate(iso: string): string {
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

/** "PENDING" → "Pending" — enum values are already English words. */
function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

export function balanceDue(inv: Pick<PdfInvoiceInput, 'status' | 'amount'>): string {
  return ZERO_BALANCE_STATUSES.has(inv.status) ? formatPdfMoney('0') : formatPdfMoney(inv.amount)
}

/** Filename uses the local calendar date — an export at 23:50 shouldn't be
 * stamped "tomorrow" the way toISOString()'s UTC date would. */
export function pdfFileName(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `invoices-${y}-${m}-${d}.pdf`
}

/**
 * Pure page-model builder: selected rows + property-address lookup → ordered
 * page descriptions. Pages sort by the shared natural-order rule so the PDF
 * and the Sheets mirror can never disagree on ordering.
 */
export function buildInvoicePdfModel(
  invoices: PdfInvoiceInput[],
  addressByPropertyId: ReadonlyMap<string, string>,
): InvoicePdfPage[] {
  return [...invoices].sort(compareInvoiceOrder).map((inv) => ({
    heading: `${PDF_LABELS.invoice} ${inv.invoiceNumber ?? EMPTY}`,
    date: formatPdfDate(inv.invoiceDate),
    status: statusLabel(inv.status),
    table: {
      location: (inv.propertyId && addressByPropertyId.get(inv.propertyId)) || EMPTY,
      description: inv.description,
      amount: formatPdfMoney(inv.amount),
    },
    balanceDue: balanceDue(inv),
  }))
}

const MARGIN = 40

/**
 * Render and download the PDF. jsPDF and the autotable plugin load here, at
 * call time — keep these imports dynamic (R12: not in the initial bundle).
 */
export async function generateInvoicesPdf(
  invoices: PdfInvoiceInput[],
  addressByPropertyId: ReadonlyMap<string, string>,
  now: Date = new Date(),
): Promise<void> {
  const pages = buildInvoicePdfModel(invoices, addressByPropertyId)
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage()
    doc.setFontSize(16)
    doc.text(page.heading, MARGIN, 50)
    doc.setFontSize(10)
    doc.text(`${PDF_LABELS.date}: ${page.date}`, MARGIN, 70)
    doc.text(`${PDF_LABELS.status}: ${page.status}`, MARGIN, 84)
    autoTable(doc, {
      startY: 100,
      margin: { left: MARGIN, right: MARGIN },
      head: [PDF_TABLE_COLUMNS.map((c) => c.label)],
      body: [[page.table.location, page.table.description, page.table.amount]],
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 6 },
      // Explicit light colors: exported artifacts are always light (DEC-025e).
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
    })
    // autotable leaves the cursor on the table's last (possibly continuation)
    // page and records where it ended.
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 140
    doc.setFontSize(12)
    doc.text(`${PDF_LABELS.balanceDue}: ${page.balanceDue}`, MARGIN, finalY + 28)
  })
  doc.save(pdfFileName(now))
}
