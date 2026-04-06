-- ============================================================================
-- Migration 021: Enterprise Hardening
-- ============================================================================
-- Addresses 11 audit findings — security, integrity, correctness, metadata.
--
-- Changes:
--   1. SET search_path = public on ALL SECURITY DEFINER functions (CWE-426)
--   2. Fix uuid_generate_v4() → gen_random_uuid() in generate_qr_session
--   3. Add CHECK (end_page >= start_page) on course_book_reference
--   4. Fix feedback_question RLS: replace broad teacher policy with scoped one
--   5. Enforce NOT NULL on audit_log.changed_at
--   6. Drop redundant CHECK on qr_sessions.attendance_date
--   7. Add COMMENT ON TABLE for all 32 tables (self-documenting schema)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SECURITY DEFINER HARDENING — SET search_path = public
--    Without this, a malicious user could create objects in a schema that
--    precedes 'public' in the search_path, hijacking function logic.
--    Reference: https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
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

-- generate_qr_session: fix uuid_generate_v4 → gen_random_uuid + add search_path
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
    SELECT time, grace_period_minutes
    INTO v_session_time_str, v_grace_period
    FROM public.session
    WHERE session_id = p_session_id;

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

  -- gen_random_uuid(): native PostgreSQL 13+, no extension dependency
  v_token := gen_random_uuid();

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

-- validate_qr_token: add search_path
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

-- invalidate_qr_session: add search_path
CREATE OR REPLACE FUNCTION public.invalidate_qr_session(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.qr_sessions SET is_valid = false WHERE token = p_token;
  RETURN FOUND;
END;
$$;

-- ============================================================================
-- 2. DATA INTEGRITY: course_book_reference end_page >= start_page
-- ============================================================================

ALTER TABLE public.course_book_reference
  ADD CONSTRAINT course_book_reference_page_range_check
  CHECK (end_page >= start_page);

-- ============================================================================
-- 3. FIX feedback_question RLS — remove overly-broad teacher policy
--    The "Teachers and admins can manage" FOR ALL policy made the scoped
--    "Teachers can manage own session" policy irrelevant (policies are OR'd).
--    Replace with proper Admin-only + scoped Teacher pattern.
-- ============================================================================

DROP POLICY IF EXISTS "Teachers and admins can manage feedback questions" ON feedback_question;

-- Add proper admin-only full access (was previously bundled with teacher)
CREATE POLICY "Admin has full access" ON feedback_question
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- "Teachers can manage own session feedback questions" already exists — unchanged.
-- "Anyone can read feedback questions" already exists — unchanged.

-- ============================================================================
-- 4. ENFORCE NOT NULL on audit_log.changed_at
-- ============================================================================

UPDATE public.audit_log SET changed_at = COALESCE(deleted_at, now()) WHERE changed_at IS NULL;
ALTER TABLE public.audit_log ALTER COLUMN changed_at SET NOT NULL;

-- ============================================================================
-- 5. DROP REDUNDANT CHECK on qr_sessions.attendance_date
--    Column is already NOT NULL — the CHECK (attendance_date IS NOT NULL) is noise.
-- ============================================================================

ALTER TABLE public.qr_sessions DROP CONSTRAINT IF EXISTS qr_sessions_attendance_date_check;

-- ============================================================================
-- 6. SELF-DOCUMENTING SCHEMA — COMMENT ON TABLE
--    Queryable via \dt+ in psql or information_schema.
-- ============================================================================

COMMENT ON TABLE public.admin IS 'Platform administrators with full system access';
COMMENT ON TABLE public.specialization IS 'Lookup table for student/teacher specialization domains';
COMMENT ON TABLE public.teacher IS 'Instructors who manage courses, sessions, and student enrollment';
COMMENT ON TABLE public.student IS 'Learners enrolled in training sessions';
COMMENT ON TABLE public.course IS 'Curriculum definitions owned by a teacher';
COMMENT ON TABLE public.session IS 'Scheduled course delivery — date range, day(s), time, and configuration';
COMMENT ON TABLE public.enrollment IS 'Student ↔ session binding with status lifecycle (active → completed/dropped)';
COMMENT ON TABLE public.attendance IS 'Per-date attendance record for each enrollment — status, GPS, timing';
COMMENT ON TABLE public.qr_sessions IS 'Time-limited QR/photo check-in tokens generated per session date';
COMMENT ON TABLE public.photo_checkin_sessions IS 'Face-recognition check-in sessions linked to QR tokens';
COMMENT ON TABLE public.session_date_host IS 'Per-date host assignment and location override for a session';
COMMENT ON TABLE public.session_day_change IS 'Audit trail of session schedule day changes with effective dates';
COMMENT ON TABLE public.session_time_change IS 'Audit trail of session schedule time changes with effective dates';
COMMENT ON TABLE public.teacher_host_schedule IS 'Teacher-hosted session dates (when teacher_can_host is enabled)';
COMMENT ON TABLE public.session_recording IS 'Session recordings with visibility controls and soft-delete';
COMMENT ON TABLE public.course_book_reference IS 'Hierarchical book/page references linked to a course';
COMMENT ON TABLE public.session_book_coverage IS 'Tracks which book references were covered on each session date';
COMMENT ON TABLE public.scoring_config IS 'Teacher-owned scoring formula: weights, late brackets (JSONB), decay curves';
COMMENT ON TABLE public.excuse_request IS 'Student absence excuse workflow — pending → approved/rejected/cancelled';
COMMENT ON TABLE public.feedback_question IS 'Per-session, per-date feedback questions (rating, text, emoji, multiple choice)';
COMMENT ON TABLE public.feedback_template IS 'Reusable feedback question templates for quick session setup';
COMMENT ON TABLE public.session_feedback IS 'Student-submitted feedback responses with optional anonymity';
COMMENT ON TABLE public.certificate_template IS 'Certificate layout and criteria templates (completion, attendance, achievement)';
COMMENT ON TABLE public.issued_certificate IS 'Individually issued certificates with unique verification codes';
COMMENT ON TABLE public.announcement IS 'Teacher/admin announcements — global or course-scoped, with priority and expiry';
COMMENT ON TABLE public.announcement_read IS 'Tracks which students have read which announcements';
COMMENT ON TABLE public.announcement_comment IS 'Threaded comments on announcements (teacher or student)';
COMMENT ON TABLE public.announcement_reaction IS 'Emoji reactions on announcements';
COMMENT ON TABLE public.message IS 'Direct messages between teachers, students, and admins';
COMMENT ON TABLE public.message_reaction IS 'Emoji reactions on messages';
COMMENT ON TABLE public.message_starred IS 'User-starred messages for quick access';
COMMENT ON TABLE public.audit_log IS 'Immutable audit trail — INSERT/UPDATE/DELETE operations with old/new data snapshots';

COMMIT;
