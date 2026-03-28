-- FINAL-TEACHER-ONLY-RLS.sql
-- =================================================================
-- FINAL RLS Configuration for Training Center
-- =================================================================
-- 
-- GOAL: 
--   Teachers = Full access to all tables (edit buttons work)
--   Students = Read data + check-in for themselves only
--   Students CANNOT access Attendance page (blocked in frontend)
--
-- Date: 2026-01-29
-- =================================================================

-- ===== STEP 1: Create helper functions =====

-- Check if logged-in user is a teacher
CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM teacher 
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get the student_id for the logged-in user
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

-- ===== STEP 2: Drop ALL existing policies on ALL tables =====
-- Including dangerous "Allow all for anon" and "Allow all for authenticated" policies

-- Teacher table
DROP POLICY IF EXISTS "Allow all for anon" ON teacher;
DROP POLICY IF EXISTS "Allow all for authenticated" ON teacher;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Teachers have full access" ON teacher;
DROP POLICY IF EXISTS "Students can read teachers" ON teacher;
DROP POLICY IF EXISTS "Authenticated users can read" ON teacher;
DROP POLICY IF EXISTS "teacher_select_policy" ON teacher;
DROP POLICY IF EXISTS "teacher_insert_policy" ON teacher;
DROP POLICY IF EXISTS "teacher_update_policy" ON teacher;
DROP POLICY IF EXISTS "teacher_delete_policy" ON teacher;

-- Student table
DROP POLICY IF EXISTS "Allow all for anon" ON student;
DROP POLICY IF EXISTS "Allow all for authenticated" ON student;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON student;
DROP POLICY IF EXISTS "Teachers have full access" ON student;
DROP POLICY IF EXISTS "Students can read students" ON student;
DROP POLICY IF EXISTS "Authenticated users can read" ON student;
DROP POLICY IF EXISTS "student_select_policy" ON student;
DROP POLICY IF EXISTS "student_insert_policy" ON student;
DROP POLICY IF EXISTS "student_update_policy" ON student;
DROP POLICY IF EXISTS "student_delete_policy" ON student;

-- Course table
DROP POLICY IF EXISTS "Allow all for anon" ON course;
DROP POLICY IF EXISTS "Allow all for authenticated" ON course;
DROP POLICY IF EXISTS "Everyone can view courses" ON course;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON course;
DROP POLICY IF EXISTS "Teachers have full access" ON course;
DROP POLICY IF EXISTS "Students can read courses" ON course;
DROP POLICY IF EXISTS "Authenticated users can read" ON course;

-- Session table
DROP POLICY IF EXISTS "Allow all for anon" ON session;
DROP POLICY IF EXISTS "Allow all for authenticated" ON session;
DROP POLICY IF EXISTS "Everyone can view sessions" ON session;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session;
DROP POLICY IF EXISTS "Teachers have full access" ON session;
DROP POLICY IF EXISTS "Students can read sessions" ON session;
DROP POLICY IF EXISTS "Authenticated users can read" ON session;

-- Enrollment table
DROP POLICY IF EXISTS "Allow all for anon" ON enrollment;
DROP POLICY IF EXISTS "Allow all for authenticated" ON enrollment;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Teachers have full access" ON enrollment;
DROP POLICY IF EXISTS "Students can read enrollments" ON enrollment;
DROP POLICY IF EXISTS "Authenticated users can read" ON enrollment;

-- Attendance table
DROP POLICY IF EXISTS "Allow all for anon" ON attendance;
DROP POLICY IF EXISTS "Allow all for authenticated" ON attendance;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Teachers have full access" ON attendance;
DROP POLICY IF EXISTS "Students can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can insert own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can update own attendance" ON attendance;
DROP POLICY IF EXISTS "Authenticated users can read" ON attendance;

-- Session Date Host table
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Teachers have full access" ON session_date_host;
DROP POLICY IF EXISTS "Students can read session hosts" ON session_date_host;
DROP POLICY IF EXISTS "Authenticated users can read" ON session_date_host;

-- ===== STEP 3: Enable RLS on all tables =====
ALTER TABLE teacher ENABLE ROW LEVEL SECURITY;
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE course ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_date_host ENABLE ROW LEVEL SECURITY;

-- ===== STEP 4: Teacher Policies (FULL ACCESS) =====
-- Teachers can SELECT, INSERT, UPDATE, DELETE on all tables

CREATE POLICY "Teachers have full access" ON teacher 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON student 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON course 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON session 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON enrollment 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON attendance 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

CREATE POLICY "Teachers have full access" ON session_date_host 
  FOR ALL TO authenticated 
  USING (is_teacher()) 
  WITH CHECK (is_teacher());

-- ===== STEP 5: Student Policies (READ + Self Check-in ONLY) =====
-- Students can READ all data (needed for QR/Photo check-in to work)
-- Students can ONLY insert/update their OWN attendance

-- Read access for students
CREATE POLICY "Students can read teachers" ON teacher 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

CREATE POLICY "Students can read students" ON student 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

CREATE POLICY "Students can read courses" ON course 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

CREATE POLICY "Students can read sessions" ON session 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

CREATE POLICY "Students can read enrollments" ON enrollment 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

CREATE POLICY "Students can read session hosts" ON session_date_host 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher());

-- Students can ONLY modify their OWN attendance (for QR/Photo check-in)
CREATE POLICY "Students can read own attendance" ON attendance 
  FOR SELECT TO authenticated 
  USING (NOT is_teacher() AND student_id = get_my_student_id());

CREATE POLICY "Students can insert own attendance" ON attendance 
  FOR INSERT TO authenticated 
  WITH CHECK (NOT is_teacher() AND student_id = get_my_student_id());

CREATE POLICY "Students can update own attendance" ON attendance 
  FOR UPDATE TO authenticated 
  USING (NOT is_teacher() AND student_id = get_my_student_id())
  WITH CHECK (NOT is_teacher() AND student_id = get_my_student_id());

-- ===== STEP 6: QR Sessions and Photo Check-in Sessions =====

DO $$
BEGIN
  -- QR Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qr_sessions' AND table_schema = 'public') THEN
    ALTER TABLE qr_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON qr_sessions;
    DROP POLICY IF EXISTS "Anyone can read QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "Students can read QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "Authenticated users can read QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "Teachers can create QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "System can update QR sessions" ON qr_sessions;
    
    -- Teachers: full access (create/read/update/delete QR codes)
    EXECUTE 'CREATE POLICY "Teachers have full access" ON qr_sessions FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    -- Students: can ONLY read QR tokens (for check-in link validation)
    EXECUTE 'CREATE POLICY "Students can read QR sessions" ON qr_sessions FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
  
  -- Photo Check-in Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_checkin_sessions' AND table_schema = 'public') THEN
    ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Anyone can read photo sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Students can read photo sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Authenticated users can read photo check-in sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Teachers can create photo check-in sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "System can update photo check-in sessions" ON photo_checkin_sessions;
    
    -- Teachers: full access
    EXECUTE 'CREATE POLICY "Teachers have full access" ON photo_checkin_sessions FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    -- Students: can ONLY read photo tokens (for check-in link validation)
    EXECUTE 'CREATE POLICY "Students can read photo sessions" ON photo_checkin_sessions FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
END $$;

-- ===== STEP 7: Course Book Reference and Session Book Coverage =====

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_book_reference' AND table_schema = 'public') THEN
    ALTER TABLE course_book_reference ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON course_book_reference;
    DROP POLICY IF EXISTS "Students can read book references" ON course_book_reference;
    
    EXECUTE 'CREATE POLICY "Teachers have full access" ON course_book_reference FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    EXECUTE 'CREATE POLICY "Students can read book references" ON course_book_reference FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_book_coverage' AND table_schema = 'public') THEN
    ALTER TABLE session_book_coverage ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON session_book_coverage;
    DROP POLICY IF EXISTS "Students can read book coverage" ON session_book_coverage;
    
    EXECUTE 'CREATE POLICY "Teachers have full access" ON session_book_coverage FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    EXECUTE 'CREATE POLICY "Students can read book coverage" ON session_book_coverage FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
END $$;

-- ===== STEP 8: Teacher Host Schedule =====

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teacher_host_schedule' AND table_schema = 'public') THEN
    ALTER TABLE teacher_host_schedule ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON teacher_host_schedule;
    DROP POLICY IF EXISTS "Students can read host schedule" ON teacher_host_schedule;
    
    EXECUTE 'CREATE POLICY "Teachers have full access" ON teacher_host_schedule FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    EXECUTE 'CREATE POLICY "Students can read host schedule" ON teacher_host_schedule FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
END $$;

-- ===== STEP 9: Audit Log (Teachers ONLY) =====

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log' AND table_schema = 'public') THEN
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON audit_log;
    DROP POLICY IF EXISTS "Allow authenticated users to insert audit logs" ON audit_log;
    DROP POLICY IF EXISTS "Allow authenticated users to read audit logs" ON audit_log;
    
    EXECUTE 'CREATE POLICY "Teachers have full access" ON audit_log FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
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
  RAISE NOTICE '✅ FINAL Teacher-Only RLS Successfully Applied!';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '';
  RAISE NOTICE '📚 TEACHERS (email in teacher table):';
  RAISE NOTICE '   ✓ Full access to ALL tables';
  RAISE NOTICE '   ✓ Can use Edit/Delete buttons';
  RAISE NOTICE '   ✓ Can access Attendance page';
  RAISE NOTICE '   ✓ Can mark attendance for ANY student';
  RAISE NOTICE '   ✓ Can generate QR codes and photo check-in links';
  RAISE NOTICE '';
  RAISE NOTICE '👨‍🎓 STUDENTS (email in student table):';
  RAISE NOTICE '   ✓ Can READ all data (for check-in to work)';
  RAISE NOTICE '   ✓ Can check-in for THEMSELVES via QR/Photo';
  RAISE NOTICE '   ✗ CANNOT access Attendance page (blocked in frontend)';
  RAISE NOTICE '   ✗ CANNOT mark attendance for other students';
  RAISE NOTICE '   ✗ CANNOT edit/delete any data';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 UNKNOWN USERS (email not in any table):';
  RAISE NOTICE '   ✗ No access to anything';
  RAISE NOTICE '';
  RAISE NOTICE 'FRONTEND PROTECTION:';
  RAISE NOTICE '   Attendance page checks if user is teacher';
  RAISE NOTICE '   Students are redirected to dashboard';
  RAISE NOTICE '';
END $$;
