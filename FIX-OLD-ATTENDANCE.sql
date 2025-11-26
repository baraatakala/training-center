-- Fix existing attendance records that don't have attendance_date populated
-- Run this after SAFE-MIGRATION.sql

-- Check if session_location table exists and migrate data if it does
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_location') THEN
    UPDATE attendance a
    SET attendance_date = sl.date
    FROM session_location sl
    WHERE a.session_location_id = sl.id
    AND a.attendance_date IS NULL;
  END IF;
END $$;

-- For any remaining records without a date, set to created_at date or current date
UPDATE attendance
SET attendance_date = COALESCE(DATE(created_at), CURRENT_DATE)
WHERE attendance_date IS NULL;

-- Verify the fix
SELECT 
  COUNT(*) as total_records,
  COUNT(attendance_date) as records_with_date,
  COUNT(*) - COUNT(attendance_date) as records_missing_date
FROM attendance;

-- Show sample of fixed records
SELECT 
  attendance_id,
  status,
  attendance_date,
  session_id,
  created_at
FROM attendance
ORDER BY created_at DESC
LIMIT 10;
