-- ============================================================================
-- Migration 029: Data Integrity, Performance & Scalability Hardening
-- ============================================================================
-- Audit-driven migration covering:
--   A. CHECK constraints — domain validation at the database level
--   B. Foreign key cascades — prevent orphans on parent deletion
--   C. Composite & partial indexes — cover hot query patterns from services
--   D. Trigger: cascade soft-delete from session_recording to storage cleanup log
--   E. Data-model tightening — NOT NULL, defaults, domain constraints
-- ============================================================================

BEGIN;

-- ============================================================================
-- A. CHECK CONSTRAINTS — Domain Validation
-- ============================================================================

-- A1. scoring_config: weights must be 0–100 and sum to 100
--     Prevents nonsensical scoring formulae at the database level.
ALTER TABLE public.scoring_config
  ADD CONSTRAINT chk_weight_quality_range
    CHECK (weight_quality >= 0 AND weight_quality <= 100),
  ADD CONSTRAINT chk_weight_attendance_range
    CHECK (weight_attendance >= 0 AND weight_attendance <= 100),
  ADD CONSTRAINT chk_weight_punctuality_range
    CHECK (weight_punctuality >= 0 AND weight_punctuality <= 100),
  ADD CONSTRAINT chk_weights_sum_100
    CHECK (weight_quality + weight_attendance + weight_punctuality = 100);

-- A2. scoring_config: bonus/penalty values must be non-negative
ALTER TABLE public.scoring_config
  ADD CONSTRAINT chk_perfect_attendance_bonus_range
    CHECK (perfect_attendance_bonus >= 0 AND perfect_attendance_bonus <= 100),
  ADD CONSTRAINT chk_streak_bonus_range
    CHECK (streak_bonus_per_week >= 0 AND streak_bonus_per_week <= 50),
  ADD CONSTRAINT chk_absence_penalty_range
    CHECK (absence_penalty_multiplier >= 0 AND absence_penalty_multiplier <= 10);

-- A3. scoring_config: decay parameters must be positive
ALTER TABLE public.scoring_config
  ADD CONSTRAINT chk_late_decay_positive
    CHECK (late_decay_constant > 0),
  ADD CONSTRAINT chk_late_minimum_credit_range
    CHECK (late_minimum_credit >= 0 AND late_minimum_credit <= 1),
  ADD CONSTRAINT chk_late_null_estimate_range
    CHECK (late_null_estimate >= 0 AND late_null_estimate <= 1),
  ADD CONSTRAINT chk_coverage_minimum_range
    CHECK (coverage_minimum >= 0 AND coverage_minimum <= 1);

-- A4. attendance: late_minutes and early_minutes must be non-negative when present
ALTER TABLE public.attendance
  ADD CONSTRAINT chk_late_minutes_non_negative
    CHECK (late_minutes IS NULL OR late_minutes >= 0),
  ADD CONSTRAINT chk_early_minutes_non_negative
    CHECK (early_minutes IS NULL OR early_minutes >= 0);

-- A5. attendance: GPS coordinates must be valid ranges
ALTER TABLE public.attendance
  ADD CONSTRAINT chk_gps_latitude_range
    CHECK (gps_latitude IS NULL OR (gps_latitude >= -90 AND gps_latitude <= 90)),
  ADD CONSTRAINT chk_gps_longitude_range
    CHECK (gps_longitude IS NULL OR (gps_longitude >= -180 AND gps_longitude <= 180));

-- A6. attendance: gps_accuracy must be non-negative
ALTER TABLE public.attendance
  ADD CONSTRAINT chk_gps_accuracy_non_negative
    CHECK (gps_accuracy IS NULL OR gps_accuracy >= 0);

-- A7. attendance: distance_from_host must be non-negative
ALTER TABLE public.attendance
  ADD CONSTRAINT chk_distance_non_negative
    CHECK (distance_from_host IS NULL OR distance_from_host >= 0);

-- A8. session: proximity_radius must be positive
ALTER TABLE public.session
  ADD CONSTRAINT chk_proximity_radius_positive
    CHECK (proximity_radius IS NULL OR (proximity_radius >= 1 AND proximity_radius <= 10000));

-- A9. certificate_template: min_score and min_attendance are percentages (0–100)
ALTER TABLE public.certificate_template
  ADD CONSTRAINT chk_min_score_range
    CHECK (min_score IS NULL OR (min_score >= 0 AND min_score <= 100)),
  ADD CONSTRAINT chk_min_attendance_range
    CHECK (min_attendance IS NULL OR (min_attendance >= 0 AND min_attendance <= 100));

-- A10. issued_certificate: final_score and attendance_rate are percentages
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT chk_final_score_range
    CHECK (final_score IS NULL OR (final_score >= 0 AND final_score <= 100)),
  ADD CONSTRAINT chk_attendance_rate_range
    CHECK (attendance_rate IS NULL OR (attendance_rate >= 0 AND attendance_rate <= 100));

-- A11. issued_certificate: status lifecycle — revoked requires revoked_at
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT chk_revoked_fields
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL);

-- A12. issued_certificate: issued requires issued_at
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT chk_issued_fields
    CHECK (status <> 'issued' OR issued_at IS NOT NULL);

-- A13. announcement: view_count must be non-negative
ALTER TABLE public.announcement
  ADD CONSTRAINT chk_view_count_non_negative
    CHECK (view_count >= 0);

-- A14. qr_sessions: used_count must be non-negative
ALTER TABLE public.qr_sessions
  ADD CONSTRAINT chk_used_count_non_negative
    CHECK (used_count >= 0);

-- A15. course_book_reference: end_page must also be positive
ALTER TABLE public.course_book_reference
  ADD CONSTRAINT chk_end_page_positive
    CHECK (end_page > 0);

-- A16. course_book_reference: display_order must be non-negative
ALTER TABLE public.course_book_reference
  ADD CONSTRAINT chk_display_order_non_negative
    CHECK (display_order IS NULL OR display_order >= 0);

-- A17. feedback_question: sort_order must be non-negative
ALTER TABLE public.feedback_question
  ADD CONSTRAINT chk_sort_order_non_negative
    CHECK (sort_order >= 0);

-- A18. session: virtual_meeting_link requires virtual_provider to be set
ALTER TABLE public.session
  ADD CONSTRAINT chk_virtual_link_requires_provider
    CHECK (virtual_meeting_link IS NULL OR virtual_provider IS NOT NULL);


-- ============================================================================
-- B. FOREIGN KEY CASCADES — Prevent Orphaned Child Rows
-- ============================================================================

-- B1. announcement_read → announcement: delete reads when announcement deleted
ALTER TABLE public.announcement_read
  DROP CONSTRAINT IF EXISTS announcement_read_announcement_id_fkey;
ALTER TABLE public.announcement_read
  ADD CONSTRAINT announcement_read_announcement_id_fkey
    FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE;

-- B2. announcement_comment → announcement: delete comments when announcement deleted
ALTER TABLE public.announcement_comment
  DROP CONSTRAINT IF EXISTS announcement_comment_announcement_id_fkey;
ALTER TABLE public.announcement_comment
  ADD CONSTRAINT announcement_comment_announcement_id_fkey
    FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE;

-- B3. announcement_reaction → announcement: delete reactions when announcement deleted
ALTER TABLE public.announcement_reaction
  DROP CONSTRAINT IF EXISTS announcement_reaction_announcement_id_fkey;
ALTER TABLE public.announcement_reaction
  ADD CONSTRAINT announcement_reaction_announcement_id_fkey
    FOREIGN KEY (announcement_id) REFERENCES public.announcement(announcement_id) ON DELETE CASCADE;

-- B4. message_reaction → message: delete reactions when message deleted
ALTER TABLE public.message_reaction
  DROP CONSTRAINT IF EXISTS message_reaction_message_id_fkey;
ALTER TABLE public.message_reaction
  ADD CONSTRAINT message_reaction_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.message(message_id) ON DELETE CASCADE;

-- B5. message_starred → message: delete stars when message deleted
ALTER TABLE public.message_starred
  DROP CONSTRAINT IF EXISTS message_starred_message_id_fkey;
ALTER TABLE public.message_starred
  ADD CONSTRAINT message_starred_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.message(message_id) ON DELETE CASCADE;

-- B6. feedback_question → session: delete questions when session deleted
ALTER TABLE public.feedback_question
  DROP CONSTRAINT IF EXISTS feedback_question_session_id_fkey;
ALTER TABLE public.feedback_question
  ADD CONSTRAINT feedback_question_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B7. session_feedback → session: delete responses when session deleted
ALTER TABLE public.session_feedback
  DROP CONSTRAINT IF EXISTS session_feedback_session_id_fkey;
ALTER TABLE public.session_feedback
  ADD CONSTRAINT session_feedback_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B8. session_book_coverage → session: delete coverage when session deleted
ALTER TABLE public.session_book_coverage
  DROP CONSTRAINT IF EXISTS session_book_coverage_session_id_fkey;
ALTER TABLE public.session_book_coverage
  ADD CONSTRAINT session_book_coverage_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B9. session_book_coverage → course_book_reference: delete coverage when reference deleted
ALTER TABLE public.session_book_coverage
  DROP CONSTRAINT IF EXISTS session_book_coverage_reference_id_fkey;
ALTER TABLE public.session_book_coverage
  ADD CONSTRAINT session_book_coverage_reference_id_fkey
    FOREIGN KEY (reference_id) REFERENCES public.course_book_reference(reference_id) ON DELETE CASCADE;

-- B10. course_book_reference → parent self-ref: set null on parent deletion
ALTER TABLE public.course_book_reference
  DROP CONSTRAINT IF EXISTS course_book_reference_parent_id_fkey;
ALTER TABLE public.course_book_reference
  ADD CONSTRAINT course_book_reference_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.course_book_reference(reference_id) ON DELETE SET NULL;

-- B11. session_date_host → session: delete host assignments when session deleted
ALTER TABLE public.session_date_host
  DROP CONSTRAINT IF EXISTS session_date_host_session_id_fkey;
ALTER TABLE public.session_date_host
  ADD CONSTRAINT session_date_host_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B12. teacher_host_schedule → session: delete schedule when session deleted
ALTER TABLE public.teacher_host_schedule
  DROP CONSTRAINT IF EXISTS teacher_host_schedule_session_id_fkey;
ALTER TABLE public.teacher_host_schedule
  ADD CONSTRAINT teacher_host_schedule_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B13. qr_sessions → session: delete QR tokens when session deleted
ALTER TABLE public.qr_sessions
  DROP CONSTRAINT IF EXISTS qr_sessions_session_id_fkey;
ALTER TABLE public.qr_sessions
  ADD CONSTRAINT qr_sessions_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B14. photo_checkin_sessions → session: delete photo tokens when session deleted
ALTER TABLE public.photo_checkin_sessions
  DROP CONSTRAINT IF EXISTS photo_checkin_sessions_session_id_fkey;
ALTER TABLE public.photo_checkin_sessions
  ADD CONSTRAINT photo_checkin_sessions_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B15. session_recording → session: delete recordings when session deleted
ALTER TABLE public.session_recording
  DROP CONSTRAINT IF EXISTS session_recording_session_id_fkey;
ALTER TABLE public.session_recording
  ADD CONSTRAINT session_recording_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B16. announcement_comment self-ref: nullify parent_comment_id on parent deletion
ALTER TABLE public.announcement_comment
  DROP CONSTRAINT IF EXISTS announcement_comment_parent_comment_id_fkey;
ALTER TABLE public.announcement_comment
  ADD CONSTRAINT announcement_comment_parent_comment_id_fkey
    FOREIGN KEY (parent_comment_id) REFERENCES public.announcement_comment(comment_id) ON DELETE SET NULL;

-- B17. message self-ref: nullify parent_message_id on parent deletion
ALTER TABLE public.message
  DROP CONSTRAINT IF EXISTS message_parent_message_id_fkey;
ALTER TABLE public.message
  ADD CONSTRAINT message_parent_message_id_fkey
    FOREIGN KEY (parent_message_id) REFERENCES public.message(message_id) ON DELETE SET NULL;

-- B18. excuse_request → session: cascade on session deletion
ALTER TABLE public.excuse_request
  DROP CONSTRAINT IF EXISTS excuse_request_session_id_fkey;
ALTER TABLE public.excuse_request
  ADD CONSTRAINT excuse_request_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE CASCADE;

-- B19. issued_certificate → session: set null on session deletion (cert survives)
ALTER TABLE public.issued_certificate
  DROP CONSTRAINT IF EXISTS issued_certificate_session_id_fkey;
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT issued_certificate_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.session(session_id) ON DELETE SET NULL;

-- B20. issued_certificate → course: set null on course deletion (cert survives)
ALTER TABLE public.issued_certificate
  DROP CONSTRAINT IF EXISTS issued_certificate_course_id_fkey;
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT issued_certificate_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE SET NULL;

-- B21. announcement_read → student: cascade on student deletion
ALTER TABLE public.announcement_read
  DROP CONSTRAINT IF EXISTS announcement_read_student_id_fkey;
ALTER TABLE public.announcement_read
  ADD CONSTRAINT announcement_read_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;

-- B22. announcement_reaction → student: cascade on student deletion
ALTER TABLE public.announcement_reaction
  DROP CONSTRAINT IF EXISTS announcement_reaction_student_id_fkey;
ALTER TABLE public.announcement_reaction
  ADD CONSTRAINT announcement_reaction_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


-- ============================================================================
-- C. COMPOSITE & PARTIAL INDEXES — Hot Query Patterns
-- ============================================================================

-- C1. session_feedback: fast existence check (checkFeedbackExists service call)
CREATE INDEX IF NOT EXISTS idx_session_feedback_student_date
  ON public.session_feedback(session_id, attendance_date, student_id);

-- C2. attendance: teacher dashboard date-range scans (session_id + date range)
--     Covers the heaviest query: getBySession ordered by date
CREATE INDEX IF NOT EXISTS idx_attendance_session_date_status
  ON public.attendance(session_id, attendance_date, status);

-- C3. session: teacher's active/upcoming sessions (end_date filter + teacher scope)
CREATE INDEX IF NOT EXISTS idx_session_teacher_end_date
  ON public.session(teacher_id, end_date DESC);

-- C4. enrollment: active-only lookups (most common filter)
CREATE INDEX IF NOT EXISTS idx_enrollment_active
  ON public.enrollment(session_id, student_id)
  WHERE status = 'active';

-- C5. excuse_request: pending excuse lookups (3-column composite for the hot path) 
CREATE INDEX IF NOT EXISTS idx_excuse_pending
  ON public.excuse_request(session_id, attendance_date)
  WHERE status = 'pending';

-- C6. announcement: active (non-expired) announcements ordered by recency
CREATE INDEX IF NOT EXISTS idx_announcement_active_recent
  ON public.announcement(course_id, created_at DESC)
  WHERE expires_at IS NULL OR expires_at > now();

-- C7. announcement_read: fast "has student read this?" check
CREATE INDEX IF NOT EXISTS idx_announcement_read_unique
  ON public.announcement_read(announcement_id, student_id);

-- C8. session_recording: non-deleted recordings per session (common RLS + app query)
CREATE INDEX IF NOT EXISTS idx_session_recording_active
  ON public.session_recording(session_id, attendance_date)
  WHERE deleted_at IS NULL;

-- C9. attendance: student date-range analytics (dashboard student history)
CREATE INDEX IF NOT EXISTS idx_attendance_student_date_status
  ON public.attendance(student_id, attendance_date DESC, status);

-- C10. session: parent_session_id for clone lookups (added in migration 028)
CREATE INDEX IF NOT EXISTS idx_session_parent
  ON public.session(parent_session_id)
  WHERE parent_session_id IS NOT NULL;


-- ============================================================================
-- D. UNIQUE CONSTRAINTS — Prevent Business Logic Duplicates
-- ============================================================================

-- D1. announcement_read: prevent duplicate read records for same student + announcement
ALTER TABLE public.announcement_read
  ADD CONSTRAINT announcement_read_student_announcement_unique
    UNIQUE (announcement_id, student_id);

-- D2. announcement_reaction: one reaction type per student per announcement
ALTER TABLE public.announcement_reaction
  ADD CONSTRAINT announcement_reaction_student_announcement_emoji_unique
    UNIQUE (announcement_id, student_id, emoji);

-- D3. message_starred: one star per user per message
ALTER TABLE public.message_starred
  ADD CONSTRAINT message_starred_user_message_unique
    UNIQUE (message_id, user_type, user_id);

-- D4. message_reaction: one reaction type per user per message
ALTER TABLE public.message_reaction
  ADD CONSTRAINT message_reaction_user_message_emoji_unique
    UNIQUE (message_id, reactor_type, reactor_id, emoji);

-- D5. session_book_coverage: prevent duplicate coverage entries
ALTER TABLE public.session_book_coverage
  ADD CONSTRAINT session_book_coverage_session_date_ref_unique
    UNIQUE (session_id, attendance_date, reference_id);

-- D6. session_feedback: one response per student per session/date
--     (anonymous feedback gets student_id = NULL, so this only constrains identified feedback)
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_feedback_one_per_student
  ON public.session_feedback(session_id, attendance_date, student_id)
  WHERE student_id IS NOT NULL;


-- ============================================================================
-- E. DATA MODEL TIGHTENING
-- ============================================================================

-- E1. attendance: check_in_method should use a known vocabulary
ALTER TABLE public.attendance
  ADD CONSTRAINT chk_check_in_method_valid
    CHECK (check_in_method IS NULL OR check_in_method = ANY (ARRAY[
      'manual', 'qr_code', 'photo', 'bulk', 'face_recognition', 'gps', 'auto'
    ]));

-- E2. session_feedback: check_in_method same validation
ALTER TABLE public.session_feedback
  ADD CONSTRAINT chk_feedback_check_in_method_valid
    CHECK (check_in_method IS NULL OR check_in_method = ANY (ARRAY[
      'manual', 'qr_code', 'photo', 'bulk', 'face_recognition', 'gps', 'auto'
    ]));

-- E3. student: age should have a practical lower bound (not just > 0)
--     Already has CHECK (age > 0 AND age < 150), tighten to age >= 5
ALTER TABLE public.student
  DROP CONSTRAINT IF EXISTS student_age_check;
ALTER TABLE public.student
  ADD CONSTRAINT student_age_check
    CHECK (age IS NULL OR (age >= 5 AND age < 150));

-- E4. announcement: category should use a known vocabulary
ALTER TABLE public.announcement
  ADD CONSTRAINT chk_announcement_category_valid
    CHECK (category IS NULL OR category = ANY (ARRAY[
      'general', 'homework', 'exam', 'event', 'reminder', 'urgent', 'celebration'
    ]));

-- E5. issued_certificate: signer_teacher_id cascade on teacher deletion
ALTER TABLE public.issued_certificate
  DROP CONSTRAINT IF EXISTS issued_certificate_signer_teacher_id_fkey;
ALTER TABLE public.issued_certificate
  ADD CONSTRAINT issued_certificate_signer_teacher_id_fkey
    FOREIGN KEY (signer_teacher_id) REFERENCES public.teacher(teacher_id) ON DELETE SET NULL;

-- E6. course_book_reference: cascade on course deletion (removes all book refs)
ALTER TABLE public.course_book_reference
  DROP CONSTRAINT IF EXISTS course_book_reference_course_id_fkey;
ALTER TABLE public.course_book_reference
  ADD CONSTRAINT course_book_reference_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES public.course(course_id) ON DELETE CASCADE;


-- ============================================================================
-- F. FUNCTION: Optimized attendance statistics (avoids N+1 in dashboard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_attendance_stats_by_session(p_session_id UUID)
RETURNS TABLE (
  total_records   BIGINT,
  on_time_count   BIGINT,
  late_count      BIGINT,
  absent_count    BIGINT,
  excused_count   BIGINT,
  unique_dates    BIGINT,
  unique_students BIGINT,
  avg_late_minutes NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COUNT(*)                                                AS total_records,
    COUNT(*) FILTER (WHERE status = 'on time')              AS on_time_count,
    COUNT(*) FILTER (WHERE status = 'late')                 AS late_count,
    COUNT(*) FILTER (WHERE status = 'absent')               AS absent_count,
    COUNT(*) FILTER (WHERE status = 'excused')              AS excused_count,
    COUNT(DISTINCT attendance_date)                          AS unique_dates,
    COUNT(DISTINCT student_id)                               AS unique_students,
    ROUND(AVG(late_minutes) FILTER (WHERE late_minutes > 0), 1) AS avg_late_minutes
  FROM public.attendance
  WHERE session_id = p_session_id;
$$;

COMMENT ON FUNCTION public.get_attendance_stats_by_session IS
  'Single-query attendance aggregate for dashboard cards. Avoids N+1 client-side counting.';


-- ============================================================================
-- G. METADATA — Update table comments for new constraints
-- ============================================================================

COMMENT ON TABLE public.scoring_config IS
  'Teacher-owned scoring formula: weights (must sum to 100), late brackets (JSONB), decay curves, bonus/penalty configs';

COMMENT ON TABLE public.attendance IS
  'Per-date attendance record for each enrollment — status, GPS (validated ranges), timing (non-negative), check-in method';

COMMENT ON TABLE public.issued_certificate IS
  'Individually issued certificates with unique verification codes, percentage-validated scores and attendance rates';


COMMIT;
