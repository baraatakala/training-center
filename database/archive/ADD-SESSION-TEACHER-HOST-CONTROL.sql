ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS teacher_can_host boolean DEFAULT true;

UPDATE public.session
SET teacher_can_host = true
WHERE teacher_can_host IS NULL;