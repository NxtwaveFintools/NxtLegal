-- Rollback: Remove VIEWER from recipient_type CHECK constraint
-- WARNING: This rollback will FAIL if any rows in contract_signatories have recipient_type = 'VIEWER'.
-- Delete all VIEWER signatories first before running this rollback.

ALTER TABLE "public"."contract_signatories"
  DROP CONSTRAINT IF EXISTS "contract_signatories_recipient_type_check";

ALTER TABLE "public"."contract_signatories"
  ADD CONSTRAINT "contract_signatories_recipient_type_check"
  CHECK (("recipient_type" = ANY (ARRAY['INTERNAL'::text, 'EXTERNAL'::text])));
