-- ============================================================
-- Data Integrity Cleanup Migration
-- 2026-03-23: Fix orphaned data, expired tokens, feedback integrity
-- ============================================================

-- 1. Invalidate all expired QR tokens still marked as valid
UPDATE public.qr_sessions
SET is_valid = false
WHERE is_valid = true
  AND expires_at < NOW();

-- 2. Invalidate all expired photo check-in tokens still marked as valid
UPDATE public.photo_checkin_sessions
SET is_valid = false
WHERE is_valid = true
  AND expires_at < NOW();

-- 3. Clean up orphaned feedback for "session not held" dates
-- These are feedback rows where the attendance was later marked as session not held
DELETE FROM public.session_feedback sf
WHERE EXISTS (
  SELECT 1 FROM public.attendance a
  WHERE a.session_id = sf.session_id
    AND a.attendance_date = sf.attendance_date
    AND a.student_id = sf.student_id
    AND (a.host_address = 'SESSION_NOT_HELD' OR a.excuse_reason = 'session not held')
);

-- 4. Clean up orphaned feedback where no matching attendance exists at all
-- (student has no attendance record for that session+date)
DELETE FROM public.session_feedback sf
WHERE sf.student_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.session_id = sf.session_id
      AND a.attendance_date = sf.attendance_date
      AND a.student_id = sf.student_id
      AND a.status IN ('on time', 'late')
  );

-- 5. Soft-delete recording links for dates marked as "session not held"
UPDATE public.session_recording sr
SET deleted_at = NOW(), is_primary = false
WHERE deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.session_date_host sdh
    WHERE sdh.session_id = sr.session_id
      AND sdh.attendance_date = sr.attendance_date
      AND sdh.host_address = 'SESSION_NOT_HELD'
  );

-- 6. Add a comment documenting the data flow expectations
COMMENT ON TABLE public.session_feedback IS 'Student feedback submissions. Rows should only exist when the student has on-time/late attendance for the same session+date. Cleaned up when session is marked not held.';
COMMENT ON TABLE public.session_recording IS 'Recording links per session date. Soft-deleted (deleted_at) when removed. Auto-cleaned when session date marked not held.';
