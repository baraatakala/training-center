-- Migration 026: Remove clone/parent_session_id infrastructure
-- The session cloning feature was never fully implemented and has been removed from the frontend.
-- No sessions have parent_session_id set (verified before migration).

BEGIN;

-- Drop the index first
DROP INDEX IF EXISTS idx_session_parent;

-- Drop the foreign key constraint, then the column
ALTER TABLE session DROP CONSTRAINT IF EXISTS session_parent_session_id_fkey;
ALTER TABLE session DROP COLUMN IF EXISTS parent_session_id;

-- Remove the old comment about clone semantics
COMMENT ON TABLE session IS 'Core session table — one row per scheduled course session';

COMMIT;
