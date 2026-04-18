-- ============================================================
-- Migration 047: Fix session_schedule_exception new_day_of_week backfill
-- Migration 046 didn't populate new_day_of_week from session_day_change.new_day.
-- Also fixes exception_type for rows where old_day == new_day (pure time change).
-- ============================================================

BEGIN;

-- 1. Backfill new_day_of_week from legacy session_day_change
UPDATE session_schedule_exception se
SET new_day_of_week = CASE LOWER(TRIM(dc.new_day))
    WHEN 'sunday'    THEN 0
    WHEN 'monday'    THEN 1
    WHEN 'tuesday'   THEN 2
    WHEN 'wednesday' THEN 3
    WHEN 'thursday'  THEN 4
    WHEN 'friday'    THEN 5
    WHEN 'saturday'  THEN 6
  END
FROM session_day_change dc
WHERE dc.session_id = se.session_id
  AND dc.effective_date = se.original_date
  AND se.new_day_of_week IS NULL;

-- 2. Downgrade exception_type where old_day == new_day (no actual day change)
UPDATE session_schedule_exception se
SET exception_type = 'time_change',
    new_day_of_week = NULL
FROM session_day_change dc
WHERE dc.session_id = se.session_id
  AND dc.effective_date = se.original_date
  AND se.exception_type = 'time_and_day_change'
  AND LOWER(TRIM(dc.old_day)) = LOWER(TRIM(dc.new_day));

COMMIT;
