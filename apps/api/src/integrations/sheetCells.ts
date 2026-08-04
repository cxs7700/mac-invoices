// Plain types shared between the pure row/spec builders (sheetRows.ts) and the
// googleapis-backed writer (sheets.ts). Lives apart from sheets.ts so the pure
// side never imports googleapis.

/** A cell whose string is a formula the SERVER constructed (never user text).
 * safeCell writes it through verbatim instead of neutralizing the leading `=`;
 * any user-influenced value inside it must be escaped by the constructor site. */
export class SheetFormula {
  constructor(readonly formula: string) {}
}

export type SheetCell = string | number | SheetFormula

/** A dropdown (data-validation) spec for one sheet column: the 0-based column
 * index and the allowed values. Built by the pure layout side (sheetRows.ts)
 * so option lists can never drift from the column positions they attach to. */
export type ColumnDropdownSpec = { columnIndex: number; values: string[] }
