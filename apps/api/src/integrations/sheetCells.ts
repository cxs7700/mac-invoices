// Cell types for the Sheets writers. Lives apart from sheets.ts so pure row
// builders (sheetRows.ts) can construct formulas without importing googleapis.

/** A cell whose string is a formula the SERVER constructed (never user text).
 * safeCell writes it through verbatim instead of neutralizing the leading `=`;
 * any user-influenced value inside it must be escaped by the constructor site. */
export class SheetFormula {
  constructor(readonly formula: string) {}
}

export type SheetCell = string | number | SheetFormula
