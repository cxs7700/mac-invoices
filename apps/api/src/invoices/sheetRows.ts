// Single source of truth for the Google Sheets row shape — shared by the manual
// "Sync now" handler and the continuous-sync cron mirror so the two can never
// drift. Pure (no DB / no Google client) and trivially unit-testable.

import { InvoiceCategory, InvoiceStatus } from '@mac-invoices/shared'
import { SheetFormula, type ColumnDropdownSpec, type SheetCell } from '../integrations/sheetCells'

// The operator's ledger layout (DEC-025). `id` and `vendorName` are
// internal-only and never exported; `invoiceLink` stays LAST. The mirror writes
// these as a header row (row 1), then one data row per invoice; the operator
// never maintains the header by hand (a full-mirror clear+rewrite would wipe
// it — KTD continuous-sync).
export const EXPORT_COLUMNS = [
  'invoiceNumber',
  'invoiceDate',
  'description',
  'propertyAddress',
  'amount',
  'category',
  'status',
  'notes',
  'partsOrdered',
  'invoiceLink',
] as const

/** Human-friendly labels for the header row. Keys stay the internal column
 * names; only the displayed text changes. */
const COLUMN_LABELS: Record<(typeof EXPORT_COLUMNS)[number], string> = {
  invoiceNumber: 'Invoice #',
  invoiceDate: 'Date',
  description: 'Description',
  propertyAddress: 'Property',
  amount: 'Amount',
  category: 'Category',
  status: 'Status',
  notes: 'Notes',
  partsOrdered: 'Parts Ordered',
  invoiceLink: 'Invoice Link',
}

/** The header row written as row 1 of every full mirror. */
export const EXPORT_HEADER: string[] = EXPORT_COLUMNS.map((c) => COLUMN_LABELS[c])

// Only real spend mirrors to the accounting sheet (KTD-9): SUBMITTED (un-vetted),
// REJECTED (declined) and CANCELLED (withdrawn) are never exported. A later
// approval re-qualifies the row and assigns its number.
export const NON_EXPORTABLE_STATUSES = ['SUBMITTED', 'REJECTED', 'CANCELLED'] as const

/** The statuses that can appear in the sheet — also the Status dropdown list. */
export const EXPORTABLE_STATUSES = InvoiceStatus.options.filter(
  (s) => !(NON_EXPORTABLE_STATUSES as readonly string[]).includes(s),
)

// Natural-order text comparison ("9" < "10") for invoice numbers and option lists.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The app's invoice-detail URL — the gallery page with fresh signed photo URLs.
 * A direct blob link would be useless in a sheet (private store, 15-min expiry);
 * this link never expires and stays behind the login. WEB_ORIGIN fallback matches
 * the digest/contractor-link convention. Rendered as a HYPERLINK formula so the
 * cell shows "Link" instead of the raw URL; the embedded quote-escape keeps the
 * formula well-formed no matter what WEB_ORIGIN holds. */
const invoiceLink = (id: string) => {
  const url = `${process.env.WEB_ORIGIN ?? 'http://localhost:5173'}/invoices/${id}`
  return new SheetFormula(`=HYPERLINK("${url.replace(/"/g, '""')}", "Link")`)
}

/** The minimal invoice shape a row needs (amount kept as the Prisma Decimal so
 * money never round-trips through a JS float before the cell). `id` still rides
 * along for the invoiceLink URL even though it is no longer a column. */
export type InvoiceRowInput = {
  id: string
  invoiceNumber: string | null
  amount: { toNumber: () => number }
  status: string
  invoiceDate: Date
  category: string | null
  description: string
  notes: string | null
  partsOrdered: string | null
  property: { address: string } | null
}

/**
 * Sheet row order: ascending by invoice number, numeric-aware ("9" < "10";
 * DEC-023 keeps the column a string, so SQL string sort can't do this).
 * Un-numbered invoices (number is stamped on first APPROVED) sort last,
 * tiebroken by invoice date then id so their order is stable. Numbered ties
 * can't happen — the column is unique.
 */
export function compareForExport(
  a: Pick<InvoiceRowInput, 'id' | 'invoiceNumber' | 'invoiceDate'>,
  b: Pick<InvoiceRowInput, 'id' | 'invoiceNumber' | 'invoiceDate'>,
): number {
  if (a.invoiceNumber != null && b.invoiceNumber != null) {
    return collator.compare(a.invoiceNumber, b.invoiceNumber)
  }
  if (a.invoiceNumber != null) return -1
  if (b.invoiceNumber != null) return 1
  const byDate = a.invoiceDate.getTime() - b.invoiceDate.getTime()
  if (byDate !== 0) return byDate
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const columnIndex = (c: (typeof EXPORT_COLUMNS)[number]) => EXPORT_COLUMNS.indexOf(c)

/**
 * The dropdown (data-validation) specs for a mirror pass. Status/Category come
 * from the shared enums; Property options are the landlord's addresses —
 * trimmed, empties dropped, deduped, natural-sorted — rebuilt every sync so the
 * list tracks the properties table. Column indices derive from EXPORT_COLUMNS,
 * so the specs can never drift from the layout.
 */
export function dropdownSpecs(propertyAddresses: string[]): ColumnDropdownSpec[] {
  const properties = [
    ...new Set(propertyAddresses.map((a) => a.trim()).filter((a) => a !== '')),
  ].sort((a, b) => collator.compare(a, b))
  return [
    { columnIndex: columnIndex('status'), values: [...EXPORTABLE_STATUSES] },
    { columnIndex: columnIndex('category'), values: [...InvoiceCategory.options] },
    { columnIndex: columnIndex('propertyAddress'), values: properties },
  ]
}

/** Map one invoice to a sheet row in `EXPORT_COLUMNS` order. */
export function invoiceToRow(inv: InvoiceRowInput): SheetCell[] {
  const cell: Record<(typeof EXPORT_COLUMNS)[number], SheetCell> = {
    invoiceNumber: inv.invoiceNumber ?? '',
    invoiceDate: ymd(inv.invoiceDate),
    description: inv.description,
    propertyAddress: inv.property?.address ?? '',
    amount: inv.amount.toNumber(),
    category: inv.category ?? '',
    status: inv.status,
    notes: inv.notes ?? '',
    partsOrdered: inv.partsOrdered ?? '',
    invoiceLink: invoiceLink(inv.id),
  }
  return EXPORT_COLUMNS.map((c) => cell[c])
}
