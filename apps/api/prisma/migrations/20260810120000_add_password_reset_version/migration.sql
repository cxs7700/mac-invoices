-- Issuing a password-reset link bumps this, and the value is signed into the
-- link, so a newly issued link retires any outstanding one (spec R8).
-- Additive with a default: existing rows get 0 and every already-issued link
-- (there are none in production yet) would simply fail closed.
ALTER TABLE "users" ADD COLUMN "passwordResetVersion" INTEGER NOT NULL DEFAULT 0;
