-- Capture the mandatory justification provided when Founder Approval (budget_approved) is "No".
-- Minimum length (120 characters) is enforced at the application layer; the column itself is
-- nullable so contracts with Founder Approval = Yes simply leave it empty.
ALTER TABLE "public"."contracts"
  ADD COLUMN IF NOT EXISTS "founder_approval_reason" text;

COMMENT ON COLUMN "public"."contracts"."founder_approval_reason" IS
  'Mandatory justification captured when founder approval (budget_approved) is No. Minimum 120 characters enforced at the application layer.';
