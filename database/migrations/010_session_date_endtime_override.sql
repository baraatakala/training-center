-- Migration 010: Add per-date session END time override
-- Allows overriding the session end time on specific dates,
-- complementing the existing override_time (start time) column.

ALTER TABLE public.session_date_host
  ADD COLUMN IF NOT EXISTS override_end_time TIME DEFAULT NULL;

COMMENT ON COLUMN public.session_date_host.override_end_time IS
  'If set, this specific date used a different session end time than session.end_time';
