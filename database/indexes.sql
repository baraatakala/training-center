-- ============================================================================
-- Training Center — Indexes
-- ============================================================================
-- Run order: 3 of 6 (after functions.sql)
-- All performance indexes. Uses IF NOT EXISTS for idempotent re-runs.
-- Synced with live Supabase as of 2026-04-06 (migration 020 applied).
--
-- NOTE: Primary key indexes and UNIQUE constraint indexes are created
-- automatically by schema.sql and are NOT repeated here.
-- ============================================================================

-- ============================================================================
-- 0. FUNCTIONAL INDEXES — RLS PERFORMANCE
-- ============================================================================

-- Every RLS policy resolves identity via LOWER(email) = LOWER(auth.jwt()->>'email').
-- Without these, PostgreSQL does sequential scans on the identity tables.
CREATE INDEX IF NOT EXISTS idx_teacher_email_lower ON public.teacher (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_student_email_lower ON public.student (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_admin_email_lower   ON public.admin   (LOWER(email));

-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

-- student
-- NOTE: student_email_key UNIQUE already provides an email index.
CREATE INDEX IF NOT EXISTS idx_student_name            ON public.student(name);
CREATE INDEX IF NOT EXISTS idx_student_specialization  ON public.student(specialization);

-- teacher
CREATE INDEX IF NOT EXISTS idx_teacher_name            ON public.teacher(name);
CREATE INDEX IF NOT EXISTS idx_teacher_specialization  ON public.teacher(specialization);

-- course
CREATE INDEX IF NOT EXISTS idx_course_teacher          ON public.course(teacher_id);

-- session
CREATE INDEX IF NOT EXISTS idx_session_course          ON public.session(course_id);
CREATE INDEX IF NOT EXISTS idx_session_teacher         ON public.session(teacher_id);
CREATE INDEX IF NOT EXISTS idx_session_dates           ON public.session(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_session_end_date        ON public.session(end_date);
CREATE INDEX IF NOT EXISTS idx_session_teacher_start   ON public.session(teacher_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_session_course_start    ON public.session(course_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_session_learning_method ON public.session(learning_method);

-- enrollment
-- NOTE: enrollment_student_session_unique UNIQUE (student_id, session_id)
-- already provides the composite index. Standalone student/session indexes
-- are covered by other composites below.
CREATE INDEX IF NOT EXISTS idx_enrollment_can_host         ON public.enrollment(session_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_session_canhost  ON public.enrollment(session_id, can_host);
CREATE INDEX IF NOT EXISTS idx_enrollment_session_status   ON public.enrollment(session_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollment_session_student  ON public.enrollment(session_id, student_id);

-- ============================================================================
-- 2. ATTENDANCE & CHECK-IN
-- ============================================================================

-- attendance
-- NOTE: attendance_enrollment_date_unique (enrollment_id, attendance_date)
-- already provides the leading enrollment_id index.
CREATE INDEX IF NOT EXISTS idx_attendance_session_date     ON public.attendance(session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_session  ON public.attendance(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date     ON public.attendance(student_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status_excuse    ON public.attendance(status, excuse_reason);
CREATE INDEX IF NOT EXISTS idx_attendance_host_address     ON public.attendance(host_address);
CREATE INDEX IF NOT EXISTS idx_attendance_date_address     ON public.attendance(attendance_date, host_address);
CREATE INDEX IF NOT EXISTS idx_attendance_late_minutes     ON public.attendance(late_minutes) WHERE late_minutes IS NOT NULL;

-- qr_sessions
CREATE INDEX IF NOT EXISTS idx_qr_sessions_token          ON public.qr_sessions(token) WHERE is_valid = true;
CREATE INDEX IF NOT EXISTS idx_qr_sessions_session_date   ON public.qr_sessions(session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_qr_sessions_expires        ON public.qr_sessions(expires_at) WHERE is_valid = true;
CREATE INDEX IF NOT EXISTS idx_qr_sessions_linked_photo_token ON public.qr_sessions(linked_photo_token);

-- photo_checkin_sessions
CREATE INDEX IF NOT EXISTS idx_photo_checkin_token         ON public.photo_checkin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_photo_checkin_session       ON public.photo_checkin_sessions(session_id, attendance_date);

-- ============================================================================
-- 3. SESSION MANAGEMENT
-- ============================================================================

-- session_date_host
-- NOTE: session_date_host_session_id_attendance_date_key UNIQUE covers (session_id, attendance_date).
CREATE INDEX IF NOT EXISTS idx_session_date_host_date         ON public.session_date_host(attendance_date);

-- session_day_change
CREATE INDEX IF NOT EXISTS idx_session_day_change_session   ON public.session_day_change(session_id);
CREATE INDEX IF NOT EXISTS idx_session_day_change_effective ON public.session_day_change(effective_date);

-- session_time_change
CREATE INDEX IF NOT EXISTS idx_session_time_change_session   ON public.session_time_change(session_id);
CREATE INDEX IF NOT EXISTS idx_session_time_change_effective ON public.session_time_change(effective_date);

-- teacher_host_schedule
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_teacher_id ON public.teacher_host_schedule(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_session_id ON public.teacher_host_schedule(session_id);
CREATE INDEX IF NOT EXISTS idx_teacher_host_schedule_host_date  ON public.teacher_host_schedule(host_date);

-- session_recording
CREATE INDEX IF NOT EXISTS idx_session_recording_session_date ON public.session_recording(session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_session_recording_visibility   ON public.session_recording(recording_visibility);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_recording_primary_per_date
  ON public.session_recording(session_id, attendance_date)
  WHERE is_primary = true AND deleted_at IS NULL;

-- ============================================================================
-- 4. BOOK TRACKING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_session_book_coverage_session ON public.session_book_coverage(session_id);
CREATE INDEX IF NOT EXISTS idx_book_ref_parent              ON public.course_book_reference(parent_id);
CREATE INDEX IF NOT EXISTS idx_course_book_reference_course_id ON public.course_book_reference(course_id);
CREATE INDEX IF NOT EXISTS idx_course_book_reference_pages  ON public.course_book_reference(course_id, start_page);

-- ============================================================================
-- 5. SCORING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_scoring_config_teacher  ON public.scoring_config(teacher_id);
-- Enforce one default config per teacher
CREATE UNIQUE INDEX IF NOT EXISTS unique_teacher_default
  ON public.scoring_config(teacher_id, is_default) WHERE is_default = true;

-- ============================================================================
-- 6. EXCUSES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_excuse_request_student ON public.excuse_request(student_id);
CREATE INDEX IF NOT EXISTS idx_excuse_request_session ON public.excuse_request(session_id);
CREATE INDEX IF NOT EXISTS idx_excuse_request_status  ON public.excuse_request(status);
CREATE INDEX IF NOT EXISTS idx_excuse_request_date    ON public.excuse_request(attendance_date);
CREATE INDEX IF NOT EXISTS idx_excuse_request_session_date_status
  ON public.excuse_request(session_id, attendance_date, status);

-- ============================================================================
-- 7. FEEDBACK
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_session_feedback_session_date ON public.session_feedback(session_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_session_feedback_student      ON public.session_feedback(student_id);
CREATE INDEX IF NOT EXISTS idx_feedback_question_session     ON public.feedback_question(session_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_feedback_question_session_date ON public.feedback_question(session_id, attendance_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_question_unique_per_date
  ON public.feedback_question(session_id, attendance_date, question_text);

-- ============================================================================
-- 8. CERTIFICATES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_issued_cert_student       ON public.issued_certificate(student_id);
CREATE INDEX IF NOT EXISTS idx_issued_cert_session       ON public.issued_certificate(session_id);
CREATE INDEX IF NOT EXISTS idx_issued_cert_template      ON public.issued_certificate(template_id);
CREATE INDEX IF NOT EXISTS idx_issued_certificate_student_session ON public.issued_certificate(student_id, session_id);

-- ============================================================================
-- 9. COMMUNICATION
-- ============================================================================

-- announcement
CREATE INDEX IF NOT EXISTS idx_announcement_course       ON public.announcement(course_id);
CREATE INDEX IF NOT EXISTS idx_announcement_created_by   ON public.announcement(created_by);
CREATE INDEX IF NOT EXISTS idx_announcement_created_at   ON public.announcement(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_priority     ON public.announcement(priority);
CREATE INDEX IF NOT EXISTS idx_announcement_pinned       ON public.announcement(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_announcement_category     ON public.announcement(category);
CREATE INDEX IF NOT EXISTS idx_announcement_course_created ON public.announcement(course_id, created_at DESC);

-- announcement_read
CREATE INDEX IF NOT EXISTS idx_announcement_read_student      ON public.announcement_read(student_id);

-- announcement_reaction / comment
CREATE INDEX IF NOT EXISTS idx_announcement_reaction_announcement ON public.announcement_reaction(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reaction_student      ON public.announcement_reaction(student_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_announcement  ON public.announcement_comment(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_parent        ON public.announcement_comment(parent_comment_id);

-- message
CREATE INDEX IF NOT EXISTS idx_message_sender          ON public.message(sender_type, sender_id);
CREATE INDEX IF NOT EXISTS idx_message_recipient       ON public.message(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_message_created_at      ON public.message(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_thread          ON public.message(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_message_unread          ON public.message(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_message_recipient_sorted ON public.message(recipient_type, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_sender_sorted    ON public.message(sender_type, sender_id, created_at DESC);

-- message_reaction / starred
CREATE INDEX IF NOT EXISTS idx_message_reaction_message ON public.message_reaction(message_id);
CREATE INDEX IF NOT EXISTS idx_message_starred_message  ON public.message_starred(message_id);

-- ============================================================================
-- 10. AUDIT LOG
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_log_table        ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record       ON public.audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at   ON public.audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_deleted_at   ON public.audit_log(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_deleted_by   ON public.audit_log(deleted_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_operation    ON public.audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_changed ON public.audit_log(table_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by   ON public.audit_log(changed_by);
