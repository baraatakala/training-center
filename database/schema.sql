-- ============================================================================
-- Training Center — Schema Definition
-- ============================================================================
-- Run order: 1 of 6
-- This file creates all tables in dependency order.
-- Based on the live Supabase schema (2026-03-23) plus supplementary tables.
-- ============================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT specialization_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.teacher (
  teacher_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  address TEXT,
  address_latitude NUMERIC CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90)),
  address_longitude NUMERIC CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180)),
  specialization VARCHAR CHECK (specialization IS NULL OR (char_length(TRIM(BOTH FROM specialization)) >= 2 AND char_length(TRIM(BOTH FROM specialization)) <= 150)),
  CONSTRAINT teacher_pkey PRIMARY KEY (teacher_id)
);

CREATE TABLE IF NOT EXISTS public.student (
  student_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR NOT NULL UNIQUE,
  address TEXT,
  nationality VARCHAR,
  age INTEGER CHECK (age > 0 AND age < 150),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  location TEXT,
  photo_url TEXT,
  address_latitude NUMERIC CHECK (address_latitude IS NULL OR (address_latitude >= -90 AND address_latitude <= 90)),
  address_longitude NUMERIC CHECK (address_longitude IS NULL OR (address_longitude >= -180 AND address_longitude <= 180)),
  specialization TEXT,
  CONSTRAINT student_pkey PRIMARY KEY (student_id)
);

-- ============================================================================
-- 2. CORE ENTITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course (
  course_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id UUID,
  course_name VARCHAR NOT NULL,
  category VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 6000),
  description_format TEXT DEFAULT 'markdown' CHECK (description_format = ANY (ARRAY['markdown', 'plain_text'])),
  description_updated_at TIMESTAMPTZ,
  CONSTRAINT course_pkey PRIMARY KEY (course_id),
  CONSTRAINT course_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);

CREATE TABLE IF NOT EXISTS public.session (
  session_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  day TEXT,    -- TEXT (unbounded) — supports multi-day strings e.g. "Monday, Friday, Tuesday"
  time VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  location TEXT,
  grace_period_minutes INTEGER DEFAULT 15 CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 60),
  proximity_radius INTEGER DEFAULT 50,
  learning_method TEXT DEFAULT 'face_to_face' CHECK (learning_method = ANY (ARRAY['face_to_face', 'online', 'hybrid'])),
  virtual_provider TEXT CHECK (virtual_provider IS NULL OR (virtual_provider = ANY (ARRAY['zoom', 'google_meet', 'microsoft_teams', 'other']))),
  virtual_meeting_link TEXT,
  requires_recording BOOLEAN NOT NULL DEFAULT false,
  default_recording_visibility TEXT CHECK (default_recording_visibility IS NULL OR (default_recording_visibility = ANY (ARRAY['private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link']))),
  feedback_enabled BOOLEAN DEFAULT false,
  feedback_anonymous_allowed BOOLEAN DEFAULT true,
  teacher_can_host BOOLEAN DEFAULT true,
  CONSTRAINT session_pkey PRIMARY KEY (session_id),
  CONSTRAINT session_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id),
  CONSTRAINT session_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);

CREATE TABLE IF NOT EXISTS public.enrollment (
  enrollment_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL,
  session_id UUID NOT NULL,
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR DEFAULT 'active' CHECK (status::TEXT = ANY (ARRAY['active', 'completed', 'dropped', 'pending'])),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  can_host BOOLEAN NOT NULL DEFAULT false,
  host_date DATE,
  CONSTRAINT enrollment_pkey PRIMARY KEY (enrollment_id),
  CONSTRAINT enrollment_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT enrollment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

-- ============================================================================
-- 3. ATTENDANCE & CHECK-IN
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.attendance (
  attendance_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  enrollment_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status VARCHAR DEFAULT 'absent' CHECK (status::TEXT = ANY (ARRAY['on time', 'absent', 'late', 'excused', 'not enrolled'])),
  check_in_time TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  gps_latitude NUMERIC,
  gps_longitude NUMERIC,
  gps_accuracy NUMERIC,
  gps_timestamp TIMESTAMPTZ,
  excuse_reason VARCHAR,
  session_id UUID,
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
  CONSTRAINT attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(enrollment_id),
  CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

CREATE TABLE IF NOT EXISTS public.qr_sessions (
  qr_session_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  token UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL CHECK (attendance_date IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  used_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by TEXT,
  check_in_mode TEXT NOT NULL DEFAULT 'qr_code' CHECK (check_in_mode = ANY (ARRAY['qr_code', 'photo'])),
  linked_photo_token TEXT,
  CONSTRAINT qr_sessions_pkey PRIMARY KEY (qr_session_id),
  CONSTRAINT qr_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

CREATE TABLE IF NOT EXISTS public.photo_checkin_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT photo_checkin_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT photo_checkin_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

-- ============================================================================
-- 4. SESSION MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.session_date_host (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  host_id UUID,
  host_type VARCHAR DEFAULT 'student',
  host_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  host_latitude NUMERIC CHECK (host_latitude IS NULL OR (host_latitude >= -90 AND host_latitude <= 90)),
  host_longitude NUMERIC CHECK (host_longitude IS NULL OR (host_longitude >= -180 AND host_longitude <= 180)),
  override_time TEXT DEFAULT NULL,
  CONSTRAINT session_date_host_pkey PRIMARY KEY (id),
  CONSTRAINT session_date_host_session_date_unique UNIQUE (session_id, attendance_date),
  CONSTRAINT session_date_host_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

CREATE TABLE IF NOT EXISTS public.session_day_change (
  change_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  old_day TEXT,
  new_day TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT session_day_change_pkey PRIMARY KEY (change_id),
  CONSTRAINT session_day_change_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.teacher_host_schedule (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL,
  session_id UUID NOT NULL,
  host_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT teacher_host_schedule_pkey PRIMARY KEY (id),
  CONSTRAINT teacher_host_schedule_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id),
  CONSTRAINT teacher_host_schedule_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

CREATE TABLE IF NOT EXISTS public.session_recording (
  recording_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE,
  recording_type TEXT NOT NULL CHECK (recording_type = ANY (ARRAY['zoom_recording', 'google_meet_recording', 'teacher_mobile_recording', 'uploaded_recording', 'external_stream'])),
  recording_url TEXT,
  recording_storage_location TEXT NOT NULL CHECK (recording_storage_location = ANY (ARRAY['supabase_storage', 'external_link', 'streaming_link', 'provider_managed'])),
  storage_bucket TEXT,
  storage_path TEXT,
  recording_uploaded_by UUID,
  recording_visibility TEXT NOT NULL DEFAULT 'course_staff' CHECK (recording_visibility = ANY (ARRAY['private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link'])),
  title VARCHAR,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  mime_type VARCHAR,
  provider_name TEXT,
  provider_recording_id TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT session_recording_pkey PRIMARY KEY (recording_id),
  CONSTRAINT session_recording_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_recording_recording_uploaded_by_fkey FOREIGN KEY (recording_uploaded_by) REFERENCES auth.users(id)
);

-- ============================================================================
-- 5. BOOK TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course_book_reference (
  reference_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL,
  topic TEXT NOT NULL,
  start_page INTEGER NOT NULL CHECK (start_page > 0),
  end_page INTEGER NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  parent_id UUID,
  CONSTRAINT course_book_reference_pkey PRIMARY KEY (reference_id),
  CONSTRAINT course_book_reference_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.course_book_reference(reference_id),
  CONSTRAINT course_book_reference_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id)
);

CREATE TABLE IF NOT EXISTS public.session_book_coverage (
  coverage_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT session_book_coverage_pkey PRIMARY KEY (coverage_id),
  CONSTRAINT session_book_coverage_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_book_coverage_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES public.course_book_reference(reference_id)
);

-- ============================================================================
-- 6. SCORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scoring_config (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL,
  config_name TEXT NOT NULL DEFAULT 'Default Scoring',
  is_default BOOLEAN NOT NULL DEFAULT true,
  weight_quality NUMERIC NOT NULL DEFAULT 55.00,
  weight_attendance NUMERIC NOT NULL DEFAULT 35.00,
  weight_punctuality NUMERIC NOT NULL DEFAULT 10.00,
  late_decay_constant NUMERIC NOT NULL DEFAULT 43.30,
  late_minimum_credit NUMERIC NOT NULL DEFAULT 0.050,
  late_null_estimate NUMERIC NOT NULL DEFAULT 0.600,
  coverage_enabled BOOLEAN NOT NULL DEFAULT true,
  coverage_method TEXT NOT NULL DEFAULT 'sqrt' CHECK (coverage_method = ANY (ARRAY['sqrt', 'linear', 'log', 'none'])),
  coverage_minimum NUMERIC NOT NULL DEFAULT 0.100,
  late_brackets JSONB NOT NULL DEFAULT '[{"id": "1", "max": 5, "min": 1, "name": "Minor", "color": "bg-green-100 text-green-800"}, {"id": "2", "max": 15, "min": 6, "name": "Moderate", "color": "bg-yellow-100 text-yellow-800"}, {"id": "3", "max": 30, "min": 16, "name": "Significant", "color": "bg-orange-100 text-orange-800"}, {"id": "4", "max": 60, "min": 31, "name": "Severe", "color": "bg-red-100 text-red-800"}, {"id": "5", "max": 999, "min": 61, "name": "Very Late", "color": "bg-red-200 text-red-900"}]'::JSONB,
  perfect_attendance_bonus NUMERIC NOT NULL DEFAULT 0.00,
  streak_bonus_per_week NUMERIC NOT NULL DEFAULT 0.00,
  absence_penalty_multiplier NUMERIC NOT NULL DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT scoring_config_pkey PRIMARY KEY (id),
  CONSTRAINT scoring_config_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES auth.users(id)
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'cancelled'])),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT excuse_request_pkey PRIMARY KEY (request_id),
  CONSTRAINT excuse_request_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT excuse_request_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

-- ============================================================================
-- 8. FEEDBACK
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feedback_question (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'rating' CHECK (question_type = ANY (ARRAY['rating', 'text', 'emoji', 'multiple_choice'])),
  options JSONB DEFAULT '[]'::JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  attendance_date DATE,
  CONSTRAINT feedback_question_pkey PRIMARY KEY (id),
  CONSTRAINT feedback_question_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);

CREATE TABLE IF NOT EXISTS public.feedback_template (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  questions JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT feedback_template_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.session_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  student_id UUID,
  is_anonymous BOOLEAN DEFAULT false,
  overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
  comment TEXT,
  responses JSONB DEFAULT '{}'::JSONB,
  check_in_method TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT session_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT session_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_feedback_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);

-- ============================================================================
-- 9. CERTIFICATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.certificate_template (
  template_id UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  template_type TEXT NOT NULL DEFAULT 'completion' CHECK (template_type = ANY (ARRAY['completion', 'attendance', 'achievement', 'participation'])),
  min_score NUMERIC DEFAULT 0,
  min_attendance NUMERIC DEFAULT 0,
  style_config JSONB DEFAULT '{"font_family": "serif", "orientation": "landscape", "accent_color": "#1e40af", "border_style": "classic", "background_color": "#ffffff"}'::JSONB,
  body_template TEXT DEFAULT 'This is to certify that {{name}} has successfully completed the course "{{course}}" with a score of {{score}}%.',
  signature_name TEXT,
  signature_title TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT certificate_template_pkey PRIMARY KEY (template_id)
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
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft', 'issued', 'revoked'])),
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  resolved_body TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  signature_name TEXT,
  signature_title TEXT,
  signer_teacher_id UUID,
  signer_source TEXT DEFAULT 'template_default' CHECK (signer_source = ANY (ARRAY['teacher_specialization', 'template_default', 'manual_override'])),
  signer_title_snapshot TEXT,
  CONSTRAINT issued_certificate_pkey PRIMARY KEY (certificate_id),
  CONSTRAINT issued_certificate_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.certificate_template(template_id),
  CONSTRAINT issued_certificate_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT issued_certificate_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT issued_certificate_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id),
  CONSTRAINT issued_certificate_signer_teacher_id_fkey FOREIGN KEY (signer_teacher_id) REFERENCES public.teacher(teacher_id)
);

-- ============================================================================
-- 10. COMMUNICATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.announcement (
  announcement_id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  priority VARCHAR DEFAULT 'normal' CHECK (priority::TEXT = ANY (ARRAY['low', 'normal', 'high', 'urgent'])),
  created_by UUID NOT NULL,
  course_id UUID,
  is_pinned BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  category VARCHAR DEFAULT 'general',
  attachments JSONB DEFAULT '[]'::JSONB,
  view_count INTEGER DEFAULT 0,
  image_url TEXT,
  creator_type TEXT DEFAULT 'teacher',
  CONSTRAINT announcement_pkey PRIMARY KEY (announcement_id),
  CONSTRAINT announcement_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id)
);

CREATE TABLE IF NOT EXISTS public.announcement_read (
  read_id UUID NOT NULL DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL,
  student_id UUID NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT announcement_read_pkey PRIMARY KEY (read_id),
  CONSTRAINT announcement_read_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_read_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);

CREATE TABLE IF NOT EXISTS public.announcement_comment (
  comment_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL,
  commenter_type VARCHAR NOT NULL CHECK (commenter_type::TEXT = ANY (ARRAY['teacher', 'student'])),
  commenter_id UUID NOT NULL,
  content TEXT NOT NULL,
  parent_comment_id UUID,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT announcement_comment_pkey PRIMARY KEY (comment_id),
  CONSTRAINT announcement_comment_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_comment_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.announcement_comment(comment_id)
);

CREATE TABLE IF NOT EXISTS public.announcement_reaction (
  reaction_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL,
  student_id UUID NOT NULL,
  emoji VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT announcement_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT announcement_reaction_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_reaction_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);

CREATE TABLE IF NOT EXISTS public.message (
  message_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_type VARCHAR NOT NULL CHECK (sender_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin'])),
  sender_id UUID NOT NULL,
  recipient_type VARCHAR NOT NULL CHECK (recipient_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin'])),
  recipient_id UUID NOT NULL,
  subject VARCHAR,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  parent_message_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  is_starred BOOLEAN DEFAULT false,
  CONSTRAINT message_pkey PRIMARY KEY (message_id),
  CONSTRAINT message_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.message(message_id)
);

-- NOTE: message_attachment table does not exist in the live schema.
-- Attachments are handled via Supabase Storage directly.

CREATE TABLE IF NOT EXISTS public.message_reaction (
  reaction_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL,
  reactor_type VARCHAR NOT NULL CHECK (reactor_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin'])),
  reactor_id UUID NOT NULL,
  emoji VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT message_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT message_reaction_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);

CREATE TABLE IF NOT EXISTS public.message_starred (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL,
  user_type VARCHAR NOT NULL CHECK (user_type::TEXT = ANY (ARRAY['teacher', 'student', 'admin'])),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT message_starred_pkey PRIMARY KEY (id),
  CONSTRAINT message_starred_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);

CREATE TABLE IF NOT EXISTS public.notification_preference (
  preference_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('teacher', 'student')),
  user_id UUID NOT NULL,
  email_announcements BOOLEAN DEFAULT true,
  email_messages BOOLEAN DEFAULT true,
  push_announcements BOOLEAN DEFAULT true,
  push_messages BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_type, user_id)
);

-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  audit_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation = ANY (ARRAY['DELETE', 'UPDATE', 'INSERT'])),
  old_data JSONB,
  new_data JSONB,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT now(),
  changed_by UUID,
  ip_address TEXT,
  user_agent TEXT,
  CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id)
);
