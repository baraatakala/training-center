-- Database Restructuring: Simplify by removing location tables and adding location to session/student
-- This script removes the complex location structure and adds simple text fields instead

-- Step 1: Drop the location_zone table (if exists from previous updates)
DROP TABLE IF EXISTS location_zone CASCADE;

-- Step 2: Remove foreign key constraint from session_location to location
-- and drop session_location table entirely (we'll auto-generate attendance dates instead)
DROP TABLE IF EXISTS session_location CASCADE;

-- Step 3: Add location field directly to session table
ALTER TABLE session
ADD COLUMN IF NOT EXISTS location TEXT;

-- Step 4: Add location field to student table (for their home/contact location)
ALTER TABLE student
ADD COLUMN IF NOT EXISTS location TEXT;

-- Step 5: Modify attendance table to reference session directly instead of session_location
-- First, add new columns
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES session(session_id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS attendance_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Step 6: Create new unique constraint for attendance (student can only have one attendance per session per date)
-- Drop old unique constraint first
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_id_session_location_id_key;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_enrollment_session_date_unique;

-- Add new unique constraint
ALTER TABLE attendance
ADD CONSTRAINT attendance_enrollment_session_date_unique 
UNIQUE(enrollment_id, session_id, attendance_date);

-- Step 7: Update indexes for new structure
DROP INDEX IF EXISTS idx_attendance_session_location;
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);

-- Step 8: Make session_location_id nullable (for migration) or remove it
ALTER TABLE attendance ALTER COLUMN session_location_id DROP NOT NULL;

-- Step 9: Drop the location table (now unused)
DROP TABLE IF EXISTS location CASCADE;

-- Step 10: Update comments
COMMENT ON COLUMN session.location IS 'Physical location/venue where this session takes place (e.g., Main Campus - Room 202)';
COMMENT ON COLUMN student.location IS 'Student home address or primary location';
COMMENT ON COLUMN attendance.session_id IS 'Reference to the session this attendance record belongs to';
COMMENT ON COLUMN attendance.attendance_date IS 'The specific date of this attendance record';

-- Step 11: Add index for session location searches
CREATE INDEX IF NOT EXISTS idx_session_location ON session(location) WHERE location IS NOT NULL;
