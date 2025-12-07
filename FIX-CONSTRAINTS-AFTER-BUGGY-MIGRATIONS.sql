-- FIX-CONSTRAINTS-AFTER-BUGGY-MIGRATIONS.sql
-- Run this to fix constraint checking issues after running buggy SQL files
-- This fixes the constraint checks that were added incorrectly

-- ===== FIX 1: Fix excuse_reason constraint check =====
-- Drop and recreate with proper existence check
DO $$
BEGIN
  -- First, try to drop if it exists (might have been created incorrectly)
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS check_excuse_reason_when_excused;
  
  -- Now add it properly
  ALTER TABLE attendance
  ADD CONSTRAINT check_excuse_reason_when_excused
  CHECK (status != 'excused' OR excuse_reason IS NOT NULL);
  
  RAISE NOTICE 'Fixed check_excuse_reason_when_excused constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Issue with excuse_reason constraint: %', SQLERRM;
END $$;

-- ===== FIX 2: Fix can_host constraint check =====
-- Drop and recreate with proper existence check
DO $$
BEGIN
  -- First, try to drop if it exists
  ALTER TABLE enrollment DROP CONSTRAINT IF EXISTS check_can_host_only_active;
  
  -- Now add it properly
  ALTER TABLE enrollment
  ADD CONSTRAINT check_can_host_only_active 
  CHECK (can_host = FALSE OR status = 'active');
  
  RAISE NOTICE 'Fixed check_can_host_only_active constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Issue with can_host constraint: %', SQLERRM;
END $$;

-- ===== FIX 3: Ensure can_host is NOT NULL =====
-- The buggy version might have failed to add NOT NULL properly
DO $$
BEGIN
  -- Update any NULL values
  UPDATE enrollment SET can_host = FALSE WHERE can_host IS NULL;
  
  -- Set NOT NULL constraint
  ALTER TABLE enrollment ALTER COLUMN can_host SET NOT NULL;
  
  RAISE NOTICE 'Fixed can_host NOT NULL constraint';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'can_host column may already be NOT NULL or does not exist: %', SQLERRM;
END $$;

-- ===== VERIFICATION =====
-- Check that all constraints are properly in place
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    conrelid::regclass AS table_name
FROM pg_constraint
WHERE conrelid IN ('enrollment'::regclass, 'attendance'::regclass)
  AND conname IN ('check_can_host_only_active', 'check_excuse_reason_when_excused')
ORDER BY table_name, constraint_name;

-- Verify can_host is NOT NULL
SELECT 
    column_name, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_name = 'enrollment' 
  AND column_name = 'can_host';

-- Verify excuse_reason exists
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'attendance' 
  AND column_name = 'excuse_reason';
