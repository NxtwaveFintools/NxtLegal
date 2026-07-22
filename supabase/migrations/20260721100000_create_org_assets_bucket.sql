-- Private bucket for organisation-level assets (company stamp, etc).
-- Separate from contracts-private: contracts are per-tenant confidential
-- documents; org assets are read by every staff member's signing editor.
--
-- Written to be safely re-runnable so the same file applies unchanged to
-- test and prod, and a repeated apply is a no-op rather than an error.
insert into storage.buckets (id, name, public)
values ('org-assets', 'org-assets', false)
on conflict (id) do nothing;
-- Reads go through the service role (send-time flattening) or a signed URL
-- minted by our API (editor preview), so no public read policy is granted.
-- Writes are service-role only, performed by scripts/seed-company-stamp.ts.
--
-- Note: service_role holds BYPASSRLS, so this policy grants nothing it did
-- not already have. What actually protects the bucket is the ABSENCE of any
-- policy for anon/authenticated — without a signed URL from our endpoint,
-- those roles can read nothing here. The policy is kept as an explicit
-- statement of intent, and so that revoking BYPASSRLS would not silently
-- lock out the service role.
drop policy if exists "org_assets_service_role_all" on storage.objects;
create policy "org_assets_service_role_all"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'org-assets')
  with check (bucket_id = 'org-assets');