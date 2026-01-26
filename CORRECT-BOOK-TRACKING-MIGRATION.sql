 -- CORRECT IMPLEMENTATION - Book References at Course Level
-- This creates the proper structure for book tracking

-- Step 1: Create table for course book references
CREATE TABLE IF NOT EXISTS course_book_reference (
  reference_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  start_page INTEGER NOT NULL CHECK (start_page > 0),
  end_page INTEGER NOT NULL CHECK (end_page >= start_page),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Create table to track which book reference was covered on which session date
CREATE TABLE IF NOT EXISTS session_book_coverage (
  coverage_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  reference_id uuid NOT NULL REFERENCES course_book_reference(reference_id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(session_id, attendance_date)
);

-- Step 3: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_course_book_reference_course_id ON course_book_reference(course_id);
CREATE INDEX IF NOT EXISTS idx_course_book_reference_pages ON course_book_reference(course_id, start_page);
CREATE INDEX IF NOT EXISTS idx_session_book_coverage_session_id ON session_book_coverage(session_id);
CREATE INDEX IF NOT EXISTS idx_session_book_coverage_date ON session_book_coverage(session_id, attendance_date);

-- Step 4: Add comments for documentation
COMMENT ON TABLE course_book_reference IS 'Stores book references (topics and page ranges) for each course';
COMMENT ON TABLE session_book_coverage IS 'Tracks which book topic was covered on each session date';
COMMENT ON COLUMN course_book_reference.topic IS 'Topic or chapter name (e.g., Chapter 3: Functions)';
COMMENT ON COLUMN course_book_reference.start_page IS 'Starting page number';
COMMENT ON COLUMN course_book_reference.end_page IS 'Ending page number';
COMMENT ON COLUMN course_book_reference.display_order IS 'Order to display references (optional)';
COMMENT ON COLUMN session_book_coverage.attendance_date IS 'The date when this topic was covered';

-- Step 5: Remove the wrong columns from session table if they exist
ALTER TABLE session DROP COLUMN IF EXISTS book_topic;
ALTER TABLE session DROP COLUMN IF EXISTS book_start_page;
ALTER TABLE session DROP COLUMN IF EXISTS book_end_page;
ALTER TABLE session DROP CONSTRAINT IF EXISTS book_pages_valid;

-- Verification
SELECT 
    '✅ Correct book tracking schema created!' as status,
    (SELECT COUNT(*) FROM course_book_reference) as total_book_references,
    (SELECT COUNT(*) FROM session_book_coverage) as dates_with_topic_selected;
