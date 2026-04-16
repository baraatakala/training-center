-- Migration 039: Feedback Timer & Answer Duration Tracking
-- Adds timed feedback support + answer duration + submission reason tracking
-- ============================================================================

BEGIN;

-- 1. Session: optional feedback time limit (NULL = no limit)
ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS feedback_time_limit_seconds INTEGER;

ALTER TABLE public.session
  ADD CONSTRAINT chk_feedback_time_limit_range
  CHECK (feedback_time_limit_seconds IS NULL OR (feedback_time_limit_seconds >= 10 AND feedback_time_limit_seconds <= 7200));

COMMENT ON COLUMN public.session.feedback_time_limit_seconds IS
  'Optional time limit in seconds for feedback submission. NULL = unlimited. Range: 10s–7200s (2h).';

-- 2. Session feedback: answer duration + submission reason
ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS answer_duration_seconds INTEGER;

ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS submission_reason TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE public.session_feedback
  ADD CONSTRAINT chk_feedback_answer_duration_positive
  CHECK (answer_duration_seconds IS NULL OR answer_duration_seconds >= 0);

ALTER TABLE public.session_feedback
  ADD CONSTRAINT chk_feedback_submission_reason_valid
  CHECK (submission_reason = ANY (ARRAY['completed', 'timer_expired', 'tab_violation', 'partial_timer', 'skipped']));

COMMENT ON COLUMN public.session_feedback.answer_duration_seconds IS
  'How many seconds the student spent on the feedback form before submitting.';

COMMENT ON COLUMN public.session_feedback.submission_reason IS
  'Why the form was submitted: completed (normal), timer_expired (auto-submit when time ran out), tab_violation (auto-submit from tab switching), partial_timer (student submitted before timer ended but with incomplete answers), skipped (student clicked skip/was redirected).';

COMMIT;
