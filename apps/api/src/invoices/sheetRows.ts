// Single source of truth for the Google Sheets row shape — shared by the manual
// "Sync now" handler and the continuous-sync cron mirror so the two can never
// drift. Pure (no DB / no Google client) and trivially unit-testable.

// The §8 column order. The mirror writes these names as a header row (row 1),
// then one data row per invoice; the operator no longer maintains the header by
// hand (a full-mirror clear+rewrite would wipe it — KTD continuous-sync).
export const EXPORT_COLUMNS = [
  'id',
  'invoiceNumber',
  'vendorName',
  'amount',
  'status',
  'invoiceDate',
  'category',
  'description',
  'propertyAddress',
  'partsOrdered',
  // Keep invoiceLink LAST: existing consumers address cells positionally.
  'invoiceLink',
] as const

/** The header row written as row 1 of every full mirror. */
export const EXPORT_HEADER: string[] = [...EXPORT_COLUMNS]

// Only real spend mirrors to the accounting sheet (KTD-9): SUBMITTED (un-vetted),
// REJECTED (declined) and CANCELLED (withdrawn) are never exported. A later
// approval re-qualifies the row and assigns its number.
export const NON_EXPORTABLE_STATUSES = ['SUBMITTED', 'REJECTED', 'CANCELLED'] as const

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The app's invoice-detail URL — the gallery page with fresh signed photo URLs.
 * A direct blob link would be useless in a sheet (private store, 15-min expiry);
 * this link never expires and stays behind the login. WEB_ORIGIN fallback matches
 * the digest/contractor-link convention. */
const invoiceLink = (id: string) =>
  `${process.env.WEB_ORIGIN ?? 'http://localhost:5173'}/invoices/${id}`

/** The minimal invoice shape a row needs (amount kept as the Prisma Decimal so
 * money never round-trips through a JS float before the cell). */
export type InvoiceRowInput = {
  id: string
  invoiceNumber: string | null
  vendorName: string
  amount: { toNumber: () => number }
  status: string
  invoiceDate: Date
  category: string | null
  description: string
  partsOrdered: string | null
  property: { address: string } | null
}

/** Map one invoice to a sheet row in `EXPORT_COLUMNS` order. */
export function invoiceToRow(inv: InvoiceRowInput): (string | number)[] {
  const cell: Record<(typeof EXPORT_COLUMNS)[number], string | number> = {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? '',
    vendorName: inv.vendorName,
    amount: inv.amount.toNumber(),
    status: inv.status,
    invoiceDate: ymd(inv.invoiceDate),
    category: inv.category ?? '',
    description: inv.description,
    propertyAddress: inv.property?.address ?? '',
    partsOrdered: inv.partsOrdered ?? '',
    invoiceLink: invoiceLink(inv.id),
  }
  return EXPORT_COLUMNS.map((c) => cell[c])
}
