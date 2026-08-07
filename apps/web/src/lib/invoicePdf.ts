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

/** One itemized line, as the PDF needs it. */
export type PdfInvoiceItem = {
  description: string
  quantity: number
  total: string
  sortOrder: number
}

/** The fields a PDF page needs — a subset of the invoice list row. */
export type PdfInvoiceInput = {
  id: string
  invoiceNumber: string | null
  items: PdfInvoiceItem[]
  vendorName: string
  vendorEmail: string | null
  amount: string
  status: string
  invoiceDate: string
  propertyId: string | null
  // The attribution vendor — "who this invoice is from" — the PDF Sender
  // section. Null only when no vendor could be resolved, which falls back to
  // vendorName/vendorEmail (the closest "who this is from" data available).
  vendor: { name: string; phone: string | null; email: string | null } | null
}

/** The landlord's identity for the Bill-To section — the same block on every
 * page (the recipient is always the landlord, regardless of which invoice). */
export type PdfLandlord = { firstName: string | null; lastName: string | null; email: string }

/** One rendered page per invoice; long table cells may spill to a
 * continuation page (autotable paginates; no data is truncated). */
export type InvoicePdfPage = {
  heading: string
  date: string
  status: string
  location: string
  sender: { name: string; contact: string }
  billTo: { name: string; email: string }
  items: { description: string; quantity: string; total: string }[]
  balanceDue: string
}

/** Single source of truth for the per-page items table layout. Matches the
 * item's stored fields exactly (description/quantity/total) — there is no
 * unit-price column since the data model doesn't carry one. */
const PDF_ITEMS_COLUMNS = [
  { key: 'description', label: 'Description' },
  { key: 'quantity', label: 'Qty' },
  { key: 'total', label: 'Total' },
] as const

const PDF_LABELS = {
  invoice: 'Invoice',
  date: 'Date',
  status: 'Status',
  location: 'Location',
  sender: 'Sender',
  billTo: 'Bill To',
  balanceDue: 'Balance Due',
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

/** "Jane Doe" from parts, falling back to the email when both names are unset
 * (a landlord who hasn't filled in their profile yet). */
function landlordName(landlord: PdfLandlord): string {
  const joined = [landlord.firstName, landlord.lastName].filter(Boolean).join(' ')
  return joined || landlord.email
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
 * Pure page-model builder: selected rows + property-address lookup + the
 * landlord's identity → ordered page descriptions. Pages sort by the shared
 * natural-order rule so the PDF and the Sheets mirror can never disagree on
 * ordering. The Bill-To block is the same landlord on every page (the
 * recipient is always the landlord); Sender is per-invoice (the attribution
 * vendor, or the invoice's own vendorName/vendorEmail when there isn't one).
 */
export function buildInvoicePdfModel(
  invoices: PdfInvoiceInput[],
  addressByPropertyId: ReadonlyMap<string, string>,
  landlord: PdfLandlord,
): InvoicePdfPage[] {
  const billTo = { name: landlordName(landlord), email: landlord.email }
  return [...invoices].sort(compareInvoiceOrder).map((inv) => ({
    heading: `${PDF_LABELS.invoice} ${inv.invoiceNumber ?? EMPTY}`,
    date: formatPdfDate(inv.invoiceDate),
    status: statusLabel(inv.status),
    location: (inv.propertyId && addressByPropertyId.get(inv.propertyId)) || EMPTY,
    sender: inv.vendor
      ? {
          name: inv.vendor.name,
          contact: [inv.vendor.phone, inv.vendor.email].filter(Boolean).join(' · ') || EMPTY,
        }
      : { name: inv.vendorName, contact: inv.vendorEmail ?? EMPTY },
    billTo,
    items: [...inv.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        total: formatPdfMoney(item.total),
      })),
    balanceDue: balanceDue(inv),
  }))
}

const MARGIN = 40
// Balance-due highlight: a light green fill behind the right-aligned amount.
const BALANCE_FILL: [number, number, number] = [220, 237, 200]
const BALANCE_TEXT: [number, number, number] = [20, 90, 50]

/**
 * Render and download the PDF. jsPDF and the autotable plugin load here, at
 * call time — keep these imports dynamic (R12: not in the initial bundle).
 */
export async function generateInvoicesPdf(
  invoices: PdfInvoiceInput[],
  addressByPropertyId: ReadonlyMap<string, string>,
  landlord: PdfLandlord,
  now: Date = new Date(),
): Promise<void> {
  const pages = buildInvoicePdfModel(invoices, addressByPropertyId, landlord)
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage()
    doc.setFontSize(16)
    doc.text(page.heading, MARGIN, 50)
    doc.setFontSize(10)
    doc.text(`${PDF_LABELS.date}: ${page.date}`, MARGIN, 70)
    doc.text(`${PDF_LABELS.status}: ${page.status}`, MARGIN, 84)
    doc.text(`${PDF_LABELS.location}: ${page.location}`, MARGIN, 98)

    // Sender (left) / Bill To (right) header blocks.
    const senderY = 122
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(PDF_LABELS.sender, MARGIN, senderY)
    doc.text(PDF_LABELS.billTo, pageWidth / 2, senderY)
    doc.setFont('helvetica', 'normal')
    doc.text(page.sender.name, MARGIN, senderY + 14)
    doc.text(page.sender.contact, MARGIN, senderY + 28)
    doc.text(page.billTo.name, pageWidth / 2, senderY + 14)
    doc.text(page.billTo.email, pageWidth / 2, senderY + 28)

    autoTable(doc, {
      startY: senderY + 48,
      margin: { left: MARGIN, right: MARGIN },
      head: [PDF_ITEMS_COLUMNS.map((c) => c.label)],
      body: page.items.map((item) => [item.description, item.quantity, item.total]),
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 6 },
      // Explicit light colors: exported artifacts are always light (DEC-025e).
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    })
    // autotable leaves the cursor on the table's last (possibly continuation)
    // page and records where it ended.
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      senderY + 88

    // Balance due: right-aligned, highlighted in green.
    const boxWidth = 180
    const boxHeight = 26
    const boxX = pageWidth - MARGIN - boxWidth
    const boxY = finalY + 16
    doc.setFillColor(...BALANCE_FILL)
    doc.rect(boxX, boxY, boxWidth, boxHeight, 'F')
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BALANCE_TEXT)
    doc.text(PDF_LABELS.balanceDue, boxX + 10, boxY + boxHeight / 2 + 4)
    doc.text(page.balanceDue, pageWidth - MARGIN - 10, boxY + boxHeight / 2 + 4, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'normal')
  })
  doc.save(pdfFileName(now))
}
