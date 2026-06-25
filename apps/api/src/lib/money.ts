/**
 * Format a Prisma Decimal (or null) as a Decimal-safe 2dp string for the API.
 * Null/absent sums (e.g. an aggregate over zero rows) render as "0.00".
 */
export function money(d: { toFixed: (n: number) => string } | null): string {
  return d ? d.toFixed(2) : '0.00'
}
