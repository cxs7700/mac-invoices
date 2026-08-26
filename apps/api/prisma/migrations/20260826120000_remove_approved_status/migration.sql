-- Remove APPROVED from InvoiceStatus: approving a vendor submission now lands
-- directly on PAID. Existing APPROVED rows become PAID; a row that had no
-- paidDate gets one stamped now (it is entering PAID by this migration).
UPDATE "invoices"
SET "status" = 'PAID',
    "paidDate" = COALESCE("paidDate", CURRENT_TIMESTAMP)
WHERE "status" = 'APPROVED';

-- Postgres cannot drop an enum value in place: rebuild the type without it.
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED', 'CANCELLED', 'SUBMITTED');
ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus" USING ("status"::text::"InvoiceStatus");
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "InvoiceStatus_old";
