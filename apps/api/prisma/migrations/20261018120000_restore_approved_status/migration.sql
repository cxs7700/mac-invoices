-- Restore APPROVED to InvoiceStatus: approving a vendor submission lands on
-- APPROVED (accepted, money still owed) instead of PAID; paying is a separate
-- step. Rows moved to PAID by 20260826120000 stay PAID — which of them were
-- only approved is not recoverable.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'APPROVED' BEFORE 'PAID';
