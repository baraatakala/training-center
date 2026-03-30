-- ============================================================================
-- Training Center — Functions & Triggers
-- ============================================================================
-- Run order: 2 of 6 (after schema.sql)
-- All database functions, trigger functions, and trigger bindings.
-- ============================================================================

-- ============================================================================
-- 1. ROLE-CHECK HELPER FUNCTIONS (used by RLS policies)
-- ============================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM teacher
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_student_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT student_id FROM student
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. TIMESTAMP TRIGGER FUNCTIONS
-- ============================================================================

-- Generic updated_at trigger (used by most tables)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Certificate template timestamp
CREATE OR REPLACE FUNCTION update_certificate_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Issued certificate timestamp
CREATE OR REPLACE FUNCTION update_issued_certificate_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Scoring config timestamp
CREATE OR REPLACE FUNCTION update_scoring_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Excuse request timestamp
CREATE OR REPLACE FUNCTION update_excuse_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Announcement timestamp
CREATE OR REPLACE FUNCTION update_announcement_timestamp()
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
    FROM announcement a
    LEFT JOIN announcement_read ar ON a.announcement_id = ar.announcement_id
      AND ar.student_id = p_student_id
    WHERE ar.read_id IS NULL
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND (
        a.course_id IS NULL
        OR EXISTS (
          SELECT 1 FROM enrollment e
          JOIN session s ON e.session_id = s.session_id
          WHERE e.student_id = p_student_id
            AND s.course_id = a.course_id
        )
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Unread message count
CREATE OR REPLACE FUNCTION get_unread_message_count(p_user_type VARCHAR, p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM message
    WHERE recipient_type = p_user_type
      AND recipient_id = p_user_id
      AND is_read = false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Late scoring weight lookup
CREATE OR REPLACE FUNCTION get_late_score_weight(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_weight DECIMAL(3,2);
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN 1.00;
  END IF;

  -- Try session-specific brackets first
  SELECT score_weight INTO v_weight
  FROM late_brackets
  WHERE session_id = p_session_id
    AND p_late_minutes >= min_minutes
    AND (max_minutes IS NULL OR p_late_minutes <= max_minutes)
  ORDER BY min_minutes DESC
  LIMIT 1;

  -- Fall back to global defaults
  IF v_weight IS NULL THEN
    SELECT score_weight INTO v_weight
    FROM late_brackets
    WHERE session_id IS NULL
      AND p_late_minutes >= min_minutes
      AND (max_minutes IS NULL OR p_late_minutes <= max_minutes)
    ORDER BY min_minutes DESC
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_weight, 0.50);
END;
$$ LANGUAGE plpgsql STABLE;

-- Late bracket info lookup (returns table)
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
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN QUERY SELECT
      'On Time'::VARCHAR(50),
      'في الوقت'::VARCHAR(50),
      1.00::DECIMAL(3,2),
      '#22c55e'::VARCHAR(20);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT lb.bracket_name, lb.bracket_name_ar, lb.score_weight, lb.display_color
  FROM late_brackets lb
  WHERE (lb.session_id = p_session_id OR lb.session_id IS NULL)
    AND p_late_minutes >= lb.min_minutes
    AND (lb.max_minutes IS NULL OR p_late_minutes <= lb.max_minutes)
  ORDER BY lb.session_id NULLS LAST, lb.min_minutes DESC
  LIMIT 1;
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
-- 4. TRIGGER BINDINGS
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

-- Specialized timestamp triggers
DROP TRIGGER IF EXISTS trg_certificate_template_updated ON certificate_template;
CREATE TRIGGER trg_certificate_template_updated
  BEFORE UPDATE ON certificate_template FOR EACH ROW EXECUTE FUNCTION update_certificate_template_timestamp();

DROP TRIGGER IF EXISTS trg_issued_certificate_updated ON issued_certificate;
CREATE TRIGGER trg_issued_certificate_updated
  BEFORE UPDATE ON issued_certificate FOR EACH ROW EXECUTE FUNCTION update_issued_certificate_timestamp();

DROP TRIGGER IF EXISTS scoring_config_updated ON scoring_config;
CREATE TRIGGER scoring_config_updated
  BEFORE UPDATE ON scoring_config FOR EACH ROW EXECUTE FUNCTION update_scoring_config_timestamp();

DROP TRIGGER IF EXISTS trigger_excuse_request_updated_at ON excuse_request;
CREATE TRIGGER trigger_excuse_request_updated_at
  BEFORE UPDATE ON excuse_request FOR EACH ROW EXECUTE FUNCTION update_excuse_request_updated_at();

DROP TRIGGER IF EXISTS trigger_update_announcement_timestamp ON announcement;
CREATE TRIGGER trigger_update_announcement_timestamp
  BEFORE UPDATE ON announcement FOR EACH ROW EXECUTE FUNCTION update_announcement_timestamp();

-- Business logic triggers
DROP TRIGGER IF EXISTS trg_book_ref_same_course ON course_book_reference;
CREATE TRIGGER trg_book_ref_same_course
  BEFORE INSERT OR UPDATE ON course_book_reference FOR EACH ROW EXECUTE FUNCTION check_book_ref_same_course();

DROP TRIGGER IF EXISTS trg_validate_excuse_request_session_day ON excuse_request;
CREATE TRIGGER trg_validate_excuse_request_session_day
  BEFORE INSERT OR UPDATE OF session_id, attendance_date ON excuse_request
  FOR EACH ROW EXECUTE FUNCTION validate_excuse_request_session_day();
