-- Migration: Add can_host column to enrollment
-- Date: 2025-11-27

-- Step 1: Add column as nullable with default
ALTER TABLE enrollment
ADD COLUMN IF NOT EXISTS can_host BOOLEAN DEFAULT FALSE;

-- Step 2: Update any NULL values (should be none due to default)
UPDATE enrollment SET can_host = FALSE WHERE can_host IS NULL;

-- Step 3: Add NOT NULL constraint
ALTER TABLE enrollment
ALTER COLUMN can_host SET NOT NULL;

COMMENT ON COLUMN enrollment.can_host IS 'Whether the enrolled student can host sessions at their home (true/false)';

-- Optional: create an index to quickly find hosts for a session
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host ON enrollment(session_id) WHERE can_host = true;
