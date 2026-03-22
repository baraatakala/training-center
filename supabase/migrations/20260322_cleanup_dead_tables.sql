-- ============================================================
-- Cleanup: Drop dead tables, functions, and orphaned objects
-- These are not referenced by any frontend code.
-- ============================================================

-- 1. Drop session_feedback_answer (all answers stored in session_feedback.responses JSONB)
DROP TABLE IF EXISTS public.session_feedback_answer CASCADE;

-- 2. Drop late_brackets TABLE (frontend uses scoring_config.late_brackets JSONB column instead)
DROP TABLE IF EXISTS public.late_brackets CASCADE;

-- 3. Drop notification_preference (not used by any frontend page)
DROP TABLE IF EXISTS public.notification_preference CASCADE;

-- 4. Drop message_attachment (not used by frontend Messages page)
DROP TABLE IF EXISTS public.message_attachment CASCADE;

-- 5. Drop the submit_session_feedback RPC (frontend now does direct INSERT into session_feedback)
DROP FUNCTION IF EXISTS public.submit_session_feedback(
  uuid, date, uuid, boolean, integer, text, jsonb, text
);
-- Also try without exact signature in case parameter types differ
DROP FUNCTION IF EXISTS public.submit_session_feedback;

-- 6. Clean up orphaned indexes from dropped tables (if any remain)
-- PostgreSQL drops indexes automatically with CASCADE, but just in case:
DROP INDEX IF EXISTS idx_session_feedback_answer_feedback;
DROP INDEX IF EXISTS idx_session_feedback_answer_question;
DROP INDEX IF EXISTS idx_session_feedback_answer_session_date;
