-- Add excuse_reason column to attendance table
-- This allows tracking the reason why a student was excused (abroad, sick, on working)

-- Step 1: Add the column
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS excuse_reason VARCHAR(100);

-- Step 2: Clean up existing data - set a default reason for existing excused records
UPDATE attendance 
SET excuse_reason = 'other'
WHERE status = 'excused' AND excuse_reason IS NULL;

-- Step 3: Create a valid CHECK constraint
-- This ensures that if status is 'excused', excuse_reason must be provided
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_excuse_reason_when_excused'
    AND conrelid = 'attendance'::regclass
  ) THEN
    ALTER TABLE attendance
    ADD CONSTRAINT check_excuse_reason_when_excused
    CHECK (status != 'excused' OR excuse_reason IS NOT NULL);
  END IF;
END $$;

-- Step 4: Create index for filtering by excuse_reason
CREATE INDEX IF NOT EXISTS idx_attendance_excuse_reason 
ON attendance(excuse_reason);

-- Step 5: Create a composite index for common queries (status + excuse_reason)
CREATE INDEX IF NOT EXISTS idx_attendance_status_excuse 
ON attendance(status, excuse_reason);

