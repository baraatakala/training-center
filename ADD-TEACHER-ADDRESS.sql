-- Migration: Add address field to teacher table
-- Purpose: Allow teachers to host sessions at their home
-- Date: 2026-01-27

-- Add address field to teacher table
ALTER TABLE public.teacher
ADD COLUMN IF NOT EXISTS address TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.teacher.address IS 'Teacher home address for hosting sessions';

-- Verification query
-- Run this after migration to verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'teacher'
  AND column_name = 'address';
