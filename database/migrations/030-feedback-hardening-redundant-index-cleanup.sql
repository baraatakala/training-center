-- ============================================================================
-- Migration 030: Feedback Hardening & Redundant Index Cleanup
-- ============================================================================
-- This migration addresses:
--   A. Redundant indexes introduced in 029 or earlier — drop to save write
--      amplification and storage without losing query performance.
--   B. Feedback FK cascade — preserve analytics data when a student is deleted.
--
-- Rationale for each drop is documented inline.
-- ============================================================================

BEGIN;

-- ============================================================================
-- A. DROP REDUNDANT INDEXES
-- ============================================================================

-- A1. idx_session_feedback_session_date (session_id, attendance_date)
--     Redundant: strict prefix of idx_session_feedback_student_date
--     (session_id, attendance_date, student_id). PostgreSQL B-tree can
--     satisfy (session_id, attendance_date) queries using the 3-col index.
DROP INDEX IF EXISTS public.idx_session_feedback_session_date;

-- A2. idx_feedback_question_session_date (session_id, attendance_date)
--     Redundant: strict prefix of the UNIQUE index
--     idx_feedback_question_unique_per_date (session_id, attendance_date, question_text).
DROP INDEX IF EXISTS public.idx_feedback_question_session_date;

-- A3. idx_announcement_read_unique (announcement_id, student_id)
--     Redundant: the UNIQUE constraint announcement_read_student_announcement_unique
--     on (announcement_id, student_id) already creates an implicit unique index.
DROP INDEX IF EXISTS public.idx_announcement_read_unique;

-- A4. idx_announcement_active_recent (course_id, created_at DESC)
--     Redundant: duplicate of pre-existing idx_announcement_course_created
--     on the exact same columns (course_id, created_at DESC).
DROP INDEX IF EXISTS public.idx_announcement_active_recent;


-- ============================================================================
-- B. FEEDBACK FK CASCADE FIX
-- ============================================================================

-- B1. session_feedback.student_id → student: ON DELETE SET NULL
--     When a student is removed from the system, their feedback submissions
--     remain as anonymous analytics rather than becoming FK violations.
--     The is_anonymous flag and the existing CHECK constraint
--     (is_anonymous = true OR student_id IS NOT NULL) are compatible:
--     if student_id becomes NULL, the row is effectively anonymous.
--     To keep the CHECK valid we also flip is_anonymous = true when
--     the student is deleted (see trigger below).
ALTER TABLE public.session_feedback
  DROP CONSTRAINT IF EXISTS session_feedback_student_id_fkey;
ALTER TABLE public.session_feedback
  ADD CONSTRAINT session_feedback_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE SET NULL;

-- B2. Trigger: when SET NULL fires, mark the feedback row anonymous
--     so the CHECK (is_anonymous = true OR student_id IS NOT NULL) stays valid.
CREATE OR REPLACE FUNCTION public.fn_feedback_anonymize_on_student_null()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.student_id IS NULL AND OLD.student_id IS NOT NULL THEN
    NEW.is_anonymous := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feedback_anonymize_on_student_null ON public.session_feedback;
CREATE TRIGGER trg_feedback_anonymize_on_student_null
  BEFORE UPDATE ON public.session_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_feedback_anonymize_on_student_null();


COMMIT;
