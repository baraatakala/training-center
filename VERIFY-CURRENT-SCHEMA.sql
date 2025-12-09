-- VERIFY-CURRENT-SCHEMA.sql
-- Run this FIRST to see what's missing in your current database
-- This will tell you exactly what needs to be migrated
-- Date: 2025-12-10

\echo '========================================';
\echo '  DATABASE SCHEMA VERIFICATION';
\echo '========================================';
\echo '';

-- ================================================================
-- CHECK 1: VERIFY ALL REQUIRED TABLES EXIST
-- ================================================================
\echo '1. CHECKING REQUIRED TABLES...';
\echo '';

SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teacher') 
    THEN '✓ teacher' 
    ELSE '✗ teacher (MISSING!)' 
  END AS status
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'student') 
    THEN '✓ student' 
    ELSE '✗ student (MISSING!)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course') 
    THEN '✓ course' 
    ELSE '✗ course (MISSING!)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session') 
    THEN '✓ session' 
    ELSE '✗ session (MISSING!)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'enrollment') 
    THEN '✓ enrollment' 
    ELSE '✗ enrollment (MISSING!)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attendance') 
    THEN '✓ attendance' 
    ELSE '✗ attendance (MISSING!)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'location') 
    THEN '⚠ location (OLD TABLE - SHOULD BE REMOVED!)' 
    ELSE '✓ location (correctly removed)' 
  END
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_location') 
    THEN '⚠ session_location (OLD TABLE - SHOULD BE REMOVED!)' 
    ELSE '✓ session_location (correctly removed)' 
  END;

-- ================================================================
-- CHECK 2: VERIFY SESSION TABLE COLUMNS
-- ================================================================
\echo '';
\echo '2. CHECKING SESSION TABLE...';
\echo '';

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'session' AND column_name = 'location'
    ) 
    THEN '✓ session.location exists' 
    ELSE '✗ session.location MISSING - needs migration!' 
  END AS status
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'session' AND column_name = 'grace_period_minutes'
    ) 
    THEN '✓ session.grace_period_minutes exists' 
    ELSE '✗ session.grace_period_minutes MISSING - needs migration!' 
  END;

-- ================================================================
-- CHECK 3: VERIFY ENROLLMENT TABLE COLUMNS
-- ================================================================
\echo '';
\echo '3. CHECKING ENROLLMENT TABLE...';
\echo '';

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'enrollment' AND column_name = 'can_host'
    ) 
    THEN '✓ enrollment.can_host exists' 
    ELSE '✗ enrollment.can_host MISSING - needs migration!' 
  END AS status
UNION ALL
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'enrollment' AND column_name = 'host_date'
    ) 
    THEN '✓ enrollment.host_date exists' 
    ELSE '✗ enrollment.host_date MISSING - needs migration!' 
  END;

-- ================================================================
-- CHECK 4: VERIFY ATTENDANCE TABLE COLUMNS
-- ================================================================
\echo '';
\echo '4. CHECKING ATTENDANCE TABLE...';
\echo '';

SELECT 
  column_name,
  CASE 
    WHEN column_name IN (
      'attendance_id', 'enrollment_id', 'student_id', 'session_id',
      'attendance_date', 'status', 'check_in_time', 'notes',
      'gps_latitude', 'gps_longitude', 'gps_accuracy', 'gps_timestamp',
      'excuse_reason', 'marked_by', 'marked_at', 'host_address',
      'created_at', 'updated_at'
    ) THEN '✓ Required'
    WHEN column_name = 'session_location_id' THEN '⚠ OLD - Should be removed!'
    ELSE '? Unknown column'
  END AS status,
  data_type
FROM information_schema.columns
WHERE table_name = 'attendance'
ORDER BY 
  CASE 
    WHEN column_name IN ('attendance_id', 'enrollment_id', 'student_id', 'session_id') THEN 1
    WHEN column_name IN ('attendance_date', 'status', 'check_in_time') THEN 2
    WHEN column_name LIKE 'gps_%' THEN 3
    WHEN column_name IN ('excuse_reason', 'marked_by', 'marked_at', 'host_address') THEN 4
    ELSE 5
  END,
  column_name;

-- ================================================================
-- CHECK 5: COUNT MISSING REQUIRED COLUMNS
-- ================================================================
\echo '';
\echo '5. SUMMARY OF MISSING COLUMNS...';
\echo '';

WITH required_attendance_columns AS (
  SELECT unnest(ARRAY[
    'attendance_id', 'enrollment_id', 'student_id', 'session_id',
    'attendance_date', 'status', 'check_in_time', 'notes',
    'gps_latitude', 'gps_longitude', 'gps_accuracy', 'gps_timestamp',
    'excuse_reason', 'marked_by', 'marked_at', 'host_address',
    'created_at', 'updated_at'
  ]) AS required_column
),
existing_columns AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'attendance'
)
SELECT 
  COUNT(*) AS missing_count,
  string_agg(r.required_column, ', ') AS missing_columns
FROM required_attendance_columns r
LEFT JOIN existing_columns e ON r.required_column = e.column_name
WHERE e.column_name IS NULL;

-- ================================================================
-- CHECK 6: VERIFY CONSTRAINTS
-- ================================================================
\echo '';
\echo '6. CHECKING CONSTRAINTS...';
\echo '';

SELECT 
  conname AS constraint_name,
  CASE contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'c' THEN 'CHECK'
  END AS constraint_type,
  CASE 
    WHEN conname LIKE '%session_location%' THEN '⚠ OLD - references deleted table!'
    WHEN conname = 'attendance_enrollment_date_unique' THEN '✓ Required constraint'
    ELSE '✓ OK'
  END AS status
FROM pg_constraint
WHERE conrelid = 'attendance'::regclass
ORDER BY contype, conname;

-- ================================================================
-- CHECK 7: DATA INTEGRITY CHECK
-- ================================================================
\echo '';
\echo '7. DATA INTEGRITY CHECK...';
\echo '';

SELECT 
  'Total attendance records' AS check_item,
  COUNT(*)::text AS value
FROM attendance
UNION ALL
SELECT 
  'Records with NULL session_id',
  COUNT(*)::text
FROM attendance
WHERE session_id IS NULL
UNION ALL
SELECT 
  'Records with NULL attendance_date',
  COUNT(*)::text
FROM attendance
WHERE attendance_date IS NULL
UNION ALL
SELECT 
  'Records with old session_location_id',
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'attendance' AND column_name = 'session_location_id'
    )
    THEN COUNT(*)::text
    ELSE 'Column does not exist'
  END
FROM attendance
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns 
  WHERE table_name = 'attendance' AND column_name = 'session_location_id'
);

-- ================================================================
-- FINAL RECOMMENDATION
-- ================================================================
\echo '';
\echo '========================================';
\echo '  RECOMMENDATION';
\echo '========================================';
\echo '';
\echo 'Based on the results above:';
\echo '';
\echo 'If you see ✗ MISSING items:';
\echo '  → Run MIGRATE-TO-CURRENT-SCHEMA.sql';
\echo '';
\echo 'If you see ⚠ OLD items:';
\echo '  → Run MIGRATE-TO-CURRENT-SCHEMA.sql';
\echo '';
\echo 'If all items show ✓:';
\echo '  → Your database is up to date!';
\echo '';
