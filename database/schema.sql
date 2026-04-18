-- ============================================================================
-- Training Center — Schema Definition
-- ============================================================================
-- Run order: 1 of 6
-- This file creates all 34 tables in dependency order.
-- All UUID columns use gen_random_uuid() (native PostgreSQL 13+, no extensions).
-- Synced with live Supabase as of 2025-07-18 (through migration 026).
-- ============================================================================

-- ============================================================================
-- 1. LOOKUP / INDEPENDENT TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin (
  admin_id UUID NOT NULL DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Admin',
  auth_user_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_pkey PRIMARY KEY (admin_id)
);

CREATE TABLE IF NOT EXISTS public.specialization (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT specialization_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.teacher (
  teacher_id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  address TEXT,
  address_latitude NUMERIC,
  address_longitude NUMERIC,
  specialization VARCHAR,
  CONSTRAINT teacher_pkey PRIMARY KEY (teacher_id),
  CONSTRAINT check_valid_teacher_latitude  CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90)),
  CONSTRAINT check_valid_teacher_longitude CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180)),
  CONSTRAINT teacher_specialization_length_check CHECK (specialization IS NULL OR (char_length(TRIM(BOTH FROM specialization)) >= 2 AND char_length(TRIM(BOTH FROM specialization)) <= 150))
);

CREATE TABLE IF NOT EXISTS public.student (
  student_id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR NOT NULL UNIQUE,
  address TEXT,
  nationality VARCHAR,
  age INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location TEXT,
  photo_url TEXT,
  address_latitude NUMERIC,
  address_longitude NUMERIC,
  specialization TEXT,
  CONSTRAINT student_pkey PRIMARY KEY (student_id),
  CONSTRAINT student_age_check CHECK (age IS NULL OR (age >= 5 AND age < 150)),
  CONSTRAINT check_valid_student_latitude  CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90)),
  CONSTRAINT check_valid_student_longitude CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180))
);

-- ============================================================================
-- 2. CORE ENTITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course (
  course_id UUID NOT NULL DEFAULT gen_random_uuid(),
  teacher_id UUID,
  course_name VARCHAR NOT NULL,
  category VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  description_format TEXT DEFAULT 'markdown',
  description_updated_at TIMESTAMPTZ,
  CONSTRAINT course_pkey PRIMARY KEY (course_id),
  CONSTRAINT course_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE SET NULL,
  CONSTRAINT course_description_length_check CHECK (description IS NULL OR (char_length(description) >= 10 AND char_length(description) <= 6000)),
  CONSTRAINT course_description_format_check CHECK (description_format = ANY (ARRAY['markdown', 'plain_text']))
);

CREATE TABLE IF NOT EXISTS public.session (
  session_id UUID NOT NULL DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  day TEXT,    -- TEXT (unbounded) — supports multi-day strings e.g. "Monday, Friday, Tuesday"
  time VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location TEXT,
  grace_period_minutes INTEGER DEFAULT 15,
  proximity_radius INTEGER DEFAULT 50,
  learning_method TEXT DEFAULT 'face_to_face',
  virtual_provider TEXT,
  virtual_meeting_link TEXT,
  requires_recording BOOLEAN NOT NULL DEFAULT false,
  default_recording_visibility TEXT,
  feedback_enabled BOOLEAN NOT NULL DEFAULT false,
  feedback_anonymous_allowed BOOLEAN NOT NULL DEFAULT true,
  max_tab_switches INTEGER NOT NULL DEFAULT 3,
  feedback_time_limit_seconds INTEGER,
  teacher_can_host BOOLEAN NOT NULL DEFAULT true,
  start_time TIME,
  end_time TIME,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  CONSTRAINT session_pkey PRIMARY KEY (session_id),
  CONSTRAINT session_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE CASCADE,
  CONSTRAINT session_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE CASCADE,
  CONSTRAINT session_dates_ordered CHECK (end_date >= start_date),
  CONSTRAINT check_grace_period_range CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 60),
  CONSTRAINT chk_proximity_radius_positive CHECK (proximity_radius IS NULL OR (proximity_radius >= 1 AND proximity_radius <= 10000)),
  CONSTRAINT session_learning_method_check CHECK (learning_method = ANY (ARRAY['face_to_face', 'online', 'hybrid'])),
  CONSTRAINT session_virtual_provider_check CHECK (virtual_provider IS NULL OR (virtual_provider = ANY (ARRAY['zoom', 'google_meet', 'microsoft_teams', 'other']))),
  CONSTRAINT chk_virtual_link_requires_provider CHECK (virtual_meeting_link IS NULL OR virtual_provider IS NOT NULL),
  CONSTRAINT session_virtual_link_requirement_check CHECK (
    (learning_method = 'face_to_face' AND virtual_meeting_link IS NULL AND virtual_provider IS NULL)
    OR learning_method = ANY (ARRAY['online', 'hybrid'])
  ),
  CONSTRAINT session_recording_visibility_check CHECK (default_recording_visibility IS NULL OR (default_recording_visibility = ANY (ARRAY['private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link']))),
  CONSTRAINT session_max_tab_switches_check CHECK (max_tab_switches >= 1 AND max_tab_switches <= 20),
  CONSTRAINT chk_feedback_time_limit_range CHECK (feedback_time_limit_seconds IS NULL OR (feedback_time_limit_seconds >= 10 AND feedback_time_limit_seconds <= 7200))
  -- chk_session_time_order removed (migration 053): overnight sessions are valid (e.g. 23:04–00:04)
);

CREATE TABLE IF NOT EXISTS public.enrollment (
  enrollment_id UUID NOT NULL DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  session_id UUID NOT NULL,
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  can_host BOOLEAN NOT NULL DEFAULT false,
  host_date DATE,
  CONSTRAINT enrollment_pkey PRIMARY KEY (enrollment_id),
  CONSTRAINT enrollment_student_session_unique UNIQUE (student_id, session_id),
  CONSTRAINT enrollment_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE,
  CONSTRAINT enrollment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT enrollment_status_check CHECK (status::TEXT = ANY (ARRAY['active', 'completed', 'dropped', 'pending'])),
  CONSTRAINT check_can_host_only_active CHECK (can_host = false OR status::TEXT = 'active')
);

-- ============================================================================
-- 3. ATTENDANCE & CHECK-IN
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.attendance (
  attendance_id UUID NOT NULL DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status VARCHAR DEFAULT 'absent',
  check_in_time TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gps_latitude NUMERIC,
  gps_longitude NUMERIC,
  gps_accuracy NUMERIC,
  gps_timestamp TIMESTAMPTZ,
  excuse_reason VARCHAR,
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  marked_by TEXT,
  marked_at TIMESTAMPTZ,
  host_address TEXT,
  late_minutes INTEGER,
  check_in_method VARCHAR,
  distance_from_host NUMERIC,
  early_minutes INTEGER,
  CONSTRAINT attendance_pkey PRIMARY KEY (attendance_id),
  CONSTRAINT attendance_enrollment_date_unique UNIQUE (enrollment_id, attendance_date),
  CONSTRAINT attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(enrollment_id) ON DELETE CASCADE,
  CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE,
  CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT attendance_status_check CHECK (status::TEXT = ANY (ARRAY['on time', 'absent', 'late', 'excused', 'not enrolled'])),
  CONSTRAINT attendance_not_both_late_and_early CHECK (NOT (late_minutes IS NOT NULL AND early_minutes IS NOT NULL)),
  CONSTRAINT check_excuse_reason_when_excused CHECK (status::TEXT <> 'excused' OR excuse_reason IS NOT NULL),
  CONSTRAINT chk_late_minutes_non_negative CHECK (late_minutes IS NULL OR late_minutes >= 0),
  CONSTRAINT chk_early_minutes_non_negative CHECK (early_minutes IS NULL OR early_minutes >= 0),
  CONSTRAINT chk_gps_latitude_range CHECK (gps_latitude IS NULL OR (gps_latitude >= -90 AND gps_latitude <= 90)),
  CONSTRAINT chk_gps_longitude_range CHECK (gps_longitude IS NULL OR (gps_longitude >= -180 AND gps_longitude <= 180)),
  CONSTRAINT chk_gps_accuracy_non_negative CHECK (gps_accuracy IS NULL OR gps_accuracy >= 0),
  CONSTRAINT chk_distance_non_negative CHECK (distance_from_host IS NULL OR distance_from_host >= 0),
  CONSTRAINT chk_check_in_method_valid CHECK (check_in_method IS NULL OR check_in_method::TEXT = ANY (ARRAY['manual', 'qr_code', 'photo', 'bulk', 'face_recognition', 'gps', 'auto']))
);

CREATE TABLE IF NOT EXISTS public.qr_sessions (
  qr_session_id UUID NOT NULL DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  used_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by TEXT,
  check_in_mode TEXT NOT NULL DEFAULT 'qr_code',
  linked_photo_token TEXT,
  CONSTRAINT qr_sessions_pkey PRIMARY KEY (qr_session_id),
  CONSTRAINT qr_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT qr_sessions_check_in_mode_check CHECK (check_in_mode = ANY (ARRAY['qr_code', 'photo'])),
  CONSTRAINT qr_session_date_check CHECK (attendance_date IS NOT NULL),
  CONSTRAINT qr_sessions_photo_link_guard CHECK (
    (check_in_mode = 'photo' AND linked_photo_token IS NOT NULL)
    OR (check_in_mode = 'qr_code' AND linked_photo_token IS NULL)
  ),
  CONSTRAINT chk_used_count_non_negative CHECK (used_count >= 0)
);
-- At most one active QR token per session/date/mode (inactive tokens kept for audit history)
CREATE UNIQUE INDEX IF NOT EXISTS qr_sessions_active_unique
  ON public.qr_sessions (session_id, attendance_date, check_in_mode)
  WHERE is_valid = true;

CREATE TABLE IF NOT EXISTS public.photo_checkin_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  token TEXT NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT photo_checkin_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT photo_checkin_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE
);

-- ============================================================================
-- 4. SESSION MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_date_host (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  host_id UUID,
  host_type VARCHAR DEFAULT 'student',
  host_address TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  host_latitude NUMERIC,
  host_longitude NUMERIC,
  CONSTRAINT session_date_host_pkey PRIMARY KEY (id),
  CONSTRAINT session_date_host_session_date_unique UNIQUE (session_id, attendance_date),
  CONSTRAINT session_date_host_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT session_date_host_type_check CHECK (host_type IS NULL OR host_type::TEXT = ANY (ARRAY['student', 'teacher', 'other'])),
  CONSTRAINT check_valid_latitude CHECK (host_latitude IS NULL OR (host_latitude >= -90 AND host_latitude <= 90)),
  CONSTRAINT check_valid_longitude CHECK (host_longitude IS NULL OR (host_longitude >= -180 AND host_longitude <= 180))
);

CREATE TABLE IF NOT EXISTS public.session_day_change (
  change_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  old_day TEXT,
  new_day TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_day_change_pkey PRIMARY KEY (change_id),
  CONSTRAINT session_day_change_session_date_unique UNIQUE (session_id, effective_date),
  CONSTRAINT session_day_change_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.session_time_change (
  change_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  old_time TEXT,
  new_time TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_time_change_pkey PRIMARY KEY (change_id),
  CONSTRAINT session_time_change_session_date_unique UNIQUE (session_id, effective_date),
  CONSTRAINT session_time_change_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.session_schedule_day (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_schedule_day_unique UNIQUE (session_id, day_of_week),
  CONSTRAINT chk_day_of_week_range CHECK (day_of_week BETWEEN 0 AND 6)
);

CREATE TABLE IF NOT EXISTS public.session_schedule_exception (
  exception_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  original_date   DATE NOT NULL,
  exception_type  TEXT NOT NULL,
  new_date        DATE,
  new_start_time  TIME,
  new_end_time    TIME,
  new_day_of_week SMALLINT,
  old_day_of_week SMALLINT,
  reason          TEXT,
  changed_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_schedule_exception_unique UNIQUE (session_id, original_date),
  CONSTRAINT chk_exception_type CHECK (exception_type IN ('cancelled', 'rescheduled', 'time_change', 'day_change', 'time_and_day_change')),
  CONSTRAINT chk_exception_new_day_range CHECK (new_day_of_week IS NULL OR (new_day_of_week BETWEEN 0 AND 6)),
  CONSTRAINT chk_exception_old_day_range CHECK (old_day_of_week IS NULL OR (old_day_of_week BETWEEN 0 AND 6)),
  CONSTRAINT chk_exception_time_order CHECK (new_start_time IS NULL OR new_end_time IS NULL OR new_end_time > new_start_time)
);

CREATE TABLE IF NOT EXISTS public.teacher_host_schedule (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL,
  session_id UUID NOT NULL,
  host_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_host_schedule_pkey PRIMARY KEY (id),
  CONSTRAINT teacher_host_schedule_session_date_unique UNIQUE (session_id, host_date),
  CONSTRAINT unique_teacher_session UNIQUE (teacher_id, session_id),
  CONSTRAINT teacher_host_schedule_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE CASCADE,
  CONSTRAINT teacher_host_schedule_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.session_recording (
  recording_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE,
  recording_type TEXT NOT NULL,
  recording_url TEXT,
  recording_storage_location TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  recording_uploaded_by UUID,
  recording_visibility TEXT NOT NULL DEFAULT 'course_staff',
  title VARCHAR,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  mime_type VARCHAR,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT session_recording_pkey PRIMARY KEY (recording_id),
  CONSTRAINT session_recording_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT session_recording_recording_uploaded_by_fkey FOREIGN KEY (recording_uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT session_recording_type_check CHECK (recording_type = ANY (ARRAY['zoom_recording', 'google_meet_recording', 'teacher_mobile_recording', 'uploaded_recording', 'external_stream'])),
  CONSTRAINT session_recording_storage_location_check CHECK (recording_storage_location = ANY (ARRAY['supabase_storage', 'external_link', 'streaming_link', 'provider_managed'])),
  CONSTRAINT session_recording_visibility_check CHECK (recording_visibility = ANY (ARRAY['private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link'])),
  CONSTRAINT session_recording_duration_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT session_recording_file_size_check CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);

-- ============================================================================
-- 5. BOOK TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course_book_reference (
  reference_id UUID NOT NULL DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL,
  topic TEXT NOT NULL,
  start_page INTEGER NOT NULL CHECK (start_page > 0),
  end_page INTEGER NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  parent_id UUID,
  CONSTRAINT course_book_reference_pkey PRIMARY KEY (reference_id),
  CONSTRAINT course_book_reference_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE CASCADE,
  CONSTRAINT course_book_reference_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.course_book_reference(reference_id) ON DELETE SET NULL,
  CONSTRAINT course_book_reference_page_range_check CHECK (end_page >= start_page),
  CONSTRAINT chk_end_page_positive CHECK (end_page > 0),
  CONSTRAINT chk_display_order_non_negative CHECK (display_order IS NULL OR display_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.session_book_coverage (
  coverage_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_book_coverage_pkey PRIMARY KEY (coverage_id),
  CONSTRAINT session_book_coverage_session_id_attendance_date_key UNIQUE (session_id, attendance_date),
  CONSTRAINT session_book_coverage_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT session_book_coverage_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES public.course_book_reference(reference_id) ON DELETE CASCADE
);

-- ============================================================================
-- 6. SCORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scoring_config (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  teacher_id UUID,
  config_name TEXT NOT NULL DEFAULT 'Default Scoring',
  is_default BOOLEAN NOT NULL DEFAULT true,
  weight_quality NUMERIC NOT NULL DEFAULT 55.00,
  weight_attendance NUMERIC NOT NULL DEFAULT 35.00,
  weight_punctuality NUMERIC NOT NULL DEFAULT 10.00,
  late_decay_constant NUMERIC NOT NULL DEFAULT 43.30,
  late_minimum_credit NUMERIC NOT NULL DEFAULT 0.050,
  late_null_estimate NUMERIC NOT NULL DEFAULT 0.600,
  coverage_enabled BOOLEAN NOT NULL DEFAULT true,
  coverage_method TEXT NOT NULL DEFAULT 'sqrt',
  coverage_minimum NUMERIC NOT NULL DEFAULT 0.100,
  late_brackets JSONB NOT NULL DEFAULT '[{"id": "1", "max": 5, "min": 1, "name": "Minor", "color": "bg-green-100 text-green-800"}, {"id": "2", "max": 15, "min": 6, "name": "Moderate", "color": "bg-yellow-100 text-yellow-800"}, {"id": "3", "max": 30, "min": 16, "name": "Significant", "color": "bg-orange-100 text-orange-800"}, {"id": "4", "max": 60, "min": 31, "name": "Severe", "color": "bg-red-100 text-red-800"}, {"id": "5", "max": 999, "min": 61, "name": "Very Late", "color": "bg-red-200 text-red-900"}]'::JSONB,
  perfect_attendance_bonus NUMERIC NOT NULL DEFAULT 0.00,
  streak_bonus_per_week NUMERIC NOT NULL DEFAULT 0.00,
  absence_penalty_multiplier NUMERIC NOT NULL DEFAULT 1.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scoring_config_pkey PRIMARY KEY (id),
  CONSTRAINT scoring_config_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE CASCADE,
  CONSTRAINT scoring_config_coverage_method_check CHECK (coverage_method = ANY (ARRAY['sqrt', 'linear', 'log', 'none'])),
  CONSTRAINT chk_weights_sum_100 CHECK ((weight_quality + weight_attendance + weight_punctuality) = 100),
  CONSTRAINT chk_weight_quality_range CHECK (weight_quality >= 0 AND weight_quality <= 100),
  CONSTRAINT chk_weight_attendance_range CHECK (weight_attendance >= 0 AND weight_attendance <= 100),
  CONSTRAINT chk_weight_punctuality_range CHECK (weight_punctuality >= 0 AND weight_punctuality <= 100),
  CONSTRAINT chk_late_decay_positive CHECK (late_decay_constant > 0),
  CONSTRAINT chk_late_minimum_credit_range CHECK (late_minimum_credit >= 0 AND late_minimum_credit <= 1),
  CONSTRAINT chk_late_null_estimate_range CHECK (late_null_estimate >= 0 AND late_null_estimate <= 1),
  CONSTRAINT chk_coverage_minimum_range CHECK (coverage_minimum >= 0 AND coverage_minimum <= 1),
  CONSTRAINT chk_perfect_attendance_bonus_range CHECK (perfect_attendance_bonus >= 0 AND perfect_attendance_bonus <= 100),
  CONSTRAINT chk_streak_bonus_range CHECK (streak_bonus_per_week >= 0 AND streak_bonus_per_week <= 50),
  CONSTRAINT chk_absence_penalty_range CHECK (absence_penalty_multiplier >= 0 AND absence_penalty_multiplier <= 10)
);

-- NOTE: late_brackets is stored as a JSONB column in scoring_config above.
-- A separate late_brackets table was originally planned but never deployed.

-- ============================================================================
-- 7. EXCUSES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.excuse_request (
  request_id UUID NOT NULL DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  reason TEXT NOT NULL,
  description TEXT,
  supporting_doc_url TEXT,
  supporting_doc_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT excuse_request_pkey PRIMARY KEY (request_id),
  CONSTRAINT excuse_request_student_session_date_unique UNIQUE (student_id, session_id, attendance_date),
  CONSTRAINT excuse_request_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE,
  CONSTRAINT excuse_request_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT excuse_request_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'cancelled'])),
  CONSTRAINT excuse_request_review_fields CHECK (
    (status IN ('pending', 'cancelled'))
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

-- ============================================================================
-- 8. FEEDBACK
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feedback_question (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'rating',
  options JSONB NOT NULL DEFAULT '[]'::JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attendance_date DATE,
  correct_answer TEXT DEFAULT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT false,
  grading_mode TEXT NOT NULL DEFAULT 'exact',
  CONSTRAINT feedback_question_pkey PRIMARY KEY (id),
  CONSTRAINT feedback_question_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT feedback_question_question_type_check CHECK (question_type = ANY (ARRAY['rating', 'text', 'multiple_choice'])),
  CONSTRAINT feedback_question_grading_mode_check CHECK (grading_mode = ANY (ARRAY['exact', 'partial', 'any'])),
  CONSTRAINT chk_sort_order_non_negative CHECK (sort_order >= 0),
  CONSTRAINT chk_multiple_choice_has_options CHECK (
    question_type <> 'multiple_choice'
    OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) > 0)
  )
);

CREATE TABLE IF NOT EXISTS public.feedback_template (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_template_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.session_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  student_id UUID,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  overall_rating INTEGER,
  comment TEXT,
  responses JSONB DEFAULT '{}'::JSONB,
  check_in_method TEXT,
  tab_switch_count INTEGER NOT NULL DEFAULT 0,
  is_auto_submitted BOOLEAN NOT NULL DEFAULT false,
  answer_duration_seconds INTEGER,
  submission_reason TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT session_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE,
  CONSTRAINT session_feedback_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE SET NULL,
  CONSTRAINT session_feedback_overall_rating_check CHECK (overall_rating >= 1 AND overall_rating <= 5),
  CONSTRAINT session_feedback_anonymous_student_check CHECK (is_anonymous = true OR student_id IS NOT NULL),
  CONSTRAINT chk_feedback_check_in_method_valid CHECK (check_in_method IS NULL OR check_in_method = ANY (ARRAY['manual', 'qr_code', 'photo', 'bulk', 'face_recognition', 'gps', 'auto'])),
  CONSTRAINT chk_feedback_answer_duration_positive CHECK (answer_duration_seconds IS NULL OR answer_duration_seconds >= 0),
  CONSTRAINT chk_feedback_submission_reason_valid CHECK (submission_reason = ANY (ARRAY['completed', 'timer_expired', 'tab_violation', 'partial_timer', 'skipped']))
);

-- ============================================================================
-- 9. CERTIFICATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.certificate_template (
  template_id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  template_type TEXT NOT NULL DEFAULT 'completion',
  min_score NUMERIC DEFAULT 0,
  min_attendance NUMERIC DEFAULT 0,
  style_config JSONB DEFAULT '{"font_family": "serif", "orientation": "landscape", "accent_color": "#1e40af", "border_style": "classic", "background_color": "#ffffff"}'::JSONB,
  body_template TEXT DEFAULT 'This is to certify that {{name}} has successfully completed the course "{{course}}" with a score of {{score}}%.',
  signature_name TEXT,
  signature_title TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT certificate_template_pkey PRIMARY KEY (template_id),
  CONSTRAINT certificate_template_template_type_check CHECK (template_type = ANY (ARRAY['completion', 'attendance', 'achievement', 'participation'])),
  CONSTRAINT chk_min_score_range CHECK (min_score IS NULL OR (min_score >= 0 AND min_score <= 100)),
  CONSTRAINT chk_min_attendance_range CHECK (min_attendance IS NULL OR (min_attendance >= 0 AND min_attendance <= 100))
);

CREATE TABLE IF NOT EXISTS public.issued_certificate (
  certificate_id UUID NOT NULL DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  student_id UUID NOT NULL,
  session_id UUID,
  course_id UUID,
  certificate_number TEXT NOT NULL UNIQUE,
  verification_code TEXT NOT NULL UNIQUE,
  final_score NUMERIC,
  attendance_rate NUMERIC,
  status TEXT NOT NULL DEFAULT 'draft',
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  resolved_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_name TEXT,
  signature_title TEXT,
  signer_teacher_id UUID,
  signer_source TEXT DEFAULT 'template_default',
  signer_title_snapshot TEXT,
  CONSTRAINT issued_certificate_pkey PRIMARY KEY (certificate_id),
  CONSTRAINT issued_certificate_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.certificate_template(template_id) ON DELETE CASCADE,
  CONSTRAINT issued_certificate_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE,
  CONSTRAINT issued_certificate_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE SET NULL,
  CONSTRAINT issued_certificate_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE SET NULL,
  CONSTRAINT issued_certificate_signer_teacher_id_fkey FOREIGN KEY (signer_teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE SET NULL,
  CONSTRAINT issued_certificate_status_check CHECK (status = ANY (ARRAY['draft', 'issued', 'revoked'])),
  CONSTRAINT issued_certificate_signer_source_check CHECK (signer_source = ANY (ARRAY['teacher_specialization', 'template_default', 'manual_override'])),
  CONSTRAINT chk_final_score_range CHECK (final_score IS NULL OR (final_score >= 0 AND final_score <= 100)),
  CONSTRAINT chk_attendance_rate_range CHECK (attendance_rate IS NULL OR (attendance_rate >= 0 AND attendance_rate <= 100)),
  CONSTRAINT chk_revoked_fields CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT chk_issued_fields CHECK (status <> 'issued' OR issued_at IS NOT NULL)
);

-- ============================================================================
-- 10. COMMUNICATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.announcement (
  announcement_id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  priority VARCHAR DEFAULT 'normal',
  created_by UUID NOT NULL,
  course_id UUID,
  is_pinned BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  category VARCHAR DEFAULT 'general',
  attachments JSONB DEFAULT '[]'::JSONB,
  view_count INTEGER DEFAULT 0,
  image_url TEXT,
  creator_type TEXT DEFAULT 'teacher',
  CONSTRAINT announcement_pkey PRIMARY KEY (announcement_id),
  CONSTRAINT announcement_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE CASCADE,
  CONSTRAINT announcement_priority_check CHECK (priority::TEXT = ANY (ARRAY['low', 'normal', 'high', 'urgent'])),
  CONSTRAINT chk_view_count_non_negative CHECK (view_count >= 0),
  CONSTRAINT chk_announcement_category_valid CHECK (category IS NULL OR category::TEXT = ANY (ARRAY['general', 'homework', 'exam', 'event', 'reminder', 'urgent', 'celebration']))
);

CREATE TABLE IF NOT EXISTS public.announcement_read (
  read_id UUID NOT NULL DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL,
  student_id UUID NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT announcement_read_pkey PRIMARY KEY (read_id),
  CONSTRAINT announcement_read_announcement_id_student_id_key UNIQUE (announcement_id, student_id),
  CONSTRAINT announcement_read_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE,
  CONSTRAINT announcement_read_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.announcement_comment (
  comment_id UUID NOT NULL DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL,
  commenter_type VARCHAR NOT NULL,
  commenter_id UUID NOT NULL,
  content TEXT NOT NULL,
  parent_comment_id UUID,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcement_comment_pkey PRIMARY KEY (comment_id),
  CONSTRAINT announcement_comment_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE,
  CONSTRAINT announcement_comment_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.announcement_comment(comment_id) ON DELETE SET NULL,
  CONSTRAINT announcement_comment_commenter_type_check CHECK (commenter_type::TEXT = ANY (ARRAY['teacher', 'student']))
);

CREATE TABLE IF NOT EXISTS public.announcement_reaction (
  reaction_id UUID NOT NULL DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL,
  student_id UUID NOT NULL,
  emoji VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcement_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT announcement_reaction_announcement_id_student_id_emoji_key UNIQUE (announcement_id, student_id, emoji),
  CONSTRAINT announcement_reaction_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE,
  CONSTRAINT announcement_reaction_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.message (
  message_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_type VARCHAR NOT NULL,
  sender_id UUID NOT NULL,
  recipient_type VARCHAR NOT NULL,
  recipient_id UUID NOT NULL,
  subject VARCHAR,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  parent_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_pkey PRIMARY KEY (message_id),
  CONSTRAINT message_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.message(message_id) ON DELETE SET NULL,
  CONSTRAINT message_sender_type_check CHECK (sender_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin'])),
  CONSTRAINT message_recipient_type_check CHECK (recipient_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin']))
);

-- NOTE: message_attachment table does not exist in the live schema.
-- Attachments are handled via Supabase Storage directly.

CREATE TABLE IF NOT EXISTS public.message_reaction (
  reaction_id UUID NOT NULL DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  reactor_type VARCHAR NOT NULL,
  reactor_id UUID NOT NULL,
  emoji VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT message_reaction_message_id_reactor_type_reactor_id_key UNIQUE (message_id, reactor_type, reactor_id),
  CONSTRAINT message_reaction_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id) ON DELETE CASCADE,
  CONSTRAINT message_reaction_reactor_type_check CHECK (reactor_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin']))
);

CREATE TABLE IF NOT EXISTS public.message_starred (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  user_type VARCHAR NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_starred_pkey PRIMARY KEY (id),
  CONSTRAINT message_starred_message_id_user_type_user_id_key UNIQUE (message_id, user_type, user_id),
  CONSTRAINT message_starred_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id) ON DELETE CASCADE,
  CONSTRAINT message_starred_user_type_check CHECK (user_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin']))
);

-- NOTE: notification_preference table was removed in migration 017.
-- It had zero frontend integration (scaffolded for future email/push system).

-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  audit_id UUID NOT NULL DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT,
  CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id),
  CONSTRAINT audit_log_operation_check CHECK (operation = ANY (ARRAY['DELETE', 'UPDATE', 'INSERT']))
);

-- ============================================================================
-- 12. TABLE COMMENTS (self-documenting — queryable via \dt+ in psql)
-- ============================================================================

COMMENT ON TABLE public.admin IS 'Platform administrators with full system access';
COMMENT ON TABLE public.specialization IS 'Lookup table for student/teacher specialization domains';
COMMENT ON TABLE public.teacher IS 'Instructors who manage courses, sessions, and student enrollment';
COMMENT ON TABLE public.student IS 'Learners enrolled in training sessions';
COMMENT ON TABLE public.course IS 'Curriculum definitions owned by a teacher';
COMMENT ON TABLE public.session IS 'Scheduled course delivery — date range, day(s), time, and configuration';
COMMENT ON TABLE public.enrollment IS 'Student ↔ session binding with status lifecycle (active → completed/dropped)';
COMMENT ON TABLE public.attendance IS 'Per-date attendance record for each enrollment — status, GPS (validated ranges), timing (non-negative), check-in method';
COMMENT ON TABLE public.qr_sessions IS 'Time-limited QR/photo check-in tokens generated per session date';
COMMENT ON TABLE public.photo_checkin_sessions IS 'Face-recognition check-in sessions linked to QR tokens';
COMMENT ON TABLE public.session_date_host IS 'Per-date host assignment and location override for a session';
COMMENT ON TABLE public.session_day_change IS 'Audit trail of session schedule day changes with effective dates';
COMMENT ON TABLE public.session_time_change IS 'Audit trail of session schedule time changes with effective dates';
COMMENT ON TABLE public.session_schedule_day IS 'Normalized session day-of-week. 0=Sunday, 6=Saturday. Replaces comma-separated session.day TEXT.';
COMMENT ON TABLE public.session_schedule_exception IS 'Unified schedule exceptions replacing session_time_change + session_day_change. One exception per date.';
COMMENT ON TABLE public.teacher_host_schedule IS 'Teacher-hosted session dates (when teacher_can_host is enabled)';
COMMENT ON TABLE public.session_recording IS 'Session recordings with visibility controls and soft-delete';
COMMENT ON TABLE public.course_book_reference IS 'Hierarchical book/page references linked to a course';
COMMENT ON TABLE public.session_book_coverage IS 'Tracks which book references were covered on each session date';
COMMENT ON TABLE public.scoring_config IS 'Teacher-owned scoring formula: weights (must sum to 100), late brackets (JSONB), decay curves, bonus/penalty configs';
COMMENT ON TABLE public.excuse_request IS 'Student absence excuse workflow — pending → approved/rejected/cancelled';
COMMENT ON TABLE public.feedback_question IS 'Per-session, per-date feedback questions (rating, text, multiple choice) with optional test grading';
COMMENT ON TABLE public.feedback_template IS 'Reusable feedback question templates for quick session setup';
COMMENT ON TABLE public.session_feedback IS 'Student-submitted feedback responses with optional anonymity';
COMMENT ON TABLE public.certificate_template IS 'Certificate layout and criteria templates (completion, attendance, achievement)';
COMMENT ON TABLE public.issued_certificate IS 'Individually issued certificates with unique verification codes, percentage-validated scores and attendance rates';
COMMENT ON TABLE public.announcement IS 'Teacher/admin announcements — global or course-scoped, with priority and expiry';
COMMENT ON TABLE public.announcement_read IS 'Tracks which students have read which announcements';
COMMENT ON TABLE public.announcement_comment IS 'Threaded comments on announcements (teacher or student)';
COMMENT ON TABLE public.announcement_reaction IS 'Emoji reactions on announcements';
COMMENT ON TABLE public.message IS 'Direct messages between teachers, students, and admins';
COMMENT ON TABLE public.message_reaction IS 'Emoji reactions on messages';
COMMENT ON TABLE public.message_starred IS 'User-starred messages for quick access';
COMMENT ON TABLE public.audit_log IS 'Immutable audit trail — INSERT/UPDATE/DELETE operations with old/new data snapshots';
