-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

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
  CONSTRAINT announcement_pkey PRIMARY KEY (announcement_id),
  CONSTRAINT announcement_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.teacher(teacher_id),
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
CREATE TABLE public.course (
  course_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id uuid,
  course_name character varying NOT NULL,
  category character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
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
  CONSTRAINT course_book_reference_pkey PRIMARY KEY (reference_id),
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
  sender_type character varying NOT NULL CHECK (sender_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
  sender_id uuid NOT NULL,
  recipient_type character varying NOT NULL CHECK (recipient_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
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
  reactor_type character varying NOT NULL CHECK (reactor_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
  reactor_id uuid NOT NULL,
  emoji character varying NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT message_reaction_pkey PRIMARY KEY (reaction_id),
  CONSTRAINT message_reaction_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.message_starred (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL,
  user_type character varying NOT NULL CHECK (user_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT message_starred_pkey PRIMARY KEY (id),
  CONSTRAINT message_starred_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.message(message_id)
);
CREATE TABLE public.notification_preference (
  preference_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_type character varying NOT NULL CHECK (user_type::text = ANY (ARRAY['teacher'::character varying, 'student'::character varying]::text[])),
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