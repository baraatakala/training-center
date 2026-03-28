-- ✅ CORRECTED MIGRATION - Book Tracking Feature
-- This migration adds book progress tracking to the session table
-- Run this in your Supabase SQL Editor

-- Step 1: Add the three new columns
ALTER TABLE session
ADD COLUMN IF NOT EXISTS book_topic TEXT,
ADD COLUMN IF NOT EXISTS book_start_page INTEGER,
ADD COLUMN IF NOT EXISTS book_end_page INTEGER;

-- Step 2: Add documentation comments
COMMENT ON COLUMN session.book_topic IS 'Topic or chapter covered in this session';
COMMENT ON COLUMN session.book_start_page IS 'Starting page number covered in this session';
COMMENT ON COLUMN session.book_end_page IS 'Ending page number covered in this session';

-- Step 3: Add validation constraint
-- This ensures that if pages are entered, they make logical sense (end >= start)
ALTER TABLE session
ADD CONSTRAINT book_pages_valid 
CHECK (
  (book_start_page IS NULL AND book_end_page IS NULL) OR
  (book_start_page IS NOT NULL AND book_end_page IS NOT NULL AND book_end_page >= book_start_page)
);

-- Verification query - run this to confirm it worked
SELECT 
    '✅ Migration completed successfully!' as status,
    COUNT(*) as total_sessions,
    COUNT(book_topic) as sessions_with_book_info
FROM session;

-- Expected output: Shows total sessions and 0 sessions with book info (initially)
