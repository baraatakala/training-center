-- ============================================================================
-- Migration 001: Add missing UNIQUE constraints for upsert operations
-- ============================================================================
-- CRITICAL FIX: The frontend uses onConflict: 'enrollment_id,attendance_date'
-- and onConflict: 'session_id,attendance_date' but these constraints did not
-- exist, causing upserts to fail or create duplicates.
-- ============================================================================

-- 1. Remove duplicate attendance records (keep the latest one per enrollment+date)
DELETE FROM public.attendance a
WHERE a.attendance_id NOT IN (
  SELECT DISTINCT ON (enrollment_id, attendance_date) attendance_id
  FROM public.attendance
  ORDER BY enrollment_id, attendance_date, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
);

-- 2. Add UNIQUE constraint on attendance (enrollment_id, attendance_date)
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_enrollment_date_unique
  UNIQUE (enrollment_id, attendance_date);

-- 3. Remove duplicate session_date_host records (keep the latest one per session+date)
DELETE FROM public.session_date_host a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (session_id, attendance_date) id
  FROM public.session_date_host
  ORDER BY session_id, attendance_date, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
);

-- 4. Add UNIQUE constraint on session_date_host (session_id, attendance_date)
ALTER TABLE public.session_date_host
  ADD CONSTRAINT session_date_host_session_date_unique
  UNIQUE (session_id, attendance_date);
