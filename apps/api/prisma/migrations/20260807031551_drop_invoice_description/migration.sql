-- Drop the now-unused legacy `description` column. `items` (InvoiceItem) has
-- been the single source of truth since the itemized-invoice feature landed;
-- no write path writes `description` and the one-time backfill
-- (`npm run db:backfill-invoice-items`) into item rows is complete.
--
-- DEPLOY ORDER (destructive — inverts the usual migrate-first rule): deploy
-- the new code FIRST (its regenerated client no longer SELECTs this column),
-- confirm it is serving, THEN run `db:deploy`. Dropping before the new code
-- is live breaks every invoice read by the still-running old client. See
-- docs/DEPLOYMENT.md §3.
-- Before applying against a database that hasn't run the backfill yet,
-- confirm every invoice has at least one item:
--   SELECT COUNT(*) FROM invoices i
--   WHERE NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii."invoiceId" = i.id);  -- must be 0

/*
  Warnings:

  - You are about to drop the column `description` on the `invoices` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "description";
