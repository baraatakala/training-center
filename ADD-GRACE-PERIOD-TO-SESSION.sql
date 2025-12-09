-- ADD-GRACE-PERIOD-TO-SESSION.sql
-- Adds configurable grace period to session table
-- Allows teachers to set their own grace period (default 15 minutes)
-- Date: 2025-12-09

-- ===== STEP 1: Add grace_period_minutes column =====
ALTER TABLE session 
ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER DEFAULT 15;

-- ===== STEP 2: Add check constraint to ensure reasonable values =====
-- Grace period should be between 0 and 60 minutes
ALTER TABLE session
ADD CONSTRAINT check_grace_period_range 
CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 60);

-- ===== STEP 3: Update existing sessions to use default =====
-- Set all existing sessions to 15 minutes if NULL
UPDATE session
SET grace_period_minutes = 15
WHERE grace_period_minutes IS NULL;

-- ===== STEP 4: Add helpful comment =====
COMMENT ON COLUMN session.grace_period_minutes IS 'Number of minutes after session start time that students can check in without being marked late (default: 15)';

-- ===== STEP 5: Verification =====
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICATION RESULTS ===';
END $$;

-- Show the new column
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'session' AND column_name = 'grace_period_minutes';

-- Show check constraint
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'session'::regclass
  AND conname = 'check_grace_period_range';

-- Count sessions and show grace period distribution
SELECT 
    grace_period_minutes,
    COUNT(*) as session_count
FROM session
GROUP BY grace_period_minutes
ORDER BY grace_period_minutes;

-- ===== SUCCESS MESSAGE =====
DO $$
BEGIN
  RAISE NOTICE '✅ Session table now has configurable grace period!';
  RAISE NOTICE 'Teachers can now:';
  RAISE NOTICE '  - Set grace period per session (0-60 minutes)';
  RAISE NOTICE '  - Default is 15 minutes';
  RAISE NOTICE '  - Students marked late if checked in after grace period';
END $$;
