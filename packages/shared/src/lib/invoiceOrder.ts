// Natural-order invoice comparison shared by every export surface (Sheets
// mirror, PDF export) so row/page ordering can never drift between them.

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** The minimal shape ordering needs. `invoiceDate` accepts a Date (api-side
 * Prisma rows) or an ISO string (web-side serialized list items). */
export type InvoiceOrderKey = {
  id: string
  invoiceNumber: string | null
  invoiceDate: Date | string
}

const dateMs = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d).getTime()

/**
 * Ascending by invoice number, numeric-aware ("9" < "10"; DEC-023 keeps the
 * column a string, so SQL string sort can't do this). Un-numbered invoices
 * (number is stamped on first APPROVED) sort last, tiebroken by invoice date
 * then id so their order is stable. Numbered ties can't happen — the column
 * is unique.
 */
export function compareInvoiceOrder(a: InvoiceOrderKey, b: InvoiceOrderKey): number {
  if (a.invoiceNumber != null && b.invoiceNumber != null) {
    return collator.compare(a.invoiceNumber, b.invoiceNumber)
  }
  if (a.invoiceNumber != null) return -1
  if (b.invoiceNumber != null) return 1
  const byDate = dateMs(a.invoiceDate) - dateMs(b.invoiceDate)
  if (byDate !== 0) return byDate
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
