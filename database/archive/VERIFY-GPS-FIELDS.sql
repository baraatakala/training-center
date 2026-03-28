-- Verify GPS fields exist in attendance table
-- These fields should already exist based on database.types.ts

-- Check current structure
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'attendance'
    AND column_name IN ('gps_latitude', 'gps_longitude', 'gps_accuracy', 'gps_timestamp', 'marked_by', 'marked_at')
ORDER BY ordinal_position;

-- Add missing GPS and tracking fields
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS gps_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS gps_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS gps_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS marked_by TEXT,
ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

-- Add index for location-based queries
CREATE INDEX IF NOT EXISTS idx_attendance_gps ON attendance(gps_latitude, gps_longitude);

-- Add index for filtering by marked_by
CREATE INDEX IF NOT EXISTS idx_attendance_marked_by ON attendance(marked_by);

-- Verify sample data
SELECT 
    attendance_id,
    student_id,
    attendance_date,
    status,
    gps_latitude,
    gps_longitude,
    gps_accuracy,
    gps_timestamp,
    marked_by,
    marked_at
FROM attendance
ORDER BY created_at DESC
LIMIT 10;
