-- ============================================================================
-- Migration 031: Feedback Constraint Hardening
-- Date: 2026-04-14
-- Author: GitHub Copilot
-- Summary:
--   Implements 3 validated improvements from automated schema audit + 1 bonus
--   cleanup that Claude Code missed:
--
--   A. DROP redundant full-unique constraint on session_feedback (overlaps the
--      more correct partial unique index added in migration 028). Claude Code
--      missed that duplicate prevention was ALREADY fixed; this just removes
--      the redundant enforcement overhead.
--
--   B. Make feedback_question.options NOT NULL — the column has DEFAULT '[]'
--      but was left nullable, which is inconsistent (NULL ≠ empty array).
--
--   C. ADD CHECK: when question_type = 'multiple_choice', options must have at
--      least one entry. Prevents a structurally invalid question from reaching
--      the DB.
--
--   D. ADD UNIQUE partial index on feedback_template.is_default — enforces
--      that at most one template can be the default at any time.
--
-- What Claude Code got WRONG (not implemented):
--   - P0 "redesign template with junction table" — templates are JSONB blueprints
--     that get instantiated into per-session questions on applyTemplate(); a
--     junction table model requires a shared question library which this system
--     intentionally does not have.
--   - P1 "normalize responses into separate table" — responses JSONB is keyed
--     by question_id, correct at this scale, transaction-free on submission.
--   - "FK created_by → auth.users" — service never sets created_by; FK would
--     cause every template insert to violate the constraint.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- A. Drop redundant full-unique constraint on session_feedback
--    Redundant because idx_session_feedback_one_per_student (partial WHERE
--    student_id IS NOT NULL) enforces the same uniqueness more correctly and
--    efficiently. NULLs are excluded by the partial index, matching the CHECK
--    constraint semantics. The full unique constraint is wider but provides no
--    additional enforcement: PostgreSQL treats NULL as distinct, so it also
--    allows multiple anonymous rows — making both behave identically for
--    identified students and equivalently permissive for anonymous ones.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.session_feedback
  DROP CONSTRAINT IF EXISTS session_feedback_session_id_attendance_date_student_id_key;


-- ─────────────────────────────────────────────────────────────────────────────
-- B. Fix feedback_question.options nullability
--    Column has DEFAULT '[]' but IS NULL = YES. Backfill any accidental NULLs
--    (none expected) then tighten to NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.feedback_question
  SET options = '[]'::JSONB
  WHERE options IS NULL;

ALTER TABLE public.feedback_question
  ALTER COLUMN options SET NOT NULL;

-- Tighten is_required while we are here (same pattern — nullable boolean with
-- a DEFAULT false makes no semantic sense as nullable).
UPDATE public.feedback_question
  SET is_required = false
  WHERE is_required IS NULL;

ALTER TABLE public.feedback_question
  ALTER COLUMN is_required SET NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- C. CHECK: multiple_choice questions must declare at least one option
--    Condition is one-sided: rating/text questions may have an empty options
--    array (the service always passes '[]' for them), and that is valid.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.feedback_question
  ADD CONSTRAINT chk_multiple_choice_has_options
  CHECK (
    question_type != 'multiple_choice'
    OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) > 0)
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- D. Enforce single default template
--    A partial unique index on (is_default) WHERE is_default = true allows at
--    most one row to carry is_default = true. Rows with is_default = false or
--    NULL are unconstrained (no conflict possible — false ≠ true).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_default_template
  ON public.feedback_template (is_default)
  WHERE is_default = true;
