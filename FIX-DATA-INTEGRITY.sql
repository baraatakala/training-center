-- FIX-DATA-INTEGRITY.sql
-- Purpose: Improve data integrity for attendance system
-- Date: 2026-02-03

-- ============================================
-- 1. Add CHECK constraint for attendance status
-- ============================================

-- First, check for any invalid status values
SELECT DISTINCT status, COUNT(*) as count
FROM attendance
GROUP BY status
ORDER BY status;

-- Remove any 'pending' or invalid status values (convert to 'absent')
UPDATE attendance 
SET status = 'absent'
WHERE status NOT IN ('on time', 'late', 'absent', 'excused', 'not enrolled');

-- Add the constraint (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'attendance_status_check'
  ) THEN
    ALTER TABLE attendance 
    ADD CONSTRAINT attendance_status_check 
    CHECK (status IN ('on time', 'late', 'absent', 'excused', 'not enrolled'));
    RAISE NOTICE '✅ Added attendance_status_check constraint';
  ELSE
    RAISE NOTICE 'ℹ️ attendance_status_check constraint already exists';
  END IF;
END $$;

-- ============================================
-- 2. Clean up orphaned session_date_host records
-- ============================================

-- Find orphaned host records (host_id doesn't exist in student or teacher)
SELECT h.*, 
       s.name as student_name,
       t.name as teacher_name
FROM session_date_host h
LEFT JOIN student s ON h.host_type = 'student' AND h.host_id = s.student_id
LEFT JOIN teacher t ON h.host_type = 'teacher' AND h.host_id = t.teacher_id
WHERE (h.host_type = 'student' AND s.student_id IS NULL)
   OR (h.host_type = 'teacher' AND t.teacher_id IS NULL);

-- Delete orphaned records (uncomment when ready)
-- DELETE FROM session_date_host h
-- WHERE (h.host_type = 'student' AND NOT EXISTS (SELECT 1 FROM student WHERE student_id = h.host_id))
--    OR (h.host_type = 'teacher' AND NOT EXISTS (SELECT 1 FROM teacher WHERE teacher_id = h.host_id));

-- ============================================
-- 3. Ensure enrollment_id is valid in attendance
-- ============================================

-- Find attendance records with missing/invalid enrollment_id
SELECT a.attendance_id, a.student_id, a.session_id, a.attendance_date, a.enrollment_id,
       e.enrollment_id as valid_enrollment
FROM attendance a
LEFT JOIN enrollment e ON e.enrollment_id = a.enrollment_id
WHERE e.enrollment_id IS NULL
  AND a.enrollment_id IS NOT NULL;

-- Fix by finding the correct enrollment
UPDATE attendance a
SET enrollment_id = (
  SELECT e.enrollment_id 
  FROM enrollment e 
  WHERE e.student_id = a.student_id 
    AND e.session_id = a.session_id
  LIMIT 1
)
WHERE NOT EXISTS (
  SELECT 1 FROM enrollment e WHERE e.enrollment_id = a.enrollment_id
)
AND EXISTS (
  SELECT 1 FROM enrollment e 
  WHERE e.student_id = a.student_id 
    AND e.session_id = a.session_id
);

-- ============================================
-- 4. Verify session-enrollment-attendance chain
-- ============================================

-- Check for attendance without valid session
SELECT a.attendance_id, a.session_id
FROM attendance a
LEFT JOIN session s ON s.session_id = a.session_id
WHERE s.session_id IS NULL;

-- Check for attendance without valid student
SELECT a.attendance_id, a.student_id
FROM attendance a
LEFT JOIN student s ON s.student_id = a.student_id
WHERE s.student_id IS NULL;

-- ============================================
-- 5. Add indexes for performance
-- ============================================

-- Index for common attendance queries
CREATE INDEX IF NOT EXISTS idx_attendance_session_date 
ON attendance(session_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendance_student_date 
ON attendance(student_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_session_date_host_lookup
ON session_date_host(session_id, attendance_date);

-- Index for enrollment lookups
CREATE INDEX IF NOT EXISTS idx_enrollment_session_student
ON enrollment(session_id, student_id);

-- ============================================
-- 6. Verify 'not enrolled' status consistency
-- ============================================

-- Find records marked 'not enrolled' that SHOULD be enrolled
SELECT a.attendance_id, a.student_id, a.session_id, a.attendance_date, a.status,
       e.enrollment_date
FROM attendance a
JOIN enrollment e ON e.student_id = a.student_id AND e.session_id = a.session_id
WHERE a.status = 'not enrolled'
  AND a.attendance_date >= e.enrollment_date;

-- Fix these records (set to 'absent' if they should be enrolled)
-- UPDATE attendance a
-- SET status = 'absent'
-- FROM enrollment e
-- WHERE e.student_id = a.student_id 
--   AND e.session_id = a.session_id
--   AND a.status = 'not enrolled'
--   AND a.attendance_date >= e.enrollment_date;

-- ============================================
-- 7. Summary report
-- ============================================

SELECT 'Attendance Status Distribution' as report, status, COUNT(*) as count
FROM attendance
GROUP BY status
ORDER BY count DESC;

SELECT 'Sessions with Host Data' as report, COUNT(DISTINCT session_id) as sessions_with_hosts
FROM session_date_host;

SELECT 'Enrollment Status Distribution' as report, status, COUNT(*) as count
FROM enrollment
GROUP BY status;

RAISE NOTICE '✅ Data integrity check complete!';
