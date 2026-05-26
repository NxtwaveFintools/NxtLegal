
-- Extend recipient_type CHECK constraint to allow VIEWER
ALTER TABLE "public"."contract_signatories"
  DROP CONSTRAINT IF EXISTS "contract_signatories_recipient_type_check";

ALTER TABLE "public"."contract_signatories"
  ADD CONSTRAINT "contract_signatories_recipient_type_check"
  CHECK (("recipient_type" = ANY (ARRAY['INTERNAL'::text, 'EXTERNAL'::text, 'VIEWER'::text])));
