BEGIN;

WITH ranked_attendance AS (
  SELECT
    attendance_id,
    ROW_NUMBER() OVER (
      PARTITION BY enrollment_id, attendance_date
      ORDER BY
        CASE status
          WHEN 'on time' THEN 5
          WHEN 'late' THEN 4
          WHEN 'excused' THEN 3
          WHEN 'absent' THEN 2
          WHEN 'not enrolled' THEN 1
          ELSE 0
        END DESC,
        COALESCE(marked_at, check_in_time, updated_at, created_at) DESC,
        attendance_id DESC
    ) AS row_rank
  FROM public.attendance
),
deleted_attendance AS (
  DELETE FROM public.attendance attendance_row
  USING ranked_attendance ranked_row
  WHERE attendance_row.attendance_id = ranked_row.attendance_id
    AND ranked_row.row_rank > 1
  RETURNING attendance_row.attendance_id
)
SELECT COUNT(*) FROM deleted_attendance;

WITH ranked_hosts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY session_id, attendance_date
      ORDER BY
        CASE WHEN host_address = 'SESSION_NOT_HELD' THEN 0 ELSE 1 END DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS row_rank
  FROM public.session_date_host
),
deleted_hosts AS (
  DELETE FROM public.session_date_host host_row
  USING ranked_hosts ranked_row
  WHERE host_row.id = ranked_row.id
    AND ranked_row.row_rank > 1
  RETURNING host_row.id
)
SELECT COUNT(*) FROM deleted_hosts;

WITH ranked_feedback AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY session_id, attendance_date, student_id
      ORDER BY
        created_at DESC,
        id DESC
    ) AS row_rank
  FROM public.session_feedback
  WHERE student_id IS NOT NULL
),
deleted_feedback AS (
  DELETE FROM public.session_feedback feedback_row
  USING ranked_feedback ranked_row
  WHERE feedback_row.id = ranked_row.id
    AND ranked_row.row_rank > 1
  RETURNING feedback_row.id
)
SELECT COUNT(*) FROM deleted_feedback;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_enrollment_date_unique
  ON public.attendance(enrollment_id, attendance_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_date_host_session_date_unique
  ON public.session_date_host(session_id, attendance_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_feedback_student_session_date_unique
  ON public.session_feedback(session_id, attendance_date, student_id)
  WHERE student_id IS NOT NULL;

COMMIT;