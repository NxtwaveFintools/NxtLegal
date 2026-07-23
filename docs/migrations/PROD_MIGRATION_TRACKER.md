# Prod Migration Tracker

Living log of every DB migration created during feature work, so applying them to the
**Prod Supabase project** is a mechanical, low-risk step.

> Convention in this repo:
> - Forward migrations: `supabase/migrations/<timestamp>_<name>.sql`
> - Matching rollbacks: `supabase/rollbacks/<timestamp>_<name>_rollback.sql`
> - Migrations are **additive only** (per `docs/context/coding-rules.md`); destructive
>   changes require a rollback plan.
> - Every table carries `tenant_id`, `created_at`, `updated_at` and has RLS enabled.

---

## Environments

| Env  | Supabase project ref   | Notes                                   |
| ---- | ---------------------- | --------------------------------------- |
| Dev  | `otkipoimhkmrbtcsphrz` | Current `.env.local` target (local run) |
| Prod | `<fill in prod ref>`   | Do NOT point local at prod for testing  |

---

## Feature migrations (this work) — apply to Prod in this order

| # | Timestamp / file | Purpose | Forward SQL | Rollback SQL | Dev applied | Prod applied |
|---|------------------|---------|-------------|--------------|-------------|--------------|
| 1 | `20260723100000_create_google_drive_connections` | Google Drive integration: per-user OAuth connection store (encrypted tokens + last-used folder), RLS tenant isolation, `updated_at` trigger, FK to `users`. | `supabase/migrations/20260723100000_create_google_drive_connections.sql` | `supabase/rollbacks/20260723100000_create_google_drive_connections_rollback.sql` | ☐ | ☐ |

---

## How to apply to Prod

### Option A — Supabase CLI (preferred, applies all pending migrations)

```bash
# 1. Link the local repo to the PROD project (one-time)
npx supabase link --project-ref <PROD_PROJECT_REF>

# 2. Preview what would run (diff local migrations vs remote)
npx supabase db diff --linked

# 3. Push all pending migrations to prod
npx supabase db push
```

`supabase db push` only applies migrations not already recorded in the remote
`supabase_migrations.schema_migrations` table, so re-running is safe/idempotent.

### Option B — Manual (Supabase Dashboard → SQL Editor)

Run the Forward SQL files listed above, top-to-bottom. On failure, run the matching
Rollback SQL for that step.

---

## Feature env vars required in Prod (Google Drive)

Set these on the Prod host (e.g. Vercel) before enabling the feature:

- `FEATURE_GOOGLE_DRIVE=true`
- `GOOGLE_CLIENT_ID` (or `GOOGLE_DRIVE_CLIENT_ID`)
- `GOOGLE_CLIENT_SECRET` (or `GOOGLE_DRIVE_CLIENT_SECRET`)
- `GOOGLE_DRIVE_TOKEN_ENC_KEY` — base64-encoded 32-byte key (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

Also register the prod redirect URI in the Google Cloud OAuth client:
`https://<prod-domain>/api/integrations/google-drive/callback`

---

## Pre-flight checklist before pushing to Prod

- [ ] Every migration in the table above applied + verified on Dev
- [ ] Each forward migration has a matching rollback file
- [ ] Migrations are additive (no destructive change without an approved rollback)
- [ ] RLS policies included for any new table (`tenant_id` enforced)
- [ ] `npm run build` passes with the schema changes
- [ ] Feature env vars set in prod (see above)
- [ ] `npx supabase db diff --linked` reviewed against prod — no unexpected drift

---

_Last updated: 2026-07-23_
