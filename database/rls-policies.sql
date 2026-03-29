-- ============================================================================
-- Training Center — Row Level Security Policies
-- ============================================================================
-- Run order: 4 of 6 (after indexes.sql)
-- Requires: functions.sql (is_admin, is_teacher, get_my_student_id)
--
-- Convention:
--   Admin  → full access (ALL) on every table
--   Teacher → SELECT + INSERT (not admin) on most tables
--   Student → SELECT only, scoped to own data where appropriate
-- ============================================================================

-- ============================================================================
-- 1. ADMIN TABLE
-- ============================================================================

ALTER TABLE admin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin read admin table" ON admin;
CREATE POLICY "Admin read admin table" ON admin
  FOR SELECT TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "Admin insert admin table" ON admin;
CREATE POLICY "Admin insert admin table" ON admin
  FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin update admin table" ON admin;
CREATE POLICY "Admin update admin table" ON admin
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin delete admin table" ON admin;
CREATE POLICY "Admin delete admin table" ON admin
  FOR DELETE TO authenticated USING (is_admin());

-- ============================================================================
-- 2. CORE TABLES (teacher, student, course, session, enrollment)
-- ============================================================================

-- teacher ---------------------------------------------------------------
ALTER TABLE teacher ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON teacher;
CREATE POLICY "Admin has full access" ON teacher
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON teacher;
CREATE POLICY "Teachers can read" ON teacher
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON teacher;
CREATE POLICY "Teachers can insert" ON teacher
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read teachers" ON teacher;
CREATE POLICY "Students can read teachers" ON teacher
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- student ---------------------------------------------------------------
ALTER TABLE student ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON student;
CREATE POLICY "Admin has full access" ON student
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON student;
CREATE POLICY "Teachers can read" ON student
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON student;
CREATE POLICY "Teachers can insert" ON student
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read students" ON student;
CREATE POLICY "Students can read students" ON student
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- course ----------------------------------------------------------------
ALTER TABLE course ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON course;
CREATE POLICY "Admin has full access" ON course
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON course;
CREATE POLICY "Teachers can read" ON course
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON course;
CREATE POLICY "Teachers can insert" ON course
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read courses" ON course;
CREATE POLICY "Students can read courses" ON course
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- session ---------------------------------------------------------------
ALTER TABLE session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON session;
CREATE POLICY "Admin has full access" ON session
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON session;
CREATE POLICY "Teachers can read" ON session
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON session;
CREATE POLICY "Teachers can insert" ON session
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read sessions" ON session;
CREATE POLICY "Students can read sessions" ON session
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- enrollment ------------------------------------------------------------
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON enrollment;
CREATE POLICY "Admin has full access" ON enrollment
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON enrollment;
CREATE POLICY "Teachers can read" ON enrollment
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON enrollment;
CREATE POLICY "Teachers can insert" ON enrollment
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read enrollments" ON enrollment;
CREATE POLICY "Students can read enrollments" ON enrollment
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- ============================================================================
-- 3. ATTENDANCE
-- ============================================================================

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON attendance;
CREATE POLICY "Admin has full access" ON attendance
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON attendance;
CREATE POLICY "Teachers can read" ON attendance
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON attendance;
CREATE POLICY "Teachers can insert" ON attendance
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read own attendance" ON attendance;
CREATE POLICY "Students can read own attendance" ON attendance
  FOR SELECT TO authenticated
  USING (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

DROP POLICY IF EXISTS "Students can insert own attendance" ON attendance;
CREATE POLICY "Students can insert own attendance" ON attendance
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

DROP POLICY IF EXISTS "Students can update own attendance" ON attendance;
CREATE POLICY "Students can update own attendance" ON attendance
  FOR UPDATE TO authenticated
  USING (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id())
  WITH CHECK (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

DROP POLICY IF EXISTS "Teachers can update" ON attendance;
CREATE POLICY "Teachers can update" ON attendance
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 4. SESSION MANAGEMENT
-- ============================================================================

-- session_date_host -----------------------------------------------------
ALTER TABLE session_date_host ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON session_date_host;
CREATE POLICY "Admin has full access" ON session_date_host
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON session_date_host;
CREATE POLICY "Teachers can read" ON session_date_host
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON session_date_host;
CREATE POLICY "Teachers can insert" ON session_date_host
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read session hosts" ON session_date_host;
CREATE POLICY "Students can read session hosts" ON session_date_host
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- session_day_change ----------------------------------------------------
ALTER TABLE session_day_change ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON session_day_change;
CREATE POLICY "Admin has full access" ON session_day_change
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON session_day_change;
CREATE POLICY "Teachers can read" ON session_day_change
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON session_day_change;
CREATE POLICY "Teachers can insert" ON session_day_change
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read day changes" ON session_day_change;
CREATE POLICY "Students can read day changes" ON session_day_change
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- teacher_host_schedule -------------------------------------------------
ALTER TABLE teacher_host_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON teacher_host_schedule;
CREATE POLICY "Admin has full access" ON teacher_host_schedule
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON teacher_host_schedule;
CREATE POLICY "Teachers can read" ON teacher_host_schedule
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON teacher_host_schedule;
CREATE POLICY "Teachers can insert" ON teacher_host_schedule
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read host schedule" ON teacher_host_schedule;
CREATE POLICY "Students can read host schedule" ON teacher_host_schedule
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- session_recording -----------------------------------------------------
ALTER TABLE session_recording ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to session recordings"   ON session_recording;
DROP POLICY IF EXISTS "Teachers have full access to session recordings" ON session_recording;
DROP POLICY IF EXISTS "Teachers have full access"                       ON session_recording;
DROP POLICY IF EXISTS "Students can view session recordings"            ON session_recording;
DROP POLICY IF EXISTS "Students can read visible session recordings"    ON session_recording;
DROP POLICY IF EXISTS "Enrolled students can view recordings"           ON session_recording;

CREATE POLICY "Admins have full access to session recordings" ON session_recording
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Teachers have full access to session recordings" ON session_recording
  FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher());

-- NOTE: student.student_id is uuid_generate_v4(), NOT auth.uid().
-- get_my_student_id() (SECURITY DEFINER) resolves student_id from auth.email().
CREATE POLICY "Students can view session recordings" ON session_recording
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND NOT is_teacher()
    AND NOT is_admin()
    AND (
      recording_visibility IN ('organization', 'public_link')
      OR (
        recording_visibility IN ('enrolled_students', 'course_staff')
        AND EXISTS (
          SELECT 1 FROM enrollment e
          WHERE e.session_id = session_recording.session_id
            AND e.student_id = get_my_student_id()
            AND e.status = 'active'
        )
      )
    )
  );

-- ============================================================================
-- 5. CHECK-IN TABLES
-- ============================================================================

-- qr_sessions -----------------------------------------------------------
ALTER TABLE qr_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON qr_sessions;
CREATE POLICY "Admin has full access" ON qr_sessions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON qr_sessions;
CREATE POLICY "Teachers can read" ON qr_sessions
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON qr_sessions;
CREATE POLICY "Teachers can insert" ON qr_sessions
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read QR sessions" ON qr_sessions;
CREATE POLICY "Students can read QR sessions" ON qr_sessions
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- photo_checkin_sessions ------------------------------------------------
ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON photo_checkin_sessions;
CREATE POLICY "Admin has full access" ON photo_checkin_sessions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON photo_checkin_sessions;
CREATE POLICY "Teachers can read" ON photo_checkin_sessions
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON photo_checkin_sessions;
CREATE POLICY "Teachers can insert" ON photo_checkin_sessions
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read photo sessions" ON photo_checkin_sessions;
CREATE POLICY "Students can read photo sessions" ON photo_checkin_sessions
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- ============================================================================
-- 6. BOOK TRACKING
-- ============================================================================

-- course_book_reference -------------------------------------------------
ALTER TABLE course_book_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON course_book_reference;
CREATE POLICY "Admin has full access" ON course_book_reference
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON course_book_reference;
CREATE POLICY "Teachers can read" ON course_book_reference
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON course_book_reference;
CREATE POLICY "Teachers can insert" ON course_book_reference
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read book references" ON course_book_reference;
CREATE POLICY "Students can read book references" ON course_book_reference
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- session_book_coverage -------------------------------------------------
ALTER TABLE session_book_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON session_book_coverage;
CREATE POLICY "Admin has full access" ON session_book_coverage
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON session_book_coverage;
CREATE POLICY "Teachers can read" ON session_book_coverage
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON session_book_coverage;
CREATE POLICY "Teachers can insert" ON session_book_coverage
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Students can read book coverage" ON session_book_coverage;
CREATE POLICY "Students can read book coverage" ON session_book_coverage
  FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin());

-- ============================================================================
-- 7. SCORING
-- ============================================================================

-- scoring_config --------------------------------------------------------
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teacher and admin write scoring_config" ON scoring_config;
CREATE POLICY "Teacher and admin write scoring_config" ON scoring_config
  FOR ALL TO authenticated
  USING (is_admin() OR is_teacher()) WITH CHECK (is_admin() OR is_teacher());

DROP POLICY IF EXISTS "Authenticated read scoring_config" ON scoring_config;
CREATE POLICY "Authenticated read scoring_config" ON scoring_config
  FOR SELECT TO authenticated USING (true);

-- late_brackets ---------------------------------------------------------
ALTER TABLE late_brackets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON late_brackets;
CREATE POLICY "Admin has full access" ON late_brackets
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can manage late brackets" ON late_brackets;
CREATE POLICY "Teachers can manage late brackets" ON late_brackets
  FOR ALL TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Authenticated can read late brackets" ON late_brackets;
CREATE POLICY "Authenticated can read late brackets" ON late_brackets
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 8. EXCUSES
-- ============================================================================

ALTER TABLE excuse_request ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to excuse requests" ON excuse_request;
CREATE POLICY "Admins have full access to excuse requests" ON excuse_request
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Students can view own excuse requests" ON excuse_request;
CREATE POLICY "Students can view own excuse requests" ON excuse_request
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Students can create own excuse requests" ON excuse_request;
CREATE POLICY "Students can create own excuse requests" ON excuse_request
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Students can cancel own pending requests" ON excuse_request;
CREATE POLICY "Students can cancel own pending requests" ON excuse_request
  FOR UPDATE TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
    AND status = 'pending'
  )
  WITH CHECK (status = 'cancelled');

DROP POLICY IF EXISTS "Teachers can view excuse requests for their sessions" ON excuse_request;
CREATE POLICY "Teachers can view excuse requests for their sessions" ON excuse_request
  FOR SELECT TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Teachers can review excuse requests" ON excuse_request;
CREATE POLICY "Teachers can review excuse requests" ON excuse_request
  FOR UPDATE TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- 9. FEEDBACK
-- ============================================================================

-- feedback_question -----------------------------------------------------
ALTER TABLE feedback_question ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feedback questions" ON feedback_question;
CREATE POLICY "Anyone can read feedback questions" ON feedback_question
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage feedback questions" ON feedback_question;
CREATE POLICY "Teachers and admins can manage feedback questions" ON feedback_question
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- session_feedback ------------------------------------------------------
ALTER TABLE session_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can submit feedback" ON session_feedback;
CREATE POLICY "Students can submit feedback" ON session_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_teacher() AND NOT is_admin()
    AND (
      student_id = get_my_student_id()
      OR student_id IS NULL  -- anonymous
    )
  );

DROP POLICY IF EXISTS "Students can read own feedback" ON session_feedback;
CREATE POLICY "Students can read own feedback" ON session_feedback
  FOR SELECT TO authenticated
  USING (
    is_teacher()
    OR is_admin()
    OR student_id = get_my_student_id()
    OR student_id IS NULL
  );

-- feedback_template -----------------------------------------------------
ALTER TABLE feedback_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feedback templates" ON feedback_template;
CREATE POLICY "Anyone can read feedback templates" ON feedback_template
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage feedback templates" ON feedback_template;
CREATE POLICY "Teachers and admins can manage feedback templates" ON feedback_template
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ============================================================================
-- 10. CERTIFICATES
-- ============================================================================

-- certificate_template --------------------------------------------------
ALTER TABLE certificate_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active templates" ON certificate_template;
CREATE POLICY "Anyone can view active templates" ON certificate_template
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Teachers can manage templates" ON certificate_template;
CREATE POLICY "Teachers can manage templates" ON certificate_template
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- issued_certificate ----------------------------------------------------
ALTER TABLE issued_certificate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own certificates" ON issued_certificate;
CREATE POLICY "Students view own certificates" ON issued_certificate
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Teachers view all certificates" ON issued_certificate;
CREATE POLICY "Teachers view all certificates" ON issued_certificate
  FOR SELECT TO authenticated USING (is_teacher() OR is_admin());

DROP POLICY IF EXISTS "Teachers manage certificates" ON issued_certificate;
CREATE POLICY "Teachers manage certificates" ON issued_certificate
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ============================================================================
-- 11. SPECIALIZATION
-- ============================================================================

ALTER TABLE specialization ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read specializations" ON specialization;
CREATE POLICY "Anyone can read specializations" ON specialization
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage specializations" ON specialization;
CREATE POLICY "Teachers and admins can manage specializations" ON specialization
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ============================================================================
-- 12. COMMUNICATION
-- ============================================================================

-- announcement ----------------------------------------------------------
ALTER TABLE announcement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON announcement;
CREATE POLICY "Admin has full access" ON announcement
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can manage their announcements" ON announcement;
CREATE POLICY "Teachers can manage their announcements" ON announcement
  FOR ALL TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND EXISTS (
      SELECT 1 FROM teacher
      WHERE teacher.teacher_id = announcement.created_by
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Students can read relevant announcements" ON announcement;
CREATE POLICY "Students can read relevant announcements" ON announcement
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND (
      course_id IS NULL
      OR EXISTS (
        SELECT 1 FROM enrollment e
        JOIN session s ON e.session_id = s.session_id
        WHERE s.course_id = announcement.course_id
          AND e.student_id = get_my_student_id()
          AND e.status = 'active'
      )
    )
  );

-- announcement_read -----------------------------------------------------
ALTER TABLE announcement_read ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON announcement_read;
CREATE POLICY "Admin has full access" ON announcement_read
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Students can mark announcements as read" ON announcement_read;
CREATE POLICY "Students can mark announcements as read" ON announcement_read
  FOR ALL TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Teachers can view read status" ON announcement_read;
CREATE POLICY "Teachers can view read status" ON announcement_read
  FOR SELECT TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- announcement_reaction -------------------------------------------------
ALTER TABLE announcement_reaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON announcement_reaction;
CREATE POLICY "Admin has full access" ON announcement_reaction
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Enable read for authenticated users" ON announcement_reaction;
CREATE POLICY "Enable read for authenticated users" ON announcement_reaction
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON announcement_reaction;
CREATE POLICY "Enable insert for authenticated users" ON announcement_reaction
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete for own reactions" ON announcement_reaction;
CREATE POLICY "Enable delete for own reactions" ON announcement_reaction
  FOR DELETE TO authenticated USING (true);

-- announcement_comment --------------------------------------------------
ALTER TABLE announcement_comment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON announcement_comment;
CREATE POLICY "Admin has full access" ON announcement_comment
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Enable read for authenticated users" ON announcement_comment;
CREATE POLICY "Enable read for authenticated users" ON announcement_comment
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON announcement_comment;
CREATE POLICY "Enable insert for authenticated users" ON announcement_comment
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for own comments" ON announcement_comment;
CREATE POLICY "Enable update for own comments" ON announcement_comment
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable delete for own comments" ON announcement_comment;
CREATE POLICY "Enable delete for own comments" ON announcement_comment
  FOR DELETE TO authenticated USING (true);

-- message ---------------------------------------------------------------
ALTER TABLE message ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON message;
CREATE POLICY "Admin has full access" ON message
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Users can view their messages" ON message;
CREATE POLICY "Users can view their messages" ON message
  FOR SELECT USING (
    (sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (sender_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS "Teachers can send messages" ON message;
CREATE POLICY "Teachers can send messages" ON message
  FOR INSERT WITH CHECK (
    sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Students can send messages" ON message;
CREATE POLICY "Students can send messages" ON message
  FOR INSERT WITH CHECK (
    sender_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Recipients can update message read status" ON message;
CREATE POLICY "Recipients can update message read status" ON message
  FOR UPDATE USING (
    (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS "Users can delete their messages" ON message;
CREATE POLICY "Users can delete their messages" ON message
  FOR DELETE USING (
    (sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (sender_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS "Users can delete their messages" ON message;
CREATE POLICY "Users can delete their messages" ON message
  FOR DELETE TO authenticated
  USING (
    (sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (sender_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- message_attachment ----------------------------------------------------
ALTER TABLE message_attachment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON message_attachment;
CREATE POLICY "Admin has full access" ON message_attachment
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Message participants can read attachments" ON message_attachment;
CREATE POLICY "Message participants can read attachments" ON message_attachment
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message m
      WHERE m.message_id = message_attachment.message_id
        AND (
          (m.sender_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = m.sender_id
              AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
          ))
          OR (m.sender_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = m.sender_id
              AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
          ))
          OR (m.recipient_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = m.recipient_id
              AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
          ))
          OR (m.recipient_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = m.recipient_id
              AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
          ))
        )
    )
  );

DROP POLICY IF EXISTS "Senders can insert attachments" ON message_attachment;
CREATE POLICY "Senders can insert attachments" ON message_attachment
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM message m
      WHERE m.message_id = message_attachment.message_id
        AND (
          (m.sender_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = m.sender_id
              AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
          ))
          OR (m.sender_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = m.sender_id
              AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
          ))
        )
    )
  );

-- message_reaction ------------------------------------------------------
ALTER TABLE message_reaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON message_reaction;
CREATE POLICY "Admin has full access" ON message_reaction
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Enable read for authenticated users" ON message_reaction;
CREATE POLICY "Enable read for authenticated users" ON message_reaction
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON message_reaction;
CREATE POLICY "Enable insert for authenticated users" ON message_reaction
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete for own reactions" ON message_reaction;
CREATE POLICY "Enable delete for own reactions" ON message_reaction
  FOR DELETE TO authenticated USING (true);

-- message_starred -------------------------------------------------------
ALTER TABLE message_starred ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON message_starred;
CREATE POLICY "Admin has full access" ON message_starred
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Enable read for authenticated users" ON message_starred;
CREATE POLICY "Enable read for authenticated users" ON message_starred
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON message_starred;
CREATE POLICY "Enable insert for authenticated users" ON message_starred
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete for own stars" ON message_starred;
CREATE POLICY "Enable delete for own stars" ON message_starred
  FOR DELETE TO authenticated USING (true);

-- notification_preference -----------------------------------------------
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON notification_preference;
CREATE POLICY "Admin has full access" ON notification_preference
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Users can manage their notification preferences" ON notification_preference;
CREATE POLICY "Users can manage their notification preferences" ON notification_preference
  FOR ALL USING (
    (user_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = notification_preference.user_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (user_type = 'student' AND EXISTS (
      SELECT 1 FROM student WHERE student.student_id = notification_preference.user_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- ============================================================================
-- 13. AUDIT LOG
-- ============================================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON audit_log;
CREATE POLICY "Admin has full access" ON audit_log
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can read" ON audit_log;
CREATE POLICY "Teachers can read" ON audit_log
  FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can insert" ON audit_log;
CREATE POLICY "Teachers can insert" ON audit_log
  FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin());
