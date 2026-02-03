-- FIX-NULL-LATE-MINUTES.sql
-- Run this in Supabase SQL Editor to fix existing late records without late_minutes

-- First, let's see how many records need fixing
SELECT COUNT(*) as records_to_fix 
FROM attendance 
WHERE status = 'late' AND late_minutes IS NULL;

-- Update existing late records that don't have late_minutes
-- Set to 1 minute as a default (Minor late bracket)
UPDATE attendance 
SET late_minutes = 1 
WHERE status = 'late' AND late_minutes IS NULL;

-- Verify the fix
SELECT COUNT(*) as remaining_null 
FROM attendance 
WHERE status = 'late' AND late_minutes IS NULL;

-- Show updated records
SELECT 
  a.attendance_id,
  s.name as student_name,
  a.status,
  a.late_minutes,
  a.attendance_date,
  a.marked_at
FROM attendance a
JOIN students s ON a.student_id = s.student_id
WHERE a.status = 'late'
ORDER BY a.attendance_date DESC
LIMIT 10;
