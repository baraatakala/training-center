-- Migration: Add can_host column to enrollment
-- Date: 2025-11-27

ALTER TABLE enrollment
ADD COLUMN IF NOT EXISTS can_host BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN enrollment.can_host IS 'Whether the enrolled student can host sessions at their home (true/false)';

-- Optional: create an index to quickly find hosts for a session
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host ON enrollment(session_id) WHERE can_host = true;
