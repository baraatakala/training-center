-- Migration: Add GPS coordinates to student table
-- Purpose: Store coordinates per student address (persists across sessions)
-- Date: 2026-01-29
-- This replaces the per-session coordinate storage approach

-- Add latitude and longitude columns to student table
ALTER TABLE public.student 
ADD COLUMN IF NOT EXISTS address_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS address_longitude DECIMAL(11, 8);

-- Add comments for documentation
COMMENT ON COLUMN public.student.address_latitude IS 
'Latitude coordinate of the student address. Used for proximity validation during check-in.';

COMMENT ON COLUMN public.student.address_longitude IS 
'Longitude coordinate of the student address. Used for proximity validation during check-in.';

-- Add check constraints to ensure valid coordinates
ALTER TABLE public.student
ADD CONSTRAINT check_valid_student_latitude CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90));

ALTER TABLE public.student
ADD CONSTRAINT check_valid_student_longitude CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180));

-- Also add to teacher table
ALTER TABLE public.teacher 
ADD COLUMN IF NOT EXISTS address_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS address_longitude DECIMAL(11, 8);

COMMENT ON COLUMN public.teacher.address_latitude IS 
'Latitude coordinate of the teacher address. Used for proximity validation during check-in.';

COMMENT ON COLUMN public.teacher.address_longitude IS 
'Longitude coordinate of the teacher address. Used for proximity validation during check-in.';

ALTER TABLE public.teacher
ADD CONSTRAINT check_valid_teacher_latitude CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90));

ALTER TABLE public.teacher
ADD CONSTRAINT check_valid_teacher_longitude CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180));

-- Verification queries:
-- SELECT student_id, name, address, address_latitude, address_longitude FROM student WHERE address IS NOT NULL;
-- SELECT teacher_id, name, address, address_latitude, address_longitude FROM teacher WHERE address IS NOT NULL;
