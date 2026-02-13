-- Up Migration: Make password_hash nullable for OAuth users
-- OAuth users don't need password hashes, so this column should allow NULL
-- 2026-02-14 00:05:00

ALTER TABLE employees ALTER COLUMN password_hash DROP NOT NULL;
