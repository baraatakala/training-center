-- ============================================================================
-- Migration 006: Security Fixes & Gap Fill
-- ============================================================================
-- Fixes remaining gaps found comparing Supabase live state vs canonical files.
--
-- ISSUES FIXED:
--   A. CRITICAL: Fix 4 message policies that use TO public (unauthenticated)
--      → SELECT, INSERT×2, UPDATE must be TO authenticated
--   B. Drop 4 duplicate RLS policies left from earlier manual migrations
--      (feedback_question, session_feedback×2, feedback_template)
--   C. Create notification_preference table (in schema.sql but not in live DB)
--   D. Add missing admin updated_at trigger
--   E. Enable RLS + policies on notification_preference
-- ============================================================================

BEGIN;

-- ============================================================================
-- A. CRITICAL SECURITY: Fix message policies TO public → TO authenticated
-- ============================================================================
-- These 4 policies currently default to the "public" (anon) role, meaning
-- unauthenticated requests can reach the USING/WITH CHECK expressions.
-- While the expressions themselves check auth.jwt(), the correct defense-in-depth
-- approach requires TO authenticated so Supabase blocks anon requests outright.

-- A1. SELECT — users can view their own messages
DROP POLICY IF EXISTS "Users can view their messages" ON public.message;
CREATE POLICY "Users can view their messages" ON public.message
  FOR SELECT TO authenticated
  USING (
    (sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (sender_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- A2. INSERT — teachers can send
DROP POLICY IF EXISTS "Teachers can send messages" ON public.message;
CREATE POLICY "Teachers can send messages" ON public.message
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.sender_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- A3. INSERT — students can send
DROP POLICY IF EXISTS "Students can send messages" ON public.message;
CREATE POLICY "Students can send messages" ON public.message
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.sender_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- A4. UPDATE — recipients mark messages as read
DROP POLICY IF EXISTS "Recipients can update message read status" ON public.message;
CREATE POLICY "Recipients can update message read status" ON public.message
  FOR UPDATE TO authenticated
  USING (
    (recipient_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = message.recipient_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (recipient_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = message.recipient_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- ============================================================================
-- B. DROP DUPLICATE POLICIES (left from earlier manual migrations)
-- ============================================================================
-- Migration 005 creates clean versions; these are the stale duplicates.

-- B1. feedback_question: old name "Authenticated users can read session feedback questions"
--     Migration 005 creates "Anyone can read feedback questions" (identical logic)
DROP POLICY IF EXISTS "Authenticated users can read session feedback questions" ON public.feedback_question;

-- B2. session_feedback: old name "Students can insert verified session feedback"
--     Migration 005 creates "Students can submit feedback"
DROP POLICY IF EXISTS "Students can insert verified session feedback" ON public.session_feedback;

-- B3. session_feedback: old name "Students can read own session feedback"
--     Migration 005 creates "Students can read own feedback"
DROP POLICY IF EXISTS "Students can read own session feedback" ON public.session_feedback;

-- B4. feedback_template: old name "Authenticated users can read feedback templates"
--     Migration 005 creates "Anyone can read feedback templates"
DROP POLICY IF EXISTS "Authenticated users can read feedback templates" ON public.feedback_template;

-- ============================================================================
-- C. CREATE MISSING TABLE: notification_preference
-- ============================================================================
-- Defined in schema.sql but never created in live Supabase.

CREATE TABLE IF NOT EXISTS public.notification_preference (
  preference_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('teacher', 'student')),
  user_id UUID NOT NULL,
  email_announcements BOOLEAN DEFAULT true,
  email_messages BOOLEAN DEFAULT true,
  push_announcements BOOLEAN DEFAULT true,
  push_messages BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_type, user_id)
);

-- ============================================================================
-- D. ADD MISSING TRIGGER: admin updated_at
-- ============================================================================
-- admin table has updated_at column but no trigger to auto-update it.

DROP TRIGGER IF EXISTS update_admin_updated_at ON public.admin;
CREATE TRIGGER update_admin_updated_at
  BEFORE UPDATE ON public.admin
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- E. ENABLE RLS + POLICIES ON notification_preference
-- ============================================================================

ALTER TABLE public.notification_preference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin has full access" ON public.notification_preference;
CREATE POLICY "Admin has full access" ON public.notification_preference
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Users can manage their notification preferences" ON public.notification_preference;
CREATE POLICY "Users can manage their notification preferences" ON public.notification_preference
  FOR ALL TO authenticated
  USING (
    (user_type = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher
      WHERE teacher.teacher_id = notification_preference.user_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (user_type = 'student' AND EXISTS (
      SELECT 1 FROM public.student
      WHERE student.student_id = notification_preference.user_id
        AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

COMMIT;

-- ============================================================================
-- VERIFICATION (run after migration)
-- ============================================================================
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('message', 'feedback_question', 'session_feedback',
--                     'feedback_template', 'notification_preference')
-- ORDER BY tablename, policyname;
--
-- Expected after migration 006:
--   message:                  6 policies (all TO authenticated)
--   feedback_question:        2 policies (no duplicates)
--   session_feedback:         2 policies (no duplicates)
--   feedback_template:        2 policies (no duplicates)
--   notification_preference:  2 policies (Admin ALL + Users manage)
-- ============================================================================
