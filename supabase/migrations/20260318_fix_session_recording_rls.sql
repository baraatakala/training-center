ALTER TABLE public.session_recording ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_recording'
      AND policyname = 'Admins have full access to session recordings'
  ) THEN
    EXECUTE 'CREATE POLICY "Admins have full access to session recordings" ON public.session_recording FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_recording'
      AND policyname = 'Teachers have full access to session recordings'
  ) THEN
    EXECUTE 'CREATE POLICY "Teachers have full access to session recordings" ON public.session_recording FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_recording'
      AND policyname = 'Students can read visible session recordings'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Students can read visible session recordings"
      ON public.session_recording
      FOR SELECT
      TO authenticated
      USING (
        deleted_at IS NULL
        AND (
          recording_visibility IN ('organization', 'public_link')
          OR (
            recording_visibility IN ('enrolled_students', 'course_staff')
            AND EXISTS (
              SELECT 1
              FROM public.enrollment e
              WHERE e.session_id = session_recording.session_id
                AND e.status = 'active'
                AND e.student_id IN (
                  SELECT s.student_id
                  FROM public.student s
                  WHERE lower(s.email) = lower(auth.email())
                )
            )
          )
        )
      )
    $policy$;
  END IF;
END $$;