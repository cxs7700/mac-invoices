/**
 * Path/query types for invoice routes. Request body shapes come from the shared
 * Zod schemas in @mac-invoices/shared (validated at the handler).
 */

export interface GetInvoiceParams {
  id: string
}

export interface ListInvoicesQuery {
  status?: string
  limit?: string
  offset?: string
}
