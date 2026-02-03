-- Clean up invalid attendance records
-- This removes all "pending" status records and ensures clean data for analytics

-- Step 1: Delete all records with 'pending' status (these are placeholders)
DELETE FROM attendance WHERE status = 'pending';

-- Step 2: Delete any records with NULL status
DELETE FROM attendance WHERE status IS NULL;

-- Step 3: View remaining valid records
SELECT 
  a.attendance_id,
  a.status,
  a.attendance_date,
  s.student_id,
  s.name as student_name,
  a.check_in_time,
  a.created_at
FROM attendance a
JOIN student s ON a.student_id = s.student_id
ORDER BY a.attendance_date DESC, s.name;

-- Step 4: Count by status
SELECT 
  status,
  COUNT(*) as count
FROM attendance
GROUP BY status
ORDER BY status;

-- Step 5: Verify Analytics data will be correct
SELECT 
  s.name as student_name,
  COUNT(*) as total_attendance_records,
  SUM(CASE WHEN a.status = 'on time' THEN 1 ELSE 0 END) as on_time_count,
  SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count,
  SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late_count,
  SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) as excused_count
FROM student s
LEFT JOIN attendance a ON s.student_id = a.student_id
WHERE a.attendance_id IS NOT NULL
GROUP BY s.student_id, s.name
ORDER BY s.name;
