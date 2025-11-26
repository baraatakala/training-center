-- SIMPLE DATABASE MIGRATION - Run this in Supabase SQL Editor
-- This adds new columns without breaking existing data

-- Step 1: Add new columns to attendance table (if they don't exist)
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES session(session_id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS attendance_date DATE;

-- Step 2: Check if session_location table exists and migrate data if it does
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'session_location') THEN
    -- Populate from existing session_location data
    UPDATE attendance a
    SET 
      session_id = sl.session_id,
      attendance_date = sl.date
    FROM session_location sl
    WHERE a.session_location_id = sl.id
    AND a.session_id IS NULL;
  END IF;
END $$;

-- Step 3: Set defaults for any records that don't have data yet
UPDATE attendance
SET attendance_date = CURRENT_DATE
WHERE attendance_date IS NULL;

-- Step 4: Since session_location doesn't exist, we cannot safely make session_id NOT NULL
-- Instead, we'll leave it nullable for now and you can add data through the frontend

-- Step 5: Add location field to session table
ALTER TABLE session
ADD COLUMN IF NOT EXISTS location TEXT;

-- Step 6: Add location field to student table  
ALTER TABLE student
ADD COLUMN IF NOT EXISTS location TEXT;

-- Step 7: Make session_location_id nullable (for compatibility) - only if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'attendance' AND column_name = 'session_location_id'
  ) THEN
    ALTER TABLE attendance ALTER COLUMN session_location_id DROP NOT NULL;
  END IF;
END $$;

-- Step 8: Create new index for session_id queries
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);

-- Step 9: Create new unique constraint (drop old one first if exists)
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_session_date_unique;

-- Add new unique constraint (allows null session_id for now)
-- This will prevent duplicate attendance for the same enrollment, session, and date
CREATE UNIQUE INDEX IF NOT EXISTS attendance_enrollment_session_date_idx 
ON attendance(enrollment_id, session_id, attendance_date) 
WHERE session_id IS NOT NULL;

-- Step 10: Add helpful comments
COMMENT ON COLUMN session.location IS 'Physical location/venue where this session takes place (e.g., Main Campus - Room 202)';
COMMENT ON COLUMN student.location IS 'Student home address or primary location';
COMMENT ON COLUMN attendance.session_id IS 'Reference to the session this attendance record belongs to';
COMMENT ON COLUMN attendance.attendance_date IS 'The specific date of this attendance record';

-- Done! Your database is now updated and compatible with the new frontend.
-- You can keep the old location, location_zone, and session_location tables for now as backup.
-- Once you verify everything works, you can drop them later with:
-- DROP TABLE IF EXISTS location_zone CASCADE;
-- DROP TABLE IF EXISTS session_location CASCADE;
-- DROP TABLE IF EXISTS location CASCADE;
