-- Migration 009: Widen session.day column from VARCHAR(20) to TEXT
-- ============================================================================
-- PROBLEM:
--   The `day` column on the `session` table is typed VARCHAR(20) in the live
--   database. Multi-day session strings like "Monday, Friday, Tuesday" exceed
--   20 characters and the UPDATE fails with:
--     "value too long for type character varying(20)"
--
-- FIX:
--   Alter the column to TEXT (unbounded). This is a safe, non-destructive
--   change — existing data is preserved and all current values fit in TEXT.
--   Also widen session_day_change.old_day / new_day if they have a limit
--   (they are already TEXT in schema.sql but may differ in live DB).
-- ============================================================================

BEGIN;

-- Widen session.day to TEXT
ALTER TABLE public.session
  ALTER COLUMN day TYPE TEXT;

-- Ensure session_day_change columns are also TEXT (defensive — already TEXT in schema)
ALTER TABLE public.session_day_change
  ALTER COLUMN old_day TYPE TEXT;

ALTER TABLE public.session_day_change
  ALTER COLUMN new_day TYPE TEXT;

COMMIT;
