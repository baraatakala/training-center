-- Add constraint/trigger to enforce can_host logic based on status
-- Only 'active' enrollments can have can_host = true
-- This file runs AFTER ADD-CAN-HOST-TO-ENROLLMENT.sql has added the column

-- ===== STEP 1: Clean existing data =====
UPDATE public.enrollment
SET can_host = FALSE
WHERE can_host = TRUE AND status != 'active';

-- ===== STEP 2: Create/Replace Trigger Function =====
-- This function enforces the rule by AUTO-CORRECTING violations
-- (Does NOT raise exceptions to avoid blocking updates)
CREATE OR REPLACE FUNCTION public.fn_enforce_can_host_on_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Rule: can_host can ONLY be TRUE if status is 'active'
  -- If status is non-active, force can_host to FALSE
  IF NEW.status != 'active' THEN
    NEW.can_host := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== STEP 3: Create Trigger =====
-- Trigger name starts with 'aaa_' to ensure it runs BEFORE update_enrollment_updated_at
DROP TRIGGER IF EXISTS aaa_enforce_can_host_on_status_change ON public.enrollment;
CREATE TRIGGER aaa_enforce_can_host_on_status_change
BEFORE INSERT OR UPDATE ON public.enrollment
FOR EACH ROW
EXECUTE FUNCTION public.fn_enforce_can_host_on_status_change();

-- ===== STEP 4: Add CHECK Constraint (Database Level Defense) =====
-- This prevents any bypass at the database level
-- Using IF NOT EXISTS approach for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_can_host_only_active'
    AND conrelid = 'enrollment'::regclass
  ) THEN
    ALTER TABLE public.enrollment
    ADD CONSTRAINT check_can_host_only_active 
    CHECK (can_host = FALSE OR status = 'active');
  END IF;
END $$;

-- ===== VERIFICATION QUERIES =====
-- After running, verify with these queries:

-- Check 1: All can_host=TRUE should have status='active'
-- SELECT enrollment_id, status, can_host FROM public.enrollment 
-- WHERE can_host = TRUE AND status != 'active';
-- Expected: 0 rows

-- Check 2: Constraint exists
-- SELECT constraint_name FROM information_schema.table_constraints 
-- WHERE table_name='enrollment' AND constraint_name LIKE 'check_can%';
-- Expected: check_can_host_only_active

-- Check 3: Trigger exists
-- SELECT trigger_name FROM information_schema.triggers 
-- WHERE table_name='enrollment' AND trigger_name LIKE 'aaa_%';
-- Expected: aaa_enforce_can_host_on_status_change

