-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "submittedByContractorId" TEXT,
ALTER COLUMN "invoiceNumber" DROP NOT NULL,
ALTER COLUMN "category" DROP NOT NULL;

-- CreateTable
CREATE TABLE "contractors" (
    "id" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "tokenLookupId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_tokenLookupId_key" ON "contractors"("tokenLookupId");

-- CreateIndex
CREATE INDEX "contractors_landlordId_idx" ON "contractors"("landlordId");

-- CreateIndex
CREATE INDEX "invoices_submittedByContractorId_idx" ON "invoices"("submittedByContractorId");

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_submittedByContractorId_fkey" FOREIGN KEY ("submittedByContractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
