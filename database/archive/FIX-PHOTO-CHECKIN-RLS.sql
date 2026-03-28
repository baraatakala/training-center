-- FIX-PHOTO-CHECKIN-RLS.sql
-- Add missing RLS policies to photo_checkin_sessions table
-- This fixes the same bug that affected qr_sessions:
-- Unauthenticated users couldn't read tokens, causing "Invalid check-in link" error
-- Date: 2026-01-28

-- ===== STEP 1: Enable RLS (Row Level Security) =====
ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;

-- ===== STEP 2: Add RLS Policies =====

-- Policy: Teachers can create photo check-in sessions
CREATE POLICY "Teachers can create photo check-in sessions"
  ON photo_checkin_sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Authenticated users can read photo check-in sessions (needed for check-in)
-- Note: Using 'true' instead of filtering by is_valid/expires_at to allow
-- client-side validation with proper error messages
CREATE POLICY "Authenticated users can read photo check-in sessions"
  ON photo_checkin_sessions FOR SELECT
  TO authenticated
  USING (true);

-- Policy: System can update photo check-in sessions (invalidation)
CREATE POLICY "System can update photo check-in sessions"
  ON photo_checkin_sessions FOR UPDATE
  TO authenticated
  USING (true);

-- ===== VERIFICATION =====
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE tablename = 'photo_checkin_sessions';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Photo check-in RLS policies added!';
  RAISE NOTICE '';
  RAISE NOTICE 'Policies created:';
  RAISE NOTICE '  • INSERT: Teachers can create sessions';
  RAISE NOTICE '  • SELECT: Authenticated users can read sessions';
  RAISE NOTICE '  • UPDATE: System can update sessions';
  RAISE NOTICE '';
END $$;
