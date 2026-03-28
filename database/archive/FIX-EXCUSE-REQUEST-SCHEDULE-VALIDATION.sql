-- Prevent excuse requests from being created for dates that do not match the session schedule.
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.validate_excuse_request_session_day()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_day_text text;
  expected_dow int;
  actual_dow int;
BEGIN
  SELECT lower(day)
  INTO session_day_text
  FROM public.session
  WHERE session_id = NEW.session_id;

  IF session_day_text IS NULL THEN
    RAISE EXCEPTION 'Session schedule day could not be verified for session %', NEW.session_id;
  END IF;

  expected_dow := CASE session_day_text
    WHEN 'sunday' THEN 0
    WHEN 'monday' THEN 1
    WHEN 'tuesday' THEN 2
    WHEN 'wednesday' THEN 3
    WHEN 'thursday' THEN 4
    WHEN 'friday' THEN 5
    WHEN 'saturday' THEN 6
    ELSE NULL
  END;

  IF expected_dow IS NULL THEN
    RAISE EXCEPTION 'Unsupported session day value: %', session_day_text;
  END IF;

  actual_dow := EXTRACT(DOW FROM NEW.attendance_date);

  IF actual_dow <> expected_dow THEN
    RAISE EXCEPTION 'Invalid excuse date %. Session is scheduled on %, but selected date is %.',
      NEW.attendance_date,
      initcap(session_day_text),
      trim(to_char(NEW.attendance_date, 'Day'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_excuse_request_session_day ON public.excuse_request;

CREATE TRIGGER trg_validate_excuse_request_session_day
BEFORE INSERT OR UPDATE OF session_id, attendance_date
ON public.excuse_request
FOR EACH ROW
EXECUTE FUNCTION public.validate_excuse_request_session_day();

-- Audit query: find existing invalid excuse requests already in the database.
SELECT
  er.request_id,
  er.student_id,
  er.session_id,
  s.day AS scheduled_day,
  er.attendance_date,
  trim(to_char(er.attendance_date, 'Day')) AS actual_day,
  er.status,
  er.reason
FROM public.excuse_request er
JOIN public.session s ON s.session_id = er.session_id
WHERE EXTRACT(DOW FROM er.attendance_date) <> CASE lower(s.day)
  WHEN 'sunday' THEN 0
  WHEN 'monday' THEN 1
  WHEN 'tuesday' THEN 2
  WHEN 'wednesday' THEN 3
  WHEN 'thursday' THEN 4
  WHEN 'friday' THEN 5
  WHEN 'saturday' THEN 6
  ELSE -1
END
ORDER BY er.attendance_date DESC;