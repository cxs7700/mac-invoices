/**
 * Type definitions for invoice API requests and responses
 */

export interface GetInvoiceParams {
  id: string;
}

export interface ListInvoicesQuery {
  status?: string;
  creatorId?: string;
  limit?: string;
  offset?: string;
}

export interface CreateInvoiceBody {
  description: string;
  date: string | Date;
  location: string;
  price: number | string;
  status: string;
  number: number;
  quantity?: number;
  creatorId: number;
}

export interface UpdateInvoiceBody {
  description?: string;
  date?: string | Date;
  location?: string;
  price?: number | string;
  status?: string;
  number?: number;
  quantity?: number;
  creatorId?: number;
}
