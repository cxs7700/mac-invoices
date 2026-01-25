export interface Invoice { 
  id: number;
  description: string;
  date: Date;
  location: string;
  price: number;
  status: string;
  number: number;
  quantity: number;
  creatorId: number;
}

export interface GetInvoiceParams {
  id: string;
}

