-- ================================================================
-- CHECK CURRENT ATTENDANCE TABLE CONSTRAINTS
-- Run this to see what constraints exist on your attendance table
-- ================================================================

-- List all constraints on attendance table
SELECT 
  constraint_name,
  constraint_type,
  table_name
FROM information_schema.table_constraints
WHERE table_name = 'attendance'
ORDER BY constraint_type, constraint_name;

-- Show detailed unique constraint columns
SELECT 
  tc.constraint_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'attendance' 
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.constraint_name;

-- ================================================================
-- EXPECTED RESULT:
-- ================================================================
-- You should see ONE unique constraint:
--   constraint_name: attendance_enrollment_date_unique
--   columns: enrollment_id, attendance_date
--
-- If you see "unique_attendance_student_session_date" - that's WRONG!
-- ================================================================
