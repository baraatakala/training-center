-- =====================================================
-- SESSION DELIVERY, RECORDINGS, COURSE DESCRIPTION,
-- TEACHER SPECIALIZATION, AND CERTIFICATE SIGNER FOUNDATION
-- =====================================================

-- 1. SESSION DELIVERY METADATA
ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS learning_method TEXT DEFAULT 'face_to_face',
  ADD COLUMN IF NOT EXISTS virtual_provider TEXT,
  ADD COLUMN IF NOT EXISTS virtual_meeting_link TEXT,
  ADD COLUMN IF NOT EXISTS requires_recording BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_recording_visibility TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_learning_method_check'
  ) THEN
    ALTER TABLE public.session
      ADD CONSTRAINT session_learning_method_check
      CHECK (learning_method IN ('face_to_face', 'online', 'hybrid'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_virtual_provider_check'
  ) THEN
    ALTER TABLE public.session
      ADD CONSTRAINT session_virtual_provider_check
      CHECK (
        virtual_provider IS NULL
        OR virtual_provider IN ('zoom', 'google_meet', 'microsoft_teams', 'other')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_recording_visibility_check'
  ) THEN
    ALTER TABLE public.session
      ADD CONSTRAINT session_recording_visibility_check
      CHECK (
        default_recording_visibility IS NULL
        OR default_recording_visibility IN ('private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_virtual_link_requirement_check'
  ) THEN
    ALTER TABLE public.session
      ADD CONSTRAINT session_virtual_link_requirement_check
      CHECK (
        (learning_method = 'face_to_face' AND virtual_meeting_link IS NULL AND virtual_provider IS NULL)
        OR learning_method IN ('online', 'hybrid')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_session_learning_method ON public.session(learning_method);

-- 2. TEACHER SPECIALIZATION
ALTER TABLE public.teacher
  ADD COLUMN IF NOT EXISTS specialization VARCHAR(150);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_specialization_length_check'
  ) THEN
    ALTER TABLE public.teacher
      ADD CONSTRAINT teacher_specialization_length_check
      CHECK (specialization IS NULL OR char_length(trim(specialization)) BETWEEN 2 AND 150);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teacher_specialization ON public.teacher(specialization);

-- 3. COURSE DESCRIPTION
ALTER TABLE public.course
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS description_format TEXT DEFAULT 'markdown',
  ADD COLUMN IF NOT EXISTS description_updated_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_description_length_check'
  ) THEN
    ALTER TABLE public.course
      ADD CONSTRAINT course_description_length_check
      CHECK (description IS NULL OR char_length(description) <= 6000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_description_format_check'
  ) THEN
    ALTER TABLE public.course
      ADD CONSTRAINT course_description_format_check
      CHECK (description_format IN ('markdown', 'plain_text'));
  END IF;
END $$;

-- 4. SESSION RECORDINGS
CREATE TABLE IF NOT EXISTS public.session_recording (
  recording_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date DATE,
  recording_type TEXT NOT NULL,
  recording_url TEXT,
  recording_storage_location TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  recording_uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recording_visibility TEXT NOT NULL DEFAULT 'course_staff',
  title VARCHAR(200),
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  mime_type VARCHAR(120),
  provider_name TEXT,
  provider_recording_id TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT session_recording_type_check CHECK (
    recording_type IN ('zoom_recording', 'google_meet_recording', 'teacher_mobile_recording', 'uploaded_recording', 'external_stream')
  ),
  CONSTRAINT session_recording_storage_location_check CHECK (
    recording_storage_location IN ('supabase_storage', 'external_link', 'streaming_link', 'provider_managed')
  ),
  CONSTRAINT session_recording_visibility_check CHECK (
    recording_visibility IN ('private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link')
  ),
  CONSTRAINT session_recording_duration_check CHECK (
    duration_seconds IS NULL OR duration_seconds >= 0
  ),
  CONSTRAINT session_recording_file_size_check CHECK (
    file_size_bytes IS NULL OR file_size_bytes >= 0
  ),
  CONSTRAINT session_recording_storage_fields_check CHECK (
    (
      recording_storage_location = 'supabase_storage'
      AND storage_bucket IS NOT NULL
      AND storage_path IS NOT NULL
    )
    OR (
      recording_storage_location <> 'supabase_storage'
      AND (recording_url IS NOT NULL OR provider_recording_id IS NOT NULL)
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_session_recording_session_date ON public.session_recording(session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_session_recording_visibility ON public.session_recording(recording_visibility);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_recording_primary_per_date
  ON public.session_recording(session_id, attendance_date)
  WHERE is_primary = TRUE AND deleted_at IS NULL;

ALTER TABLE public.session_recording ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_recording'
      AND policyname = 'Teachers have full access'
  ) THEN
    EXECUTE 'CREATE POLICY "Teachers have full access" ON public.session_recording FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
  END IF;
END $$;

-- 5. CERTIFICATE SIGNER SNAPSHOT
ALTER TABLE public.issued_certificate
  ADD COLUMN IF NOT EXISTS signer_teacher_id UUID REFERENCES public.teacher(teacher_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signer_source TEXT DEFAULT 'template_default',
  ADD COLUMN IF NOT EXISTS signer_title_snapshot TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issued_certificate_signer_source_check'
  ) THEN
    ALTER TABLE public.issued_certificate
      ADD CONSTRAINT issued_certificate_signer_source_check
      CHECK (signer_source IN ('teacher_specialization', 'template_default', 'manual_override'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_issued_certificate_signer_teacher ON public.issued_certificate(signer_teacher_id);

-- 6. UPDATE TIMESTAMPS FOR NEW EDITABLE TABLES
DROP TRIGGER IF EXISTS update_session_recording_updated_at ON public.session_recording;
CREATE TRIGGER update_session_recording_updated_at
  BEFORE UPDATE ON public.session_recording
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();