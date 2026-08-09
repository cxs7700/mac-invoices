-- Vendor submission links move from a stored SHA-256 of a random secret to a
-- secret DERIVED on demand as HMAC(VENDOR_LINK_KEY, tokenLookupId:tokenVersion),
-- so the landlord can copy a vendor's link at any time rather than only in the
-- moments after it is minted (DEC-033).
--
-- Consequence, deliberate and not recoverable: the plaintext of an
-- already-issued link cannot be re-derived under the new scheme, and the old
-- stored hash is no longer consulted. Every outstanding link stops validating
-- the moment this ships. Landlords must copy the new link and re-send it.
-- `tokenVersion` starts at 0 for existing rows and is bumped to rotate.

ALTER TABLE "vendors" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "vendors" DROP COLUMN "tokenHash";
