-- ============================================================================
-- Migration 011 — RLS Audit & Constraint Fixes
-- ============================================================================
-- Gaps filled:
--   1. session_date_host  : Teachers were missing UPDATE (upsert fails silently)
--   2. session_day_change : Teachers were missing DELETE (day-change cleanup warnings)
--   3. session            : Teachers were missing UPDATE (can't save edits)
--   4. enrollment         : Students could read ALL enrollments, not just their own
--   5. teacher_host_schedule : Teachers were missing UPDATE + DELETE
--   6. excuse_request     : Teacher review UPDATE missing WITH CHECK constraint
--   7. course_book_reference  : Teachers were missing UPDATE + DELETE
--   8. session_book_coverage  : Teachers were missing UPDATE + DELETE
-- ============================================================================

-- ============================================================================
-- 1. session_date_host — add UPDATE for teachers
-- ============================================================================
-- Used by setDateTimeOverride() which does an upsert on this table.
-- Without UPDATE, teachers' time overrides silently fail.

DROP POLICY IF EXISTS "Teachers can update" ON session_date_host;
CREATE POLICY "Teachers can update" ON session_date_host
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 2. session_day_change — add DELETE for teachers
-- ============================================================================
-- sessionService.update() deletes conflicting day-change records before
-- inserting a new one. Without DELETE, the cleanup emits RLS warnings and
-- potentially leaves stale/contradicting records in the table.

DROP POLICY IF EXISTS "Teachers can delete day changes" ON session_day_change;
CREATE POLICY "Teachers can delete day changes" ON session_day_change
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 3. session — add UPDATE for teachers
-- ============================================================================
-- Teachers editing sessions (day, time, location, etc.) need UPDATE access.
-- Without this, all teacher session edits silently fail.

DROP POLICY IF EXISTS "Teachers can update" ON session;
CREATE POLICY "Teachers can update" ON session
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- Teachers also need DELETE for their own sessions
DROP POLICY IF EXISTS "Teachers can delete" ON session;
CREATE POLICY "Teachers can delete" ON session
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 4. enrollment — scope student reads to own records
-- ============================================================================
-- Current policy allows students to read ALL enrollments (any student's).
-- Replace with a scoped policy using get_my_student_id().

DROP POLICY IF EXISTS "Students can read enrollments" ON enrollment;
CREATE POLICY "Students can read own enrollments" ON enrollment
  FOR SELECT TO authenticated
  USING (
    NOT is_teacher() AND NOT is_admin()
    AND student_id = get_my_student_id()
  );

-- Also ensure teachers can UPDATE enrollment status (active/cancelled/completed)
DROP POLICY IF EXISTS "Teachers can update enrollment" ON enrollment;
CREATE POLICY "Teachers can update enrollment" ON enrollment
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 5. teacher_host_schedule — add UPDATE + DELETE for teachers
-- ============================================================================
-- Teachers can set their own availability schedule.
-- They need to be able to modify and remove entries they created.

DROP POLICY IF EXISTS "Teachers can update host schedule" ON teacher_host_schedule;
CREATE POLICY "Teachers can update host schedule" ON teacher_host_schedule
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete host schedule" ON teacher_host_schedule;
CREATE POLICY "Teachers can delete host schedule" ON teacher_host_schedule
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 6. excuse_request — add WITH CHECK to teacher review policy
-- ============================================================================
-- Without WITH CHECK, a teacher could set status to any value via the raw API
-- (e.g. 'cancelled'). Enforce that teachers can ONLY set 'approved' or 'rejected'.

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
    AND status = 'pending'
  )
  WITH CHECK (
    status IN ('approved', 'rejected')
  );

-- ============================================================================
-- 7. course_book_reference — add UPDATE + DELETE for teachers
-- ============================================================================
-- Teachers need to manage book references (edit page ranges, remove references).

DROP POLICY IF EXISTS "Teachers can update book references" ON course_book_reference;
CREATE POLICY "Teachers can update book references" ON course_book_reference
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete book references" ON course_book_reference;
CREATE POLICY "Teachers can delete book references" ON course_book_reference
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());

-- ============================================================================
-- 8. session_book_coverage — add UPDATE + DELETE for teachers
-- ============================================================================
-- Teachers need to correct or remove book coverage records they created.

DROP POLICY IF EXISTS "Teachers can update book coverage" ON session_book_coverage;
CREATE POLICY "Teachers can update book coverage" ON session_book_coverage
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

DROP POLICY IF EXISTS "Teachers can delete book coverage" ON session_book_coverage;
CREATE POLICY "Teachers can delete book coverage" ON session_book_coverage
  FOR DELETE TO authenticated
  USING (is_teacher() AND NOT is_admin());
