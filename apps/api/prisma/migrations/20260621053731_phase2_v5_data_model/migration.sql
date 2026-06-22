-- CreateEnum
CREATE TYPE "Role" AS ENUM ('LANDLORD', 'CONTRACTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ImageType" AS ENUM ('CASH', 'PARTS', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('MAINTENANCE', 'REPAIRS', 'UTILITIES', 'SUPPLIES', 'LABOR', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'LANDLORD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "vendorEmail" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "category" "InvoiceCategory" NOT NULL,
    "propertyId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "sheetsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_images" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "ImageType" NOT NULL DEFAULT 'OTHER',
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_userId_status_idx" ON "invoices"("userId", "status");

-- CreateIndex
CREATE INDEX "invoices_userId_invoiceDate_idx" ON "invoices"("userId", "invoiceDate");

-- CreateIndex
CREATE INDEX "invoice_images_invoiceId_idx" ON "invoice_images"("invoiceId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_images" ADD CONSTRAINT "invoice_images_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
