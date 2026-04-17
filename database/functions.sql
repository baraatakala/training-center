-- ============================================================================
-- Training Center — Functions & Triggers
-- ============================================================================
-- Run order: 2 of 6 (after schema.sql)
-- All database functions, trigger functions, and trigger bindings.
-- Synced with live Supabase as of 2025-07-17 (through migration 041).
-- ============================================================================

-- ============================================================================
-- 1. ROLE-CHECK HELPER FUNCTIONS (used by RLS policies)
--    All SECURITY DEFINER functions include SET search_path = public
--    to prevent search_path hijacking (CWE-426).
-- ============================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admin
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.teacher
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_my_student_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT student_id FROM public.student
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 2. TIMESTAMP TRIGGER FUNCTIONS
-- ============================================================================

-- Generic updated_at trigger (shared by ALL tables — migration 020 consolidated
-- 5 redundant per-table functions into this single one).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. BUSINESS LOGIC FUNCTIONS
-- ============================================================================

-- Unread announcement count for a student
CREATE OR REPLACE FUNCTION get_unread_announcement_count(p_student_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM public.announcement a
    LEFT JOIN public.announcement_read ar ON a.announcement_id = ar.announcement_id
      AND ar.student_id = p_student_id
    WHERE ar.read_id IS NULL
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND (
        a.course_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.enrollment e
          JOIN public.session s ON e.session_id = s.session_id
          WHERE e.student_id = p_student_id
            AND s.course_id = a.course_id
        )
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- NOTE: get_unread_message_count was removed in migration 017 (never called).

-- Late scoring weight lookup (reads from scoring_config.late_brackets JSONB)
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

  -- Look up the teacher's scoring config via the session
  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM scoring_config sc
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
$$ LANGUAGE plpgsql STABLE;

-- Late bracket info lookup (reads from scoring_config.late_brackets JSONB)
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

  -- Look up the teacher's scoring config via the session
  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM scoring_config sc
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

  -- Fallback if no bracket matched
  RETURN QUERY SELECT
    'Late'::VARCHAR(50),
    'متأخر'::VARCHAR(50),
    0.50::DECIMAL(3,2),
    '#ef4444'::VARCHAR(20);
END;
$$ LANGUAGE plpgsql STABLE;

-- Book reference parent-course validation
CREATE OR REPLACE FUNCTION check_book_ref_same_course()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM course_book_reference
      WHERE reference_id = NEW.parent_id AND course_id = NEW.course_id
    ) THEN
      RAISE EXCEPTION 'Parent reference must belong to the same course';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Excuse request date validation against session schedule
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

  -- Resolve effective day(s) for the excuse date using day-change history
  -- Find the most recent change that was in effect on or before the excuse date
  SELECT LOWER(new_day) INTO v_effective_day
  FROM public.session_day_change
  WHERE session_id = NEW.session_id
    AND effective_date <= NEW.attendance_date
  ORDER BY effective_date DESC
  LIMIT 1;

  IF v_effective_day IS NOT NULL AND TRIM(v_effective_day) <> '' THEN
    v_session_day := v_effective_day;
  ELSE
    -- No in-effect change: if ANY change exists, use that change's old_day
    -- (the date may be before the first change, i.e. the original schedule)
    SELECT LOWER(old_day) INTO v_first_old_day
    FROM public.session_day_change
    WHERE session_id = NEW.session_id
    ORDER BY effective_date ASC
    LIMIT 1;

    IF v_first_old_day IS NOT NULL AND TRIM(v_first_old_day) <> '' THEN
      v_session_day := v_first_old_day;
    END IF;
  END IF;

  -- Check if attendance_date DOW matches any scheduled day
  -- (handles comma-separated multi-day strings, e.g. 'friday, sunday')
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

    IF v_day_dow IS NULL THEN CONTINUE; END IF; -- unknown token, skip
    IF v_day_dow = v_actual_dow THEN RETURN NEW; END IF; -- matched
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

-- ============================================================================
-- 4. QR / CHECK-IN FUNCTIONS
-- ============================================================================

-- GPS distance calculation (Haversine formula)
CREATE OR REPLACE FUNCTION public.calculate_gps_distance(
  lat1 DOUBLE PRECISION,
  lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
AS $$
DECLARE
  R CONSTANT DOUBLE PRECISION := 6371000; -- Earth radius in metres
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

-- Generate a QR check-in session (called by frontend via .rpc)
CREATE OR REPLACE FUNCTION public.generate_qr_session(
  p_session_id UUID,
  p_attendance_date DATE,
  p_created_by TEXT DEFAULT NULL,
  p_check_in_mode TEXT DEFAULT 'qr_code',
  p_linked_photo_token TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID;
  v_qr_session_id UUID;
  v_session_time_str VARCHAR;
  v_effective_time TEXT;
  v_session_time TIME;
  v_grace_period INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_mode TEXT;
  v_linked_photo_token TEXT;
BEGIN
  v_mode := COALESCE(NULLIF(trim(p_check_in_mode), ''), 'qr_code');
  v_linked_photo_token := NULLIF(trim(COALESCE(p_linked_photo_token, '')), '');

  IF v_mode NOT IN ('qr_code', 'photo') THEN
    RAISE EXCEPTION 'Unsupported check-in mode: %', v_mode;
  END IF;

  IF v_mode = 'photo' AND v_linked_photo_token IS NULL THEN
    RAISE EXCEPTION 'Photo mode QR sessions require a linked photo token';
  END IF;

  IF v_mode = 'qr_code' THEN
    v_linked_photo_token := NULL;
  END IF;

  IF p_expires_at IS NOT NULL THEN
    v_expires_at := p_expires_at;
  ELSE
    -- Get default session time and grace period
    SELECT time, grace_period_minutes
    INTO v_session_time_str, v_grace_period
    FROM session
    WHERE session_id = p_session_id;

    -- Check for effective time override from session_time_change
    SELECT new_time INTO v_effective_time
    FROM session_time_change
    WHERE session_id = p_session_id
      AND effective_date <= p_attendance_date
    ORDER BY effective_date DESC
    LIMIT 1;

    -- Use effective time if available, otherwise fall back to session default
    IF v_effective_time IS NOT NULL THEN
      v_session_time_str := v_effective_time;
    END IF;

    IF v_session_time_str IS NULL OR v_session_time_str = '' THEN
      v_expires_at := now() + interval '2 hours';
    ELSE
      v_session_time := split_part(v_session_time_str, '-', 1)::TIME;
      v_expires_at := (p_attendance_date + v_session_time)::TIMESTAMPTZ
                      + (COALESCE(v_grace_period, 15) + 30) * interval '1 minute';
      IF v_expires_at < now() THEN
        v_expires_at := now() + interval '2 hours';
      END IF;
    END IF;
  END IF;

  v_token := gen_random_uuid();

  -- Invalidate any existing active token for the same session/date/mode slot
  -- to prevent 23505 from qr_sessions_active_unique (partial index on is_valid=true)
  -- when a teacher reopens the QR modal without the previous one being closed cleanly.
  UPDATE public.qr_sessions
  SET is_valid = false
  WHERE session_id = p_session_id
    AND attendance_date = p_attendance_date
    AND check_in_mode = v_mode
    AND is_valid = true;

  INSERT INTO public.qr_sessions (
    token, session_id, attendance_date, expires_at,
    created_by, check_in_mode, linked_photo_token
  )
  VALUES (
    v_token, p_session_id, p_attendance_date, v_expires_at,
    p_created_by, v_mode, v_linked_photo_token
  )
  RETURNING qr_session_id INTO v_qr_session_id;

  RETURN json_build_object(
    'qr_session_id', v_qr_session_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'check_in_mode', v_mode,
    'linked_photo_token', v_linked_photo_token
  );
END;
$$;

-- Validate a QR token during student check-in (called by frontend via .rpc)
CREATE OR REPLACE FUNCTION public.validate_qr_token(
  p_token UUID,
  p_session_id UUID,
  p_attendance_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr_session public.qr_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_qr_session
  FROM public.qr_sessions
  WHERE token = p_token
    AND session_id = p_session_id
    AND attendance_date = p_attendance_date;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Invalid QR code');
  END IF;

  IF v_qr_session.expires_at < now() THEN
    RETURN json_build_object('valid', false, 'message', 'QR code has expired', 'expired_at', v_qr_session.expires_at);
  END IF;

  IF NOT v_qr_session.is_valid THEN
    RETURN json_build_object('valid', false, 'message', 'QR code is no longer valid');
  END IF;

  UPDATE public.qr_sessions
  SET used_count = used_count + 1, last_used_at = now()
  WHERE token = p_token;

  RETURN json_build_object(
    'valid', true,
    'message', 'QR code is valid',
    'qr_session_id', v_qr_session.qr_session_id,
    'expires_at', v_qr_session.expires_at,
    'check_in_mode', v_qr_session.check_in_mode,
    'linked_photo_token', v_qr_session.linked_photo_token
  );
END;
$$;

-- Invalidate a QR session (called by frontend via .rpc)
CREATE OR REPLACE FUNCTION public.invalidate_qr_session(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE qr_sessions SET is_valid = false WHERE token = p_token;
  RETURN FOUND;
END;
$$;

-- Cleanup expired QR sessions (cron / manual)
CREATE OR REPLACE FUNCTION public.cleanup_expired_qr_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM qr_sessions WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- ============================================================================
-- 5. ENROLLMENT ENFORCEMENT
-- ============================================================================

-- Enforce can_host constraint: only active enrollments can be hosts.
-- When status changes away from 'active', reset can_host to false.
CREATE OR REPLACE FUNCTION public.fn_enforce_can_host_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.can_host = true THEN
    NEW.can_host := false;
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure attendance.student_id always matches enrollment.student_id.
-- Logs a WARNING when a mismatch is detected (visible in Supabase logs) then corrects.
-- This makes bugs visible while still not breaking bulk inserts.
CREATE OR REPLACE FUNCTION public.fn_enforce_attendance_student_match()
RETURNS TRIGGER
LANGUAGE plpgsql
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

-- ============================================================================
-- 5b. FEEDBACK INTEGRITY
-- ============================================================================

-- When a student is deleted (student_id SET NULL on session_feedback),
-- ensure is_anonymous is set to true so the row remains valid.
CREATE OR REPLACE FUNCTION public.fn_feedback_anonymize_on_student_null()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.student_id IS NULL AND OLD.student_id IS NOT NULL THEN
    NEW.is_anonymous := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 6. REPORTING / ANALYTICS FUNCTIONS
-- ============================================================================

-- Aggregate attendance stats for a single session (used by dashboard & exports)
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
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
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
-- 7. TRIGGER BINDINGS
-- ============================================================================

-- Generic updated_at triggers
DROP TRIGGER IF EXISTS update_admin_updated_at ON admin;
CREATE TRIGGER update_admin_updated_at
  BEFORE UPDATE ON admin FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teacher_updated_at ON teacher;
CREATE TRIGGER update_teacher_updated_at
  BEFORE UPDATE ON teacher FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_student_updated_at ON student;
CREATE TRIGGER update_student_updated_at
  BEFORE UPDATE ON student FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_course_updated_at ON course;
CREATE TRIGGER update_course_updated_at
  BEFORE UPDATE ON course FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_updated_at ON session;
CREATE TRIGGER update_session_updated_at
  BEFORE UPDATE ON session FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_enrollment_updated_at ON enrollment;
CREATE TRIGGER update_enrollment_updated_at
  BEFORE UPDATE ON enrollment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_attendance_updated_at ON attendance;
CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_date_host_updated_at ON session_date_host;
CREATE TRIGGER update_session_date_host_updated_at
  BEFORE UPDATE ON session_date_host FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_announcement_comment_updated_at ON announcement_comment;
CREATE TRIGGER update_announcement_comment_updated_at
  BEFORE UPDATE ON announcement_comment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_recording_updated_at ON session_recording;
CREATE TRIGGER update_session_recording_updated_at
  BEFORE UPDATE ON session_recording FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- All timestamp triggers now use the shared update_updated_at_column() (migration 020)
DROP TRIGGER IF EXISTS update_certificate_template_updated_at ON certificate_template;
CREATE TRIGGER update_certificate_template_updated_at
  BEFORE UPDATE ON certificate_template FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_issued_certificate_updated_at ON issued_certificate;
CREATE TRIGGER update_issued_certificate_updated_at
  BEFORE UPDATE ON issued_certificate FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scoring_config_updated_at ON scoring_config;
CREATE TRIGGER update_scoring_config_updated_at
  BEFORE UPDATE ON scoring_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_excuse_request_updated_at ON excuse_request;
CREATE TRIGGER update_excuse_request_updated_at
  BEFORE UPDATE ON excuse_request FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_announcement_updated_at ON announcement;
CREATE TRIGGER set_announcement_updated_at
  BEFORE UPDATE ON announcement FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_photo_checkin_sessions_updated_at ON photo_checkin_sessions;
CREATE TRIGGER set_photo_checkin_sessions_updated_at
  BEFORE UPDATE ON photo_checkin_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Business logic triggers
DROP TRIGGER IF EXISTS trg_book_ref_same_course ON course_book_reference;
CREATE TRIGGER trg_book_ref_same_course
  BEFORE INSERT OR UPDATE ON course_book_reference FOR EACH ROW EXECUTE FUNCTION check_book_ref_same_course();

DROP TRIGGER IF EXISTS trg_validate_excuse_request_session_day ON excuse_request;
CREATE TRIGGER trg_validate_excuse_request_session_day
  BEFORE INSERT OR UPDATE OF session_id, attendance_date ON excuse_request
  FOR EACH ROW EXECUTE FUNCTION validate_excuse_request_session_day();

-- Enrollment can_host enforcement (named aaa_ to fire first alphabetically)
DROP TRIGGER IF EXISTS aaa_enforce_can_host_on_status_change ON enrollment;
CREATE TRIGGER aaa_enforce_can_host_on_status_change
  BEFORE INSERT OR UPDATE ON enrollment
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_can_host_on_status_change();

-- Attendance ↔ enrollment student consistency
DROP TRIGGER IF EXISTS trg_enforce_attendance_student_match ON attendance;
CREATE TRIGGER trg_enforce_attendance_student_match
  BEFORE INSERT OR UPDATE OF student_id, enrollment_id ON attendance
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_attendance_student_match();

-- Feedback anonymization on student deletion
DROP TRIGGER IF EXISTS trg_feedback_anonymize_on_student_null ON session_feedback;
CREATE TRIGGER trg_feedback_anonymize_on_student_null
  BEFORE UPDATE OF student_id ON session_feedback
  FOR EACH ROW EXECUTE FUNCTION fn_feedback_anonymize_on_student_null();
