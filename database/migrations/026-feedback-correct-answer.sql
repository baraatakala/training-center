-- ============================================================================
-- Migration 026: Feedback Correct Answer (Test Question Feature)
-- ============================================================================
-- Adds correct_answer to feedback_question so a question can be flagged as a
-- "test question". Student responses are graded case-insensitively against this
-- value. NULL = regular feedback question (no grading).
-- ============================================================================

-- 1. Add column to feedback_question
ALTER TABLE public.feedback_question
  ADD COLUMN IF NOT EXISTS correct_answer TEXT DEFAULT NULL;

COMMENT ON COLUMN public.feedback_question.correct_answer IS
  'If non-null, this is a test question. Analytics compares student responses '
  '(trimmed, case-insensitive) against this value to compute a correctness score. '
  'Only meaningful for text and multiple_choice question types.';

-- 2. The feedback_template.questions JSONB array stores question definitions as
--    { type, text, required, options?, correct_answer? }. No schema change needed
--    for the template table itself — JSONB handles the extra field naturally.

-- 3. RLS: no new policies needed. feedback_question inherits existing teacher/admin
--    policies. The correct_answer column is readable by enrolled students (they
--    need it client-side to display their graded result after submission), which
--    is acceptable for a training-centre quiz context where preventing cheating is
--    not a hard security requirement.
