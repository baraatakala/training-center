-- ============================================================================
-- Migration 042: QA Hardening — search_path, missing indexes, constraints
-- ============================================================================
-- Fixes all findings from the end-to-end QA audit:
--   1. Pin search_path on 11 functions that lacked it (CWE-426 mitigation)
--   2. Add 4 missing FK indexes (Supabase advisor finding)
--   3. Add DEFAULT gen_random_uuid()::text to photo_checkin_sessions.token
--   4. Add minimum course description length constraint
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FIX MUTABLE search_path ON 11 FUNCTIONS
--    Supabase advisor flagged these as SECURITY WARN.
--    Functions that access public tables must pin search_path to prevent
--    search_path hijacking (CWE-426).
-- ============================================================================

-- 1a. update_updated_at_column (shared timestamp trigger)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 1b. get_late_score_weight
CREATE OR REPLACE FUNCTION get_late_score_weight(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_weight DECIMAL(3,2);
  v_teacher_id UUID;
  v_brackets JSONB;
  v_bracket JSONB;
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN 1.00;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM public.session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM public.scoring_config sc
  WHERE (v_teacher_id IS NOT NULL AND sc.teacher_id = v_teacher_id)
  ORDER BY sc.is_default DESC
  LIMIT 1;

  IF v_brackets IS NOT NULL THEN
    FOR v_bracket IN SELECT * FROM jsonb_array_elements(v_brackets)
    LOOP
      IF p_late_minutes >= (v_bracket->>'min')::INT
         AND (v_bracket->>'max' IS NULL OR p_late_minutes <= (v_bracket->>'max')::INT) THEN
        v_weight := COALESCE((v_bracket->>'score_weight')::DECIMAL(3,2), 0.50);
        RETURN v_weight;
      END IF;
    END LOOP;
  END IF;

  RETURN 0.50;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 1c. get_late_bracket_info
CREATE OR REPLACE FUNCTION get_late_bracket_info(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  bracket_name VARCHAR(50),
  bracket_name_ar VARCHAR(50),
  score_weight DECIMAL(3,2),
  display_color VARCHAR(20)
) AS $$
DECLARE
  v_teacher_id UUID;
  v_brackets JSONB;
  v_bracket JSONB;
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN QUERY SELECT
      'On Time'::VARCHAR(50),
      'في الوقت'::VARCHAR(50),
      1.00::DECIMAL(3,2),
      '#22c55e'::VARCHAR(20);
    RETURN;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM public.session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM public.scoring_config sc
  WHERE (v_teacher_id IS NOT NULL AND sc.teacher_id = v_teacher_id)
  ORDER BY sc.is_default DESC
  LIMIT 1;

  IF v_brackets IS NOT NULL THEN
    FOR v_bracket IN SELECT * FROM jsonb_array_elements(v_brackets)
    LOOP
      IF p_late_minutes >= (v_bracket->>'min')::INT
         AND (v_bracket->>'max' IS NULL OR p_late_minutes <= (v_bracket->>'max')::INT) THEN
        RETURN QUERY SELECT
          COALESCE((v_bracket->>'name')::VARCHAR(50), 'Late'::VARCHAR(50)),
          COALESCE((v_bracket->>'name_ar')::VARCHAR(50), 'متأخر'::VARCHAR(50)),
          COALESCE((v_bracket->>'score_weight')::DECIMAL(3,2), 0.50::DECIMAL(3,2)),
          COALESCE((v_bracket->>'color')::VARCHAR(20), '#ef4444'::VARCHAR(20));
        RETURN;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT
    'Late'::VARCHAR(50),
    'متأخر'::VARCHAR(50),
    0.50::DECIMAL(3,2),
    '#ef4444'::VARCHAR(20);
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 1d. check_book_ref_same_course
CREATE OR REPLACE FUNCTION check_book_ref_same_course()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.course_book_reference
      WHERE reference_id = NEW.parent_id AND course_id = NEW.course_id
    ) THEN
      RAISE EXCEPTION 'Parent reference must belong to the same course';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 1e. validate_excuse_request_session_day
CREATE OR REPLACE FUNCTION public.validate_excuse_request_session_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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
  SELECT LOWER(day) INTO v_session_day
  FROM public.session
  WHERE session_id = NEW.session_id;

  IF v_session_day IS NULL OR TRIM(v_session_day) = '' THEN
    RETURN NEW;
  END IF;

  SELECT LOWER(new_day) INTO v_effective_day
  FROM public.session_day_change
  WHERE session_id = NEW.session_id
    AND effective_date <= NEW.attendance_date
  ORDER BY effective_date DESC
  LIMIT 1;

  IF v_effective_day IS NOT NULL AND TRIM(v_effective_day) <> '' THEN
    v_session_day := v_effective_day;
  ELSE
    SELECT LOWER(old_day) INTO v_first_old_day
    FROM public.session_day_change
    WHERE session_id = NEW.session_id
    ORDER BY effective_date ASC
    LIMIT 1;

    IF v_first_old_day IS NOT NULL AND TRIM(v_first_old_day) <> '' THEN
      v_session_day := v_first_old_day;
    END IF;
  END IF;

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

    IF v_day_dow IS NULL THEN CONTINUE; END IF;
    IF v_day_dow = v_actual_dow THEN RETURN NEW; END IF;
  END LOOP;

  RAISE EXCEPTION
    'Invalid excuse date %. Session (%) is not scheduled on %. Scheduled day(s): %.',
    NEW.attendance_date,
    NEW.session_id,
    TRIM(TO_CHAR(NEW.attendance_date, 'Day')),
    v_session_day;

  RETURN NEW;
END;
$$;

-- 1f. calculate_gps_distance
CREATE OR REPLACE FUNCTION public.calculate_gps_distance(
  lat1 DOUBLE PRECISION,
  lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  R CONSTANT DOUBLE PRECISION := 6371000;
  dlat DOUBLE PRECISION;
  dlon DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat / 2) ^ 2
     + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ^ 2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  RETURN R * c;
END;
$$;

-- 1g. fn_enforce_can_host_on_status_change
CREATE OR REPLACE FUNCTION public.fn_enforce_can_host_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.can_host = true THEN
    NEW.can_host := false;
  END IF;
  RETURN NEW;
END;
$$;

-- 1h. fn_enforce_attendance_student_match
CREATE OR REPLACE FUNCTION public.fn_enforce_attendance_student_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_enrollment_student_id UUID;
BEGIN
  SELECT student_id INTO v_enrollment_student_id
  FROM public.enrollment
  WHERE enrollment_id = NEW.enrollment_id;

  IF v_enrollment_student_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', NEW.enrollment_id;
  END IF;

  IF NEW.student_id <> v_enrollment_student_id THEN
    RAISE WARNING 'attendance student_id mismatch: got %, expected % (from enrollment %). Auto-correcting.',
      NEW.student_id, v_enrollment_student_id, NEW.enrollment_id;
    NEW.student_id := v_enrollment_student_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 1i. fn_feedback_anonymize_on_student_null
CREATE OR REPLACE FUNCTION public.fn_feedback_anonymize_on_student_null()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.student_id IS NULL AND OLD.student_id IS NOT NULL THEN
    NEW.is_anonymous := true;
  END IF;
  RETURN NEW;
END;
$$;

-- 1j. cleanup_expired_qr_sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_qr_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM public.qr_sessions WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- 1k. get_attendance_stats_by_session (sql, not plpgsql — use SET in CREATE)
CREATE OR REPLACE FUNCTION get_attendance_stats_by_session(p_session_id UUID)
RETURNS TABLE (
  total_records  BIGINT,
  on_time_count  BIGINT,
  late_count     BIGINT,
  absent_count   BIGINT,
  excused_count  BIGINT,
  unique_dates   BIGINT,
  unique_students BIGINT,
  avg_late_minutes NUMERIC
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    count(*)                                                    AS total_records,
    count(*) FILTER (WHERE status = 'on time')                  AS on_time_count,
    count(*) FILTER (WHERE status = 'late')                     AS late_count,
    count(*) FILTER (WHERE status = 'absent')                   AS absent_count,
    count(*) FILTER (WHERE status = 'excused')                  AS excused_count,
    count(DISTINCT attendance_date)                              AS unique_dates,
    count(DISTINCT student_id)                                  AS unique_students,
    round(avg(late_minutes) FILTER (WHERE late_minutes > 0), 1) AS avg_late_minutes
  FROM public.attendance
  WHERE session_id = p_session_id;
$$;

-- ============================================================================
-- 2. ADD 4 MISSING FK INDEXES (Supabase advisor: unindexed foreign keys)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_issued_certificate_course_id
  ON public.issued_certificate(course_id);

CREATE INDEX IF NOT EXISTS idx_issued_certificate_signer_teacher_id
  ON public.issued_certificate(signer_teacher_id);

CREATE INDEX IF NOT EXISTS idx_session_book_coverage_reference_id
  ON public.session_book_coverage(reference_id);

CREATE INDEX IF NOT EXISTS idx_session_recording_uploaded_by
  ON public.session_recording(recording_uploaded_by);

-- ============================================================================
-- 3. ADD DEFAULT gen_random_uuid()::text ON photo_checkin_sessions.token
--    QR sessions auto-generate tokens; photo check-in should too.
-- ============================================================================

ALTER TABLE public.photo_checkin_sessions
  ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;

-- ============================================================================
-- 4. ADD MINIMUM COURSE DESCRIPTION LENGTH CONSTRAINT
--    QA test 86 found a 4-char description was accepted.
--    Only enforce when description is non-NULL (NULL = no description yet).
-- ============================================================================

ALTER TABLE public.course
  DROP CONSTRAINT IF EXISTS course_description_length_check;

ALTER TABLE public.course
  ADD CONSTRAINT course_description_length_check
    CHECK (description IS NULL OR (char_length(description) >= 10 AND char_length(description) <= 6000));

COMMIT;
