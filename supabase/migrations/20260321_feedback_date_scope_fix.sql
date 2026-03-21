BEGIN;

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
  v_available_question_count integer;
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
  INTO v_available_question_count
  FROM public.feedback_question question_row
  WHERE question_row.session_id = p_session_id
    AND question_row.attendance_date = p_attendance_date;

  IF v_available_question_count = 0 THEN
    RAISE EXCEPTION 'No feedback questions are configured for this session date';
  END IF;

  SELECT COUNT(*)
  INTO v_required_question_count
  FROM public.feedback_question question_row
  WHERE question_row.session_id = p_session_id
    AND question_row.attendance_date = p_attendance_date
    AND question_row.is_required = true
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
        AND question_row.attendance_date = p_attendance_date
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

  IF v_answer_count = 0 THEN
    RAISE EXCEPTION 'Feedback submission did not include any valid answers for this session date';
  END IF;

  RETURN jsonb_build_object(
    'feedback_id', v_feedback_id,
    'answer_count', v_answer_count,
    'overall_rating', p_overall_rating
  );
END;
$$;

COMMENT ON FUNCTION public.submit_session_feedback IS 'Creates one parent session_feedback row plus normalized child answer rows after validating attendance and exact date-scoped feedback questions.';

COMMIT;