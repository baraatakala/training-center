-- Migration 009: Per-date session time override improvements
-- Allows override-only rows in session_date_host (no host required)
-- and adds a reason column for documenting why a date had a different time.
--
-- Run this migration once against the live Supabase database.

-- 1. Make host_address nullable so a row can be created solely to store
--    override_time without requiring a host assignment.
ALTER TABLE public.session_date_host
  ALTER COLUMN host_address DROP NOT NULL;

-- 2. Add override_reason for admin documentation.
ALTER TABLE public.session_date_host
  ADD COLUMN IF NOT EXISTS override_reason TEXT DEFAULT NULL;

COMMENT ON COLUMN public.session_date_host.host_address IS
  'NULL when row is created only for a time override (no host assigned yet)';

COMMENT ON COLUMN public.session_date_host.override_time IS
  'If set, this specific date used a different session start time than session.time';

COMMENT ON COLUMN public.session_date_host.override_reason IS
  'Optional admin note explaining why this date had a different time';
