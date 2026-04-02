-- ============================================================================
-- Migration 013 — RLS Final Completion & Cleanup
-- ============================================================================
-- Full audit of live Supabase policies vs canonical rls-policies.sql.
-- Each table is treated by its own sensitivity and operational role
-- (ERP-style: role × table × operation matrix).
--
-- ORPHANS — in Supabase but not canonical (or duplicate). Drop only.
--   A. feedback_question  : "Teachers can manage own session feedback questions"
--      Exact duplicate of "Teachers and admins can manage feedback questions" (ALL).
--   B. session_feedback   : "Teachers can read own session feedback analytics"
--      Redundant — "Students can read own feedback" already grants SELECT to
--      all teachers/admins via USING (is_teacher() OR is_admin() OR ...).
--
-- GAPS — frontend operations that fail silently without these policies:
--   1. enrollment         : Teacher DELETE — enrollmentService.delete() used in UI
--   2. attendance         : Teacher DELETE — merge delete chain
--   3. session_date_host  : Teacher DELETE — merge delete chain
--   4. qr_sessions        : Teacher UPDATE (invalidate QR) + DELETE (merge chain)
--   5. photo_checkin_sessions : Teacher UPDATE (invalidate) + DELETE (merge chain)
--   6. excuse_request     : Teacher DELETE scoped to own sessions (merge chain)
--   7. session_feedback   : Admin ALL (dashboard + merge); Teacher DELETE (merge chain)
-- ============================================================================

-- ── A. Drop orphan: duplicate policy on feedback_question ────────────────────
-- "Teachers and admins can manage feedback questions" (ALL) already covers this.
DROP POLICY IF EXISTS "Teachers can manage own session feedback questions" ON feedback_question;

-- ── B. Drop orphan: redundant SELECT policy on session_feedback ──────────────
-- "Students can read own feedback" USING condition includes is_teacher() / is_admin().
DROP POLICY IF EXISTS "Teachers can read own session feedback analytics" ON session_feedback;

-- ── 1. enrollment — Teacher DELETE ───────────────────────────────────────────
-- enrollmentService.delete() is called from the Enrollments page when a teacher
-- removes a student from a session. Also used by the merge delete chain.
DROP POLICY IF EXISTS "Teachers can delete enrollment" ON enrollment;
CREATE POLICY "Teachers can delete enrollment" ON enrollment
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ── 2. attendance — Teacher DELETE ───────────────────────────────────────────
-- Merge delete chain: DELETE FROM attendance WHERE session_id = sourceSessionId.
DROP POLICY IF EXISTS "Teachers can delete attendance" ON attendance;
CREATE POLICY "Teachers can delete attendance" ON attendance
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ── 3. session_date_host — Teacher DELETE ────────────────────────────────────
-- Merge delete chain: DELETE FROM session_date_host WHERE session_id = sourceSessionId.
DROP POLICY IF EXISTS "Teachers can delete" ON session_date_host;
CREATE POLICY "Teachers can delete" ON session_date_host
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ── 4. qr_sessions — Teacher UPDATE + DELETE ─────────────────────────────────
-- UPDATE: dashboardService.invalidateActiveSessions() sets is_valid = false
--         when a new QR/photo check-in session starts.
-- DELETE: merge delete chain removes all qr_sessions for the source session.
DROP POLICY IF EXISTS "Teachers can update qr sessions" ON qr_sessions;
CREATE POLICY "Teachers can update qr sessions" ON qr_sessions
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete qr sessions" ON qr_sessions;
CREATE POLICY "Teachers can delete qr sessions" ON qr_sessions
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ── 5. photo_checkin_sessions — Teacher UPDATE + DELETE ──────────────────────
-- Same reasons as qr_sessions above.
DROP POLICY IF EXISTS "Teachers can update photo sessions" ON photo_checkin_sessions;
CREATE POLICY "Teachers can update photo sessions" ON photo_checkin_sessions
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete photo sessions" ON photo_checkin_sessions;
CREATE POLICY "Teachers can delete photo sessions" ON photo_checkin_sessions
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ── 6. excuse_request — Teacher DELETE (scoped to own sessions) ──────────────
-- Merge delete chain removes excuse_requests before deleting the source session.
-- Scoped to sessions the teacher owns to contain the blast radius.
DROP POLICY IF EXISTS "Teachers can delete excuse requests" ON excuse_request;
CREATE POLICY "Teachers can delete excuse requests" ON excuse_request
  FOR DELETE TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- ── 7. session_feedback — Admin ALL + Teacher DELETE ─────────────────────────
-- Admin ALL: admins need full access for system dashboard analytics and data
--            management. The existing "Students can read own feedback" covers
--            teacher/admin SELECT only — admin needs INSERT/UPDATE/DELETE too.
-- Teacher DELETE: merge delete chain removes session_feedback rows by enrollment_id
--                 before deleting the source session's enrollments.
--                 Scoped via enrollment → session → teacher ownership.

DROP POLICY IF EXISTS "Admin has full access" ON session_feedback;
CREATE POLICY "Admin has full access" ON session_feedback
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Teachers can delete session feedback" ON session_feedback;
CREATE POLICY "Teachers can delete session feedback" ON session_feedback
  FOR DELETE TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND enrollment_id IN (
      SELECT e.enrollment_id FROM enrollment e
      JOIN session s ON e.session_id = s.session_id
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );
