-- Fix attendance records that have NULL session_id
-- This script will populate session_id from enrollment data

-- Update attendance records to get session_id from enrollment
UPDATE attendance a
SET session_id = e.session_id
FROM enrollment e
WHERE a.enrollment_id = e.enrollment_id
AND a.session_id IS NULL;

-- Verify the fix
SELECT 
  COUNT(*) as total_records,
  COUNT(session_id) as records_with_session_id,
  COUNT(*) - COUNT(session_id) as records_missing_session_id
FROM attendance;

-- Show all records after fix
SELECT 
  attendance_id,
  status,
  attendance_date,
  session_id,
  enrollment_id,
  created_at
FROM attendance
ORDER BY created_at DESC;
