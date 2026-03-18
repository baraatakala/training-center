-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admin (
  admin_id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Admin'::text,
  auth_user_id uuid UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_pkey PRIMARY KEY (admin_id)
);
CREATE TABLE public.announcement (
  announcement_id uuid NOT NULL DEFAULT gen_random_uuid(),
  title character varying NOT NULL,
  content text NOT NULL,
  priority character varying DEFAULT 'normal'::character varying CHECK (priority::text = ANY (ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying]::text[])),
  created_by uuid NOT NULL,
  course_id uuid,
  is_pinned boolean DEFAULT false,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  category character varying DEFAULT 'general'::character varying,
  attachments jsonb DEFAULT '[]'::jsonb,
  view_count integer DEFAULT 0,
  image_url text,
  creator_type text DEFAULT 'teacher'::text,
  CONSTRAINT announcement_pkey PRIMARY KEY (announcement_id),
  CONSTRAINT announcement_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id)
);
CREATE TABLE public.announcement_comment (
  comment_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  announcement_id uuid NOT NULL,
  commenter_type character varying NOT NULL CHECK (commenter_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
  commenter_id uuid NOT NULL,
  content text NOT NULL,
  parent_comment_id uuid,
  is_pinned boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT announcement_comment_pkey PRIMARY KEY (comment_id),
  CONSTRAINT announcement_comment_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_comment_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.announcement_comment(comment_id)
);
CREATE TABLE public.announcement_reaction (
  reaction_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  announcement_id uuid NOT NULL,
  student_id uuid NOT NULL,
  emoji character varying NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT announcement_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT announcement_reaction_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_reaction_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);
CREATE TABLE public.announcement_read (
  read_id uuid NOT NULL DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL,
  student_id uuid NOT NULL,
  read_at timestamp with time zone DEFAULT now(),
  CONSTRAINT announcement_read_pkey PRIMARY KEY (read_id),
  CONSTRAINT announcement_read_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id),
  CONSTRAINT announcement_read_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);
CREATE TABLE public.attendance (
  attendance_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status character varying DEFAULT 'absent'::character varying CHECK (status::text = ANY (ARRAY['on time'::character varying, 'absent'::character varying, 'late'::character varying, 'excused'::character varying, 'not enrolled'::character varying]::text[])),
  check_in_time timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  gps_latitude numeric,
  gps_longitude numeric,
  gps_accuracy numeric,
  gps_timestamp timestamp with time zone,
  excuse_reason character varying,
  session_id uuid,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  marked_by text,
  marked_at timestamp with time zone,
  host_address text,
  late_minutes integer,
  check_in_method character varying DEFAULT NULL::character varying,
  distance_from_host numeric DEFAULT NULL::numeric,
  early_minutes integer,
  CONSTRAINT attendance_pkey PRIMARY KEY (attendance_id),
  CONSTRAINT attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(enrollment_id),
  CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.audit_log (
  audit_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL CHECK (operation = ANY (ARRAY['DELETE'::text, 'UPDATE'::text, 'INSERT'::text])),
  old_data jsonb,
  new_data jsonb,
  deleted_by text,
  deleted_at timestamp with time zone DEFAULT now(),
  reason text,
  changed_at timestamp with time zone DEFAULT now(),
  changed_by uuid,
  ip_address text,
  user_agent text,
  CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id)
);
CREATE TABLE public.certificate_template (
  template_id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  template_type text NOT NULL DEFAULT 'completion'::text CHECK (template_type = ANY (ARRAY['completion'::text, 'attendance'::text, 'achievement'::text, 'participation'::text])),
  min_score numeric DEFAULT 0,
  min_attendance numeric DEFAULT 0,
  style_config jsonb DEFAULT '{"font_family": "serif", "orientation": "landscape", "accent_color": "#1e40af", "border_style": "classic", "background_color": "#ffffff"}'::jsonb,
  body_template text DEFAULT 'This is to certify that {{name}} has successfully completed the course "{{course}}" with a score of {{score}}%.'::text,
  signature_name text,
  signature_title text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT certificate_template_pkey PRIMARY KEY (template_id)
);
CREATE TABLE public.course (
  course_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id uuid,
  course_name character varying NOT NULL,
  category character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  description text CHECK (description IS NULL OR char_length(description) <= 6000),
  description_format text DEFAULT 'markdown'::text CHECK (description_format = ANY (ARRAY['markdown'::text, 'plain_text'::text])),
  description_updated_at timestamp with time zone,
  CONSTRAINT course_pkey PRIMARY KEY (course_id),
  CONSTRAINT course_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);
CREATE TABLE public.course_book_reference (
  reference_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL,
  topic text NOT NULL,
  start_page integer NOT NULL CHECK (start_page > 0),
  end_page integer NOT NULL,
  display_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  parent_id uuid,
  CONSTRAINT course_book_reference_pkey PRIMARY KEY (reference_id),
  CONSTRAINT course_book_reference_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.course_book_reference(reference_id),
  CONSTRAINT course_book_reference_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id)
);
CREATE TABLE public.enrollment (
  enrollment_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL,
  session_id uuid NOT NULL,
  enrollment_date date NOT NULL DEFAULT CURRENT_DATE,
  status character varying DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['active'::character varying, 'completed'::character varying, 'dropped'::character varying, 'pending'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  can_host boolean NOT NULL DEFAULT false,
  host_date date,
  CONSTRAINT enrollment_pkey PRIMARY KEY (enrollment_id),
  CONSTRAINT enrollment_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT enrollment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.excuse_request (
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  reason text NOT NULL,
  description text,
  supporting_doc_url text,
  supporting_doc_name text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])),
  reviewed_by text,
  reviewed_at timestamp with time zone,
  review_note text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT excuse_request_pkey PRIMARY KEY (request_id),
  CONSTRAINT excuse_request_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT excuse_request_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.feedback_question (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'rating'::text CHECK (question_type = ANY (ARRAY['rating'::text, 'text'::text, 'emoji'::text, 'multiple_choice'::text])),
  options jsonb DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT feedback_question_pkey PRIMARY KEY (id),
  CONSTRAINT feedback_question_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.feedback_template (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT feedback_template_pkey PRIMARY KEY (id)
);
CREATE TABLE public.issued_certificate (
  certificate_id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  student_id uuid NOT NULL,
  session_id uuid,
  course_id uuid,
  certificate_number text NOT NULL UNIQUE,
  verification_code text NOT NULL UNIQUE,
  final_score numeric,
  attendance_rate numeric,
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'issued'::text, 'revoked'::text])),
  issued_by text,
  issued_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoke_reason text,
  resolved_body text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  signature_name text,
  signature_title text,
  signer_teacher_id uuid,
  signer_source text DEFAULT 'template_default'::text CHECK (signer_source = ANY (ARRAY['teacher_specialization'::text, 'template_default'::text, 'manual_override'::text])),
  signer_title_snapshot text,
  CONSTRAINT issued_certificate_pkey PRIMARY KEY (certificate_id),
  CONSTRAINT issued_certificate_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.certificate_template(template_id),
  CONSTRAINT issued_certificate_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT issued_certificate_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT issued_certificate_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id),
  CONSTRAINT issued_certificate_signer_teacher_id_fkey FOREIGN KEY (signer_teacher_id) REFERENCES public.teacher(teacher_id)
);
CREATE TABLE public.late_brackets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid,
  min_minutes integer NOT NULL,
  max_minutes integer,
  bracket_name character varying NOT NULL,
  bracket_name_ar character varying,
  score_weight numeric NOT NULL CHECK (score_weight >= 0::numeric AND score_weight <= 1::numeric),
  display_color character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT late_brackets_pkey PRIMARY KEY (id),
  CONSTRAINT late_brackets_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.message (
  message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_type character varying NOT NULL CHECK (sender_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying, 'admin'::character varying]::text[])),
  sender_id uuid NOT NULL,
  recipient_type character varying NOT NULL CHECK (recipient_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying, 'admin'::character varying]::text[])),
  recipient_id uuid NOT NULL,
  subject character varying,
  content text NOT NULL,
  is_read boolean DEFAULT false,
  read_at timestamp with time zone,
  parent_message_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  delivered_at timestamp with time zone,
  is_starred boolean DEFAULT false,
  CONSTRAINT message_pkey PRIMARY KEY (message_id),
  CONSTRAINT message_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.message_attachment (
  attachment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  file_name character varying NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  file_type character varying,
  uploaded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT message_attachment_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT message_attachment_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.message_reaction (
  reaction_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL,
  reactor_type character varying NOT NULL CHECK (reactor_type::text = ANY (ARRAY['teacher'::text, 'student'::text, 'admin'::text])),
  reactor_id uuid NOT NULL,
  emoji character varying NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT message_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT message_reaction_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.message_starred (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL,
  user_type character varying NOT NULL CHECK (user_type::text = ANY (ARRAY['teacher'::text, 'student'::text, 'admin'::text])),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT message_starred_pkey PRIMARY KEY (id),
  CONSTRAINT message_starred_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.notification_preference (
  preference_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_type character varying NOT NULL CHECK (user_type::text = ANY (ARRAY['teacher'::text, 'student'::text, 'admin'::text])),
  user_id uuid NOT NULL,
  email_announcements boolean DEFAULT true,
  email_messages boolean DEFAULT true,
  push_announcements boolean DEFAULT true,
  push_messages boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_preference_pkey PRIMARY KEY (preference_id)
);
CREATE TABLE public.photo_checkin_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  is_valid boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT photo_checkin_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT photo_checkin_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.qr_sessions (
  qr_session_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  token uuid NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
  session_id uuid NOT NULL,
  attendance_date date NOT NULL CHECK (attendance_date IS NOT NULL),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone,
  created_by text,
  CONSTRAINT qr_sessions_pkey PRIMARY KEY (qr_session_id),
  CONSTRAINT qr_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.scoring_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  config_name text NOT NULL DEFAULT 'Default Scoring'::text,
  is_default boolean NOT NULL DEFAULT true,
  weight_quality numeric NOT NULL DEFAULT 55.00,
  weight_attendance numeric NOT NULL DEFAULT 35.00,
  weight_punctuality numeric NOT NULL DEFAULT 10.00,
  late_decay_constant numeric NOT NULL DEFAULT 43.30,
  late_minimum_credit numeric NOT NULL DEFAULT 0.050,
  late_null_estimate numeric NOT NULL DEFAULT 0.600,
  coverage_enabled boolean NOT NULL DEFAULT true,
  coverage_method text NOT NULL DEFAULT 'sqrt'::text CHECK (coverage_method = ANY (ARRAY['sqrt'::text, 'linear'::text, 'log'::text, 'none'::text])),
  coverage_minimum numeric NOT NULL DEFAULT 0.100,
  late_brackets jsonb NOT NULL DEFAULT '[{"id": "1", "max": 5, "min": 1, "name": "Minor", "color": "bg-green-100 text-green-800"}, {"id": "2", "max": 15, "min": 6, "name": "Moderate", "color": "bg-yellow-100 text-yellow-800"}, {"id": "3", "max": 30, "min": 16, "name": "Significant", "color": "bg-orange-100 text-orange-800"}, {"id": "4", "max": 60, "min": 31, "name": "Severe", "color": "bg-red-100 text-red-800"}, {"id": "5", "max": 999, "min": 61, "name": "Very Late", "color": "bg-red-200 text-red-900"}]'::jsonb,
  perfect_attendance_bonus numeric NOT NULL DEFAULT 0.00,
  streak_bonus_per_week numeric NOT NULL DEFAULT 0.00,
  absence_penalty_multiplier numeric NOT NULL DEFAULT 1.00,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scoring_config_pkey PRIMARY KEY (id),
  CONSTRAINT scoring_config_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES auth.users(id)
);
CREATE TABLE public.session (
  session_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  day character varying,
  time character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  location text,
  grace_period_minutes integer DEFAULT 15 CHECK (grace_period_minutes >= 0 AND grace_period_minutes <= 60),
  proximity_radius integer DEFAULT 50,
  learning_method text DEFAULT 'face_to_face'::text CHECK (learning_method = ANY (ARRAY['face_to_face'::text, 'online'::text, 'hybrid'::text])),
  virtual_provider text CHECK (virtual_provider IS NULL OR (virtual_provider = ANY (ARRAY['zoom'::text, 'google_meet'::text, 'microsoft_teams'::text, 'other'::text]))),
  virtual_meeting_link text,
  requires_recording boolean NOT NULL DEFAULT false,
  default_recording_visibility text CHECK (default_recording_visibility IS NULL OR (default_recording_visibility = ANY (ARRAY['private_staff'::text, 'course_staff'::text, 'enrolled_students'::text, 'organization'::text, 'public_link'::text]))),
  feedback_enabled boolean DEFAULT false,
  feedback_anonymous_allowed boolean DEFAULT true,
  teacher_can_host boolean DEFAULT true,
  CONSTRAINT session_pkey PRIMARY KEY (session_id),
  CONSTRAINT session_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id),
  CONSTRAINT session_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);
CREATE TABLE public.session_book_coverage (
  coverage_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  reference_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT session_book_coverage_pkey PRIMARY KEY (coverage_id),
  CONSTRAINT session_book_coverage_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_book_coverage_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES public.course_book_reference(reference_id)
);
CREATE TABLE public.session_date_host (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  host_id uuid,
  host_type character varying DEFAULT 'student'::character varying,
  host_address text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  host_latitude numeric CHECK (host_latitude IS NULL OR host_latitude >= '-90'::integer::numeric AND host_latitude <= 90::numeric),
  host_longitude numeric CHECK (host_longitude IS NULL OR host_longitude >= '-180'::integer::numeric AND host_longitude <= 180::numeric),
  CONSTRAINT session_date_host_pkey PRIMARY KEY (id),
  CONSTRAINT session_date_host_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.session_day_change (
  change_id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  old_day text,
  new_day text NOT NULL,
  effective_date date NOT NULL,
  reason text,
  changed_by text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT session_day_change_pkey PRIMARY KEY (change_id),
  CONSTRAINT session_day_change_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);
CREATE TABLE public.session_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  attendance_date date NOT NULL,
  student_id uuid,
  is_anonymous boolean DEFAULT false,
  overall_rating integer CHECK (overall_rating >= 1 AND overall_rating <= 5),
  comment text,
  responses jsonb DEFAULT '{}'::jsonb,
  check_in_method text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT session_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT session_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_feedback_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id)
);
CREATE TABLE public.session_recording (
  recording_id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  attendance_date date,
  recording_type text NOT NULL CHECK (recording_type = ANY (ARRAY['zoom_recording'::text, 'google_meet_recording'::text, 'teacher_mobile_recording'::text, 'uploaded_recording'::text, 'external_stream'::text])),
  recording_url text,
  recording_storage_location text NOT NULL CHECK (recording_storage_location = ANY (ARRAY['supabase_storage'::text, 'external_link'::text, 'streaming_link'::text, 'provider_managed'::text])),
  storage_bucket text,
  storage_path text,
  recording_uploaded_by uuid,
  recording_visibility text NOT NULL DEFAULT 'course_staff'::text CHECK (recording_visibility = ANY (ARRAY['private_staff'::text, 'course_staff'::text, 'enrolled_students'::text, 'organization'::text, 'public_link'::text])),
  title character varying,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  mime_type character varying,
  provider_name text,
  provider_recording_id text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT session_recording_pkey PRIMARY KEY (recording_id),
  CONSTRAINT session_recording_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id),
  CONSTRAINT session_recording_recording_uploaded_by_fkey FOREIGN KEY (recording_uploaded_by) REFERENCES auth.users(id)
);
CREATE TABLE public.specialization (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT specialization_pkey PRIMARY KEY (id)
);
CREATE TABLE public.student (
  student_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name character varying NOT NULL,
  phone character varying,
  email character varying NOT NULL UNIQUE,
  address text,
  nationality character varying,
  age integer CHECK (age > 0 AND age < 150),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  location text,
  photo_url text,
  address_latitude numeric CHECK (address_latitude IS NULL OR address_latitude >= '-90'::integer::numeric AND address_latitude <= 90::numeric),
  address_longitude numeric CHECK (address_longitude IS NULL OR address_longitude >= '-180'::integer::numeric AND address_longitude <= 180::numeric),
  specialization text,
  CONSTRAINT student_pkey PRIMARY KEY (student_id)
);
CREATE TABLE public.teacher (
  teacher_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name character varying NOT NULL,
  phone character varying,
  email character varying NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  address text,
  address_latitude numeric CHECK (address_latitude IS NULL OR address_latitude >= '-90'::integer::numeric AND address_latitude <= 90::numeric),
  address_longitude numeric CHECK (address_longitude IS NULL OR address_longitude >= '-180'::integer::numeric AND address_longitude <= 180::numeric),
  specialization character varying CHECK (specialization IS NULL OR char_length(TRIM(BOTH FROM specialization)) >= 2 AND char_length(TRIM(BOTH FROM specialization)) <= 150),
  CONSTRAINT teacher_pkey PRIMARY KEY (teacher_id)
);
CREATE TABLE public.teacher_host_schedule (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id uuid NOT NULL,
  session_id uuid NOT NULL,
  host_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT teacher_host_schedule_pkey PRIMARY KEY (id),
  CONSTRAINT teacher_host_schedule_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id),
  CONSTRAINT teacher_host_schedule_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
);