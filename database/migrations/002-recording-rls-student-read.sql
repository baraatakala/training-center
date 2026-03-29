-- Migration 002: Add student read policy for session_recording
-- Allows enrolled students to view recordings based on visibility setting.
-- Previously only teachers had access, making the recording_visibility field
-- non-functional for non-teacher roles.

DROP POLICY IF EXISTS "Enrolled students can view recordings" ON session_recording;
CREATE POLICY "Enrolled students can view recordings" ON session_recording
  FOR SELECT TO authenticated
  USING (
    recording_visibility IN ('enrolled_students', 'organization', 'public_link')
    AND EXISTS (
      SELECT 1 FROM enrollment e
      WHERE e.session_id = session_recording.session_id
        AND e.student_id = get_my_student_id()
        AND e.status = 'active'
    )
  );
