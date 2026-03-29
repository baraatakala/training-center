-- ============================================================================
-- Migration 007: Add override_time to session_date_host
-- ============================================================================
-- Enables per-date time overrides for sessions.
-- When a teacher changes a session's time mid-session, they can choose which
-- dates get the new time — exactly like the day-change strategy feature.
--
-- Attendance page reads override_time from session_date_host for the selected
-- date, falling back to session.time if no override exists.
-- ============================================================================

BEGIN;

ALTER TABLE public.session_date_host
  ADD COLUMN IF NOT EXISTS override_time TEXT DEFAULT NULL;

COMMENT ON COLUMN public.session_date_host.override_time IS
  'Per-date time override (e.g. "14:00-15:30"). When set, overrides session.time for late calculation and display on the Attendance page.';

COMMIT;
