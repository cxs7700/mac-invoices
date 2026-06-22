/**
 * Path/query types for invoice routes. Request body shapes come from the shared
 * Zod schemas in @mac-invoices/shared (validated at the handler).
 */

export interface GetInvoiceParams {
  id: string
}

// The raw query is just strings; the shape is validated by ListInvoicesQuerySchema
// (shared) in the handler via parseBody — no need to mirror every param here.
export type ListInvoicesQuery = Record<string, string | undefined>
