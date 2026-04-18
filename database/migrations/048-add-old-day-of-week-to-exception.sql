-- Migration 048: Add old_day_of_week to session_schedule_exception
-- Purpose: Enables generateAttendanceDates to reconstruct initial schedule segments
-- from the new table (old_day is needed to determine the day BEFORE a change).

ALTER TABLE public.session_schedule_exception
  ADD COLUMN IF NOT EXISTS old_day_of_week SMALLINT;

ALTER TABLE public.session_schedule_exception
  ADD CONSTRAINT chk_exception_old_day_range
  CHECK (old_day_of_week IS NULL OR (old_day_of_week BETWEEN 0 AND 6));

-- Backfill from legacy session_day_change
UPDATE public.session_schedule_exception se
SET old_day_of_week = CASE lower(trim(dc.old_day))
  WHEN 'sunday' THEN 0
  WHEN 'monday' THEN 1
  WHEN 'tuesday' THEN 2
  WHEN 'wednesday' THEN 3
  WHEN 'thursday' THEN 4
  WHEN 'friday' THEN 5
  WHEN 'saturday' THEN 6
  ELSE NULL
END
FROM public.session_day_change dc
WHERE dc.session_id = se.session_id
  AND dc.effective_date::date = se.original_date
  AND se.exception_type IN ('day_change', 'time_and_day_change')
  AND se.old_day_of_week IS NULL;
