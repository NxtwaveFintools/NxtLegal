-- Google Drive per-user OAuth connections.
-- Stores OAuth tokens (encrypted at the application layer with AES-256-GCM) plus
-- the last-used destination folder, scoped per tenant + user.
-- Additive migration; RLS enabled with tenant isolation.

CREATE TABLE IF NOT EXISTS "public"."google_drive_connections" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "google_account_email" text,
    "access_token" text,
    "refresh_token" text NOT NULL,
    "token_expires_at" timestamp with time zone,
    "scope" text,
    "last_folder_id" text,
    "last_folder_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "google_drive_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "google_drive_connections_tenant_user_unique" UNIQUE ("tenant_id", "user_id")
);

ALTER TABLE "public"."google_drive_connections" OWNER TO "postgres";

-- Foreign key to users so a deleted user's connection is removed automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'google_drive_connections_user_fk'
  ) THEN
    ALTER TABLE "public"."google_drive_connections"
      ADD CONSTRAINT "google_drive_connections_user_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Row Level Security: tenant isolation (service_role bypasses RLS for server-side access).
ALTER TABLE "public"."google_drive_connections" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_drive_connections_tenant_isolation" ON "public"."google_drive_connections";
CREATE POLICY "google_drive_connections_tenant_isolation" ON "public"."google_drive_connections"
  USING (("tenant_id" = (((SELECT auth.jwt() AS jwt) ->> 'tenant_id'))::uuid))
  WITH CHECK (("tenant_id" = (((SELECT auth.jwt() AS jwt) ->> 'tenant_id'))::uuid));

-- Keep updated_at fresh on every update.
CREATE OR REPLACE TRIGGER "update_google_drive_connections_updated_at"
  BEFORE UPDATE ON "public"."google_drive_connections"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
