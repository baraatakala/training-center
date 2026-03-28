-- ============================================================================
-- ADD CHECK-IN METADATA FIELDS
-- Tracks: check_in_method, distance_from_host, early_minutes
-- ============================================================================

-- 1. Add check_in_method column
-- Tracks how the attendance was recorded
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS check_in_method VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN attendance.check_in_method IS 
'How the attendance was recorded: qr_code, photo, manual, bulk. NULL for legacy records.';

-- 2. Add distance_from_host column
-- Stores the calculated distance from host location at check-in time (in meters)
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS distance_from_host NUMERIC(10, 2) DEFAULT NULL;

COMMENT ON COLUMN attendance.distance_from_host IS 
'Distance in meters from host location when student checked in. Useful for proximity auditing.';

-- 3. Add early_minutes column
-- Track students who arrive early (positive value = minutes before session)
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS early_minutes INTEGER DEFAULT NULL;

COMMENT ON COLUMN attendance.early_minutes IS 
'Number of minutes the student arrived early. NULL if on time or late. Rewards punctual students.';

-- ============================================================================
-- CREATE INDEXES FOR ANALYTICS
-- ============================================================================

-- Index for filtering by check-in method
CREATE INDEX IF NOT EXISTS idx_attendance_check_in_method 
ON attendance(check_in_method) 
WHERE check_in_method IS NOT NULL;

-- Index for distance analysis
CREATE INDEX IF NOT EXISTS idx_attendance_distance_from_host 
ON attendance(distance_from_host) 
WHERE distance_from_host IS NOT NULL;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify columns exist
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'attendance' 
AND column_name IN ('check_in_method', 'distance_from_host', 'early_minutes', 'late_minutes')
ORDER BY column_name;

-- ============================================================================
-- SAMPLE ANALYTICS QUERY: Check-in method distribution
-- ============================================================================
-- SELECT 
--     check_in_method,
--     COUNT(*) as count,
--     ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
-- FROM attendance
-- WHERE check_in_method IS NOT NULL
-- GROUP BY check_in_method
-- ORDER BY count DESC;

-- ============================================================================
-- SAMPLE ANALYTICS QUERY: Average distance by check-in method
-- ============================================================================
-- SELECT 
--     check_in_method,
--     ROUND(AVG(distance_from_host), 2) as avg_distance_meters,
--     ROUND(MIN(distance_from_host), 2) as min_distance,
--     ROUND(MAX(distance_from_host), 2) as max_distance
-- FROM attendance
-- WHERE distance_from_host IS NOT NULL
-- GROUP BY check_in_method;
