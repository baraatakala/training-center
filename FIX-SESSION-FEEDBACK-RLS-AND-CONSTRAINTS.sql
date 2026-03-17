-- ============================================================
-- Feedback System Repair Migration
-- ============================================================
-- Purpose:
-- 1. Ensure feedback columns exist on session
-- 2. Ensure feedback tables have RLS enabled
-- 3. Ensure required feedback policies exist
-- 4. Ensure indexes and non-anonymous duplicate protection exist
--
-- Run this if ADD-SESSION-FEEDBACK.sql was applied partially,
-- or if your exported schema snapshot contains the feedback tables
-- but is missing the RLS/policy/constraint parts.
-- ============================================================

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS feedback_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback_anonymous_allowed boolean DEFAULT true;

ALTER TABLE public.feedback_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_template ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_question'
      AND policyname = 'Anyone can read feedback questions'
  ) THEN
    CREATE POLICY "Anyone can read feedback questions"
      ON public.feedback_question
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_question'
      AND policyname = 'Teachers and admins can manage feedback questions'
  ) THEN
    CREATE POLICY "Teachers and admins can manage feedback questions"
      ON public.feedback_question
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
        OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
        OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_feedback'
      AND policyname = 'Students can submit feedback'
  ) THEN
    CREATE POLICY "Students can submit feedback"
      ON public.session_feedback
      FOR INSERT
      WITH CHECK (
        student_id = (
          SELECT student_id
          FROM public.student
          WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
          LIMIT 1
        )
        OR student_id IS NULL
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_feedback'
      AND policyname = 'Students can read own feedback'
  ) THEN
    CREATE POLICY "Students can read own feedback"
      ON public.session_feedback
      FOR SELECT
      USING (
        student_id = (
          SELECT student_id
          FROM public.student
          WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
          LIMIT 1
        )
        OR EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
        OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_template'
      AND policyname = 'Anyone can read feedback templates'
  ) THEN
    CREATE POLICY "Anyone can read feedback templates"
      ON public.feedback_template
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback_template'
      AND policyname = 'Teachers and admins can manage feedback templates'
  ) THEN
    CREATE POLICY "Teachers and admins can manage feedback templates"
      ON public.feedback_template
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
        OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
        OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_session_feedback_session_date
  ON public.session_feedback (session_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_session_feedback_student
  ON public.session_feedback (student_id);

CREATE INDEX IF NOT EXISTS idx_feedback_question_session
  ON public.feedback_question (session_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_feedback_unique_non_anonymous
  ON public.session_feedback (session_id, attendance_date, student_id)
  WHERE student_id IS NOT NULL;