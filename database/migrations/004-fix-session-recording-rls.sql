-- ============================================================================
-- Migration 004: Fix session_recording RLS policies
-- ============================================================================
-- PROBLEM SUMMARY:
--
-- All previous student policies used `e.student_id = auth.uid()`. This is
-- broken because student.student_id is uuid_generate_v4() — a custom UUID,
-- NOT the Supabase auth UUID (auth.uid()). No student ever matched, so no
-- student could read recordings through those policies.
--
-- Additionally, rls-policies.sql was missing an admin policy entirely, so
-- admins who are not teachers could not manage recordings.
--
-- Multiple migrations leaving behind duplicate policies with different names
-- created confusion. This migration wipes all session_recording policies and
-- replaces them with a clean authoritative set.
--
-- FINAL POLICY SET (3 policies):
--   1. Admins: full access (ALL operations)
--   2. Teachers: full access (ALL operations)
--   3. Students: SELECT only, visibility-gated, email-based identity
-- ============================================================================

BEGIN;

-- Drop all known session_recording policy names (from every migration/script)
DROP POLICY IF EXISTS "Teachers have full access"                       ON public.session_recording;
DROP POLICY IF EXISTS "Teachers have full access to session recordings" ON public.session_recording;
DROP POLICY IF EXISTS "Admins have full access to session recordings"   ON public.session_recording;
DROP POLICY IF EXISTS "Enrolled students can view recordings"           ON public.session_recording;
DROP POLICY IF EXISTS "Students can read visible session recordings"    ON public.session_recording;

-- ============================================================================
-- 1. ADMIN — Full access
-- ============================================================================
CREATE POLICY "Admins have full access to session recordings"
  ON public.session_recording
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================================
-- 2. TEACHER — Full access
-- ============================================================================
CREATE POLICY "Teachers have full access to session recordings"
  ON public.session_recording
  FOR ALL TO authenticated
  USING (is_teacher())
  WITH CHECK (is_teacher());

-- ============================================================================
-- 3. STUDENT — SELECT only, visibility-gated
-- ============================================================================
-- Uses get_my_student_id() (SECURITY DEFINER) to look up student_id from
-- auth.email(). This is correct because student.student_id is a custom UUID
-- (uuid_generate_v4()), NOT auth.uid().
--
-- Visibility levels:
--   'private_staff'    → never visible to students
--   'course_staff'     → only enrolled active students
--   'enrolled_students'→ only enrolled active students  (default on create)
--   'organization'     → any authenticated user (all students)
--   'public_link'      → any authenticated user (all students)
CREATE POLICY "Students can view session recordings"
  ON public.session_recording
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND NOT is_teacher()
    AND NOT is_admin()
    AND (
      -- Org-wide and public-link: any logged-in student can view
      recording_visibility IN ('organization', 'public_link')
      OR
      -- Enrolled-students and course-staff: must be in an active enrollment
      (
        recording_visibility IN ('enrolled_students', 'course_staff')
        AND EXISTS (
          SELECT 1 FROM public.enrollment e
          WHERE e.session_id = session_recording.session_id
            AND e.student_id = get_my_student_id()
            AND e.status = 'active'
        )
      )
      -- 'private_staff' is intentionally excluded — students never see these
    )
  );

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run manually to confirm)
-- ============================================================================
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'session_recording'
-- ORDER BY policyname;
--
-- Expected: 3 rows
--   "Admins have full access to session recordings"    ALL
--   "Teachers have full access to session recordings"  ALL
--   "Students can view session recordings"             SELECT
-- ============================================================================
