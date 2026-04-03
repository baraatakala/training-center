-- ============================================================================
-- Migration 018: Drop duplicate indexes and stale objects
-- ============================================================================
-- Audit of live Supabase indexes revealed duplicate UNIQUE indexes created
-- by automatic constraint naming alongside explicitly named constraints.
--
-- Run AFTER migration 017.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DUPLICATE UNIQUE INDEXES ON enrollment
-- ============================================================================
-- enrollment_student_id_session_id_key (student_id, session_id) ← auto-named
-- enrollment_student_session_unique    (student_id, session_id) ← canonical
-- Both are UNIQUE on the same columns. Keep the canonical one.

DROP INDEX IF EXISTS enrollment_student_id_session_id_key;

-- ============================================================================
-- 2. DUPLICATE UNIQUE INDEXES ON excuse_request
-- ============================================================================
-- excuse_request_student_id_session_id_attendance_date_key ← auto-named
-- excuse_request_student_session_date_unique               ← canonical
-- Both are UNIQUE on the same columns. Keep the canonical one.

DROP INDEX IF EXISTS excuse_request_student_id_session_id_attendance_date_key;

-- ============================================================================
-- 3. DROP stale indexes that don't match canonical definitions
-- ============================================================================
-- idx_attendance_status (status alone) was replaced by the more useful
-- idx_attendance_status_excuse (status, excuse_reason) in live DB.
-- idx_attendance_student (student_id alone) is covered by
-- idx_attendance_student_session (student_id, session_id).
-- These may or may not still exist; IF EXISTS makes this idempotent.

DROP INDEX IF EXISTS idx_attendance_status;
DROP INDEX IF EXISTS idx_attendance_student;
DROP INDEX IF EXISTS idx_enrollment_student;
DROP INDEX IF EXISTS idx_enrollment_session;
DROP INDEX IF EXISTS idx_enrollment_status;
DROP INDEX IF EXISTS idx_student_email;

-- ============================================================================
-- 4. DROP orphaned function: calculate_gps_distance
-- ============================================================================
-- Never called from frontend code. GPS distance is computed client-side
-- using the Haversine formula in the check-in components.
-- NOTE: Keep if you plan to use server-side proximity validation.
-- Uncomment to drop:
-- DROP FUNCTION IF EXISTS public.calculate_gps_distance(
--   DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
-- );

COMMIT;
