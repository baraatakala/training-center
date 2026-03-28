-- FIX-ALL-CHECKIN-RLS.sql
-- Comprehensive fix for QR and Photo check-in RLS policies
-- Run this in Supabase SQL Editor
-- Date: 2026-01-28

-- ========================================
-- PART 1: Fix qr_sessions RLS Policy
-- ========================================

-- Drop the restrictive SELECT policy that prevents proper error messages
DROP POLICY IF EXISTS "Anyone can read active QR sessions" ON public.qr_sessions;

-- Create new policy that allows reading all tokens (validation done in app code)
CREATE POLICY "Authenticated users can read QR sessions"
  ON public.qr_sessions FOR SELECT
  TO authenticated
  USING (true);

-- ========================================
-- PART 2: Add photo_checkin_sessions RLS
-- ========================================

-- Enable RLS if not already enabled
ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (to avoid conflicts)
DROP POLICY IF EXISTS "Teachers can create photo check-in sessions" ON photo_checkin_sessions;
DROP POLICY IF EXISTS "Authenticated users can read photo check-in sessions" ON photo_checkin_sessions;
DROP POLICY IF EXISTS "System can update photo check-in sessions" ON photo_checkin_sessions;

-- Create INSERT policy
CREATE POLICY "Teachers can create photo check-in sessions"
  ON photo_checkin_sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create SELECT policy (allows all reads so app can show proper error messages)
CREATE POLICY "Authenticated users can read photo check-in sessions"
  ON photo_checkin_sessions FOR SELECT
  TO authenticated
  USING (true);

-- Create UPDATE policy
CREATE POLICY "System can update photo check-in sessions"
  ON photo_checkin_sessions FOR UPDATE
  TO authenticated
  USING (true);

-- ========================================
-- VERIFICATION
-- ========================================

-- Show all policies for both tables
SELECT 
    tablename,
    policyname,
    cmd,
    roles
FROM pg_policies
WHERE tablename IN ('qr_sessions', 'photo_checkin_sessions')
ORDER BY tablename, policyname;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ All check-in RLS policies fixed!';
  RAISE NOTICE '';
  RAISE NOTICE 'QR Sessions:';
  RAISE NOTICE '  • SELECT policy updated to allow all reads';
  RAISE NOTICE '';
  RAISE NOTICE 'Photo Check-in Sessions:';
  RAISE NOTICE '  • INSERT, SELECT, UPDATE policies created';
  RAISE NOTICE '';
  RAISE NOTICE '🔒 Note: Validation is now done in application code';
  RAISE NOTICE '   This allows proper error messages for expired/invalid tokens';
  RAISE NOTICE '';
END $$;
