-- Migration 046: Structured time/day columns
-- Replaces VARCHAR time ("09:00-12:00") with start_time/end_time TIME columns.
-- Replaces comma-separated day TEXT with normalized session_schedule_day junction table.
-- Replaces session_time_change + session_day_change with unified session_schedule_exception.
--
-- Strategy: additive (non-breaking). Old columns kept until code fully migrated.
-- Phase 1: Add new columns/tables + backfill
-- Phase 2 (future migration): Drop old columns after code migration verified

BEGIN;

-- ============================================================================
-- A. STRUCTURED TIME COLUMNS ON SESSION
-- ============================================================================

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME,
  ADD COLUMN IF NOT EXISTS timezone   TEXT NOT NULL DEFAULT 'Asia/Dubai';

-- Backfill from session.time VARCHAR ("HH:MM-HH:MM")
UPDATE public.session
SET
  start_time = CASE
    WHEN time IS NOT NULL AND time LIKE '%-%'
    THEN TRIM(split_part(time, '-', 1))::TIME
    ELSE NULL
  END,
  end_time = CASE
    WHEN time IS NOT NULL AND time LIKE '%-%'
    THEN TRIM(split_part(time, '-', 2))::TIME
    ELSE NULL
  END
WHERE time IS NOT NULL AND start_time IS NULL;

-- Constraint: end_time must be after start_time (when both set)
ALTER TABLE public.session
  ADD CONSTRAINT chk_session_time_order
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time);

COMMENT ON COLUMN public.session.start_time IS 'Structured start time (replaces VARCHAR time). Queryable, indexable.';
COMMENT ON COLUMN public.session.end_time IS 'Structured end time (replaces VARCHAR time). Queryable, indexable.';
COMMENT ON COLUMN public.session.timezone IS 'IANA timezone identifier. Default: Asia/Dubai.';

-- ============================================================================
-- B. NORMALIZED DAY-OF-WEEK TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_schedule_day (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_schedule_day_unique UNIQUE (session_id, day_of_week),
  CONSTRAINT chk_day_of_week_range CHECK (day_of_week BETWEEN 0 AND 6)
);

COMMENT ON TABLE public.session_schedule_day IS 'Normalized session day-of-week. 0=Sunday, 6=Saturday. Replaces comma-separated session.day TEXT.';

-- Backfill from session.day TEXT ("Monday, Friday, Tuesday")
INSERT INTO public.session_schedule_day (session_id, day_of_week)
SELECT
  s.session_id,
  CASE TRIM(LOWER(d.day_name))
    WHEN 'sunday'    THEN 0
    WHEN 'monday'    THEN 1
    WHEN 'tuesday'   THEN 2
    WHEN 'wednesday' THEN 3
    WHEN 'thursday'  THEN 4
    WHEN 'friday'    THEN 5
    WHEN 'saturday'  THEN 6
  END AS day_of_week
FROM public.session s,
     LATERAL unnest(string_to_array(s.day, ',')) AS d(day_name)
WHERE s.day IS NOT NULL
  AND TRIM(LOWER(d.day_name)) IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')
ON CONFLICT (session_id, day_of_week) DO NOTHING;

-- RLS for session_schedule_day (mirrors session policies)
ALTER TABLE public.session_schedule_day ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to session_schedule_day"
  ON public.session_schedule_day FOR ALL
  USING (public.is_admin());

CREATE POLICY "Teachers manage own session schedule days"
  ON public.session_schedule_day FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.session s
      WHERE s.session_id = session_schedule_day.session_id
        AND s.teacher_id = get_my_teacher_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session s
      WHERE s.session_id = session_schedule_day.session_id
        AND s.teacher_id = get_my_teacher_id()
    )
  );

CREATE POLICY "Students read enrolled session schedule days"
  ON public.session_schedule_day FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollment e
      WHERE e.session_id = session_schedule_day.session_id
        AND e.status = 'active'
        AND e.student_id = get_my_student_id()
    )
  );

-- ============================================================================
-- C. UNIFIED SCHEDULE EXCEPTION TABLE
-- Replaces session_time_change + session_day_change
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_schedule_exception (
  exception_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  original_date   DATE NOT NULL,
  exception_type  TEXT NOT NULL,
  new_date        DATE,
  new_start_time  TIME,
  new_end_time    TIME,
  new_day_of_week SMALLINT,
  reason          TEXT,
  changed_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_schedule_exception_unique UNIQUE (session_id, original_date),
  CONSTRAINT chk_exception_type CHECK (exception_type IN ('cancelled', 'rescheduled', 'time_change', 'day_change', 'time_and_day_change')),
  CONSTRAINT chk_exception_new_day_range CHECK (new_day_of_week IS NULL OR (new_day_of_week BETWEEN 0 AND 6)),
  CONSTRAINT chk_exception_time_order CHECK (new_start_time IS NULL OR new_end_time IS NULL OR new_end_time > new_start_time)
);

COMMENT ON TABLE public.session_schedule_exception IS 'Unified schedule exceptions replacing session_time_change + session_day_change. One exception per date.';

-- Backfill from session_time_change
INSERT INTO public.session_schedule_exception (session_id, original_date, exception_type, new_start_time, new_end_time, reason, changed_by, created_at)
SELECT
  tc.session_id,
  tc.effective_date,
  'time_change',
  CASE
    WHEN tc.new_time IS NOT NULL AND tc.new_time LIKE '%-%'
    THEN TRIM(split_part(tc.new_time, '-', 1))::TIME
    ELSE NULL
  END,
  CASE
    WHEN tc.new_time IS NOT NULL AND tc.new_time LIKE '%-%'
    THEN TRIM(split_part(tc.new_time, '-', 2))::TIME
    ELSE NULL
  END,
  tc.reason,
  tc.changed_by,
  tc.created_at
FROM public.session_time_change tc
ON CONFLICT (session_id, original_date) DO NOTHING;

-- Backfill from session_day_change (merge with existing time_change if same date)
INSERT INTO public.session_schedule_exception (session_id, original_date, exception_type, reason, changed_by, created_at)
SELECT
  dc.session_id,
  dc.effective_date,
  'day_change',
  dc.reason,
  dc.changed_by,
  dc.created_at
FROM public.session_day_change dc
ON CONFLICT (session_id, original_date)
DO UPDATE SET
  exception_type = 'time_and_day_change',
  reason = COALESCE(session_schedule_exception.reason, EXCLUDED.reason);

-- RLS for session_schedule_exception
ALTER TABLE public.session_schedule_exception ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to session_schedule_exception"
  ON public.session_schedule_exception FOR ALL
  USING (public.is_admin());

CREATE POLICY "Teachers manage own session schedule exceptions"
  ON public.session_schedule_exception FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.session s
      WHERE s.session_id = session_schedule_exception.session_id
        AND s.teacher_id = get_my_teacher_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session s
      WHERE s.session_id = session_schedule_exception.session_id
        AND s.teacher_id = get_my_teacher_id()
    )
  );

CREATE POLICY "Students read enrolled session schedule exceptions"
  ON public.session_schedule_exception FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollment e
      WHERE e.session_id = session_schedule_exception.session_id
        AND e.status = 'active'
        AND e.student_id = get_my_student_id()
    )
  );

-- ============================================================================
-- D. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_session_schedule_day_session
  ON public.session_schedule_day (session_id);

CREATE INDEX IF NOT EXISTS idx_session_schedule_day_dow
  ON public.session_schedule_day (day_of_week);

CREATE INDEX IF NOT EXISTS idx_session_schedule_exception_session_date
  ON public.session_schedule_exception (session_id, original_date);

CREATE INDEX IF NOT EXISTS idx_session_start_time
  ON public.session (start_time) WHERE start_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_end_time
  ON public.session (end_time) WHERE end_time IS NOT NULL;

COMMIT;
