-- Migration 037: Add grading_mode column to feedback_question
-- Controls how multi-select correctness is evaluated:
--   'exact'   — student must select ALL correct answers, nothing more (default)
--   'partial' — score = correct_picks / total_correct (partial credit)
--   'any'     — at least one correct answer selected = correct

ALTER TABLE feedback_question
ADD COLUMN IF NOT EXISTS grading_mode TEXT NOT NULL DEFAULT 'exact'
  CHECK (grading_mode IN ('exact', 'partial', 'any'));

COMMENT ON COLUMN feedback_question.grading_mode
  IS 'Multi-select grading strategy: exact = all-or-nothing, partial = proportional credit, any = at least one correct.';
