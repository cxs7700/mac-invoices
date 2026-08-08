// A single-string summary of an invoice's line items, used wherever a
// one-cell/one-line description is needed (the invoices table's job column,
// the Sheets export's Description column) now that `description` is no
// longer a column on the invoice itself.

const DEFAULT_MAX = 3

/** The minimal shape summarization needs, in display order. */
export type SummarizableItem = { description: string; sortOrder?: number }

/**
 * "Ceiling drywall" for one item; "Ceiling drywall +2 more" for several.
 * `max` controls how many descriptions are spelled out before collapsing the
 * rest into a "+N more" suffix (default 1 — a single-line summary).
 */
export function summarizeItems(items: readonly SummarizableItem[], max = DEFAULT_MAX): string {
  if (items.length === 0) return ''
  const ordered =
    items[0]?.sortOrder !== undefined
      ? [...items].sort((a, b) => a.sortOrder! - b.sortOrder!)
      : items
  const shown = ordered.slice(0, max).map((i) => i.description)
  const rest = ordered.length - shown.length
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ')
}
