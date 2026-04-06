-- ============================================================================
-- Migration 022: Attendance-Enrollment Student Consistency
-- ============================================================================
-- Addresses Gemini's valid point: nothing prevents attendance.student_id from
-- differing from the enrollment's student_id. This adds a trigger to enforce
-- the invariant at the database level.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TRIGGER FUNCTION: Ensure attendance.student_id matches enrollment
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enforce_attendance_student_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_enrollment_student_id UUID;
BEGIN
  SELECT student_id INTO v_enrollment_student_id
  FROM public.enrollment
  WHERE enrollment_id = NEW.enrollment_id;

  IF v_enrollment_student_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', NEW.enrollment_id;
  END IF;

  IF NEW.student_id <> v_enrollment_student_id THEN
    -- Auto-correct: set student_id to the enrollment's student_id
    -- rather than rejecting — handles bulk inserts gracefully
    NEW.student_id := v_enrollment_student_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. BIND TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_enforce_attendance_student_match ON public.attendance;
CREATE TRIGGER trg_enforce_attendance_student_match
  BEFORE INSERT OR UPDATE OF student_id, enrollment_id ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_attendance_student_match();

-- ============================================================================
-- 3. VERIFY: no existing mismatches (should return 0 rows)
-- ============================================================================

DO $$
DECLARE
  v_mismatch_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_mismatch_count
  FROM public.attendance a
  JOIN public.enrollment e ON a.enrollment_id = e.enrollment_id
  WHERE a.student_id <> e.student_id;

  IF v_mismatch_count > 0 THEN
    RAISE NOTICE 'Found % attendance rows with mismatched student_id — fixing...', v_mismatch_count;
    UPDATE public.attendance a
    SET student_id = e.student_id
    FROM public.enrollment e
    WHERE a.enrollment_id = e.enrollment_id
      AND a.student_id <> e.student_id;
  END IF;
END;
$$;

COMMIT;
