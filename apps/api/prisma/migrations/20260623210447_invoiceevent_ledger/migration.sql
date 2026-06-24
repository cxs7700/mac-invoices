-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'FIELD_EDITED', 'DELETED');

-- CreateTable
CREATE TABLE "invoice_events" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "detail" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RECORDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_events_invoiceId_idx" ON "invoice_events"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_events_ownerUserId_createdAt_idx" ON "invoice_events"("ownerUserId", "createdAt");
