-- Migration: Add session_date_host table
-- Purpose: Store host address per session + date (single source of truth)
-- This fixes the issue where host_address was only saved when marking attendance
-- Date: 2026-01-28

-- Table: session_date_host
-- Stores which host (student/teacher) is assigned to each session date
-- Similar pattern to session_book_coverage table
CREATE TABLE IF NOT EXISTS public.session_date_host (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  host_id UUID, -- Can be student_id or teacher_id (nullable for backwards compat)
  host_type VARCHAR(20) DEFAULT 'student', -- 'student' or 'teacher'
  host_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, attendance_date)
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_session_date_host_session_id 
ON public.session_date_host(session_id);

CREATE INDEX IF NOT EXISTS idx_session_date_host_date 
ON public.session_date_host(attendance_date);

CREATE INDEX IF NOT EXISTS idx_session_date_host_session_date 
ON public.session_date_host(session_id, attendance_date);

-- Add trigger for updated_at
CREATE TRIGGER update_session_date_host_updated_at 
BEFORE UPDATE ON public.session_date_host
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.session_date_host IS 
'Stores the host location for each session date. Single source of truth for where a session took place.';

COMMENT ON COLUMN public.session_date_host.host_id IS 
'UUID of the host (student_id or teacher_id). May be null for legacy data.';

COMMENT ON COLUMN public.session_date_host.host_type IS 
'Type of host: student or teacher';

COMMENT ON COLUMN public.session_date_host.host_address IS 
'Physical address where the session took place';

-- Enable RLS
ALTER TABLE public.session_date_host ENABLE ROW LEVEL SECURITY;

-- RLS Policy for authenticated users
CREATE POLICY "Enable all access for authenticated users" ON public.session_date_host
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Migration: Copy existing host_address data from attendance table
-- This populates the new table with existing data (one record per session+date)
INSERT INTO public.session_date_host (session_id, attendance_date, host_address, host_type)
SELECT DISTINCT 
    session_id,
    attendance_date,
    host_address,
    'student' -- Default to student, since we can't determine from old data
FROM public.attendance
WHERE host_address IS NOT NULL 
  AND host_address != ''
  AND host_address != 'SESSION_NOT_HELD'
ON CONFLICT (session_id, attendance_date) DO NOTHING;

-- Verification queries:
-- 1. Check table exists
-- SELECT * FROM information_schema.tables WHERE table_name = 'session_date_host';

-- 2. Check data was migrated
-- SELECT COUNT(*) FROM session_date_host;

-- 3. Compare with attendance records
-- SELECT session_id, attendance_date, host_address FROM session_date_host LIMIT 10;
