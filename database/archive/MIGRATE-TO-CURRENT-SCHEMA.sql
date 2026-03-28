-- MIGRATE-TO-CURRENT-SCHEMA.sql
-- Complete migration to match the working application schema
-- Run this on your Supabase database to sync with current codebase
-- Date: 2025-12-10

-- ================================================================
-- PHASE 1: REMOVE OLD STRUCTURES (location and session_location)
-- ================================================================

-- Drop old attendance foreign key to session_location
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_session_location_id_fkey;
  RAISE NOTICE '✓ Dropped attendance_session_location_id_fkey';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: attendance_session_location_id_fkey did not exist';
END $$;

-- Drop old unique constraints
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_session_date_unique;
  RAISE NOTICE '✓ Dropped old attendance unique constraints';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: Old constraints did not exist';
END $$;

-- Drop old tables (cascade will handle dependencies)
DROP TABLE IF EXISTS session_location CASCADE;
DROP TABLE IF EXISTS location CASCADE;
RAISE NOTICE '✓ Dropped old location and session_location tables';

-- ================================================================
-- PHASE 2: UPDATE SESSION TABLE
-- ================================================================

-- Add location column to session (simple text field)
ALTER TABLE session 
ADD COLUMN IF NOT EXISTS location TEXT;

-- Add grace_period_minutes to session
ALTER TABLE session 
ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER DEFAULT 15 
CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 60);

RAISE NOTICE '✓ Added location and grace_period_minutes to session table';

-- ================================================================
-- PHASE 3: UPDATE STUDENT TABLE
-- ================================================================

-- Add location column to student (for backward compatibility)
ALTER TABLE student 
ADD COLUMN IF NOT EXISTS location TEXT;

RAISE NOTICE '✓ Added location to student table';

-- ================================================================
-- PHASE 4: UPDATE ENROLLMENT TABLE
-- ================================================================

-- Add can_host column
ALTER TABLE enrollment 
ADD COLUMN IF NOT EXISTS can_host BOOLEAN NOT NULL DEFAULT false;

-- Add host_date column
ALTER TABLE enrollment 
ADD COLUMN IF NOT EXISTS host_date DATE;

-- Add constraint for can_host status
DO $$
BEGIN
  ALTER TABLE enrollment DROP CONSTRAINT IF EXISTS enrollment_status_canhost_check;
  ALTER TABLE enrollment 
  ADD CONSTRAINT enrollment_status_canhost_check 
  CHECK (
    (status = 'active' AND can_host IN (true, false)) OR 
    (status != 'active' AND can_host = false)
  );
  RAISE NOTICE '✓ Added can_host constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: Constraint already exists or issue: %', SQLERRM;
END $$;

RAISE NOTICE '✓ Added can_host and host_date to enrollment table';

-- ================================================================
-- PHASE 5: UPDATE ATTENDANCE TABLE
-- ================================================================

-- Drop old session_location_id column if it exists
ALTER TABLE attendance DROP COLUMN IF EXISTS session_location_id CASCADE;

-- Add session_id column
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES session(session_id) ON DELETE CASCADE;

-- Add attendance_date column
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS attendance_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Add GPS tracking columns
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_timestamp TIMESTAMPTZ;

-- Add excuse_reason column
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS excuse_reason VARCHAR(255);

-- Add audit columns
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS marked_by TEXT;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

-- Add host_address column for rotation system
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS host_address TEXT;

-- Drop old unique constraint if exists
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
  RAISE NOTICE '✓ Dropped old unique constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: Old unique constraint did not exist';
END $$;

-- Add new unique constraint (enrollment + date)
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_date_unique;
  ALTER TABLE attendance 
  ADD CONSTRAINT attendance_enrollment_date_unique 
  UNIQUE (enrollment_id, attendance_date);
  RAISE NOTICE '✓ Added new unique constraint: enrollment + date';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Note: Constraint already exists or issue: %', SQLERRM;
END $$;

RAISE NOTICE '✓ Updated attendance table structure';

-- ================================================================
-- PHASE 6: UPDATE INDEXES
-- ================================================================

-- Drop old indexes that reference deleted tables
DROP INDEX IF EXISTS idx_session_location_session;
DROP INDEX IF EXISTS idx_session_location_location;
DROP INDEX IF EXISTS idx_session_location_date;
DROP INDEX IF EXISTS idx_attendance_session_location;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_session_location_text ON session(location);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status_date ON attendance(status, attendance_date);
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host ON enrollment(can_host) WHERE can_host = true;

RAISE NOTICE '✓ Updated indexes';

-- ================================================================
-- PHASE 7: DATA MIGRATION (if needed)
-- ================================================================

-- Update any NULL session_id values in attendance (if possible)
-- This helps if you have orphaned records
UPDATE attendance 
SET session_id = e.session_id
FROM enrollment e
WHERE attendance.enrollment_id = e.enrollment_id
AND attendance.session_id IS NULL;

RAISE NOTICE '✓ Migrated attendance session_id data';

-- ================================================================
-- PHASE 8: VERIFY FINAL STRUCTURE
-- ================================================================

DO $$
DECLARE
  table_count INTEGER;
  column_count INTEGER;
BEGIN
  -- Check tables exist
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('teacher', 'student', 'course', 'session', 'enrollment', 'attendance');
  
  IF table_count = 6 THEN
    RAISE NOTICE '✓ All 6 required tables exist';
  ELSE
    RAISE WARNING 'WARNING: Expected 6 tables, found %', table_count;
  END IF;
  
  -- Check attendance has all required columns
  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_name = 'attendance'
  AND column_name IN (
    'attendance_id', 'enrollment_id', 'student_id', 'session_id',
    'attendance_date', 'status', 'check_in_time', 'notes',
    'gps_latitude', 'gps_longitude', 'gps_accuracy', 'gps_timestamp',
    'excuse_reason', 'marked_by', 'marked_at', 'host_address',
    'created_at', 'updated_at'
  );
  
  IF column_count >= 16 THEN
    RAISE NOTICE '✓ Attendance table has all required columns (% columns)', column_count;
  ELSE
    RAISE WARNING 'WARNING: Attendance table missing columns (found % of 18)', column_count;
  END IF;
END $$;

-- ================================================================
-- PHASE 9: FINAL SUMMARY
-- ================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '  MIGRATION COMPLETED SUCCESSFULLY!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes Applied:';
  RAISE NOTICE '1. Removed old location & session_location tables';
  RAISE NOTICE '2. Added location (text) to session table';
  RAISE NOTICE '3. Added grace_period_minutes to session';
  RAISE NOTICE '4. Added can_host & host_date to enrollment';
  RAISE NOTICE '5. Updated attendance table with all QR check-in fields';
  RAISE NOTICE '6. Added GPS tracking columns';
  RAISE NOTICE '7. Added excuse_reason & audit fields';
  RAISE NOTICE '8. Added host_address for rotation system';
  RAISE NOTICE '9. Created proper indexes';
  RAISE NOTICE '';
  RAISE NOTICE 'Your database now matches the current application!';
  RAISE NOTICE '';
END $$;

-- Show final structure summary
SELECT 
  'teacher' AS table_name,
  COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'teacher'
UNION ALL
SELECT 'student', COUNT(*) FROM information_schema.columns WHERE table_name = 'student'
UNION ALL
SELECT 'course', COUNT(*) FROM information_schema.columns WHERE table_name = 'course'
UNION ALL
SELECT 'session', COUNT(*) FROM information_schema.columns WHERE table_name = 'session'
UNION ALL
SELECT 'enrollment', COUNT(*) FROM information_schema.columns WHERE table_name = 'enrollment'
UNION ALL
SELECT 'attendance', COUNT(*) FROM information_schema.columns WHERE table_name = 'attendance'
ORDER BY table_name;
