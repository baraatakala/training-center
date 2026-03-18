ALTER TABLE public.feedback_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read session feedback questions" ON public.feedback_question;
DROP POLICY IF EXISTS "Teachers can manage own session feedback questions" ON public.feedback_question;
DROP POLICY IF EXISTS "Admins have full access to feedback questions" ON public.feedback_question;
DROP POLICY IF EXISTS "Anyone can read feedback questions" ON public.feedback_question;
DROP POLICY IF EXISTS "Teachers and admins can manage feedback questions" ON public.feedback_question;

CREATE POLICY "Authenticated users can read session feedback questions"
  ON public.feedback_question
  FOR SELECT
  TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.session session_row
      JOIN public.teacher teacher_row ON teacher_row.teacher_id = session_row.teacher_id
      WHERE session_row.session_id = feedback_question.session_id
        AND lower(teacher_row.email) = lower(auth.email())
    )
    OR EXISTS (
      SELECT 1
      FROM public.enrollment enrollment_row
      JOIN public.student student_row ON student_row.student_id = enrollment_row.student_id
      WHERE enrollment_row.session_id = feedback_question.session_id
        AND enrollment_row.status = 'active'
        AND lower(student_row.email) = lower(auth.email())
    )
  );

CREATE POLICY "Teachers can manage own session feedback questions"
  ON public.feedback_question
  FOR ALL
  TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.session session_row
      JOIN public.teacher teacher_row ON teacher_row.teacher_id = session_row.teacher_id
      WHERE session_row.session_id = feedback_question.session_id
        AND lower(teacher_row.email) = lower(auth.email())
    )
  )
  WITH CHECK (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.session session_row
      JOIN public.teacher teacher_row ON teacher_row.teacher_id = session_row.teacher_id
      WHERE session_row.session_id = feedback_question.session_id
        AND lower(teacher_row.email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS "Students can insert verified session feedback" ON public.session_feedback;
DROP POLICY IF EXISTS "Students can read own session feedback" ON public.session_feedback;
DROP POLICY IF EXISTS "Teachers can read own session feedback analytics" ON public.session_feedback;
DROP POLICY IF EXISTS "Admins have full access to session feedback" ON public.session_feedback;
DROP POLICY IF EXISTS "Students can submit feedback" ON public.session_feedback;
DROP POLICY IF EXISTS "Students can read own feedback" ON public.session_feedback;

CREATE POLICY "Students can insert verified session feedback"
  ON public.session_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.student student_row
      WHERE student_row.student_id = session_feedback.student_id
        AND lower(student_row.email) = lower(auth.email())
    )
    AND EXISTS (
      SELECT 1
      FROM public.enrollment enrollment_row
      WHERE enrollment_row.session_id = session_feedback.session_id
        AND enrollment_row.student_id = session_feedback.student_id
        AND enrollment_row.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM public.attendance attendance_row
      WHERE attendance_row.session_id = session_feedback.session_id
        AND attendance_row.student_id = session_feedback.student_id
        AND attendance_row.attendance_date = session_feedback.attendance_date
        AND attendance_row.status IN ('on time', 'late')
    )
  );

CREATE POLICY "Students can read own session feedback"
  ON public.session_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.student student_row
      WHERE student_row.student_id = session_feedback.student_id
        AND lower(student_row.email) = lower(auth.email())
    )
  );

CREATE POLICY "Teachers can read own session feedback analytics"
  ON public.session_feedback
  FOR SELECT
  TO authenticated
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.session session_row
      JOIN public.teacher teacher_row ON teacher_row.teacher_id = session_row.teacher_id
      WHERE session_row.session_id = session_feedback.session_id
        AND lower(teacher_row.email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS "Authenticated users can read feedback templates" ON public.feedback_template;
DROP POLICY IF EXISTS "Teachers and admins can manage feedback templates" ON public.feedback_template;
DROP POLICY IF EXISTS "Anyone can read feedback templates" ON public.feedback_template;

CREATE POLICY "Authenticated users can read feedback templates"
  ON public.feedback_template
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Teachers and admins can manage feedback templates"
  ON public.feedback_template
  FOR ALL
  TO authenticated
  USING (is_admin() OR is_teacher())
  WITH CHECK (is_admin() OR is_teacher());