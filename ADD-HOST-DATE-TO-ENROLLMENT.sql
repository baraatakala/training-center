-- Add host_date column to enrollment table
-- This column stores the chosen Host Date (ISO yyyy-mm-dd format) for scheduling hosts

ALTER TABLE public.enrollment
ADD COLUMN host_date DATE;

-- Optional: add a partial index for faster queries filtering by host_date
CREATE INDEX idx_enrollment_host_date ON public.enrollment(host_date) WHERE host_date IS NOT NULL;

-- Rollback: 
-- DROP INDEX idx_enrollment_host_date;
-- ALTER TABLE public.enrollment DROP COLUMN host_date;
