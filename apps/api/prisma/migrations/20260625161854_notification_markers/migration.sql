-- AlterTable
ALTER TABLE "invoice_events" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationsSeenAt" TIMESTAMP(3);
