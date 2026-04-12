-- Migration 026: Allow 'other' host_type for stranger/custom hosts
-- Expands the session_date_host.host_type CHECK to include 'other'

ALTER TABLE public.session_date_host
  DROP CONSTRAINT IF EXISTS session_date_host_type_check;

ALTER TABLE public.session_date_host
  ADD CONSTRAINT session_date_host_type_check
  CHECK (host_type IS NULL OR host_type IN ('student', 'teacher', 'other'));
