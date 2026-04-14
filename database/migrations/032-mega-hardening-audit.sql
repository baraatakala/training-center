-- Migration 032: Mega-Hardening Audit
-- Full-system audit: live DB vs canonical SQL vs frontend code
-- Drops duplicate constraints, redundant indexes, tightens nullability
-- Date: 2025-07-11

BEGIN;

-- ============================================================
-- SECTION A: DROP DUPLICATE / REDUNDANT CONSTRAINTS (8 drops)
-- ============================================================

-- A1: announcement_reaction — exact duplicate unique constraint
-- Both cover (announcement_id, student_id, emoji)
ALTER TABLE announcement_reaction
  DROP CONSTRAINT IF EXISTS announcement_reaction_student_announcement_emoji_unique;

-- A2: announcement_read — exact duplicate unique constraint
-- Both cover (announcement_id, student_id)
ALTER TABLE announcement_read
  DROP CONSTRAINT IF EXISTS announcement_read_student_announcement_unique;

-- A3: message_starred — exact duplicate unique constraint
-- Both cover (message_id, user_type, user_id)
ALTER TABLE message_starred
  DROP CONSTRAINT IF EXISTS message_starred_user_message_unique;

-- A4: session — exact duplicate CHECK constraint
-- Both enforce: end_date >= start_date (keep session_dates_ordered)
ALTER TABLE session
  DROP CONSTRAINT IF EXISTS session_check;

-- A5: course_book_reference — exact duplicate CHECK constraint
-- Both enforce: end_page >= start_page (keep course_book_reference_page_range_check)
ALTER TABLE course_book_reference
  DROP CONSTRAINT IF EXISTS course_book_reference_check;

-- A6: message_reaction — weaker 4-col unique is redundant when stricter 3-col exists
-- UNIQUE(message_id, reactor_type, reactor_id) implies UNIQUE(message_id, reactor_type, reactor_id, emoji)
-- Frontend upsert uses onConflict:'message_id,reactor_type,reactor_id' → one reaction per user per message
ALTER TABLE message_reaction
  DROP CONSTRAINT IF EXISTS message_reaction_user_message_emoji_unique;

-- A7: session_book_coverage — weaker 3-col unique is redundant when stricter 2-col exists
-- UNIQUE(session_id, attendance_date) implies UNIQUE(session_id, attendance_date, reference_id)
-- Frontend upsert uses onConflict:'session_id,attendance_date' → one reference per session per date
ALTER TABLE session_book_coverage
  DROP CONSTRAINT IF EXISTS session_book_coverage_session_date_ref_unique;

-- A8: teacher_host_schedule — 3-col unique is redundant
-- UNIQUE(teacher_id, session_id) already prevents duplicates on (teacher_id, session_id, host_date)
-- And UNIQUE(session_id, host_date) prevents two teachers on same date
ALTER TABLE teacher_host_schedule
  DROP CONSTRAINT IF EXISTS teacher_host_schedule_teacher_id_session_id_host_date_key;


-- ============================================================
-- SECTION B: DROP REDUNDANT INDEXES (7 drops)
-- Each is a prefix of a wider composite index
-- ============================================================

-- B1: photo_checkin_sessions — plain index on (token) redundant with UNIQUE constraint index
DROP INDEX IF EXISTS idx_photo_checkin_token;

-- B2: attendance — (session_id, attendance_date) is prefix of (session_id, attendance_date, status)
DROP INDEX IF EXISTS idx_attendance_session_date;

-- B3: message — (recipient_type, recipient_id) is prefix of (recipient_type, recipient_id, created_at DESC)
DROP INDEX IF EXISTS idx_message_recipient;

-- B4: message — (sender_type, sender_id) is prefix of (sender_type, sender_id, created_at DESC)
DROP INDEX IF EXISTS idx_message_sender;

-- B5: session — (course_id) is prefix of (course_id, start_date DESC)
DROP INDEX IF EXISTS idx_session_course;

-- B6: session — (teacher_id) is prefix of (teacher_id, start_date DESC) and (teacher_id, end_date DESC)
DROP INDEX IF EXISTS idx_session_teacher;

-- B7: excuse_request — (session_id) is prefix of (session_id, attendance_date, status)
DROP INDEX IF EXISTS idx_excuse_request_session;


-- ============================================================
-- SECTION C: TIGHTEN NULLABLE BOOLEANS / COUNTERS
-- All have DEFAULT values but allow NULL — no frontend code passes NULL
-- Backfill existing NULLs before adding NOT NULL
-- ============================================================

-- C1: announcement.is_pinned
UPDATE announcement SET is_pinned = false WHERE is_pinned IS NULL;
ALTER TABLE announcement ALTER COLUMN is_pinned SET NOT NULL;

-- C2: announcement.view_count
UPDATE announcement SET view_count = 0 WHERE view_count IS NULL;
ALTER TABLE announcement ALTER COLUMN view_count SET NOT NULL;

-- C3: session.feedback_enabled
UPDATE session SET feedback_enabled = false WHERE feedback_enabled IS NULL;
ALTER TABLE session ALTER COLUMN feedback_enabled SET NOT NULL;

-- C4: session.feedback_anonymous_allowed
UPDATE session SET feedback_anonymous_allowed = true WHERE feedback_anonymous_allowed IS NULL;
ALTER TABLE session ALTER COLUMN feedback_anonymous_allowed SET NOT NULL;

-- C5: session.teacher_can_host
UPDATE session SET teacher_can_host = true WHERE teacher_can_host IS NULL;
ALTER TABLE session ALTER COLUMN teacher_can_host SET NOT NULL;

-- C6: session_feedback.is_anonymous
UPDATE session_feedback SET is_anonymous = false WHERE is_anonymous IS NULL;
ALTER TABLE session_feedback ALTER COLUMN is_anonymous SET NOT NULL;

-- C7: photo_checkin_sessions.is_valid
UPDATE photo_checkin_sessions SET is_valid = true WHERE is_valid IS NULL;
ALTER TABLE photo_checkin_sessions ALTER COLUMN is_valid SET NOT NULL;

-- C8: certificate_template.is_active
UPDATE certificate_template SET is_active = true WHERE is_active IS NULL;
ALTER TABLE certificate_template ALTER COLUMN is_active SET NOT NULL;

-- C9: feedback_template.is_default
UPDATE feedback_template SET is_default = false WHERE is_default IS NULL;
ALTER TABLE feedback_template ALTER COLUMN is_default SET NOT NULL;


COMMIT;
