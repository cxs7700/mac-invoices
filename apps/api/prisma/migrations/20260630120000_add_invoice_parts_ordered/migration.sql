-- Add the optional free-text `partsOrdered` column to invoices. Nullable +
-- additive, so it is backward-compatible: existing code that doesn't select it
-- is unaffected. Apply this migration BEFORE deploying the code that reads it.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "partsOrdered" TEXT;
