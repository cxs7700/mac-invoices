-- Case-insensitive per-landlord vendor name uniqueness, backing the
-- find-then-create in writeService.resolveVendorId with a real DB constraint
-- so a double-click (or any true concurrent create) can no longer leave two
-- vendor rows with the same name (differing only in case) for one landlord.
--
-- This is a functional (expression) index over lower("name"), which Prisma's
-- schema DSL cannot express as a `@@unique`. It is intentionally NOT modeled
-- in schema.prisma — see the comment on the Vendor model.
CREATE UNIQUE INDEX "vendors_landlordId_lower_name_key"
  ON "vendors" ("landlordId", lower("name"));
