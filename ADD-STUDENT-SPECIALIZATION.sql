ALTER TABLE public.student
ADD COLUMN IF NOT EXISTS specialization text;

ALTER TABLE public.student
DROP CONSTRAINT IF EXISTS student_specialization_check;

ALTER TABLE public.student
ADD CONSTRAINT student_specialization_check CHECK (
  specialization IS NULL OR specialization IN (
    'Computer Science',
    'Engineering',
    'Business',
    'Medicine',
    'Law',
    'Arts',
    'Science',
    'Education'
  )
);

CREATE INDEX IF NOT EXISTS idx_student_specialization
ON public.student (specialization);

COMMENT ON COLUMN public.student.specialization IS 'Constrained university specialization used for analytics, segmentation, and reporting.';