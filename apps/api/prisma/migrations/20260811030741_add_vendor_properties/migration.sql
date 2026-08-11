-- CreateTable
CREATE TABLE "vendor_properties" (
    "vendorId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_properties_pkey" PRIMARY KEY ("vendorId","propertyId")
);

-- CreateIndex
CREATE INDEX "vendor_properties_propertyId_idx" ON "vendor_properties"("propertyId");

-- AddForeignKey
ALTER TABLE "vendor_properties" ADD CONSTRAINT "vendor_properties_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_properties" ADD CONSTRAINT "vendor_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
