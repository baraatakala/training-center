BEGIN;

CREATE TABLE IF NOT EXISTS public.session_feedback_answer (
  answer_id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_feedback_id uuid NOT NULL,
  question_id uuid NOT NULL,
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  student_id uuid,
  answer_value jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT session_feedback_answer_pkey PRIMARY KEY (answer_id),
  CONSTRAINT session_feedback_answer_feedback_id_fkey FOREIGN KEY (session_feedback_id) REFERENCES public.session_feedback(id) ON DELETE CASCADE,
  CONSTRAINT session_feedback_answer_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.feedback_question(id) ON DELETE CASCADE,
  CONSTRAINT session_feedback_answer_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_feedback_answer_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT session_feedback_answer_unique_question UNIQUE (session_feedback_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_answer_feedback
  ON public.session_feedback_answer(session_feedback_id);

CREATE INDEX IF NOT EXISTS idx_session_feedback_answer_question
  ON public.session_feedback_answer(question_id);

CREATE INDEX IF NOT EXISTS idx_session_feedback_answer_session_date
  ON public.session_feedback_answer(session_id, attendance_date);

ALTER TABLE public.session_feedback_answer ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can read own feedback answers" ON public.session_feedback_answer;
CREATE POLICY "Students can read own feedback answers"
  ON public.session_feedback_answer
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND student_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.student student_row
      WHERE student_row.student_id = session_feedback_answer.student_id
        AND lower(student_row.email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS "Teachers can read own feedback answers analytics" ON public.session_feedback_answer;
CREATE POLICY "Teachers can read own feedback answers analytics"
  ON public.session_feedback_answer
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.session session_row
      JOIN public.teacher teacher_row ON teacher_row.teacher_id = session_row.teacher_id
      WHERE session_row.session_id = session_feedback_answer.session_id
        AND lower(teacher_row.email) = lower(auth.email())
    )
  );

DROP POLICY IF EXISTS "Admins have full access to feedback answers" ON public.session_feedback_answer;
CREATE POLICY "Admins have full access to feedback answers"
  ON public.session_feedback_answer
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.admin admin_row
      WHERE lower(admin_row.email) = lower(auth.email())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.admin admin_row
      WHERE lower(admin_row.email) = lower(auth.email())
    )
  );

CREATE OR REPLACE FUNCTION public.submit_session_feedback(
  p_session_id uuid,
  p_attendance_date date,
  p_student_id uuid,
  p_is_anonymous boolean DEFAULT false,
  p_overall_rating integer DEFAULT NULL,
  p_comment text DEFAULT NULL,
  p_responses jsonb DEFAULT '{}'::jsonb,
  p_check_in_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_feedback_id uuid;
  v_response_key text;
  v_response_value jsonb;
  v_required_question_count integer;
  v_answer_count integer := 0;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Student is required for feedback submission';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.session_feedback existing_feedback
    WHERE existing_feedback.session_id = p_session_id
      AND existing_feedback.attendance_date = p_attendance_date
      AND existing_feedback.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'Feedback already submitted for this session date';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.attendance attendance_row
    WHERE attendance_row.session_id = p_session_id
      AND attendance_row.student_id = p_student_id
      AND attendance_row.attendance_date = p_attendance_date
      AND attendance_row.status <> 'absent'
  ) THEN
    RAISE EXCEPTION 'Feedback requires a valid attendance record for this session date';
  END IF;

  SELECT COUNT(*)
  INTO v_required_question_count
  FROM public.feedback_question question_row
  WHERE question_row.session_id = p_session_id
    AND question_row.is_required = true
    AND (question_row.attendance_date IS NULL OR question_row.attendance_date = p_attendance_date)
    AND NOT (COALESCE(p_responses, '{}'::jsonb) ? question_row.id::text);

  IF v_required_question_count > 0 THEN
    RAISE EXCEPTION 'One or more required feedback questions are missing answers';
  END IF;

  INSERT INTO public.session_feedback (
    session_id,
    attendance_date,
    student_id,
    is_anonymous,
    overall_rating,
    comment,
    responses,
    check_in_method
  ) VALUES (
    p_session_id,
    p_attendance_date,
    p_student_id,
    COALESCE(p_is_anonymous, false),
    p_overall_rating,
    NULLIF(trim(COALESCE(p_comment, '')), ''),
    COALESCE(p_responses, '{}'::jsonb),
    NULLIF(trim(COALESCE(p_check_in_method, '')), '')
  )
  RETURNING id INTO v_feedback_id;

  FOR v_response_key, v_response_value IN
    SELECT key, value
    FROM jsonb_each(COALESCE(p_responses, '{}'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.feedback_question question_row
      WHERE question_row.id = v_response_key::uuid
        AND question_row.session_id = p_session_id
        AND (question_row.attendance_date IS NULL OR question_row.attendance_date = p_attendance_date)
    ) THEN
      INSERT INTO public.session_feedback_answer (
        session_feedback_id,
        question_id,
        session_id,
        attendance_date,
        student_id,
        answer_value
      ) VALUES (
        v_feedback_id,
        v_response_key::uuid,
        p_session_id,
        p_attendance_date,
        p_student_id,
        v_response_value
      )
      ON CONFLICT (session_feedback_id, question_id) DO UPDATE
      SET answer_value = EXCLUDED.answer_value;

      v_answer_count := v_answer_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'feedback_id', v_feedback_id,
    'answer_count', v_answer_count,
    'overall_rating', p_overall_rating
  );
END;
$$;

COMMENT ON FUNCTION public.submit_session_feedback IS 'Creates one parent session_feedback row plus normalized child answer rows after validating attendance and required questions.';

INSERT INTO public.session_feedback_answer (
  session_feedback_id,
  question_id,
  session_id,
  attendance_date,
  student_id,
  answer_value,
  created_at
)
SELECT
  feedback_row.id,
  response_entry.key::uuid,
  feedback_row.session_id,
  feedback_row.attendance_date,
  feedback_row.student_id,
  response_entry.value,
  feedback_row.created_at
FROM public.session_feedback feedback_row
CROSS JOIN LATERAL jsonb_each(COALESCE(feedback_row.responses, '{}'::jsonb)) AS response_entry(key, value)
JOIN public.feedback_question question_row
  ON question_row.id = response_entry.key::uuid
 AND question_row.session_id = feedback_row.session_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.session_feedback_answer answer_row
  WHERE answer_row.session_feedback_id = feedback_row.id
    AND answer_row.question_id = response_entry.key::uuid
);

COMMIT;