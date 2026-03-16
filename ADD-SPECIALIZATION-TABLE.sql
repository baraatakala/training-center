-- ============================================================
-- Create a managed specialization lookup table so admins can
-- add / rename / remove specializations from the UI instead
-- of touching SQL constraints.
-- ============================================================

-- 1. Create the lookup table
CREATE TABLE IF NOT EXISTS public.specialization (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 2. Enable RLS (teacher-only write, everyone can read)
ALTER TABLE public.specialization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read specializations"
  ON public.specialization FOR SELECT
  USING (true);

CREATE POLICY "Teachers and admins can manage specializations"
  ON public.specialization FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR
    EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR
    EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

-- 3. Seed with sensible defaults (skip duplicates)
INSERT INTO public.specialization (name) VALUES
  ('Computer Science'),
  ('Engineering'),
  ('Business'),
  ('Medicine'),
  ('Law'),
  ('Arts'),
  ('Science'),
  ('Education')
ON CONFLICT (name) DO NOTHING;

-- 4. Drop the old CHECK constraint on student.specialization
--    so the column accepts any value managed via the table.
ALTER TABLE public.student
  DROP CONSTRAINT IF EXISTS student_specialization_check;

-- 5. Keep the index for fast analytics grouping
CREATE INDEX IF NOT EXISTS idx_student_specialization
  ON public.student (specialization);
