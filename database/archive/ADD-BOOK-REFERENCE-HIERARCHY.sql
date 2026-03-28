-- Add parent_id column to course_book_reference for hierarchical subtitles
-- A reference with parent_id = NULL is a top-level chapter/title
-- A reference with parent_id = <some reference_id> is a subtopic under that chapter

ALTER TABLE course_book_reference
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES course_book_reference(reference_id) ON DELETE CASCADE DEFAULT NULL;

-- Index for efficient tree queries
CREATE INDEX IF NOT EXISTS idx_book_ref_parent ON course_book_reference(parent_id);

-- Ensure parent references belong to the same course (check constraint)
-- This prevents cross-course parent-child relationships
CREATE OR REPLACE FUNCTION check_book_ref_same_course()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM course_book_reference
      WHERE reference_id = NEW.parent_id AND course_id = NEW.course_id
    ) THEN
      RAISE EXCEPTION 'Parent reference must belong to the same course';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_book_ref_same_course ON course_book_reference;
CREATE TRIGGER trg_book_ref_same_course
  BEFORE INSERT OR UPDATE ON course_book_reference
  FOR EACH ROW EXECUTE FUNCTION check_book_ref_same_course();
