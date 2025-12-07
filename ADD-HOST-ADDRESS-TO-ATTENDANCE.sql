-- Migration: Add host_address column to attendance table
-- Description: Adds a host_address field to track the physical location where each attendance session took place
-- This enables smart address assignment based on the enrollment.host_date schedule
-- Date: 2025-12-07

-- Add host_address column to attendance table
ALTER TABLE public.attendance 
ADD COLUMN IF NOT EXISTS host_address TEXT;

-- Add index for filtering by host_address (sparse index for performance)
CREATE INDEX IF NOT EXISTS idx_attendance_host_address 
ON public.attendance(host_address) 
WHERE host_address IS NOT NULL;

-- Add composite index for date + address queries (used in analytics)
CREATE INDEX IF NOT EXISTS idx_attendance_date_address 
ON public.attendance(attendance_date, host_address);

-- Add column comment for documentation
COMMENT ON COLUMN public.attendance.host_address IS 
'Physical address where the session took place. Auto-populated from student.address based on enrollment.host_date matching attendance_date. Allows tracking session locations for analytics and reporting.';

-- Verification queries
-- Run these after migration to verify success:

-- 1. Check column exists and is nullable
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'attendance' AND column_name = 'host_address';

-- 2. Check indexes were created
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'attendance' 
-- AND indexname IN ('idx_attendance_host_address', 'idx_attendance_date_address');

-- 3. Test query performance (should use index)
-- EXPLAIN ANALYZE 
-- SELECT * FROM attendance 
-- WHERE attendance_date = '2025-12-07' AND host_address IS NOT NULL;

-- Rollback script (if needed):
-- DROP INDEX IF EXISTS idx_attendance_date_address;
-- DROP INDEX IF EXISTS idx_attendance_host_address;
-- ALTER TABLE public.attendance DROP COLUMN IF EXISTS host_address;
