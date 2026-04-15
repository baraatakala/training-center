-- Migration 026: Anti-cheat tracking for test-mode feedback
-- When feedback questions have correct_answer (test mode), the system detects
-- tab switches and records violations. Auto-submit triggers after max violations.

-- Track how many times the student switched away from the tab during submission
ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS tab_switch_count INTEGER NOT NULL DEFAULT 0;

-- Flag whether the submission was auto-submitted by the anti-cheat system
ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS is_auto_submitted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.session_feedback.tab_switch_count IS 'Number of times the student switched browser tabs during a test-mode feedback form';
COMMENT ON COLUMN public.session_feedback.is_auto_submitted IS 'True when the system auto-submitted due to exceeding max tab-switch violations';
