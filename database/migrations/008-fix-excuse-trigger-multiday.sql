-- Migration 008: Fix validate_excuse_request_session_day trigger
-- ============================================================================
-- PROBLEM:
--   The existing trigger uses a CASE statement that only handles a single day
--   string (e.g. 'monday'). Multi-day sessions like 'Friday, Sunday' produce
--   a NULL CASE result → the trigger raises "Unsupported session day value"
--   which causes ALL excuse inserts for multi-day sessions to fail.
--   Additionally the trigger does not consult session_day_change history, so
--   a date that was valid before a day change is incorrectly rejected.
--
-- FIX:
--   Rewrite function to:
--     1. Resolve the effective day(s) for the excuse date by checking
--        session_day_change history (most-recent change on or before the date).
--     2. Split comma-separated day strings into an array.
--     3. Accept the excuse date when its DOW matches ANY of the scheduled days.
--     4. Skip raising an exception for unrecognised day strings (allow by default).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_excuse_request_session_day()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_day    TEXT;
  v_effective_day  TEXT;
  v_first_old_day  TEXT;
  v_actual_dow     INT;
  v_days           TEXT[];
  v_day            TEXT;
  v_day_dow        INT;
BEGIN
  -- Fetch the current canonical day(s) for this session
  SELECT LOWER(day) INTO v_session_day
  FROM public.session
  WHERE session_id = NEW.session_id;

  -- No day configured → no day constraint, always allow
  IF v_session_day IS NULL OR TRIM(v_session_day) = '' THEN
    RETURN NEW;
  END IF;

  -- -------------------------------------------------------------------------
  -- Resolve effective day(s) for the excuse attendance_date using day-change history
  -- -------------------------------------------------------------------------

  -- Find the most recent change that was in effect on or before the excuse date
  SELECT LOWER(new_day) INTO v_effective_day
  FROM public.session_day_change
  WHERE session_id = NEW.session_id
    AND effective_date <= NEW.attendance_date
  ORDER BY effective_date DESC
  LIMIT 1;

  IF v_effective_day IS NOT NULL AND TRIM(v_effective_day) <> '' THEN
    -- A scheduled-day change was active on this date → use it
    v_session_day := v_effective_day;
  ELSE
    -- No in-effect change found: if ANY change exists, the date may be BEFORE
    -- the first change so use that change's old_day (the original schedule)
    SELECT LOWER(old_day) INTO v_first_old_day
    FROM public.session_day_change
    WHERE session_id = NEW.session_id
    ORDER BY effective_date ASC
    LIMIT 1;

    IF v_first_old_day IS NOT NULL AND TRIM(v_first_old_day) <> '' THEN
      v_session_day := v_first_old_day;
    END IF;
    -- Otherwise keep session.day as-is
  END IF;

  -- -------------------------------------------------------------------------
  -- Check whether attendance_date's DOW matches any of the scheduled day(s)
  -- (handles comma-separated multi-day strings, e.g. 'friday, sunday')
  -- -------------------------------------------------------------------------

  v_actual_dow := EXTRACT(DOW FROM NEW.attendance_date)::INT;
  v_days := string_to_array(v_session_day, ',');

  FOR i IN 1 .. array_length(v_days, 1) LOOP
    v_day := TRIM(v_days[i]);
    v_day_dow := CASE v_day
      WHEN 'sunday'    THEN 0
      WHEN 'monday'    THEN 1
      WHEN 'tuesday'   THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday'  THEN 4
      WHEN 'friday'    THEN 5
      WHEN 'saturday'  THEN 6
      ELSE NULL
    END;

    -- Unknown token → skip (do not block the insert)
    IF v_day_dow IS NULL THEN
      CONTINUE;
    END IF;

    -- DOW matches one of the scheduled days → valid date
    IF v_day_dow = v_actual_dow THEN
      RETURN NEW;
    END IF;
  END LOOP;

  -- No match found → reject with a clear message
  RAISE EXCEPTION
    'Invalid excuse date %. Session (%) is not scheduled on %. Scheduled day(s): %.',
    NEW.attendance_date,
    NEW.session_id,
    TRIM(TO_CHAR(NEW.attendance_date, 'Day')),
    v_session_day;

  RETURN NEW; -- unreachable, satisfies compiler
END;
$$;

COMMIT;
