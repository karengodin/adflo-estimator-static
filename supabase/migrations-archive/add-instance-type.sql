-- =============================================================================
-- Add instance_type column to instances table
-- =============================================================================
--
-- Distinguishes Classic TapClicks instances (legacy OMS) from Adflo OMS
-- instances. The extraction tool uses different API endpoints for each type.
--
-- Values:
--   'classic' — standard TapClicks OMS (/server/api/... endpoints)
--   'adflo'   — Adflo OMS (endpoints TBD; extraction not yet implemented)
--
-- Default is 'classic' so all existing rows remain valid without backfill.
-- SAFE TO RE-RUN: uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.instances
  ADD COLUMN IF NOT EXISTS instance_type text NOT NULL DEFAULT 'classic'
    CHECK (instance_type IN ('classic', 'adflo'));
