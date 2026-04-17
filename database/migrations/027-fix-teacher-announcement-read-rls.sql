-- Teachers currently can only see their OWN announcements via the ALL policy.
-- They need to also READ all announcements: global (course_id IS NULL)
-- and for courses they teach.

CREATE POLICY "Teachers can read all announcements"
  ON public.announcement
  FOR SELECT TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND (
      -- Global announcements (no course)
      course_id IS NULL
      OR
      -- Announcements for courses they teach
      EXISTS (
        SELECT 1 FROM session s
        JOIN teacher t ON t.teacher_id = s.teacher_id
        WHERE s.course_id = announcement.course_id
          AND LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
      )
      OR
      -- Their own announcements (redundant with ALL policy but explicit)
      EXISTS (
        SELECT 1 FROM teacher
        WHERE teacher.teacher_id = announcement.created_by
          AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
      )
    )
  );
