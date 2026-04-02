-- ============================================================================
-- Migration 014 — Teacher UPDATE policies on student, teacher, course
-- ============================================================================
-- The import button on Students/Teachers/Courses pages is shown to ALL teachers
-- ({isTeacher && (}), not just admins. The import process calls UPDATE via
-- studentService.update / teacherService.update / courseService.update when
-- the imported row matches an existing record (by email / course+teacher key).
-- Without UPDATE policies, those calls fail silently at the RLS level, resulting
-- in 0 updated records even though the import appears to succeed.
-- ============================================================================

-- student: Teacher UPDATE -----------------------------------------------
DROP POLICY IF EXISTS "Teachers can update" ON student;
CREATE POLICY "Teachers can update" ON student
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- teacher: Teacher UPDATE -----------------------------------------------
DROP POLICY IF EXISTS "Teachers can update" ON teacher;
CREATE POLICY "Teachers can update" ON teacher
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());

-- course: Teacher UPDATE -----------------------------------------------
DROP POLICY IF EXISTS "Teachers can update" ON course;
CREATE POLICY "Teachers can update" ON course
  FOR UPDATE TO authenticated
  USING (is_teacher() AND NOT is_admin())
  WITH CHECK (is_teacher() AND NOT is_admin());
