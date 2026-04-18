-- ============================================================
-- Migration 049: Revert Assessment System (undo 043, 044, 045)
-- ============================================================
-- Drops 4 assessment tables (question_bank, assessment, assessment_question, assessment_submission).
-- Restores columns dropped by 045 on feedback_question, session_feedback, session.
-- Keeps get_my_teacher_id() — used by session_schedule_day/exception RLS (046+).

DROP TABLE IF EXISTS public.assessment_submission CASCADE;
DROP TABLE IF EXISTS public.assessment_question CASCADE;
DROP TABLE IF EXISTS public.assessment CASCADE;
DROP TABLE IF EXISTS public.question_bank CASCADE;

ALTER TABLE public.feedback_question
  ADD COLUMN IF NOT EXISTS correct_answer TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grading_mode TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE public.feedback_question
  ADD CONSTRAINT feedback_question_grading_mode_check
    CHECK (grading_mode = ANY (ARRAY['exact', 'partial', 'any']));

ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS tab_switch_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_auto_submitted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS answer_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS submission_reason TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE public.session_feedback
  ADD CONSTRAINT chk_feedback_answer_duration_positive
    CHECK (answer_duration_seconds IS NULL OR answer_duration_seconds >= 0);
ALTER TABLE public.session_feedback
  ADD CONSTRAINT chk_feedback_submission_reason_valid
    CHECK (submission_reason = ANY (ARRAY['completed', 'timer_expired', 'tab_violation', 'partial_timer', 'skipped']));

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS max_tab_switches INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS feedback_time_limit_seconds INTEGER;
ALTER TABLE public.session
  ADD CONSTRAINT session_max_tab_switches_check
    CHECK (max_tab_switches >= 1 AND max_tab_switches <= 20);
ALTER TABLE public.session
  ADD CONSTRAINT chk_feedback_time_limit_range
    CHECK (feedback_time_limit_seconds IS NULL OR (feedback_time_limit_seconds >= 10 AND feedback_time_limit_seconds <= 7200));
