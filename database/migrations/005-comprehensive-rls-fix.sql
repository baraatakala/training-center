-- ============================================================================
-- Migration 005: Comprehensive RLS Cleanup & Gap Fill
-- ============================================================================
-- Fixes every RLS gap found comparing Supabase live policies vs
-- frontend service requirements.
--
-- ISSUES FIXED:
--   A. Drop 3 dangerous "Enable all access for authenticated users" leftovers
--      (audit_log, photo_checkin_sessions, session_book_coverage)
--   B. Add missing teacher UPDATE on attendance (needed for excuse approval)
--   C. Fix "Teachers can delete messages" → both sender AND recipient can delete
--   D. Enable RLS + policies on 4 tables that had NONE in Supabase:
--      session_feedback, feedback_question,
--      certificate_template, issued_certificate
--      (late_brackets is a jsonb column in scoring_config — not a table)
--      (message_attachment does not exist in the live schema)
--   E. Fix excuse_request, announcement, message, specialization policies
--      to use TO authenticated (not public anon role)
-- ============================================================================

BEGIN;

-- ============================================================================
-- A. DROP DANGEROUS LEFTOVER BLANKET POLICIES
-- ============================================================================

-- A1. audit_log — "Enable all access for authenticated users" gives students
--     full DELETE/UPDATE across the entire audit trail. MUST remove.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.audit_log;

-- A2. photo_checkin_sessions — blanket ALL overwrites the granular role model
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.photo_checkin_sessions;

-- A3. session_book_coverage — students should only SELECT, not INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.session_book_coverage;

-- ============================================================================
-- B. ATTENDANCE — Add missing teacher UPDATE
-- ============================================================================
-- Teachers need UPDATE on attendance for:
--   1. excuseRequestService.review() → updates status to 'excused' on approval
--   2. attendanceService.update() → correcting records from Attendance page
--   3. bulkImport → may upsert attendance records

DROP POLICY IF EXISTS "Teachers can update" ON public.attendance;
CREATE POLICY "Teachers can update" ON public.attendance
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- ============================================================================
-- C. MESSAGE — Fix delete: only sender OR recipient, not teacher-only
-- ============================================================================
-- Supabase currently has "Teachers can delete messages" which blocks students
-- from deleting their own messages. Replace with a proper sender/recipient check.

DROP POLICY IF EXISTS "Teachers can delete messages" ON public.message;
DROP POLICY IF EXISTS "Users can delete their messages" ON public.message;
CREATE POLICY "Users can delete their messages" ON public.message
  FOR DELETE TO authenticated
  USING (
    (sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.sender_id
        AND lower(teacher.email) = lower(auth.jwt() ->> 'email')
    ))
    OR (sender_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.sender_id
        AND lower(student.email) = lower(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.recipient_id
        AND lower(teacher.email) = lower(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.recipient_id
        AND lower(student.email) = lower(auth.jwt() ->> 'email')
    ))
  );

-- ============================================================================
-- D. ENABLE RLS + POLICIES ON TABLES MISSING FROM SUPABASE
-- ============================================================================
-- NOTE: late_brackets is a jsonb column in scoring_config (not a table).
-- NOTE: message_attachment does not exist in the live schema.

-- ----------------------------------------------------------------
-- D1. session_feedback — students INSERT own, teachers/admins SELECT all
-- ----------------------------------------------------------------
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can submit feedback" ON public.session_feedback;
CREATE POLICY "Students can submit feedback" ON public.session_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_teacher()
    AND NOT is_admin()
    AND (
      student_id = get_my_student_id()
      OR student_id IS NULL  -- allow anonymous submissions
    )
  );

DROP POLICY IF EXISTS "Students can read own feedback" ON public.session_feedback;
CREATE POLICY "Students can read own feedback" ON public.session_feedback
  FOR SELECT TO authenticated
  USING (
    is_teacher()
    OR is_admin()
    OR student_id = get_my_student_id()
    OR student_id IS NULL  -- anonymous feedback visible to all
  );

-- ----------------------------------------------------------------
-- D2. feedback_question — anyone can read, teachers/admins manage
-- ----------------------------------------------------------------
ALTER TABLE public.feedback_question ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feedback questions" ON public.feedback_question;
CREATE POLICY "Anyone can read feedback questions" ON public.feedback_question
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage feedback questions" ON public.feedback_question;
CREATE POLICY "Teachers and admins can manage feedback questions" ON public.feedback_question
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ----------------------------------------------------------------
-- D3. certificate_template — authenticated can read active; teachers/admins manage
-- ----------------------------------------------------------------
ALTER TABLE public.certificate_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active templates" ON public.certificate_template;
CREATE POLICY "Anyone can view active templates" ON public.certificate_template
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Teachers can manage templates" ON public.certificate_template;
CREATE POLICY "Teachers can manage templates" ON public.certificate_template
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ----------------------------------------------------------------
-- D4. issued_certificate — students see own; teachers/admins see all and manage
-- ----------------------------------------------------------------
ALTER TABLE public.issued_certificate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own certificates" ON public.issued_certificate;
CREATE POLICY "Students view own certificates" ON public.issued_certificate
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher()
    AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Teachers view all certificates" ON public.issued_certificate;
CREATE POLICY "Teachers view all certificates" ON public.issued_certificate
  FOR SELECT TO authenticated USING (is_teacher() OR is_admin());

DROP POLICY IF EXISTS "Teachers manage certificates" ON public.issued_certificate;
CREATE POLICY "Teachers manage certificates" ON public.issued_certificate
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ============================================================================
-- E. FIX: excuse_request policies — add TO authenticated
-- ============================================================================
-- Currently these use no role (defaults to public/anon). Anon users can query
-- but will always fail the WHERE clauses. Better to block them at the role level.

DROP POLICY IF EXISTS "Admins have full access to excuse requests"              ON public.excuse_request;
DROP POLICY IF EXISTS "Students can view own excuse requests"                   ON public.excuse_request;
DROP POLICY IF EXISTS "Students can create own excuse requests"                 ON public.excuse_request;
DROP POLICY IF EXISTS "Students can cancel own pending requests"                ON public.excuse_request;
DROP POLICY IF EXISTS "Teachers can view excuse requests for their sessions"    ON public.excuse_request;
DROP POLICY IF EXISTS "Teachers can review excuse requests"                     ON public.excuse_request;

CREATE POLICY "Admins have full access to excuse requests" ON public.excuse_request
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Students can view own excuse requests" ON public.excuse_request
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

CREATE POLICY "Students can create own excuse requests" ON public.excuse_request
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
    AND status = 'pending'
  );

CREATE POLICY "Students can cancel own pending requests" ON public.excuse_request
  FOR UPDATE TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
    AND status = 'pending'
  )
  WITH CHECK (status = 'cancelled');

CREATE POLICY "Teachers can view excuse requests for their sessions"
  ON public.excuse_request
  FOR SELECT TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM public.session s
      JOIN public.teacher t ON s.teacher_id = t.teacher_id
      WHERE lower(t.email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Teachers can review excuse requests" ON public.excuse_request
  FOR UPDATE TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM public.session s
      JOIN public.teacher t ON s.teacher_id = t.teacher_id
      WHERE lower(t.email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- F. FIX: announcement policies — add TO authenticated
-- ============================================================================
DROP POLICY IF EXISTS "Teachers can manage their announcements" ON public.announcement;
CREATE POLICY "Teachers can manage their announcements" ON public.announcement
  FOR ALL TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = announcement.created_by
        AND lower(teacher.email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Students can read relevant announcements" ON public.announcement;
CREATE POLICY "Students can read relevant announcements" ON public.announcement
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND (
      course_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.enrollment e
        JOIN public.session s ON e.session_id = s.session_id
        WHERE s.course_id = announcement.course_id
          AND e.student_id = get_my_student_id()
          AND e.status = 'active'
      )
    )
  );

-- ============================================================================
-- G. FIX: announcement_read policies — add TO authenticated
-- ============================================================================
DROP POLICY IF EXISTS "Students can mark announcements as read" ON public.announcement_read;
CREATE POLICY "Students can mark announcements as read" ON public.announcement_read
  FOR ALL TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Teachers can view read status" ON public.announcement_read;
CREATE POLICY "Teachers can view read status" ON public.announcement_read
  FOR SELECT TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ============================================================================
-- H. FIX: specialization — add TO authenticated (already has is_admin/is_teacher)
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can read specializations" ON public.specialization;
CREATE POLICY "Anyone can read specializations" ON public.specialization
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage specializations" ON public.specialization;
CREATE POLICY "Teachers and admins can manage specializations" ON public.specialization
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

-- ============================================================================
-- I. FIX: feedback_template — add TO authenticated
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can read feedback templates" ON public.feedback_template;
CREATE POLICY "Anyone can read feedback templates" ON public.feedback_template
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers and admins can manage feedback templates" ON public.feedback_template;
CREATE POLICY "Teachers and admins can manage feedback templates" ON public.feedback_template
  FOR ALL TO authenticated
  USING (is_teacher() OR is_admin())
  WITH CHECK (is_teacher() OR is_admin());

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
--
-- After running, Supabase policy list should show:
--   audit_log:              3 policies (Admin ALL, Teacher SELECT, Teacher INSERT)
--   attendance:             6 policies (Admin ALL, Teacher SELECT+INSERT+UPDATE, Student SELECT+INSERT+UPDATE)
--   message:                5 policies (Admin ALL, view, send-teacher, send-student, update-read, delete-user)
--   session_feedback:       2 policies (Student INSERT, Teacher/Admin SELECT)
--   feedback_question:      2 policies (Anyone SELECT, Teacher/Admin ALL)
--   certificate_template:   2 policies (Anyone active SELECT, Teacher/Admin ALL)
--   issued_certificate:     3 policies (Student SELECT own, Teacher SELECT all, Teacher/Admin ALL)
--   excuse_request:         6 policies (all now TO authenticated)
--   announcement:           3 policies (Admin ALL + 2 now TO authenticated)
--   announcement_read:      3 policies (Admin ALL + 2 now TO authenticated)
--   specialization:         2 policies (both now TO authenticated)
--   feedback_template:      2 policies (both now TO authenticated)
-- ============================================================================
