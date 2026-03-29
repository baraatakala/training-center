-- ============================================================================
-- Migration 003: Clean up duplicate/redundant indexes + recording RLS
-- ============================================================================
-- Run this ONCE on Supabase to remove ~21 duplicate indexes left behind by
-- archived migration files, and add the missing recording read policy.
--
-- WHY: Each redundant index wastes disk space and slows every INSERT/UPDATE.
--      The canonical index definitions are in database/indexes.sql.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: DROP DUPLICATE/REDUNDANT INDEXES
-- ============================================================================
-- Legend:
--   [DUPLICATE]  = exact same columns as another index
--   [REDUNDANT]  = leading columns already covered by a composite index
--   [ORPHAN]     = created by old migration, not in indexes.sql

-- --------------------------------------------------------------------------
-- attendance (3 duplicates)
-- --------------------------------------------------------------------------
-- attendance_enrollment_date_unique (enrollment_id, attendance_date) UNIQUE ← KEEP
-- idx_attendance_enrollment_date (enrollment_id, attendance_date) ← DUPLICATE
-- idx_attendance_enrollment_date_unique (enrollment_id, attendance_date) ← DUPLICATE
-- attendance_enrollment_session_date_idx (enrollment_id, session_id, attendance_date) ← ORPHAN from old migration

DROP INDEX IF EXISTS idx_attendance_enrollment_date;
DROP INDEX IF EXISTS idx_attendance_enrollment_date_unique;
DROP INDEX IF EXISTS attendance_enrollment_session_date_idx;

-- idx_attendance_enrollment(enrollment_id) is redundant — already the leading
-- column in attendance_enrollment_date_unique
DROP INDEX IF EXISTS idx_attendance_enrollment;

-- idx_attendance_session(session_id) — ORPHAN, not in indexes.sql.
-- idx_attendance_session_date(session_id, attendance_date) already covers it.
DROP INDEX IF EXISTS idx_attendance_session;

-- idx_attendance_date(attendance_date) — single-column on high-cardinality date.
-- Covered by idx_attendance_session_date and idx_attendance_student_date.
DROP INDEX IF EXISTS idx_attendance_date;

-- idx_attendance_check_in_method — low selectivity, rarely queried alone
DROP INDEX IF EXISTS idx_attendance_check_in_method;

-- idx_attendance_distance_from_host — rarely queried, GPS analytics don't
-- filter by distance alone
DROP INDEX IF EXISTS idx_attendance_distance_from_host;

-- idx_attendance_gps — (lat, lon) composite is useless for geo queries
-- (PostGIS point index needed for real geo, this is dead weight)
DROP INDEX IF EXISTS idx_attendance_gps;

-- idx_attendance_excuse_reason — low selectivity text, covered by
-- idx_attendance_status_excuse(status, excuse_reason)
DROP INDEX IF EXISTS idx_attendance_excuse_reason;

-- idx_attendance_marked_by — rarely queried, audit log covers this
DROP INDEX IF EXISTS idx_attendance_marked_by;

-- idx_attendance_student_date(student_id, attendance_date) — ORPHAN.
-- KEEP — used by excuse request + student-level date lookups
-- idx_attendance_status_excuse(status, excuse_reason) — KEEP for filtered queries

-- --------------------------------------------------------------------------
-- audit_log (4 duplicates)
-- --------------------------------------------------------------------------
-- idx_audit_log_record(record_id) and idx_audit_log_record_id(record_id) ← DUPLICATE
DROP INDEX IF EXISTS idx_audit_log_record_id;

-- idx_audit_log_table(table_name) and idx_audit_log_table_name(table_name) ← DUPLICATE
-- Also redundant: idx_audit_log_table_changed(table_name, changed_at) covers table_name
DROP INDEX IF EXISTS idx_audit_log_table_name;

-- --------------------------------------------------------------------------
-- photo_checkin_sessions (4 duplicates)
-- --------------------------------------------------------------------------
-- 3 identical (session_id, attendance_date) indexes — keep only one
DROP INDEX IF EXISTS idx_photo_checkin_session_date;
DROP INDEX IF EXISTS idx_photo_checkin_sessions_session;

-- 2 duplicate token indexes + the UNIQUE constraint key — keep only UNIQUE
DROP INDEX IF EXISTS idx_photo_checkin_sessions_token;
-- idx_photo_checkin_token stays (for partial-index WHERE is_valid queries in code)
-- photo_checkin_sessions_token_key stays (UNIQUE constraint)

-- --------------------------------------------------------------------------
-- session_book_coverage (2 duplicates)
-- --------------------------------------------------------------------------
-- idx_session_book_coverage_session(session_id) and
-- idx_session_book_coverage_session_id(session_id) ← DUPLICATE
DROP INDEX IF EXISTS idx_session_book_coverage_session_id;

-- idx_session_book_coverage_date(session_id, attendance_date) duplicates
-- the UNIQUE constraint session_book_coverage_session_id_attendance_date_key
DROP INDEX IF EXISTS idx_session_book_coverage_date;

-- --------------------------------------------------------------------------
-- session_date_host (3 duplicates)
-- --------------------------------------------------------------------------
-- 3 indexes on (session_id, attendance_date):
--   idx_session_date_host_session_date
--   idx_session_date_host_session_date_unique
--   session_date_host_session_id_attendance_date_key (UNIQUE constraint)
-- Keep only the UNIQUE constraint key
DROP INDEX IF EXISTS idx_session_date_host_session_date;
DROP INDEX IF EXISTS idx_session_date_host_session_date_unique;

-- idx_session_date_host_session_id(session_id) — redundant, covered by
-- the UNIQUE composite above
DROP INDEX IF EXISTS idx_session_date_host_session_id;

-- idx_session_date_host_coordinates(lat, lon) — same issue as attendance GPS
DROP INDEX IF EXISTS idx_session_date_host_coordinates;

-- --------------------------------------------------------------------------
-- session_recording (1 duplicate)
-- --------------------------------------------------------------------------
-- idx_session_recording_session_date(session_id, attendance_date) duplicates
-- idx_session_recording_primary_per_date (partial UNIQUE on same columns)
-- Keep both: the regular one is for general lookups, the partial unique
-- enforces is_primary constraint. Actually the regular one is redundant —
-- the partial unique IS an index that PostgreSQL uses for non-partial scans too.
-- But partial unique only covers WHERE is_primary = true AND deleted_at IS NULL,
-- so general queries need the regular index.
-- KEEP BOTH — no action needed.

-- --------------------------------------------------------------------------
-- session_feedback (2 duplicates)
-- --------------------------------------------------------------------------
-- 3 indexes on (session_id, attendance_date, student_id):
--   idx_session_feedback_student_session_date_unique
--   idx_session_feedback_unique_non_anonymous
--   session_feedback_session_id_attendance_date_student_id_key (UNIQUE constraint)
DROP INDEX IF EXISTS idx_session_feedback_student_session_date_unique;
DROP INDEX IF EXISTS idx_session_feedback_unique_non_anonymous;

-- --------------------------------------------------------------------------
-- qr_sessions (1 duplicate)
-- --------------------------------------------------------------------------
-- idx_qr_sessions_token(token) duplicates qr_sessions_token_key (UNIQUE)
-- Our indexes.sql has a partial index WHERE is_valid = true — keep ours
-- But the Supabase one is not partial, so drop it if it's just a plain copy
DROP INDEX IF EXISTS idx_qr_sessions_check_in_mode;
DROP INDEX IF EXISTS idx_qr_sessions_created_by;

-- --------------------------------------------------------------------------
-- announcement_read (2 duplicates)
-- --------------------------------------------------------------------------
-- idx_announcement_read_ann_student(announcement_id, student_id) duplicates
-- announcement_read_announcement_id_student_id_key (UNIQUE constraint)
DROP INDEX IF EXISTS idx_announcement_read_ann_student;

-- idx_announcement_read_announcement(announcement_id) — redundant, leading
-- column in the UNIQUE composite above
DROP INDEX IF EXISTS idx_announcement_read_announcement;

-- --------------------------------------------------------------------------
-- enrollment (1 redundant)
-- --------------------------------------------------------------------------
-- idx_enrollment_can_host(session_id) — misleading name in Supabase.
-- Our indexes.sql defines it as: can_host WHERE can_host = true
-- The Supabase version is just session_id with no partial filter — useless
-- because idx_enrollment_session_canhost(session_id, can_host) covers it.
-- SAFE TO DROP only if the Supabase version is plain session_id.
-- Being conservative — skip this one.

-- idx_enrollment_session_student(session_id, student_id) duplicates
-- enrollment_student_id_session_id_key(student_id, session_id) but column
-- order differs. Both useful for different query patterns. KEEP BOTH.

-- idx_enrollment_host_date(host_date) — ORPHAN, not in indexes.sql.
-- host_date queries are rare and go through session_date_host instead.
DROP INDEX IF EXISTS idx_enrollment_host_date;

-- --------------------------------------------------------------------------
-- issued_certificate (2 duplicates)
-- --------------------------------------------------------------------------
-- idx_issued_cert_number(certificate_number) duplicates
-- issued_certificate_certificate_number_key (UNIQUE constraint)
DROP INDEX IF EXISTS idx_issued_cert_number;

-- idx_issued_cert_verification(verification_code) duplicates
-- issued_certificate_verification_code_key (UNIQUE constraint)
DROP INDEX IF EXISTS idx_issued_cert_verification;

-- idx_issued_certificate_signer_teacher(signer_teacher_id) — ORPHAN from old
-- migration, not in indexes.sql. Low selectivity. 
DROP INDEX IF EXISTS idx_issued_certificate_signer_teacher;

-- --------------------------------------------------------------------------
-- feedback_question (1 orphan)
-- --------------------------------------------------------------------------
-- idx_feedback_question_unique_global(session_id, question_text) — ORPHAN.
-- Replaced by idx_feedback_question_unique_per_date which includes date.
DROP INDEX IF EXISTS idx_feedback_question_unique_global;

-- --------------------------------------------------------------------------
-- session (1 redundant)
-- --------------------------------------------------------------------------
-- idx_session_location — single column on text, rarely filtered alone
DROP INDEX IF EXISTS idx_session_location;

-- --------------------------------------------------------------------------
-- teacher_host_schedule (already clean) — no duplicates found
-- --------------------------------------------------------------------------

-- ============================================================================
-- PART 2: DROP ORPHANED FUNCTIONS
-- ============================================================================
-- update_location_zone_updated_at was for a location_zone table that
-- no longer exists. The trigger was dropped with the table, but the function
-- was left behind.
DROP FUNCTION IF EXISTS update_location_zone_updated_at();

-- ============================================================================
-- PART 3: RECORDING RLS — STUDENT READ POLICY (migration 002)
-- ============================================================================
-- The session_recording table only had a teacher-full-access policy.
-- Students couldn't view recordings regardless of recording_visibility.

DROP POLICY IF EXISTS "Enrolled students can view recordings" ON session_recording;
CREATE POLICY "Enrolled students can view recordings" ON session_recording
  FOR SELECT TO authenticated
  USING (
    recording_visibility IN ('enrolled_students', 'organization', 'public_link')
    AND EXISTS (
      SELECT 1 FROM enrollment e
      WHERE e.session_id = session_recording.session_id
        AND e.student_id = auth.uid()
        AND e.status = 'active'
    )
  );

COMMIT;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Dropped ~30 redundant/duplicate/orphan indexes:
--   attendance:            7 (3 duplicate + 4 low-value)
--   audit_log:             2 (duplicates)
--   photo_checkin:         3 (2 session_date + 1 token)
--   session_book_coverage: 2 (1 duplicate + 1 redundant)
--   session_date_host:     4 (2 duplicate + 1 redundant + 1 low-value)
--   session_feedback:      2 (duplicates)
--   qr_sessions:           2 (low-value orphans)
--   announcement_read:     2 (1 duplicate + 1 redundant)
--   enrollment:            1 (orphan)
--   issued_certificate:    3 (2 duplicate + 1 orphan)
--   feedback_question:     1 (orphan)
--   session:               1 (low-value)
--
-- Dropped 1 orphaned function:
--   update_location_zone_updated_at() — from removed location_zone table
--
-- Added:
--   1 RLS policy on session_recording for enrolled student read access
-- ============================================================================
