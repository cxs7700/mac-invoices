-- Drop the unused Invoice.dueDate column. The app no longer reads or writes it
-- (removed from schema, API, export, UI). Any stored due dates are discarded.

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "dueDate";
