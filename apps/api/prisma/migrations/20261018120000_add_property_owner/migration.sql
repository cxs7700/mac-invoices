-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "ownerEmail" TEXT,
ADD COLUMN     "ownerFirstName" TEXT,
ADD COLUMN     "ownerLastName" TEXT,
ADD COLUMN     "ownerPhone" TEXT;

-- Backfill: until now the account holder was implicitly every property's owner
-- (the PDF billed them), so seed each existing property's owner from its
-- landlord. This keeps every existing PDF identical until the landlord edits it.
UPDATE "properties" AS p
SET "ownerFirstName" = u."firstName",
    "ownerLastName"  = u."lastName",
    "ownerEmail"     = u."email"
FROM "users" AS u
WHERE u."id" = p."landlordId";
