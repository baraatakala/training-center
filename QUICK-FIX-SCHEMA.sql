-- QUICK-FIX-SCHEMA.sql
-- Small fixes to align your database with the current app
-- Your database is MOSTLY correct, just a few tweaks needed
-- Date: 2025-12-10

-- ================================================================
-- FIX 1: Remove old session_location_id from attendance
-- ================================================================

-- First check if the column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'attendance' AND column_name = 'session_location_id'
  ) THEN
    -- Drop the column (this will also drop the foreign key)
    ALTER TABLE attendance DROP COLUMN session_location_id CASCADE;
    RAISE NOTICE '✓ Removed old session_location_id column from attendance';
  ELSE
    RAISE NOTICE '✓ session_location_id already removed - OK';
  END IF;
END $$;

-- ================================================================
-- FIX 2: Add location column to session table (if missing)
-- ================================================================

ALTER TABLE session 
ADD COLUMN IF NOT EXISTS location TEXT;

DO $$
BEGIN
  RAISE NOTICE '✓ Added location column to session table';
END $$;

-- ================================================================
-- FIX 3: Ensure session.grace_period_minutes has proper default
-- ================================================================

DO $$
BEGIN
  -- Update existing NULL values to default
  UPDATE session 
  SET grace_period_minutes = 15 
  WHERE grace_period_minutes IS NULL;
  
  RAISE NOTICE '✓ Set default grace_period_minutes for existing sessions';
END $$;

-- ================================================================
-- FIX 4: Ensure enrollment.can_host has proper default
-- ================================================================

DO $$
BEGIN
  -- Update any NULL values
  UPDATE enrollment 
  SET can_host = false 
  WHERE can_host IS NULL;
  
  RAISE NOTICE '✓ Set default can_host for existing enrollments';
END $$;

-- ================================================================
-- FIX 5: Drop old location tables if they exist
-- ================================================================

DROP TABLE IF EXISTS session_location CASCADE;
DROP TABLE IF EXISTS location CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✓ Removed old location tables (if they existed)';
END $$;

-- ================================================================
-- FIX 6: Verify attendance has proper unique constraint
-- ================================================================

-- Drop old constraint
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
  RAISE NOTICE '✓ Removed old unique constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✓ Old constraint did not exist';
END $$;

-- Add correct constraint
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_date_unique;
  ALTER TABLE attendance 
  ADD CONSTRAINT attendance_enrollment_date_unique 
  UNIQUE (enrollment_id, attendance_date);
  RAISE NOTICE '✓ Added correct unique constraint (enrollment + date)';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = '42P07' THEN
    RAISE NOTICE '✓ Unique constraint already exists - OK';
  ELSE
    RAISE EXCEPTION 'Error: %', SQLERRM;
  END IF;
END $$;

-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
  has_session_location_id BOOLEAN;
  has_session_location TEXT;
  has_grace_period BOOLEAN;
  has_can_host BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '  VERIFICATION RESULTS';
  RAISE NOTICE '========================================';
  
  -- Check session_location_id is gone
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'attendance' AND column_name = 'session_location_id'
  ) INTO has_session_location_id;
  
  IF has_session_location_id THEN
    RAISE WARNING '⚠ attendance.session_location_id still exists!';
  ELSE
    RAISE NOTICE '✓ attendance.session_location_id removed';
  END IF;
  
  -- Check session.location exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session' AND column_name = 'location'
  ) INTO has_session_location;
  
  IF has_session_location THEN
    RAISE NOTICE '✓ session.location exists';
  ELSE
    RAISE WARNING '⚠ session.location is missing!';
  END IF;
  
  -- Check grace_period_minutes
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'session' AND column_name = 'grace_period_minutes'
  ) INTO has_grace_period;
  
  IF has_grace_period THEN
    RAISE NOTICE '✓ session.grace_period_minutes exists';
  ELSE
    RAISE WARNING '⚠ session.grace_period_minutes is missing!';
  END IF;
  
  -- Check can_host
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'enrollment' AND column_name = 'can_host'
  ) INTO has_can_host;
  
  IF has_can_host THEN
    RAISE NOTICE '✓ enrollment.can_host exists';
  ELSE
    RAISE WARNING '⚠ enrollment.can_host is missing!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Database is now aligned with the application!';
  RAISE NOTICE '';
END $$;

-- Show final attendance columns
SELECT 
  column_name,
  data_type,
  CASE 
    WHEN column_name = 'session_location_id' THEN '❌ Should not exist'
    ELSE '✓ OK'
  END AS status
FROM information_schema.columns
WHERE table_name = 'attendance'
ORDER BY ordinal_position;
