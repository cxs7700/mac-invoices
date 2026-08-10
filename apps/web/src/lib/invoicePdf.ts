// Client-side multi-invoice PDF export. Split in two layers: a pure page-model
// builder (unit-testable, no jsPDF) and a render wrapper that loads jsPDF via
// dynamic import so the library stays out of the initial bundle.
//
// The PDF is a fixed-English artifact (labels and en-US formatting regardless
// of UI locale — it's handed to third parties and must not flip languages with
// the landlord's setting; jsPDF's built-in fonts are Latin-only anyway). Labels
// live in a frozen map here, not the i18n catalogs, so UI copy edits can't
// silently reword a financial document.

import { compareInvoiceOrder, formatPhone, statusTone, type StatusTone } from '@mac-invoices/shared'

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
  /** Just the number, for the template's large numeral. `heading` keeps the
   * full "Invoice 123" string for callers that want one line. */
  number: string
  date: string
  status: string
  /** The status's shared tone — the same one the app's filters use. */
  tone: StatusTone
  location: string
  // Variable-height: email and phone are each omitted when blank, so a vendor
  // with no contact details renders a name only rather than empty gaps.
  sender: { name: string; lines: string[] }
  billTo: { name: string; email: string }
  items: { description: string; quantity: string; total: string }[]
  balanceDue: string
  /** Drives the panel's colour. Derived from the number, not from parsing the
   * formatted string back out (which would depend on the currency's glyphs). */
  balanceTone: BalanceTone
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

/** The numeric balance: zero for settled/void statuses, else the amount. */
function balanceAmount(inv: Pick<PdfInvoiceInput, 'status' | 'amount'>): number {
  if (ZERO_BALANCE_STATUSES.has(inv.status)) return 0
  const n = parseFloat(inv.amount)
  return Number.isNaN(n) ? 0 : n
}

export function balanceDue(inv: Pick<PdfInvoiceInput, 'status' | 'amount'>): string {
  return ZERO_BALANCE_STATUSES.has(inv.status) ? formatPdfMoney('0') : formatPdfMoney(inv.amount)
}

export function balanceToneOf(inv: Pick<PdfInvoiceInput, 'status' | 'amount'>): BalanceTone {
  const n = balanceAmount(inv)
  if (n < 0) return 'credit'
  return n === 0 ? 'settled' : 'owing'
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

/** Sender block: the linked vendor when there is one, else the invoice's own
 * free-text vendor fields. Blank contact lines are dropped, not rendered
 * empty. Order is email then phone. */
function senderBlock(inv: PdfInvoiceInput): { name: string; lines: string[] } {
  if (inv.vendor) {
    return {
      name: inv.vendor.name,
      // Formatted here, not just trusted from the column: rows written before
      // phone normalization existed still hold whatever was typed, and this is
      // the one place a vendor's number reaches a third party.
      lines: [inv.vendor.email, formatPhone(inv.vendor.phone)].filter((s): s is string => !!s),
    }
  }
  return { name: inv.vendorName, lines: [inv.vendorEmail].filter((s): s is string => !!s) }
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
    number: inv.invoiceNumber ?? EMPTY,
    date: formatPdfDate(inv.invoiceDate),
    status: statusLabel(inv.status),
    tone: statusTone(inv.status),
    location: (inv.propertyId && addressByPropertyId.get(inv.propertyId)) || EMPTY,
    sender: senderBlock(inv),
    billTo,
    items: [...inv.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        total: formatPdfMoney(item.total),
      })),
    balanceDue: balanceDue(inv),
    balanceTone: balanceToneOf(inv),
  }))
}

const MARGIN = 44

type Rgb = [number, number, number]

/**
 * A small, fixed palette. Exported artifacts are always light (DEC-025e), so
 * these are literals rather than anything theme-derived — a PDF handed to a
 * third party must not change appearance with the landlord's dark-mode setting.
 */
const ACCENT: Rgb = [37, 99, 175] // headings, rules, table header
const ACCENT_TINT: Rgb = [237, 243, 252] // zebra rows
const INK: Rgb = [17, 24, 33] // primary text
const MUTED: Rgb = [110, 122, 138] // field labels, secondary lines
const RULE: Rgb = [226, 232, 240] // hairlines

/**
 * Balance due, keyed by what is actually owed. The green is the original — it
 * is the one figure a reader hunts for, and a colour of its own is what makes
 * it findable instead of blending into the document accent.
 *
 * - owing    green — money is outstanding, the normal case
 * - settled  grey  — nothing due; quiet, because there is nothing to act on
 * - credit   red   — a negative balance, i.e. owed back. Not reachable today
 *   (amounts are schema-bounded positive) but rendered distinctly rather than
 *   silently shown as if it were an ordinary debt.
 */
type BalanceTone = 'owing' | 'settled' | 'credit'
const BALANCE_COLORS: Record<BalanceTone, { fill: Rgb; text: Rgb }> = {
  owing: { fill: [220, 237, 200], text: [20, 90, 50] },
  settled: { fill: [238, 242, 247], text: [90, 107, 123] },
  credit: { fill: [251, 226, 226], text: [153, 27, 27] },
}

/**
 * The shared status→tone mapping, resolved to fixed RGB. These are the light
 * variants of the app's `--tone-*` custom properties: the same six tones the
 * status filters use, so a status is one idea on screen and on paper, but
 * hardcoded because an exported artifact is always light (DEC-025e).
 */
const TONE_COLORS: Record<StatusTone, { fill: Rgb; text: Rgb }> = {
  amber: { fill: [253, 240, 213], text: [161, 98, 7] },
  blue: { fill: [231, 238, 252], text: [29, 95, 176] },
  violet: { fill: [239, 233, 253], text: [109, 63, 196] },
  green: { fill: [230, 244, 236], text: [31, 138, 91] },
  red: { fill: [251, 238, 233], text: [184, 68, 42] },
  slate: { fill: [238, 242, 247], text: [90, 107, 123] },
}

// Vertical rhythm for a stacked label/value pair: the label sits above its
// value rather than sharing a line, so each field reads as its own unit.
const LABEL_TO_VALUE = 15
// Each meta field (Date, Status, Location) gets its own full-width line rather
// than sharing a row of columns — one fact per line, top to bottom.
const META_ROW = 38
const FIELD_BLOCK = 46

// Status pill geometry. `STATUS_CAP_HEIGHT` is Helvetica's cap height at the
// pill's font size (~0.72 em) — the distance from baseline to the visual top of
// the glyphs, which is what centring the text vertically actually depends on.
const STATUS_FONT_SIZE = 9.5
const STATUS_CAP_HEIGHT = STATUS_FONT_SIZE * 0.72
const STATUS_PAD_X = 10
const CHIP_HEIGHT = 18

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
  const contentWidth = pageWidth - MARGIN * 2

  /** A small caps-ish field label — the top half of a stacked label/value pair. */
  const drawLabel = (text: string, x: number, y: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.setCharSpace(1.1) // letterspacing is what makes small caps read as a label
    doc.text(text.toUpperCase(), x, y)
    doc.setCharSpace(0)
  }

  const drawValue = (text: string, x: number, y: number, opts: { bold?: boolean } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...INK)
    doc.text(text, x, y)
  }

  pages.forEach((page, i) => {
    if (i > 0) doc.addPage()

    // ---- Masthead: wordmark left, invoice number right, accent rule under.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    doc.setTextColor(...ACCENT)
    doc.setCharSpace(2)
    doc.text(PDF_LABELS.invoice.toUpperCase(), MARGIN, 68)
    doc.setCharSpace(0)

    doc.setFontSize(15)
    doc.setTextColor(...INK)
    doc.text(`#${page.number}`, pageWidth - MARGIN, 68, { align: 'right' })

    doc.setFillColor(...ACCENT)
    doc.rect(MARGIN, 80, contentWidth, 2.5, 'F')

    // ---- Meta fields: one per line, each label stacked above its value.
    const metaY = 112
    drawLabel(PDF_LABELS.date, MARGIN, metaY)
    drawValue(page.date, MARGIN, metaY + LABEL_TO_VALUE)

    const statusY = metaY + META_ROW
    drawLabel(PDF_LABELS.status, MARGIN, statusY)
    const chip = TONE_COLORS[page.tone]
    // Measure at the size the text is actually drawn at. Measuring before
    // setFontSize used the 7.5pt label metrics, so the pill came out too narrow
    // for its 9.5pt text and the label sat off-centre inside it.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(STATUS_FONT_SIZE)
    const chipWidth = doc.getTextWidth(page.status) + STATUS_PAD_X * 2
    const chipTop = statusY + LABEL_TO_VALUE - CHIP_HEIGHT / 2 - STATUS_CAP_HEIGHT / 2
    doc.setFillColor(...chip.fill)
    doc.roundedRect(MARGIN, chipTop, chipWidth, CHIP_HEIGHT, CHIP_HEIGHT / 2, CHIP_HEIGHT / 2, 'F')
    doc.setTextColor(...chip.text)
    // Centred on both axes: `align: 'center'` about the pill's mid-x, and a
    // baseline set half a cap-height below the pill's mid-y.
    doc.text(
      page.status,
      MARGIN + chipWidth / 2,
      chipTop + CHIP_HEIGHT / 2 + STATUS_CAP_HEIGHT / 2,
      {
        align: 'center',
      },
    )

    const locationY = statusY + META_ROW
    drawLabel(PDF_LABELS.location, MARGIN, locationY)
    drawValue(page.location, MARGIN, locationY + LABEL_TO_VALUE)

    // ---- Parties, same stacked treatment, separated by a hairline.
    const partiesY = locationY + FIELD_BLOCK
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.75)
    doc.line(MARGIN, partiesY - 16, pageWidth - MARGIN, partiesY - 16)

    drawLabel(PDF_LABELS.sender, MARGIN, partiesY)
    drawValue(page.sender.name, MARGIN, partiesY + LABEL_TO_VALUE, { bold: true })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...MUTED)
    page.sender.lines.forEach((line, li) => {
      doc.text(line, MARGIN, partiesY + LABEL_TO_VALUE + 14 + li * 13)
    })

    const billToX = MARGIN + contentWidth / 2
    drawLabel(PDF_LABELS.billTo, billToX, partiesY)
    drawValue(page.billTo.name, billToX, partiesY + LABEL_TO_VALUE, { bold: true })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...MUTED)
    doc.text(page.billTo.email, billToX, partiesY + LABEL_TO_VALUE + 14)

    // The sender block grows with its contact lines while Bill-To is always
    // one; start the table below whichever ran longer, or a three-line sender
    // would collide with it.
    const senderBottom = partiesY + LABEL_TO_VALUE + 14 + page.sender.lines.length * 13
    const billToBottom = partiesY + LABEL_TO_VALUE + 14
    const tableStartY = Math.max(senderBottom, billToBottom) + 28

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: MARGIN, right: MARGIN },
      head: [PDF_ITEMS_COLUMNS.map((c) => c.label)],
      body: page.items.map((item) => [item.description, item.quantity, item.total]),
      // 'grid' boxes every cell; the lighter treatment lets the type carry the
      // structure and keeps the page from reading as a spreadsheet.
      theme: 'striped',
      styles: { fontSize: 10, cellPadding: 8, textColor: INK, lineColor: RULE, lineWidth: 0.5 },
      headStyles: {
        fillColor: ACCENT,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        cellPadding: { top: 7, bottom: 7, left: 8, right: 8 },
      },
      alternateRowStyles: { fillColor: ACCENT_TINT },
      columnStyles: {
        1: { halign: 'right', cellWidth: 55 },
        2: { halign: 'right', cellWidth: 95 },
      },
    })
    // autotable leaves the cursor on the table's last (possibly continuation)
    // page and records where it ended.
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      tableStartY + 40

    // ---- Balance due: the one figure a reader is looking for.
    const boxWidth = 220
    const boxHeight = 40
    const boxX = pageWidth - MARGIN - boxWidth
    const boxY = finalY + 20
    const balance = BALANCE_COLORS[page.balanceTone]
    doc.setFillColor(...balance.fill)
    doc.rect(boxX, boxY, boxWidth, boxHeight, 'F')
    doc.setFillColor(...balance.text)
    doc.rect(boxX, boxY, 3, boxHeight, 'F') // spine, in the same green family

    // The label takes the green too, so the panel reads as one unit rather than
    // a green box with a grey caption.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...balance.text)
    doc.setCharSpace(1.1)
    doc.text(PDF_LABELS.balanceDue.toUpperCase(), boxX + 14, boxY + 15)
    doc.setCharSpace(0)

    doc.setFontSize(15)
    doc.text(page.balanceDue, pageWidth - MARGIN - 14, boxY + 31, { align: 'right' })

    // Leave the graphics state neutral for the next page.
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'normal')
  })
  doc.save(pdfFileName(now))
}
