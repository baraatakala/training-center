-- Rollback: Remove excuse_reason column and related objects from attendance table

-- Step 1: Drop indexes
DROP INDEX IF EXISTS idx_attendance_status_excuse;
DROP INDEX IF EXISTS idx_attendance_excuse_reason;

-- Step 2: Drop check constraint
ALTER TABLE attendance 
DROP CONSTRAINT IF EXISTS check_excuse_reason_when_excused;

-- Step 3: Drop the column
ALTER TABLE attendance 
DROP COLUMN IF EXISTS excuse_reason;

-- Verification: Check that the column is gone
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'attendance' AND column_name = 'excuse_reason';
