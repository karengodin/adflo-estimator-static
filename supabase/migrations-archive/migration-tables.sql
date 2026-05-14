-- =============================================================================
-- Migration Tables Setup
-- =============================================================================
--
-- WHAT THIS DOES:
--   1. Adds per-item columns to `extractions` so the migration tool can read
--      individual item IDs and names from this table.
--   2. Adds per-item columns to `migration_runs` so each migrated item gets
--      its own row with full status history.
--
-- FINDINGS:
--
--   extractions (exists, columns):
--     id, user_id, instance_id, extraction_type (enum), data (jsonb),
--     record_count, created_at, ui_version
--
--     The extraction_type enum already covers the right entity types:
--       lookups, client_forms, order_forms, line_item_forms, flight_forms,
--       task_forms (plus detail variants and others)
--
--     Missing: item_id, item_name, reference_table
--     Note: `extracted_at` maps to existing `created_at` — no new column needed.
--     Note: `entity_type` maps to existing `extraction_type` — use that column.
--
--   migration_runs (exists, columns):
--     id, user_id, instance_id, item_type, results (jsonb),
--     total_items, success_count, error_count, partial_count, created_at
--
--     The existing schema stores aggregate run summaries (one row per batch run).
--     The migration tool needs per-item rows instead. Since the table is empty,
--     we add the per-item columns alongside the existing aggregate ones.
--     The aggregate columns (total_items, success_count, etc.) will be unused
--     by the new tool but are harmless to leave in place.
--
--     Missing: entity_type, item_id, item_name, status, http_code, snippet,
--              request_url, run_at, is_retry
--     Note: `entity_type` is the same concept as existing `item_type` but
--           the new column uses the canonical name from the spec.
--     Note: `run_at` overlaps with `created_at` — using run_at as the
--           per-item timestamp.
--
-- SAFE TO RE-RUN: uses ADD COLUMN IF NOT EXISTS throughout.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. extractions — add per-item columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.extractions
  ADD COLUMN IF NOT EXISTS item_id          text,
  ADD COLUMN IF NOT EXISTS item_name        text,
  ADD COLUMN IF NOT EXISTS reference_table  text;

-- reference_table stores the parent entity type for task forms
-- (e.g. 'order', 'flight', 'line_item') — null for all other entity types.


-- -----------------------------------------------------------------------------
-- 2. migration_runs — add per-item columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.migration_runs
  ADD COLUMN IF NOT EXISTS entity_type   text,
  ADD COLUMN IF NOT EXISTS item_id       text,
  ADD COLUMN IF NOT EXISTS item_name     text,
  ADD COLUMN IF NOT EXISTS status        text,
  ADD COLUMN IF NOT EXISTS http_code     integer,
  ADD COLUMN IF NOT EXISTS snippet       text,
  ADD COLUMN IF NOT EXISTS request_url   text,
  ADD COLUMN IF NOT EXISTS run_at        timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_retry      boolean DEFAULT false;

-- status values: 'success' | 'partial_success' | 'error' | 'skipped'
-- is_retry: true if this row is a retry of a previous error


-- -----------------------------------------------------------------------------
-- 3. Indexes for common query patterns
-- -----------------------------------------------------------------------------

-- extractions: look up all items for a given instance + extraction type
CREATE INDEX IF NOT EXISTS extractions_instance_type_idx
  ON public.extractions (instance_id, extraction_type);

-- extractions: look up a specific item across all extractions
CREATE INDEX IF NOT EXISTS extractions_item_id_idx
  ON public.extractions (item_id)
  WHERE item_id IS NOT NULL;

-- migration_runs: look up all runs for an instance + entity type
-- (used to build the item list view with last-known status)
CREATE INDEX IF NOT EXISTS migration_runs_instance_entity_idx
  ON public.migration_runs (instance_id, entity_type);

-- migration_runs: look up all runs for a specific item
-- (used to show per-item history and determine skipped status)
CREATE INDEX IF NOT EXISTS migration_runs_item_idx
  ON public.migration_runs (instance_id, entity_type, item_id);

-- migration_runs: filter by status (used for retry logic)
CREATE INDEX IF NOT EXISTS migration_runs_status_idx
  ON public.migration_runs (status)
  WHERE status IS NOT NULL;


-- =============================================================================
-- Done.
--
-- extractions now has: id, user_id, instance_id, extraction_type, data,
--   record_count, created_at, ui_version, item_id, item_name, reference_table
--
-- migration_runs now has: id, user_id, instance_id, item_type, results,
--   total_items, success_count, error_count, partial_count, created_at,
--   entity_type, item_id, item_name, status, http_code, snippet,
--   request_url, run_at, is_retry
-- =============================================================================
