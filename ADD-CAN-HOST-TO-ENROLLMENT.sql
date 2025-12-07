-- Migration: Add can_host column to enrollment table
-- Description: Adds a can_host boolean field to track which students are willing to host sessions at their homes
-- Date: 2025-12-07

-- Add can_host column with default FALSE
ALTER TABLE public.enrollment 
ADD COLUMN IF NOT EXISTS can_host BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for filtering by can_host (sparse index for better performance)
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host 
ON public.enrollment(can_host) 
WHERE can_host = TRUE;

-- Add column comment for documentation
COMMENT ON COLUMN public.enrollment.can_host IS 
'Indicates whether this student has agreed to host sessions at their home. Can only be TRUE when enrollment status is active (enforced by constraint in ADD-STATUS-CANHOST-CONSTRAINT.sql).';

-- Verification query
-- Run this after migration to verify success:
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'enrollment' AND column_name = 'can_host';

-- Check index was created:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'enrollment' AND indexname = 'idx_enrollment_can_host';

-- Rollback script (if needed):
-- DROP INDEX IF EXISTS idx_enrollment_can_host;
-- ALTER TABLE public.enrollment DROP COLUMN IF EXISTS can_host;
