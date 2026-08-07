-- Rename the table and its constraints/indexes. RENAME (never DROP+CREATE)
-- so no row is lost.
ALTER TABLE "contractors" RENAME TO "vendors";
ALTER INDEX "contractors_pkey" RENAME TO "vendors_pkey";
ALTER INDEX "contractors_tokenLookupId_key" RENAME TO "vendors_tokenLookupId_key";
ALTER INDEX "contractors_landlordId_idx" RENAME TO "vendors_landlordId_idx";
ALTER TABLE "vendors" RENAME CONSTRAINT "contractors_landlordId_fkey" TO "vendors_landlordId_fkey";

-- Split the single free-text `contact` column into phone + email.
ALTER TABLE "vendors" ADD COLUMN "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "email" TEXT;

-- Backfill: an email-shaped contact becomes `email`, anything else `phone`.
UPDATE "vendors" SET "email" = "contact" WHERE "contact" LIKE '%_@_%.__%';
UPDATE "vendors" SET "phone" = "contact" WHERE "contact" NOT LIKE '%_@_%.__%';

ALTER TABLE "vendors" DROP COLUMN "contact";

-- Invoice: rename the submission FK, then add the attribution FK.
ALTER TABLE "invoices" RENAME COLUMN "submittedByContractorId" TO "submittedByVendorId";
ALTER INDEX "invoices_submittedByContractorId_idx" RENAME TO "invoices_submittedByVendorId_idx";
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_submittedByContractorId_fkey" TO "invoices_submittedByVendorId_fkey";

ALTER TABLE "invoices" ADD COLUMN "vendorId" TEXT;
CREATE INDEX "invoices_vendorId_idx" ON "invoices"("vendorId");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Role enum value.
ALTER TYPE "Role" RENAME VALUE 'CONTRACTOR' TO 'VENDOR';

-- InvoiceEvent.actorId stores a literal 'contractor:<id>' prefix as DATA.
-- Renaming only the TypeScript constant would silently orphan every historical
-- event from the notifications feed and digest — no error, they would just stop
-- appearing. Migrate the stored rows in the same migration.
UPDATE "invoice_events"
SET "actorId" = 'vendor:' || substring("actorId" from 12)
WHERE "actorId" LIKE 'contractor:%';
