-- ============================================================================
-- CONSOLIDATED ESSENTIAL MIGRATIONS
-- Run this once to ensure all required columns, tables, and indexes exist
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS checks)
-- Date: 2026-01-29
-- ============================================================================

-- ============================================================================
-- SECTION 1: STUDENT TABLE - Add coordinate columns for GPS proximity
-- ============================================================================
ALTER TABLE public.student 
ADD COLUMN IF NOT EXISTS address_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS address_longitude DECIMAL(11, 8);

-- Add constraints if they don't exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_valid_student_latitude') THEN
    ALTER TABLE public.student ADD CONSTRAINT check_valid_student_latitude 
    CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_valid_student_longitude') THEN
    ALTER TABLE public.student ADD CONSTRAINT check_valid_student_longitude 
    CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180));
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: TEACHER TABLE - Add coordinate columns for GPS proximity
-- ============================================================================
ALTER TABLE public.teacher 
ADD COLUMN IF NOT EXISTS address_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS address_longitude DECIMAL(11, 8);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_valid_teacher_latitude') THEN
    ALTER TABLE public.teacher ADD CONSTRAINT check_valid_teacher_latitude 
    CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_valid_teacher_longitude') THEN
    ALTER TABLE public.teacher ADD CONSTRAINT check_valid_teacher_longitude 
    CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180));
  END IF;
END $$;

-- ============================================================================
-- SECTION 3: SESSION TABLE - Add proximity radius
-- ============================================================================
ALTER TABLE public.session 
ADD COLUMN IF NOT EXISTS proximity_radius INTEGER DEFAULT 100;

COMMENT ON COLUMN public.session.proximity_radius IS 'Maximum distance in meters for GPS proximity validation during check-in';

-- ============================================================================
-- SECTION 4: ENROLLMENT TABLE - Add can_host and host_date
-- ============================================================================
ALTER TABLE public.enrollment 
ADD COLUMN IF NOT EXISTS can_host BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS host_date DATE;

-- Create index for faster can_host lookups
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host ON public.enrollment(can_host) WHERE can_host = true;
CREATE INDEX IF NOT EXISTS idx_enrollment_session_canhost ON public.enrollment(session_id, can_host);

-- Add constraint: can_host can only be true for active enrollments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_can_host_only_active') THEN
    ALTER TABLE public.enrollment ADD CONSTRAINT check_can_host_only_active 
    CHECK (can_host = false OR status = 'active');
  END IF;
END $$;

-- ============================================================================
-- SECTION 5: SESSION_DATE_HOST TABLE - Single source of truth for daily host
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.session_date_host (
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  host_id UUID,
  host_type VARCHAR(10) CHECK (host_type IN ('student', 'teacher')),
  host_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_session_date_host_session_id ON public.session_date_host(session_id);
CREATE INDEX IF NOT EXISTS idx_session_date_host_date ON public.session_date_host(attendance_date);

-- Enable RLS
ALTER TABLE public.session_date_host ENABLE ROW LEVEL SECURITY;

-- Create RLS policy if it doesn't exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_date_host' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.session_date_host
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 6: TEACHER_HOST_SCHEDULE TABLE - Teacher hosting dates
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.teacher_host_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teacher(teacher_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  host_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(teacher_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_teacher_id ON public.teacher_host_schedule(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_session_id ON public.teacher_host_schedule(session_id);

-- Enable RLS
ALTER TABLE public.teacher_host_schedule ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'teacher_host_schedule' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.teacher_host_schedule
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 7: ATTENDANCE TABLE - Ensure all required columns exist
-- ============================================================================
ALTER TABLE public.attendance 
ADD COLUMN IF NOT EXISTS host_address TEXT,
ADD COLUMN IF NOT EXISTS gps_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS gps_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS excuse_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_host_address ON public.attendance(host_address);
CREATE INDEX IF NOT EXISTS idx_attendance_session_date ON public.attendance(session_id, attendance_date);

-- ============================================================================
-- SECTION 8: PHOTO_CHECKIN_SESSIONS TABLE - For face recognition
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.photo_checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(session_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_photo_checkin_token ON public.photo_checkin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_photo_checkin_session ON public.photo_checkin_sessions(session_id, attendance_date);

-- Enable RLS
ALTER TABLE public.photo_checkin_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'photo_checkin_sessions' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.photo_checkin_sessions
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 9: STUDENT PHOTO URL - For face recognition
-- ============================================================================
ALTER TABLE public.student 
ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ============================================================================
-- SECTION 10: AUDIT LOG TABLE - For tracking changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON public.audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.audit_log(changed_at DESC);

-- Enable RLS
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.audit_log
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 11: SESSION BOOK COVERAGE TABLE - For book tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.session_book_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_session_book_coverage_session ON public.session_book_coverage(session_id);

-- Enable RLS
ALTER TABLE public.session_book_coverage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_book_coverage' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.session_book_coverage
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 12: VERIFICATION QUERIES
-- ============================================================================
SELECT '=== VERIFICATION RESULTS ===' AS status;

SELECT 'student.address_latitude' AS column_check, 
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'student' AND column_name = 'address_latitude') 
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'teacher.address_latitude' AS column_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher' AND column_name = 'address_latitude')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'session.proximity_radius' AS column_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session' AND column_name = 'proximity_radius')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'enrollment.can_host' AS column_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'enrollment' AND column_name = 'can_host')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'enrollment.host_date' AS column_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'enrollment' AND column_name = 'host_date')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'session_date_host table' AS table_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_date_host')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'teacher_host_schedule table' AS table_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teacher_host_schedule')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'photo_checkin_sessions table' AS table_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_checkin_sessions')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT 'audit_log table' AS table_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

SELECT '=== MIGRATION COMPLETE ===' AS status;
