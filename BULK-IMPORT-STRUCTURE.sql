-- SQL Script to verify database structure for bulk import feature
-- This ensures all necessary tables and relationships exist

-- 1. Verify table structure
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('teacher', 'student', 'course', 'session', 'enrollment', 'attendance')
ORDER BY table_name, ordinal_position;

-- 2. Check foreign key constraints
SELECT
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name IN ('student', 'course', 'session', 'enrollment', 'attendance')
ORDER BY tc.table_name;

-- 3. Verify indexes exist for email lookups (important for bulk import performance)
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('teacher', 'student', 'course', 'session', 'enrollment', 'attendance')
    AND (indexdef LIKE '%email%' OR indexdef LIKE '%name%')
ORDER BY tablename, indexname;

-- 4. Check unique constraints (to prevent duplicates during import)
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_name IN ('teacher', 'student', 'course', 'session', 'enrollment', 'attendance')
ORDER BY tc.table_name;

-- 5. Sample query to understand current data relationships
SELECT 
    'Data Summary' as info,
    (SELECT COUNT(*) FROM teacher) as teachers,
    (SELECT COUNT(*) FROM student) as students,
    (SELECT COUNT(*) FROM course) as courses,
    (SELECT COUNT(*) FROM session) as sessions,
    (SELECT COUNT(*) FROM enrollment) as enrollments,
    (SELECT COUNT(*) FROM attendance) as attendance_records;
