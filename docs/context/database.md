Database: PostgreSQL via Supabase

Multi-tenant architecture.

All tables contain:
tenant_id
created_at
updated_at

Security:
Row Level Security enabled
tenant_id enforced in every query