-- ============================================================================
-- Training Center — Seed Data
-- ============================================================================
-- Run order: 6 of 6 (after storage.sql)
-- Essential seed data for a fresh deployment.
-- All inserts use ON CONFLICT DO NOTHING for idempotent re-runs.
-- ============================================================================

-- ============================================================================
-- 1. ADMIN USER
-- ============================================================================

INSERT INTO public.admin (email, name)
VALUES ('baraatakala2004@gmail.com', 'Baraa Takala')
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- 2. SPECIALIZATIONS
-- ============================================================================

INSERT INTO public.specialization (name) VALUES
  ('Computer Science'),
  ('Engineering'),
  ('Medicine'),
  ('Business'),
  ('Education'),
  ('Law'),
  ('Arts'),
  ('Science')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 3. DEFAULT LATE BRACKETS (global — session_id = NULL)
-- ============================================================================

INSERT INTO public.late_brackets (session_id, min_minutes, max_minutes, bracket_name, bracket_name_ar, score_weight, display_color)
VALUES
  (NULL,  1,  5, 'Minor',       'بسيط',    0.90, '#22c55e'),
  (NULL,  6, 15, 'Moderate',    'متوسط',   0.75, '#eab308'),
  (NULL, 16, 30, 'Significant', 'ملحوظ',   0.50, '#f97316'),
  (NULL, 31, 60, 'Severe',      'شديد',    0.25, '#ef4444'),
  (NULL, 61, NULL, 'Very Late', 'متأخر جداً', 0.10, '#991b1b')
ON CONFLICT (session_id, min_minutes) DO NOTHING;

-- ============================================================================
-- 4. DEFAULT FEEDBACK TEMPLATE
-- ============================================================================

INSERT INTO public.feedback_template (name, description, questions, is_default)
VALUES (
  'Standard Session Feedback',
  'Default feedback template for session evaluation',
  '[
    {"question_text": "How would you rate the overall session?", "question_type": "rating", "is_required": true, "sort_order": 1},
    {"question_text": "How clear was the content presented?", "question_type": "rating", "is_required": true, "sort_order": 2},
    {"question_text": "How engaging was the session?", "question_type": "rating", "is_required": false, "sort_order": 3},
    {"question_text": "Any additional comments or suggestions?", "question_type": "text", "is_required": false, "sort_order": 4}
  ]'::JSONB,
  true
)
ON CONFLICT DO NOTHING;
