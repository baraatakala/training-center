-- Migration 016: Remove override_time columns, add session_time_change table
--
-- The per-date override system (override_time / override_end_time / override_reason
-- on session_date_host) is replaced by a change-event model identical to
-- session_day_change. Instead of stamping individual rows with overrides,
-- we now record "from this date the session time becomes X" in session_time_change.
--
-- The Schedule Change modal's three modes (from_date, date_range, retroactive)
-- provide complete control without needing per-row overrides.
--
-- Run order: after 015-security-audit-rls-constraints.sql

-- ════════════════════════════════════════════════════════════════════════
-- 1. Create session_time_change table (mirrors session_day_change)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.session_time_change (
  change_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  old_time TEXT,
  new_time TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT session_time_change_pkey PRIMARY KEY (change_id),
  CONSTRAINT session_time_change_session_date_unique UNIQUE (session_id, effective_date),
  CONSTRAINT session_time_change_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.session(session_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.session_time_change IS
  'Tracks when a session''s start time changes. Each row says: from effective_date onward, '
  'the session time is new_time (replacing old_time). Mirrors session_day_change.';

-- ════════════════════════════════════════════════════════════════════════
-- 2. RLS policies for session_time_change (mirror session_day_change)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE session_time_change ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON session_time_change;
CREATE POLICY "Admin has full access" ON session_time_change
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON session_time_change;
CREATE POLICY "Teachers can read" ON session_time_change
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON session_time_change;
CREATE POLICY "Teachers can insert" ON session_time_change
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete time changes" ON session_time_change;
CREATE POLICY "Teachers can delete time changes" ON session_time_change
  FOR DELETE TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read time changes" ON session_time_change;
CREATE POLICY "Students can read time changes" ON session_time_change
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- ════════════════════════════════════════════════════════════════════════
-- 3. Indexes for session_time_change
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_session_time_change_session
  ON public.session_time_change(session_id);
CREATE INDEX IF NOT EXISTS idx_session_time_change_effective
  ON public.session_time_change(effective_date);

-- ════════════════════════════════════════════════════════════════════════
-- 4. Migrate existing override_time data into session_time_change
--    For each date that had a non-null override_time, insert a change record.
--    We pair each with a revert record at date+1 (unless the next date also has an override).
-- ════════════════════════════════════════════════════════════════════════

-- Insert one session_time_change record per date with override_time.
-- Uses ON CONFLICT to avoid duplicates if migration is re-run.
INSERT INTO public.session_time_change (session_id, old_time, new_time, effective_date, reason, changed_by)
SELECT
  sdh.session_id,
  s.time AS old_time,
  sdh.override_time AS new_time,
  sdh.attendance_date AS effective_date,
  'Migrated from override_time' AS reason,
  NULL AS changed_by
FROM public.session_date_host sdh
JOIN public.session s ON s.session_id = sdh.session_id
WHERE sdh.override_time IS NOT NULL
ON CONFLICT (session_id, effective_date) DO NOTHING;

-- For each override date, also insert a revert record at date+1
-- (reverting to session.time) UNLESS the next day also has an override.
INSERT INTO public.session_time_change (session_id, old_time, new_time, effective_date, reason, changed_by)
SELECT
  sdh.session_id,
  sdh.override_time AS old_time,
  s.time AS new_time,
  (sdh.attendance_date + INTERVAL '1 day')::DATE AS effective_date,
  'Revert after migrated override' AS reason,
  NULL AS changed_by
FROM public.session_date_host sdh
JOIN public.session s ON s.session_id = sdh.session_id
WHERE sdh.override_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.session_date_host sdh2
    WHERE sdh2.session_id = sdh.session_id
      AND sdh2.attendance_date = (sdh.attendance_date + INTERVAL '1 day')::DATE
      AND sdh2.override_time IS NOT NULL
  )
ON CONFLICT (session_id, effective_date) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Drop override columns from session_date_host
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.session_date_host
  DROP COLUMN IF EXISTS override_time,
  DROP COLUMN IF EXISTS override_end_time,
  DROP COLUMN IF EXISTS override_reason;
