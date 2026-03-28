-- Migration: Create table to store teacher hosting schedule
-- Purpose: Track when teachers host sessions (similar to enrollment.host_date for students)
-- Date: 2026-01-27

-- Create teacher_host_schedule table
CREATE TABLE IF NOT EXISTS public.teacher_host_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES public.teacher(teacher_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  host_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(teacher_id, session_id, host_date),
  CONSTRAINT unique_teacher_session UNIQUE(teacher_id, session_id)
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_teacher_id ON public.teacher_host_schedule(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_session_id ON public.teacher_host_schedule(session_id);
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_host_date ON public.teacher_host_schedule(host_date);

-- Add comments
COMMENT ON TABLE public.teacher_host_schedule IS 'Tracks when teachers are assigned to host sessions at their home';
COMMENT ON COLUMN public.teacher_host_schedule.teacher_id IS 'Teacher who will host the session';
COMMENT ON COLUMN public.teacher_host_schedule.session_id IS 'Session being hosted';
COMMENT ON COLUMN public.teacher_host_schedule.host_date IS 'Date when teacher hosts the session';

-- Verification query
SELECT * FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'teacher_host_schedule';
