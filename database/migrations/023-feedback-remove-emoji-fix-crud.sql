-- Migration 021: Remove emoji question type + feedback improvements
-- Date: 2026-04-07

BEGIN;

-- 1. Convert any existing emoji questions to rating
UPDATE feedback_question
SET question_type = 'rating'
WHERE question_type = 'emoji';

-- 2. Update the CHECK constraint to remove emoji
ALTER TABLE feedback_question
DROP CONSTRAINT IF EXISTS feedback_question_question_type_check;

ALTER TABLE feedback_question
ADD CONSTRAINT feedback_question_question_type_check
CHECK (question_type = ANY (ARRAY['rating', 'text', 'multiple_choice']));

-- 3. Also update any template JSONB that has emoji questions
UPDATE feedback_template
SET questions = (
  SELECT jsonb_agg(
    CASE
      WHEN (elem->>'type') = 'emoji'
      THEN jsonb_set(elem, '{type}', '"rating"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(questions) AS elem
)
WHERE questions::text LIKE '%"emoji"%';

COMMIT;
