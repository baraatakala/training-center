-- ============================================================
-- ADD attendance_date COLUMN TO feedback_question
-- Enables per-session-date question customization:
--   NULL  = global question (shown on ALL dates)
--   DATE  = date-specific question (shown only on that date)
-- ============================================================

-- 1. Add nullable attendance_date column
ALTER TABLE feedback_question
  ADD COLUMN IF NOT EXISTS attendance_date DATE;

-- 2. Index for efficient per-session+date lookups
CREATE INDEX IF NOT EXISTS idx_feedback_question_session_date
  ON feedback_question(session_id, attendance_date);

-- 3. Prevent duplicate question text per session+date combination
-- (null attendance_date = global; each non-null date has its own uniqueness scope)
-- We use a partial unique index for non-null dates and a separate one for global
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_question_unique_per_date
  ON feedback_question(session_id, attendance_date, question_text)
  WHERE attendance_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_question_unique_global
  ON feedback_question(session_id, question_text)
  WHERE attendance_date IS NULL;

-- 4. Comment for documentation
COMMENT ON COLUMN feedback_question.attendance_date IS
  'If NULL, this question appears on every session date (global). If set, it only appears on that specific attendance date.';
