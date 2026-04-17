-- Migration 028: Add parent_session_id to track cloned sessions
-- When a session is cloned, the new session stores the root (original) session_id
-- so that AttendanceRecords can deduplicate: selecting a root shows all its clones too.

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS parent_session_id UUID
    REFERENCES public.session(session_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.session.parent_session_id IS
  'For cloned sessions: the root (original) session_id. NULL means this is a root session. '
  'Use COALESCE(parent_session_id, session_id) as the logical session identity.';
