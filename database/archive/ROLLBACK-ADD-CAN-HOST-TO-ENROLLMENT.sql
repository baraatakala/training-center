-- Rollback migration for ADD-CAN-HOST-TO-ENROLLMENT.sql
-- Date: 2025-11-27

-- Drop index if exists
DROP INDEX IF EXISTS idx_enrollment_can_host;

-- Drop column if exists
ALTER TABLE IF EXISTS enrollment
DROP COLUMN IF EXISTS can_host;

-- Note: This rollback is irreversible for data (will remove any can_host values). Run only if you are sure.
