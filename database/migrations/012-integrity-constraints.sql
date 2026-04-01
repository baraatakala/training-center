-- ============================================================================
-- Migration 012: Comprehensive Data Integrity Constraints
-- ============================================================================
-- Addresses gaps found in the deep integrity audit. Each section:
--   1. Removes any existing duplicate/invalid rows (safe dedup strategy)
--   2. Adds the DB-level constraint to prevent future violations
-- ============================================================================

-- ── 1. enrollment — prevent duplicate student↔session registrations ──────────
-- When duplicates exist keep the "best" row:
--   active > pending > completed > dropped, then newest created_at wins.
DELETE FROM public.enrollment e
WHERE e.enrollment_id NOT IN (
  SELECT DISTINCT ON (student_id, session_id) enrollment_id
  FROM public.enrollment
  ORDER BY
    student_id,
    session_id,
    CASE status
      WHEN 'active'    THEN 1
      WHEN 'pending'   THEN 2
      WHEN 'completed' THEN 3
      WHEN 'dropped'   THEN 4
      ELSE 5
    END,
    created_at DESC NULLS LAST
);

ALTER TABLE public.enrollment
  ADD CONSTRAINT enrollment_student_session_unique
  UNIQUE (student_id, session_id);

-- ── 2. teacher_host_schedule — one host assignment per session per date ───────
DELETE FROM public.teacher_host_schedule t
WHERE t.id NOT IN (
  SELECT DISTINCT ON (session_id, host_date) id
  FROM public.teacher_host_schedule
  ORDER BY session_id, host_date, created_at DESC NULLS LAST
);

ALTER TABLE public.teacher_host_schedule
  ADD CONSTRAINT teacher_host_schedule_session_date_unique
  UNIQUE (session_id, host_date);

-- ── 3. excuse_request — one request per student/session/attendance date ───────
-- When duplicates exist keep: approved > pending > rejected > cancelled, newest wins.
DELETE FROM public.excuse_request r
WHERE r.request_id NOT IN (
  SELECT DISTINCT ON (student_id, session_id, attendance_date) request_id
  FROM public.excuse_request
  ORDER BY
    student_id,
    session_id,
    attendance_date,
    CASE status
      WHEN 'approved'  THEN 1
      WHEN 'pending'   THEN 2
      WHEN 'rejected'  THEN 3
      WHEN 'cancelled' THEN 4
      ELSE 5
    END,
    created_at DESC NULLS LAST
);

ALTER TABLE public.excuse_request
  ADD CONSTRAINT excuse_request_student_session_date_unique
  UNIQUE (student_id, session_id, attendance_date);

-- ── 4. session_day_change — one change record per session per effective date ──
DELETE FROM public.session_day_change s
WHERE s.change_id NOT IN (
  SELECT DISTINCT ON (session_id, effective_date) change_id
  FROM public.session_day_change
  ORDER BY session_id, effective_date, created_at DESC NULLS LAST
);

ALTER TABLE public.session_day_change
  ADD CONSTRAINT session_day_change_session_date_unique
  UNIQUE (session_id, effective_date);

-- ── 5. session — ensure end_date is never before start_date ──────────────────
-- Repair any existing violations by collapsing them to a single-day session.
UPDATE public.session
SET end_date = start_date
WHERE end_date < start_date;

ALTER TABLE public.session
  ADD CONSTRAINT session_dates_ordered
  CHECK (end_date >= start_date);

-- ── 6. qr_sessions — at most one active token per session/date/mode ──────────
-- Invalidate all but the newest active token in each group.
UPDATE public.qr_sessions q
SET is_valid = false
WHERE is_valid = true
  AND q.qr_session_id NOT IN (
    SELECT DISTINCT ON (session_id, attendance_date, check_in_mode) qr_session_id
    FROM public.qr_sessions
    WHERE is_valid = true
    ORDER BY session_id, attendance_date, check_in_mode, created_at DESC NULLS LAST
  );

-- Partial unique index: only one active token allowed per group (inactive tokens
-- are kept for audit history and do not participate in this constraint).
CREATE UNIQUE INDEX IF NOT EXISTS qr_sessions_active_unique
  ON public.qr_sessions (session_id, attendance_date, check_in_mode)
  WHERE is_valid = true;

-- ── 7. session_date_host — restrict host_type to known values ─────────────────
-- Nullify any unrecognised legacy values before locking the column down.
UPDATE public.session_date_host
SET host_type = NULL
WHERE host_type IS NOT NULL
  AND host_type NOT IN ('student', 'teacher');

ALTER TABLE public.session_date_host
  ADD CONSTRAINT session_date_host_type_check
  CHECK (host_type IS NULL OR host_type IN ('student', 'teacher'));
