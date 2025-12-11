-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.attendance (
  attendance_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status character varying DEFAULT 'absent'::character varying,
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
CREATE TABLE public.enrollment (
  enrollment_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL,
  session_id uuid NOT NULL,
  enrollment_date date NOT NULL DEFAULT CURRENT_DATE,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  can_host boolean NOT NULL DEFAULT false,
  host_date date,
  CONSTRAINT enrollment_pkey PRIMARY KEY (enrollment_id),
  CONSTRAINT enrollment_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id),
  CONSTRAINT enrollment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(session_id)
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
  CONSTRAINT session_pkey PRIMARY KEY (session_id),
  CONSTRAINT session_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(course_id),
  CONSTRAINT session_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);
CREATE TABLE public.student (
  student_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  teacher_id uuid,
  name character varying NOT NULL,
  phone character varying,
  email character varying NOT NULL UNIQUE,
  address text,
  nationality character varying,
  age integer CHECK (age > 0 AND age < 150),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  location text,
  CONSTRAINT student_pkey PRIMARY KEY (student_id),
  CONSTRAINT student_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teacher(teacher_id)
);
CREATE TABLE public.teacher (
  teacher_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name character varying NOT NULL,
  phone character varying,
  email character varying NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT teacher_pkey PRIMARY KEY (teacher_id)
);