-- Migration 036: Add allow_multiple column to feedback_question
-- Enables multi-select for multiple_choice questions

ALTER TABLE feedback_question
ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN feedback_question.allow_multiple IS 'When true, multiple_choice questions allow selecting multiple options. Response stored as JSON array.';
