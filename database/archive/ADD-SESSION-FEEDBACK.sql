-- ============================================================
-- Session Feedback System
-- ============================================================
-- Adds optional post-check-in feedback for students.
-- Integrates with QR code and face recognition check-in flows.
-- Teachers can enable/disable feedback per session.
-- Supports anonymous mode and customizable questions.
-- ============================================================

-- 1. Add feedback_enabled flag to session table
ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS feedback_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback_anonymous_allowed boolean DEFAULT true;

-- 2. Create feedback questions table (customizable per session)
CREATE TABLE IF NOT EXISTS public.feedback_question (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'rating'
    CHECK (question_type IN ('rating', 'text', 'emoji', 'multiple_choice')),
  options jsonb DEFAULT '[]'::jsonb,      -- For multiple_choice: ["Good","OK","Bad"]
  sort_order int NOT NULL DEFAULT 0,
  is_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 3. Create session feedback response table
CREATE TABLE IF NOT EXISTS public.session_feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  student_id uuid REFERENCES public.student(student_id) ON DELETE SET NULL,
  is_anonymous boolean DEFAULT false,
  overall_rating int CHECK (overall_rating BETWEEN 1 AND 5),
  comment text,
  responses jsonb DEFAULT '{}'::jsonb,    -- { "question_id": answer }
  check_in_method text,                   -- 'qr_code' or 'face_recognition'
  created_at timestamptz DEFAULT now(),
  UNIQUE (session_id, attendance_date, student_id)
);

-- 4. Create default question templates (global, session_id = NULL)
CREATE TABLE IF NOT EXISTS public.feedback_template (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

-- 5. Seed a default template
INSERT INTO public.feedback_template (name, description, questions, is_default) VALUES
(
  'Standard Session Feedback',
  'Default feedback template with overall rating and optional comment',
  '[
    {"type": "rating", "text": "How would you rate this session?", "required": true},
    {"type": "emoji", "text": "How do you feel after this session?", "required": false},
    {"type": "text", "text": "Any suggestions or comments?", "required": false}
  ]'::jsonb,
  true
) ON CONFLICT DO NOTHING;

-- 6. Enable RLS
ALTER TABLE public.feedback_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_template ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies

-- feedback_question: Anyone can read, teachers/admins can manage
CREATE POLICY "Anyone can read feedback questions"
  ON public.feedback_question FOR SELECT USING (true);

CREATE POLICY "Teachers and admins can manage feedback questions"
  ON public.feedback_question FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

-- session_feedback: Students can insert their own, teachers/admins can read all
CREATE POLICY "Students can submit feedback"
  ON public.session_feedback FOR INSERT
  WITH CHECK (
    student_id = (
      SELECT student_id FROM public.student
      WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
      LIMIT 1
    )
    OR student_id IS NULL  -- anonymous
  );

CREATE POLICY "Students can read own feedback"
  ON public.session_feedback FOR SELECT
  USING (
    student_id = (
      SELECT student_id FROM public.student
      WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
      LIMIT 1
    )
    OR EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

-- feedback_template: Anyone can read, teachers/admins can manage
CREATE POLICY "Anyone can read feedback templates"
  ON public.feedback_template FOR SELECT USING (true);

CREATE POLICY "Teachers and admins can manage feedback templates"
  ON public.feedback_template FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

-- 8. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_feedback_session_date
  ON public.session_feedback (session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_session_feedback_student
  ON public.session_feedback (student_id);
CREATE INDEX IF NOT EXISTS idx_feedback_question_session
  ON public.feedback_question (session_id, sort_order);
