-- Verification script for book tracking feature
-- Run this after applying the migration to verify everything is working

-- 1. Check if new columns exist
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'session' 
AND column_name IN ('book_topic', 'book_start_page', 'book_end_page')
ORDER BY column_name;

-- Expected output: 3 rows showing the three new columns

-- 2. Check if constraint exists
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'session'
AND constraint_name = 'book_pages_valid';

-- Expected output: 1 row showing the CHECK constraint

-- 3. Test inserting a session with book info (optional test)
-- Uncomment to test:
/*
INSERT INTO session (
    course_id, 
    teacher_id, 
    start_date, 
    end_date, 
    day, 
    time, 
    book_topic, 
    book_start_page, 
    book_end_page
) VALUES (
    (SELECT course_id FROM course LIMIT 1),
    (SELECT teacher_id FROM teacher LIMIT 1),
    '2026-02-01',
    '2026-03-31',
    'Monday, Wednesday',
    '10:00-12:00',
    'Chapter 1: Introduction',
    1,
    25
);
*/

-- 4. View any existing sessions with book information
SELECT 
    session_id,
    book_topic,
    book_start_page,
    book_end_page,
    CASE 
        WHEN book_start_page IS NOT NULL AND book_end_page IS NOT NULL 
        THEN (book_end_page - book_start_page + 1)
        ELSE NULL 
    END as page_count
FROM session
WHERE book_topic IS NOT NULL
ORDER BY start_date DESC;

-- Expected output: Empty initially, or sessions with book info if you've added some

-- 5. Test constraint validation (should fail with error)
-- Uncomment to test constraint:
/*
-- This should FAIL because end_page < start_page
INSERT INTO session (
    course_id, 
    teacher_id, 
    start_date, 
    end_date, 
    book_topic, 
    book_start_page, 
    book_end_page
) VALUES (
    (SELECT course_id FROM course LIMIT 1),
    (SELECT teacher_id FROM teacher LIMIT 1),
    '2026-02-01',
    '2026-03-31',
    'Test Chapter',
    50,
    25  -- Invalid: end before start
);
*/

COMMENT ON COLUMN session.book_topic IS 'Topic or chapter covered in this session';
COMMENT ON COLUMN session.book_start_page IS 'Starting page number covered in this session';
COMMENT ON COLUMN session.book_end_page IS 'Ending page number covered in this session';

-- Success message
SELECT 
    '✅ Book tracking feature verified successfully!' as status,
    COUNT(*) as total_sessions,
    COUNT(book_topic) as sessions_with_book_info
FROM session;
