-- Rollback for 20260723100000_create_google_drive_connections.sql
-- Drops the trigger, policy, FK and table (safe if partially applied).

DROP TRIGGER IF EXISTS "update_google_drive_connections_updated_at" ON "public"."google_drive_connections";
DROP POLICY IF EXISTS "google_drive_connections_tenant_isolation" ON "public"."google_drive_connections";
ALTER TABLE IF EXISTS "public"."google_drive_connections"
  DROP CONSTRAINT IF EXISTS "google_drive_connections_user_fk";
DROP TABLE IF EXISTS "public"."google_drive_connections";
