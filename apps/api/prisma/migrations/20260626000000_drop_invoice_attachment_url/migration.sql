-- Drop the now-unused legacy single-attachment column. `images[]` (InvoiceImage)
-- has been the single source of truth since the multi-photo feature; no write path
-- writes attachmentUrl and the one-time backfill into image rows is complete.
ALTER TABLE "invoices" DROP COLUMN "attachmentUrl";
