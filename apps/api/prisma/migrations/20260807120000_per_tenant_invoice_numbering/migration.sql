-- Per-tenant invoice numbering. Replaces the GLOBAL unique on
-- invoices."invoiceNumber" with a per-owner composite unique.
--
-- Why: before this, a new tenant's first auto-assigned number was
-- (global max + 1), silently reporting the incumbent landlord's invoice count;
-- and a client-supplied number colliding with ANOTHER tenant's invoice returned
-- 409, which is a working cross-tenant existence oracle. See DEC-029(j) and
-- docs/brainstorms/2026-08-07-per-tenant-invoice-numbering-requirements.md.
--
-- NON-DESTRUCTIVE: no row is read or modified. Every existing invoiceNumber is
-- already globally unique, so existing data satisfies the composite constraint
-- with no cleanup or backfill.
--
-- DEPLOY ORDER: migrate FIRST, then deploy the scoped-scan code (the usual
-- docs/DEPLOYMENT.md §3 rule -- unlike drop_invoice_description, which inverted
-- it). In the window between the two, the still-running old code's global scan
-- yields a number that satisfies the composite constraint, and same-tenant
-- duplicates still conflict. The only behavior this migration alone unlocks is
-- cross-tenant number reuse, which is the intended end state.
--
-- NULLs: Postgres treats NULLs as never equal, so many unnumbered invoices per
-- user remain allowed -- contractor submissions are unnumbered until approved.

-- DropIndex
DROP INDEX "invoices_invoiceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_userId_invoiceNumber_key" ON "invoices"("userId", "invoiceNumber");
