-- Purely additive: new nullable `users` columns and a new `invoice_items`
-- table. Old code that doesn't know about them is unaffected. Run
-- `npm run db:backfill-invoice-items` after this migration to populate
-- firstName/lastName (split from the existing `name`) and one InvoiceItem per
-- existing invoice (from its `description`/`amount`). `invoices.description`
-- stays in place until the follow-up destructive migration
-- (`drop_invoice_description`), applied only after the item-aware code is
-- deployed and confirmed serving (docs/DEPLOYMENT.md §3).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
