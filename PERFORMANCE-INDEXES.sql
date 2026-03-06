-- PERFORMANCE-INDEXES.sql
-- Adds missing database indexes based on actual query patterns in the application.
-- Run this in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS).
-- Date: 2026-02-05

-- ================================================================
-- P0: CRITICAL INDEXES (high-frequency query patterns)
-- ================================================================

-- 1. Enrollment: session + student lookup (duplicate checks, enrollment lookups)
CREATE INDEX IF NOT EXISTS idx_enrollment_session_student
  ON public.enrollment(session_id, student_id);

-- 2. Enrollment: session + status (active students per session — used on every attendance page)
CREATE INDEX IF NOT EXISTS idx_enrollment_session_status
  ON public.enrollment(session_id, status);

-- 3. Attendance: student + session (student attendance history in a course)
CREATE INDEX IF NOT EXISTS idx_attendance_student_session
  ON public.attendance(student_id, session_id);

-- 4. Attendance: session + date (attendance sheet for a session on a given date)
CREATE INDEX IF NOT EXISTS idx_attendance_session_date
  ON public.attendance(session_id, attendance_date);

-- 5. Attendance: enrollment_id (FK lookups — not auto-indexed by Supabase)
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment
  ON public.attendance(enrollment_id);

-- 6. Message: inbox queries (recipient_type + recipient_id, ordered by created_at)
CREATE INDEX IF NOT EXISTS idx_message_recipient
  ON public.message(recipient_type, recipient_id, created_at DESC);

-- 7. Message: sent items queries
CREATE INDEX IF NOT EXISTS idx_message_sender
  ON public.message(sender_type, sender_id, created_at DESC);

-- 8. Excuse request: pending requests for a session date
CREATE INDEX IF NOT EXISTS idx_excuse_request_session_date_status
  ON public.excuse_request(session_id, attendance_date, status);

-- 9. Session: teacher's sessions sorted by date (dashboard, conflict checks)
CREATE INDEX IF NOT EXISTS idx_session_teacher_start
  ON public.session(teacher_id, start_date DESC);

-- 10. Session: course sessions sorted by date
CREATE INDEX IF NOT EXISTS idx_session_course_start
  ON public.session(course_id, start_date DESC);

-- ================================================================
-- P1: IMPORTANT INDEXES (medium-frequency patterns)
-- ================================================================

-- 11. Session: end_date filter (active sessions where end_date >= today)
CREATE INDEX IF NOT EXISTS idx_session_end_date
  ON public.session(end_date);

-- 12. Audit log: table_name + changed_at (filtered audit queries with date range)
CREATE INDEX IF NOT EXISTS idx_audit_log_table_changed
  ON public.audit_log(table_name, changed_at DESC);

-- 13. Audit log: changed_by (who made the change)
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by
  ON public.audit_log(changed_by);

-- 14. Announcement: course + created_at (course announcements sorted)
CREATE INDEX IF NOT EXISTS idx_announcement_course_created
  ON public.announcement(course_id, created_at DESC);

-- 15. Announcement read: announcement + student (check if read)
CREATE INDEX IF NOT EXISTS idx_announcement_read_ann_student
  ON public.announcement_read(announcement_id, student_id);

-- 16. Course: teacher_id (teacher's courses)
CREATE INDEX IF NOT EXISTS idx_course_teacher
  ON public.course(teacher_id);

-- 17. Excuse request: student lookup
CREATE INDEX IF NOT EXISTS idx_excuse_request_student
  ON public.excuse_request(student_id);

-- 18. Issued certificate: student + session lookup
CREATE INDEX IF NOT EXISTS idx_issued_certificate_student_session
  ON public.issued_certificate(student_id, session_id);

-- ================================================================
-- P2: NICE-TO-HAVE INDEXES (search/sort optimization)
-- ================================================================

-- 19. Student: name sort (alphabetical listings)
CREATE INDEX IF NOT EXISTS idx_student_name
  ON public.student(name);

-- 20. Teacher: name sort
CREATE INDEX IF NOT EXISTS idx_teacher_name
  ON public.teacher(name);

-- 21. QR sessions: session + date (lookup active QR for a session date)
CREATE INDEX IF NOT EXISTS idx_qr_sessions_session_date
  ON public.qr_sessions(session_id, attendance_date);

-- 22. Photo check-in sessions: session + date
CREATE INDEX IF NOT EXISTS idx_photo_checkin_session_date
  ON public.photo_checkin_sessions(session_id, attendance_date);

-- ================================================================
-- VERIFICATION: List all custom indexes
-- ================================================================
-- Run this to verify:
-- SELECT indexname, tablename, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
