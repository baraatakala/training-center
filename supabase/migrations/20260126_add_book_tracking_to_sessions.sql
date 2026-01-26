-- Add book tracking fields to session table
-- This allows tracking what topic and pages were covered in each session

ALTER TABLE session
ADD COLUMN IF NOT EXISTS book_topic TEXT,
ADD COLUMN IF NOT EXISTS book_start_page INTEGER,
ADD COLUMN IF NOT EXISTS book_end_page INTEGER;

-- Add a comment to document the purpose
COMMENT ON COLUMN session.book_topic IS 'Topic or chapter covered in this session';
COMMENT ON COLUMN session.book_start_page IS 'Starting page number covered in this session';
COMMENT ON COLUMN session.book_end_page IS 'Ending page number covered in this session';

-- Add a check constraint to ensure end_page >= start_page when both are provided
ALTER TABLE session
ADD CONSTRAINT book_pages_valid 
CHECK (
  (book_start_page IS NULL AND book_end_page IS NULL) OR
  (book_start_page IS NOT NULL AND book_end_page IS NOT NULL AND book_end_page >= book_start_page)
);
