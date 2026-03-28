-- PERFORMANCE-INDEXES.sql
-- Adds MISSING composite/covering indexes based on actual frontend query patterns.
-- Run this in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS).
-- Date: 2026-03-06
--
-- NOTE: Many single-column indexes already exist from prior migrations:
--   supabase-schema.sql, ADD-COMMUNICATION-HUB.sql, ADD-EXCUSE-REQUEST-TABLE.sql,
--   ADD-CERTIFICATE-TABLES.sql, CREATE-AUDIT-LOG-TABLE.sql, FIX-DATA-INTEGRITY.sql,
--   RUN-ALL-ESSENTIAL-MIGRATIONS.sql, etc.
-- This file adds only NEW composite indexes that cover multi-column query patterns.

-- ================================================================
-- P0: CRITICAL COMPOSITE INDEXES (high-frequency multi-column queries)
-- ================================================================

-- 1. Enrollment: session + status (active students per session — every attendance page)
--    Existing: idx_enrollment_session, idx_enrollment_status (separate single-column)
--    New: composite covers .eq('session_id').eq('status', 'active') in one scan
CREATE INDEX IF NOT EXISTS idx_enrollment_session_status
  ON public.enrollment(session_id, status);

-- 2. Attendance: student + session (student attendance history in a course)
--    Existing: idx_attendance_student, idx_attendance_session (separate single-column)
--    New: composite covers .eq('student_id').eq('session_id') lookups
CREATE INDEX IF NOT EXISTS idx_attendance_student_session
  ON public.attendance(student_id, session_id);

-- 3. Excuse request: pending requests for a session date (3-column composite)
--    Existing: idx_excuse_request_session, idx_excuse_request_date, idx_excuse_request_status (separate)
--    New: composite covers .eq('session_id').eq('attendance_date').eq('status', 'pending')
CREATE INDEX IF NOT EXISTS idx_excuse_request_session_date_status
  ON public.excuse_request(session_id, attendance_date, status);

-- 4. Session: teacher's sessions sorted by date (dashboard, conflict checks)
--    Existing: idx_session_teacher (single column)
--    New: composite covers .eq('teacher_id').order('start_date', desc) without extra sort
CREATE INDEX IF NOT EXISTS idx_session_teacher_start
  ON public.session(teacher_id, start_date DESC);

-- 5. Session: course sessions sorted by date
--    Existing: idx_session_course (single column)
--    New: composite covers .eq('course_id').order('start_date', desc) without extra sort
CREATE INDEX IF NOT EXISTS idx_session_course_start
  ON public.session(course_id, start_date DESC);

-- 6. Message: inbox covering index (3-column: filter + sort in one scan)
--    Existing: idx_message_recipient ON (recipient_type, recipient_id) — no sort column
--    New: adds created_at DESC for covering index (different name to avoid clash)
CREATE INDEX IF NOT EXISTS idx_message_recipient_sorted
  ON public.message(recipient_type, recipient_id, created_at DESC);

-- 7. Message: sent items covering index (3-column: filter + sort in one scan)
--    Existing: idx_message_sender ON (sender_type, sender_id) — no sort column
--    New: adds created_at DESC for covering index (different name to avoid clash)
CREATE INDEX IF NOT EXISTS idx_message_sender_sorted
  ON public.message(sender_type, sender_id, created_at DESC);

-- ================================================================
-- P1: IMPORTANT INDEXES (medium-frequency patterns, not yet covered)
-- ================================================================

-- 8. Session: end_date filter (active sessions where end_date >= today)
--    No existing index on end_date alone
CREATE INDEX IF NOT EXISTS idx_session_end_date
  ON public.session(end_date);

-- 9. Audit log: table_name + changed_at composite (filtered audit queries with date range)
--    Existing: idx_audit_log_table_name, idx_audit_log_deleted_at (separate single-column)
--    New: composite covers .eq('table_name').order('changed_at', desc) in one scan
CREATE INDEX IF NOT EXISTS idx_audit_log_table_changed
  ON public.audit_log(table_name, changed_at DESC);

-- 10. Audit log: changed_by (who made the change — no existing index)
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by
  ON public.audit_log(changed_by);

-- 11. Announcement: course + created_at composite (course announcements sorted)
--     Existing: idx_announcement_course, idx_announcement_created_at (separate)
--     New: composite covers .eq('course_id').order('created_at', desc)
CREATE INDEX IF NOT EXISTS idx_announcement_course_created
  ON public.announcement(course_id, created_at DESC);

-- 12. Announcement read: composite (check if student read a specific announcement)
--     Existing: idx_announcement_read_student, idx_announcement_read_announcement (separate)
--     New: composite covers .eq('announcement_id').eq('student_id') check
CREATE INDEX IF NOT EXISTS idx_announcement_read_ann_student
  ON public.announcement_read(announcement_id, student_id);

-- 13. Issued certificate: student + session composite
--     Existing: idx_issued_cert_student, idx_issued_cert_session (separate)
--     New: composite covers .eq('student_id').eq('session_id') lookup
CREATE INDEX IF NOT EXISTS idx_issued_certificate_student_session
  ON public.issued_certificate(student_id, session_id);

-- ================================================================
-- P2: NICE-TO-HAVE (search/sort optimization)
-- ================================================================

-- 14. Student: name sort (alphabetical listings — no existing index)
CREATE INDEX IF NOT EXISTS idx_student_name
  ON public.student(name);

-- 15. Teacher: name sort (no existing index)
CREATE INDEX IF NOT EXISTS idx_teacher_name
  ON public.teacher(name);

-- ================================================================
-- VERIFICATION: List all custom indexes
-- ================================================================
-- Run this to verify:
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
