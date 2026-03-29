-- ============================================================================
-- Training Center — Production Verification Script
-- ============================================================================
-- Run this in the Supabase SQL Editor to verify all backend components.
-- Expected: All checks should return ✅ PASS or show 0 issues.
-- Last updated: 2026-03-23 (matches migration 005)
-- ============================================================================

-- ============================================================================
-- SECTION 1: TABLE EXISTENCE (32 tables expected)
-- ============================================================================
DO $$
DECLARE
  _expected TEXT[] := ARRAY[
    'admin', 'specialization', 'teacher', 'student', 'course', 'session',
    'enrollment', 'attendance', 'qr_sessions', 'photo_checkin_sessions',
    'session_date_host', 'session_day_change', 'teacher_host_schedule',
    'session_recording', 'course_book_reference', 'session_book_coverage',
    'scoring_config', 'excuse_request', 'feedback_question', 'feedback_template',
    'session_feedback', 'certificate_template', 'issued_certificate',
    'announcement', 'announcement_read', 'announcement_comment',
    'announcement_reaction', 'message', 'message_reaction', 'message_starred',
    'notification_preference', 'audit_log'
  ];
  _missing TEXT[] := '{}';
  _tbl TEXT;
BEGIN
  FOREACH _tbl IN ARRAY _expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _tbl
    ) THEN
      _missing := array_append(_missing, _tbl);
    END IF;
  END LOOP;

  IF array_length(_missing, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All 32 expected tables exist';
  ELSE
    RAISE WARNING '❌ FAIL: Missing tables: %', array_to_string(_missing, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: ROW-LEVEL SECURITY ENABLED ON ALL TABLES
-- ============================================================================
DO $$
DECLARE
  _rec RECORD;
  _no_rls TEXT[] := '{}';
BEGIN
  FOR _rec IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'admin', 'specialization', 'teacher', 'student', 'course', 'session',
        'enrollment', 'attendance', 'qr_sessions', 'photo_checkin_sessions',
        'session_date_host', 'session_day_change', 'teacher_host_schedule',
        'session_recording', 'course_book_reference', 'session_book_coverage',
        'scoring_config', 'excuse_request', 'feedback_question', 'feedback_template',
        'session_feedback', 'certificate_template', 'issued_certificate',
        'announcement', 'announcement_read', 'announcement_comment',
        'announcement_reaction', 'message', 'message_reaction', 'message_starred',
        'notification_preference', 'audit_log'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = _rec.tablename AND relrowsecurity = true
    ) THEN
      _no_rls := array_append(_no_rls, _rec.tablename);
    END IF;
  END LOOP;

  IF array_length(_no_rls, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: RLS enabled on all 32 tables';
  ELSE
    RAISE WARNING '❌ FAIL: RLS NOT enabled on: %', array_to_string(_no_rls, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 3: CRITICAL FUNCTIONS EXIST
-- ============================================================================
DO $$
DECLARE
  _fns TEXT[] := ARRAY['is_admin', 'is_teacher', 'get_my_student_id'];
  _missing TEXT[] := '{}';
  _fn TEXT;
BEGIN
  FOREACH _fn IN ARRAY _fns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = _fn AND pronamespace = 'public'::regnamespace
    ) THEN
      _missing := array_append(_missing, _fn);
    END IF;
  END LOOP;

  IF array_length(_missing, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All 3 role-check functions exist (is_admin, is_teacher, get_my_student_id)';
  ELSE
    RAISE WARNING '❌ FAIL: Missing functions: %', array_to_string(_missing, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 4: SECURITY DEFINER ON ROLE-CHECK FUNCTIONS
-- ============================================================================
DO $$
DECLARE
  _fns TEXT[] := ARRAY['is_admin', 'is_teacher', 'get_my_student_id'];
  _not_definer TEXT[] := '{}';
  _fn TEXT;
BEGIN
  FOREACH _fn IN ARRAY _fns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = _fn
        AND pronamespace = 'public'::regnamespace
        AND prosecdef = true
    ) THEN
      _not_definer := array_append(_not_definer, _fn);
    END IF;
  END LOOP;

  IF array_length(_not_definer, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All role-check functions are SECURITY DEFINER';
  ELSE
    RAISE WARNING '❌ FAIL: Not SECURITY DEFINER: %', array_to_string(_not_definer, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 5: RLS POLICY COUNT PER TABLE (should have at least 1 policy each)
-- ============================================================================
DO $$
DECLARE
  _rec RECORD;
  _no_policies TEXT[] := '{}';
BEGIN
  FOR _rec IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'admin', 'specialization', 'teacher', 'student', 'course', 'session',
        'enrollment', 'attendance', 'qr_sessions', 'photo_checkin_sessions',
        'session_date_host', 'session_day_change', 'teacher_host_schedule',
        'session_recording', 'course_book_reference', 'session_book_coverage',
        'scoring_config', 'excuse_request', 'feedback_question', 'feedback_template',
        'session_feedback', 'certificate_template', 'issued_certificate',
        'announcement', 'announcement_read', 'announcement_comment',
        'announcement_reaction', 'message', 'message_reaction', 'message_starred',
        'notification_preference', 'audit_log'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = _rec.tablename AND schemaname = 'public'
    ) THEN
      _no_policies := array_append(_no_policies, _rec.tablename);
    END IF;
  END LOOP;

  IF array_length(_no_policies, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All tables have at least 1 RLS policy';
  ELSE
    RAISE WARNING '❌ FAIL: Tables with NO policies: %', array_to_string(_no_policies, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 6: NO BLANKET "FOR ALL" TO "public" POLICIES (security risk)
-- ============================================================================
SELECT
  '❌ BLANKET POLICY' AS status,
  schemaname, tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND 'public' = ANY(roles)
  AND cmd = 'ALL';
-- Expected: 0 rows

-- ============================================================================
-- SECTION 7: CRITICAL CONSTRAINTS EXIST
-- ============================================================================
DO $$
DECLARE
  _checks RECORD;
  _issues TEXT[] := '{}';
BEGIN
  -- enrollment unique constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'enrollment'::regclass
      AND contype = 'u'
  ) THEN
    _issues := array_append(_issues, 'enrollment: missing unique constraint');
  END IF;

  -- attendance unique constraint on enrollment_id + attendance_date
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'attendance'::regclass
      AND contype = 'u'
  ) THEN
    _issues := array_append(_issues, 'attendance: missing unique constraint on enrollment_id+attendance_date');
  END IF;

  -- session_feedback unique constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'session_feedback'::regclass
      AND contype = 'u'
  ) THEN
    _issues := array_append(_issues, 'session_feedback: missing unique constraint');
  END IF;

  IF array_length(_issues, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: Critical unique constraints exist on enrollment, attendance, session_feedback';
  ELSE
    RAISE WARNING '❌ FAIL: %', array_to_string(_issues, '; ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 8: FOREIGN KEY INTEGRITY CHECK
-- ============================================================================
-- Orphaned enrollments (student or session deleted)
SELECT '❌ Orphaned enrollment' AS status, e.enrollment_id, e.student_id, e.session_id
FROM enrollment e
LEFT JOIN student s ON s.student_id = e.student_id
LEFT JOIN session sess ON sess.session_id = e.session_id
WHERE s.student_id IS NULL OR sess.session_id IS NULL
LIMIT 10;

-- Orphaned attendance (enrollment deleted)
SELECT '❌ Orphaned attendance' AS status, a.attendance_id, a.enrollment_id
FROM attendance a
LEFT JOIN enrollment e ON e.enrollment_id = a.enrollment_id
WHERE e.enrollment_id IS NULL
LIMIT 10;

-- ============================================================================
-- SECTION 9: DATA QUALITY CHECKS
-- ============================================================================
-- Attendance records with invalid status values
SELECT '❌ Invalid attendance status' AS status, attendance_id, a.status
FROM attendance a
WHERE a.status NOT IN ('on time', 'late', 'absent', 'excused', 'early leave')
LIMIT 10;

-- Duplicate attendance (same enrollment + date, should not exist with unique constraint)
SELECT '❌ Duplicate attendance' AS status, enrollment_id, attendance_date, COUNT(*) AS cnt
FROM attendance
GROUP BY enrollment_id, attendance_date
HAVING COUNT(*) > 1
LIMIT 10;

-- Enrollments where can_host is true but status is not active
SELECT '❌ can_host on inactive enrollment' AS status, enrollment_id, e.status, can_host
FROM enrollment e
WHERE can_host = true AND e.status != 'active'
LIMIT 10;

-- ============================================================================
-- SECTION 10: STORAGE BUCKETS
-- ============================================================================
DO $$
DECLARE
  _buckets TEXT[] := ARRAY['student-photos', 'excuse-documents'];
  _missing TEXT[] := '{}';
  _b TEXT;
BEGIN
  FOREACH _b IN ARRAY _buckets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM storage.buckets WHERE id = _b
    ) THEN
      _missing := array_append(_missing, _b);
    END IF;
  END LOOP;

  IF array_length(_missing, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All required storage buckets exist';
  ELSE
    RAISE WARNING '❌ FAIL: Missing storage buckets: %', array_to_string(_missing, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 11: INDEX EXISTENCE (performance-critical indexes)
-- ============================================================================
DO $$
DECLARE
  _indexes TEXT[] := ARRAY[
    'idx_attendance_enrollment_date',
    'idx_attendance_session_date',
    'idx_attendance_student_id',
    'idx_enrollment_session_id',
    'idx_enrollment_student_id'
  ];
  _missing TEXT[] := '{}';
  _idx TEXT;
BEGIN
  FOREACH _idx IN ARRAY _indexes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = _idx AND schemaname = 'public'
    ) THEN
      _missing := array_append(_missing, _idx);
    END IF;
  END LOOP;

  IF array_length(_missing, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: All critical indexes exist';
  ELSE
    RAISE WARNING '⚠️ WARN: Missing indexes (performance): %', array_to_string(_missing, ', ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 12: MIGRATION 005 VERIFICATION (latest RLS fix)
-- ============================================================================
DO $$
DECLARE
  _issues TEXT[] := '{}';
BEGIN
  -- A: Blanket policies on audit_log, photo_checkin_sessions, session_book_coverage should NOT exist
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'Enable all access for authenticated users') THEN
    _issues := array_append(_issues, 'audit_log still has blanket "Enable all access" policy');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'photo_checkin_sessions' AND policyname = 'Enable all access for authenticated users') THEN
    _issues := array_append(_issues, 'photo_checkin_sessions still has blanket "Enable all access" policy');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_book_coverage' AND policyname = 'Enable all access for authenticated users') THEN
    _issues := array_append(_issues, 'session_book_coverage still has blanket "Enable all access" policy');
  END IF;

  -- B: Teacher should be able to UPDATE attendance (for excuse approvals)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance' AND policyname ILIKE '%teacher%update%') THEN
    _issues := array_append(_issues, 'attendance: missing teacher UPDATE policy');
  END IF;

  -- D: RLS enabled on session_feedback, feedback_question, certificate_template, issued_certificate
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'session_feedback') THEN
    _issues := array_append(_issues, 'session_feedback: RLS not enabled');
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'feedback_question') THEN
    _issues := array_append(_issues, 'feedback_question: RLS not enabled');
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'certificate_template') THEN
    _issues := array_append(_issues, 'certificate_template: RLS not enabled');
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'issued_certificate') THEN
    _issues := array_append(_issues, 'issued_certificate: RLS not enabled');
  END IF;

  IF array_length(_issues, 1) IS NULL THEN
    RAISE NOTICE '✅ PASS: Migration 005 RLS fixes verified';
  ELSE
    RAISE WARNING '❌ FAIL: Migration 005 issues: %', array_to_string(_issues, '; ');
  END IF;
END $$;

-- ============================================================================
-- SECTION 13: SUMMARY COUNTS
-- ============================================================================
SELECT
  'Summary' AS section,
  (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public') AS total_tables,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') AS total_policies,
  (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') AS total_indexes,
  (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS total_functions;

-- Per-table policy count
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- ============================================================================
-- END OF VERIFICATION
-- ============================================================================
-- Expected output: All ✅ PASS messages, no ❌ FAIL warnings.
-- Any ❌ rows in SELECT queries indicate data integrity issues to fix.
