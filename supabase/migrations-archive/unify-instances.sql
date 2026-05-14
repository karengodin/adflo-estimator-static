-- =============================================================================
-- Unify instances tables
-- =============================================================================
--
-- WHAT THIS DOES:
--   Adds the columns from tapclicks_instances that instances is missing,
--   then drops tapclicks_instances. The instances table becomes the single
--   source of truth for all TapClicks credential storage.
--
-- COLUMN MAPPING (tapclicks_instances → instances):
--   label              → name              (already exists)
--   base_url           → base_url          (already exists)
--   is_active          → is_active         (already exists)
--   cookie_expires_at  → cookie_expires_at (already exists)
--   last_login_at      → last_connected_at (already exists)
--   encrypted_cookie   → session_cookie    (already exists)
--   instance_key       → instance_key      (ADDED below)
--   login_email        → login_email       (ADDED below)
--   encrypted_password → encrypted_password(ADDED below)
--   last_login_status  → last_login_status (ADDED below)
--   last_error         → last_error        (ADDED below)
--
-- DATA: tapclicks_instances rows are stale (all failed logins, no valid cookies).
--   They will not be migrated — instances will be re-entered fresh.
--
-- HOW TO RUN:
--   Paste into Supabase SQL Editor and execute.
--   Safe to re-run — uses ADD COLUMN IF NOT EXISTS and DROP TABLE IF EXISTS.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Step 1: Add missing columns to instances
-- -----------------------------------------------------------------------------

ALTER TABLE public.instances
  ADD COLUMN IF NOT EXISTS instance_key        text,
  ADD COLUMN IF NOT EXISTS login_email         text,
  ADD COLUMN IF NOT EXISTS encrypted_password  text,
  ADD COLUMN IF NOT EXISTS last_login_status   text,
  ADD COLUMN IF NOT EXISTS last_error          text;

-- Unique constraint so upsert-by-key works (matches tapclicks_instances behaviour)
-- Uses DO $$ block to skip gracefully if it already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instances_instance_key_key'
      AND conrelid = 'public.instances'::regclass
  ) THEN
    ALTER TABLE public.instances
      ADD CONSTRAINT instances_instance_key_key UNIQUE (instance_key);
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Step 2: Drop tapclicks_instances
-- (Data is stale — all rows show failed logins. Will be re-entered via UI.)
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.tapclicks_instances;


-- =============================================================================
-- Done.
-- instances now has: id, user_id, name, base_url, session_cookie, is_active,
--   last_connected_at, display_order, cookie_expires_at, created_at, updated_at,
--   instance_key, login_email, encrypted_password, last_login_status, last_error
-- =============================================================================
