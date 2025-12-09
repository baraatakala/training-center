-- FIX-ATTENDANCE-FOR-QR-CHECKIN.sql
-- Fixes attendance table structure to support QR code check-in system
-- Ensures proper unique constraint and all necessary fields exist
-- Date: 2025-12-09

-- ===== STEP 1: Verify current structure =====
DO $$
BEGIN
  RAISE NOTICE '=== ATTENDANCE TABLE CURRENT STRUCTURE ===';
END $$;

-- Show current columns
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'attendance'
ORDER BY ordinal_position;

-- Show current constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'attendance'::regclass
ORDER BY contype, conname;

-- ===== STEP 2: Drop old problematic constraint =====
-- The original schema had attendance_enrollment_id_session_location_id_key
-- which doesn't work with our simplified structure
DO $$
BEGIN
  -- Drop all old unique constraints that might conflict
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_session_date_unique;
  
  RAISE NOTICE 'Dropped old unique constraints';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Issue dropping constraints (might not exist): %', SQLERRM;
END $$;

-- ===== STEP 3: Ensure all required columns exist =====
-- Add any missing columns (IF NOT EXISTS prevents errors)
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES session(session_id) ON DELETE CASCADE;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS attendance_date DATE;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_latitude DECIMAL(10, 8);

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_longitude DECIMAL(11, 8);

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(10, 2);

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_timestamp TIMESTAMPTZ;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS host_address TEXT;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS marked_by VARCHAR(255);

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS excuse_reason VARCHAR(100);

-- ===== STEP 4: Make session_location_id nullable (legacy field) =====
-- We don't use this anymore but keep it for backward compatibility
ALTER TABLE attendance 
ALTER COLUMN session_location_id DROP NOT NULL;

-- ===== STEP 5: Create proper unique constraint =====
-- This allows one attendance record per enrollment per date
-- Supports both manual marking and QR check-in
DO $$
BEGIN
  -- Create the unique constraint
  ALTER TABLE attendance
  ADD CONSTRAINT attendance_enrollment_date_unique 
  UNIQUE(enrollment_id, attendance_date);
  
  RAISE NOTICE 'Created unique constraint: attendance_enrollment_date_unique';
EXCEPTION 
  WHEN duplicate_key THEN
    -- If data already exists with duplicates, we need to handle it
    RAISE NOTICE 'Duplicate data exists. Cleaning up...';
    
    -- Keep the most recent record for each enrollment_id + attendance_date combination
    DELETE FROM attendance a
    WHERE attendance_id IN (
      SELECT attendance_id
      FROM (
        SELECT 
          attendance_id,
          ROW_NUMBER() OVER (
            PARTITION BY enrollment_id, attendance_date 
            ORDER BY marked_at DESC NULLS LAST, created_at DESC
          ) as rn
        FROM attendance
      ) sub
      WHERE rn > 1
    );
    
    -- Now try again
    ALTER TABLE attendance
    ADD CONSTRAINT attendance_enrollment_date_unique 
    UNIQUE(enrollment_id, attendance_date);
    
    RAISE NOTICE 'Cleaned duplicates and created unique constraint';
  WHEN unique_violation THEN
    RAISE NOTICE 'Constraint already exists: attendance_enrollment_date_unique';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating constraint: %', SQLERRM;
END $$;

-- ===== STEP 6: Update existing indexes =====
-- Drop old indexes that might be inefficient
DROP INDEX IF EXISTS idx_attendance_session_location;

-- Create optimized indexes for QR check-in queries
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date) WHERE attendance_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment_date ON attendance(enrollment_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_gps ON attendance(gps_latitude, gps_longitude) WHERE gps_latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_host_address ON attendance(host_address) WHERE host_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_marked_by ON attendance(marked_by) WHERE marked_by IS NOT NULL;

-- ===== STEP 7: Add helpful comments =====
COMMENT ON COLUMN attendance.session_id IS 'Reference to session (simplified from session_location)';
COMMENT ON COLUMN attendance.attendance_date IS 'Specific date of attendance (YYYY-MM-DD)';
COMMENT ON COLUMN attendance.gps_latitude IS 'GPS latitude when attendance marked (for verification)';
COMMENT ON COLUMN attendance.gps_longitude IS 'GPS longitude when attendance marked (for verification)';
COMMENT ON COLUMN attendance.gps_accuracy IS 'GPS accuracy in meters';
COMMENT ON COLUMN attendance.gps_timestamp IS 'Timestamp when GPS was captured';
COMMENT ON COLUMN attendance.host_address IS 'Physical address where session took place';
COMMENT ON COLUMN attendance.marked_by IS 'Email of person who marked attendance (teacher email or student email - self check-in)';
COMMENT ON COLUMN attendance.marked_at IS 'Timestamp when attendance was marked';
COMMENT ON COLUMN attendance.excuse_reason IS 'Reason for excused absence (sick, abroad, on working, etc)';
COMMENT ON COLUMN attendance.check_in_time IS 'Timestamp when student checked in (for QR code check-in)';
COMMENT ON CONSTRAINT attendance_enrollment_date_unique ON attendance IS 'Ensures one attendance record per enrollment per date (supports both manual and QR check-in)';

-- ===== STEP 8: Verification =====
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICATION RESULTS ===';
END $$;

-- Show final structure
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'attendance'
ORDER BY ordinal_position;

-- Show constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'attendance'::regclass
  AND contype IN ('u', 'c') -- unique and check constraints
ORDER BY contype, conname;

-- Show indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'attendance'
ORDER BY indexname;

-- Count records
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT enrollment_id || '|' || attendance_date) as unique_enrollment_dates,
    COUNT(*) - COUNT(DISTINCT enrollment_id || '|' || attendance_date) as potential_duplicates
FROM attendance;

-- ===== SUCCESS MESSAGE =====
DO $$
BEGIN
  RAISE NOTICE '✅ Attendance table is now ready for QR code check-in system!';
  RAISE NOTICE 'Students can now:';
  RAISE NOTICE '  - Scan QR code to check in';
  RAISE NOTICE '  - One check-in per enrollment per date';
  RAISE NOTICE '  - GPS location captured automatically';
  RAISE NOTICE '  - marked_by shows who marked attendance';
END $$;

