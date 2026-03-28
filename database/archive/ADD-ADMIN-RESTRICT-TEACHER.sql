-- ADD-ADMIN-RESTRICT-TEACHER.sql
-- =================================================================
-- Add Admin Role + Restrict Teacher to SELECT/INSERT only
-- =================================================================
-- 
-- CHANGES FROM PREVIOUS RLS (FINAL-TEACHER-ONLY-RLS.sql):
--   1. NEW: is_admin() function — checks if user email = 'baraatakala2004@gmail.com'
--   2. ADMIN: Full access (SELECT, INSERT, UPDATE, DELETE) on ALL tables
--   3. TEACHER: Downgraded from full access to SELECT + INSERT only
--      - Can still READ all data and CREATE new records
--      - Can NO LONGER UPDATE or DELETE any records
--   4. STUDENT: No changes (still read-only + own attendance check-in)
--
-- Date: 2026-02-10
-- =================================================================

-- ===== STEP 1: Create/Update helper functions =====

-- Check if logged-in user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN LOWER(auth.jwt()->>'email') = 'baraatakala2004@gmail.com';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if logged-in user is a teacher (unchanged)
CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM teacher 
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get the student_id for the logged-in user (unchanged)
CREATE OR REPLACE FUNCTION get_my_student_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT student_id FROM student 
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== STEP 2: Drop ALL existing policies on ALL core tables =====

-- Teacher table
DROP POLICY IF EXISTS "Allow all for anon" ON teacher;
DROP POLICY IF EXISTS "Allow all for authenticated" ON teacher;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Teachers have full access" ON teacher;
DROP POLICY IF EXISTS "Teachers can read" ON teacher;
DROP POLICY IF EXISTS "Teachers can insert" ON teacher;
DROP POLICY IF EXISTS "Admin has full access" ON teacher;
DROP POLICY IF EXISTS "Students can read teachers" ON teacher;

-- Student table
DROP POLICY IF EXISTS "Allow all for anon" ON student;
DROP POLICY IF EXISTS "Allow all for authenticated" ON student;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON student;
DROP POLICY IF EXISTS "Teachers have full access" ON student;
DROP POLICY IF EXISTS "Teachers can read" ON student;
DROP POLICY IF EXISTS "Teachers can insert" ON student;
DROP POLICY IF EXISTS "Admin has full access" ON student;
DROP POLICY IF EXISTS "Students can read students" ON student;

-- Course table
DROP POLICY IF EXISTS "Allow all for anon" ON course;
DROP POLICY IF EXISTS "Allow all for authenticated" ON course;
DROP POLICY IF EXISTS "Everyone can view courses" ON course;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON course;
DROP POLICY IF EXISTS "Teachers have full access" ON course;
DROP POLICY IF EXISTS "Teachers can read" ON course;
DROP POLICY IF EXISTS "Teachers can insert" ON course;
DROP POLICY IF EXISTS "Admin has full access" ON course;
DROP POLICY IF EXISTS "Students can read courses" ON course;

-- Session table
DROP POLICY IF EXISTS "Allow all for anon" ON session;
DROP POLICY IF EXISTS "Allow all for authenticated" ON session;
DROP POLICY IF EXISTS "Everyone can view sessions" ON session;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session;
DROP POLICY IF EXISTS "Teachers have full access" ON session;
DROP POLICY IF EXISTS "Teachers can read" ON session;
DROP POLICY IF EXISTS "Teachers can insert" ON session;
DROP POLICY IF EXISTS "Admin has full access" ON session;
DROP POLICY IF EXISTS "Students can read sessions" ON session;

-- Enrollment table
DROP POLICY IF EXISTS "Allow all for anon" ON enrollment;
DROP POLICY IF EXISTS "Allow all for authenticated" ON enrollment;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Teachers have full access" ON enrollment;
DROP POLICY IF EXISTS "Teachers can read" ON enrollment;
DROP POLICY IF EXISTS "Teachers can insert" ON enrollment;
DROP POLICY IF EXISTS "Admin has full access" ON enrollment;
DROP POLICY IF EXISTS "Students can read enrollments" ON enrollment;

-- Attendance table
DROP POLICY IF EXISTS "Allow all for anon" ON attendance;
DROP POLICY IF EXISTS "Allow all for authenticated" ON attendance;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Teachers have full access" ON attendance;
DROP POLICY IF EXISTS "Teachers can read" ON attendance;
DROP POLICY IF EXISTS "Teachers can insert" ON attendance;
DROP POLICY IF EXISTS "Admin has full access" ON attendance;
DROP POLICY IF EXISTS "Students can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can insert own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can update own attendance" ON attendance;

-- Session Date Host table
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Teachers have full access" ON session_date_host;
DROP POLICY IF EXISTS "Teachers can read" ON session_date_host;
DROP POLICY IF EXISTS "Teachers can insert" ON session_date_host;
DROP POLICY IF EXISTS "Admin has full access" ON session_date_host;
DROP POLICY IF EXISTS "Students can read session hosts" ON session_date_host;

-- ===== STEP 3: Enable RLS on all core tables =====
ALTER TABLE teacher ENABLE ROW LEVEL SECURITY;
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE course ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_date_host ENABLE ROW LEVEL SECURITY;

-- ===== STEP 4: ADMIN Policies (FULL ACCESS on everything) =====

CREATE POLICY "Admin has full access" ON teacher 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON student 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON course 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON session 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON enrollment 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON attendance 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

CREATE POLICY "Admin has full access" ON session_date_host 
  FOR ALL TO authenticated 
  USING (is_admin()) 
  WITH CHECK (is_admin());

-- ===== STEP 5: TEACHER Policies (SELECT + INSERT only, NO update/delete) =====

-- Teacher can READ all tables
CREATE POLICY "Teachers can read" ON teacher 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON student 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON course 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON session 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON enrollment 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON attendance 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can read" ON session_date_host 
  FOR SELECT TO authenticated 
  USING (is_teacher() AND NOT is_admin());

-- Teacher can INSERT into all tables
CREATE POLICY "Teachers can insert" ON teacher 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON student 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON course 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON session 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON enrollment 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON attendance 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert" ON session_date_host 
  FOR INSERT TO authenticated 
  WITH CHECK (is_teacher() AND NOT is_admin());

-- ===== STEP 6: Student Policies (READ + Self Check-in ONLY) — unchanged =====

CREATE POLICY "Students can read teachers" ON teacher 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read students" ON student 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read courses" ON course 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read sessions" ON session 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read enrollments" ON enrollment 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read session hosts" ON session_date_host 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin());

CREATE POLICY "Students can read own attendance" ON attendance 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

CREATE POLICY "Students can insert own attendance" ON attendance 
  FOR INSERT TO authenticated 
  WITH CHECK (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

CREATE POLICY "Students can update own attendance" ON attendance 
  FOR UPDATE TO authenticated 
  USING (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id())
  WITH CHECK (NOT is_teacher() AND NOT is_admin() AND student_id = get_my_student_id());

-- ===== STEP 7: QR Sessions, Photo Check-in, Book tables, Teacher Host Schedule, Audit Log =====

DO $$
BEGIN
  -- QR Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qr_sessions' AND table_schema = 'public') THEN
    ALTER TABLE qr_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON qr_sessions;
    DROP POLICY IF EXISTS "Admin has full access" ON qr_sessions;
    DROP POLICY IF EXISTS "Teachers can read" ON qr_sessions;
    DROP POLICY IF EXISTS "Teachers can insert" ON qr_sessions;
    DROP POLICY IF EXISTS "Anyone can read QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "Students can read QR sessions" ON qr_sessions;
    
    -- Admin: full access
    EXECUTE 'CREATE POLICY "Admin has full access" ON qr_sessions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    -- Teacher: read + insert
    EXECUTE 'CREATE POLICY "Teachers can read" ON qr_sessions FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON qr_sessions FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
    -- Students: read only
    EXECUTE 'CREATE POLICY "Students can read QR sessions" ON qr_sessions FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin())';
  END IF;
  
  -- Photo Check-in Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_checkin_sessions' AND table_schema = 'public') THEN
    ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Admin has full access" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Teachers can read" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Teachers can insert" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Anyone can read photo sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Students can read photo sessions" ON photo_checkin_sessions;
    
    -- Admin: full access
    EXECUTE 'CREATE POLICY "Admin has full access" ON photo_checkin_sessions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    -- Teacher: read + insert
    EXECUTE 'CREATE POLICY "Teachers can read" ON photo_checkin_sessions FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON photo_checkin_sessions FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
    -- Students: read only
    EXECUTE 'CREATE POLICY "Students can read photo sessions" ON photo_checkin_sessions FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin())';
  END IF;

  -- Course Book Reference
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_book_reference' AND table_schema = 'public') THEN
    ALTER TABLE course_book_reference ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON course_book_reference;
    DROP POLICY IF EXISTS "Admin has full access" ON course_book_reference;
    DROP POLICY IF EXISTS "Teachers can read" ON course_book_reference;
    DROP POLICY IF EXISTS "Teachers can insert" ON course_book_reference;
    DROP POLICY IF EXISTS "Students can read book references" ON course_book_reference;
    
    EXECUTE 'CREATE POLICY "Admin has full access" ON course_book_reference FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can read" ON course_book_reference FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON course_book_reference FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Students can read book references" ON course_book_reference FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin())';
  END IF;
  
  -- Session Book Coverage
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_book_coverage' AND table_schema = 'public') THEN
    ALTER TABLE session_book_coverage ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON session_book_coverage;
    DROP POLICY IF EXISTS "Admin has full access" ON session_book_coverage;
    DROP POLICY IF EXISTS "Teachers can read" ON session_book_coverage;
    DROP POLICY IF EXISTS "Teachers can insert" ON session_book_coverage;
    DROP POLICY IF EXISTS "Students can read book coverage" ON session_book_coverage;
    
    EXECUTE 'CREATE POLICY "Admin has full access" ON session_book_coverage FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can read" ON session_book_coverage FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON session_book_coverage FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Students can read book coverage" ON session_book_coverage FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin())';
  END IF;

  -- Teacher Host Schedule
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teacher_host_schedule' AND table_schema = 'public') THEN
    ALTER TABLE teacher_host_schedule ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Enable all access for authenticated users" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Admin has full access" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Teachers can read" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Teachers can insert" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Students can read host schedule" ON teacher_host_schedule;
    
    EXECUTE 'CREATE POLICY "Admin has full access" ON teacher_host_schedule FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can read" ON teacher_host_schedule FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON teacher_host_schedule FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Students can read host schedule" ON teacher_host_schedule FOR SELECT TO authenticated USING (NOT is_teacher() AND NOT is_admin())';
  END IF;

  -- Audit Log (Admin full, Teachers read + insert)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log' AND table_schema = 'public') THEN
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON audit_log;
    DROP POLICY IF EXISTS "Allow authenticated users to insert audit logs" ON audit_log;
    DROP POLICY IF EXISTS "Allow authenticated users to read audit logs" ON audit_log;
    DROP POLICY IF EXISTS "Admin has full access" ON audit_log;
    DROP POLICY IF EXISTS "Teachers can read" ON audit_log;
    DROP POLICY IF EXISTS "Teachers can insert" ON audit_log;
    
    EXECUTE 'CREATE POLICY "Admin has full access" ON audit_log FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can read" ON audit_log FOR SELECT TO authenticated USING (is_teacher() AND NOT is_admin())';
    EXECUTE 'CREATE POLICY "Teachers can insert" ON audit_log FOR INSERT TO authenticated WITH CHECK (is_teacher() AND NOT is_admin())';
  END IF;

  -- Late Brackets (read-only for all authenticated, admin full)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'late_brackets' AND table_schema = 'public') THEN
    ALTER TABLE late_brackets ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Enable all access for authenticated users" ON late_brackets;
    DROP POLICY IF EXISTS "Admin has full access" ON late_brackets;
    DROP POLICY IF EXISTS "Authenticated can read late brackets" ON late_brackets;
    
    EXECUTE 'CREATE POLICY "Admin has full access" ON late_brackets FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
    EXECUTE 'CREATE POLICY "Authenticated can read late brackets" ON late_brackets FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ===== STEP 8: Communication Hub tables =====
-- These have their own email-based policies. Add admin override.

DO $$
BEGIN
  -- Announcement
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON announcement;
    EXECUTE 'CREATE POLICY "Admin has full access" ON announcement FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Announcement Read
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement_read' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON announcement_read;
    EXECUTE 'CREATE POLICY "Admin has full access" ON announcement_read FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Message
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON message;
    EXECUTE 'CREATE POLICY "Admin has full access" ON message FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Message Attachment
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_attachment' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON message_attachment;
    EXECUTE 'CREATE POLICY "Admin has full access" ON message_attachment FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Notification Preference
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preference' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON notification_preference;
    EXECUTE 'CREATE POLICY "Admin has full access" ON notification_preference FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Announcement Reaction
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement_reaction' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON announcement_reaction;
    EXECUTE 'CREATE POLICY "Admin has full access" ON announcement_reaction FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Announcement Comment
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement_comment' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON announcement_comment;
    EXECUTE 'CREATE POLICY "Admin has full access" ON announcement_comment FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Message Reaction
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_reaction' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON message_reaction;
    EXECUTE 'CREATE POLICY "Admin has full access" ON message_reaction FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;

  -- Message Starred
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_starred' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Admin has full access" ON message_starred;
    EXECUTE 'CREATE POLICY "Admin has full access" ON message_starred FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin())';
  END IF;
END $$;

-- ===== VERIFICATION =====
SELECT 
    tablename,
    policyname,
    permissive,
    cmd,
    roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ===== SUCCESS MESSAGE =====
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '✅ Admin + Restricted Teacher RLS Applied!';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '';
  RAISE NOTICE '👑 ADMIN (baraatakala2004@gmail.com):';
  RAISE NOTICE '   ✓ Full access to ALL tables (SELECT, INSERT, UPDATE, DELETE)';
  RAISE NOTICE '   ✓ Can edit/delete any record';
  RAISE NOTICE '   ✓ Can manage all data';
  RAISE NOTICE '';
  RAISE NOTICE '📚 TEACHERS (email in teacher table, not admin):';
  RAISE NOTICE '   ✓ Can READ all data';
  RAISE NOTICE '   ✓ Can CREATE new records (students, courses, sessions, etc.)';
  RAISE NOTICE '   ✗ CANNOT UPDATE existing records';
  RAISE NOTICE '   ✗ CANNOT DELETE any records';
  RAISE NOTICE '';
  RAISE NOTICE '👨‍🎓 STUDENTS (email in student table):';
  RAISE NOTICE '   ✓ Can READ all data (for check-in to work)';
  RAISE NOTICE '   ✓ Can check-in for THEMSELVES via QR/Photo';
  RAISE NOTICE '   ✗ CANNOT modify other data';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANT: If admin email is also in teacher table,';
  RAISE NOTICE '   the admin policies take priority (is_admin() checked first).';
  RAISE NOTICE '';
END $$;
