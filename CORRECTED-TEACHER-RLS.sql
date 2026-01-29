-- CORRECTED-TEACHER-RLS.sql
-- Fixed RLS: Teachers = full access, Students = read + self check-in
-- Date: 2026-01-29

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

-- ===== STEP 2: Drop ALL existing policies =====

-- Teacher table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Teachers have full access" ON teacher;
DROP POLICY IF EXISTS "Students can read teachers" ON teacher;

-- Student table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON student;
DROP POLICY IF EXISTS "Teachers have full access" ON student;
DROP POLICY IF EXISTS "Students can read students" ON student;

-- Course table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON course;
DROP POLICY IF EXISTS "Teachers have full access" ON course;
DROP POLICY IF EXISTS "Students can read courses" ON course;

-- Session table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session;
DROP POLICY IF EXISTS "Teachers have full access" ON session;
DROP POLICY IF EXISTS "Students can read sessions" ON session;

-- Enrollment table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Teachers have full access" ON enrollment;
DROP POLICY IF EXISTS "Students can read enrollments" ON enrollment;

-- Attendance table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Teachers have full access" ON attendance;
DROP POLICY IF EXISTS "Students can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can insert own attendance" ON attendance;
DROP POLICY IF EXISTS "Students can update own attendance" ON attendance;

-- Session Date Host table
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session_date_host;
DROP POLICY IF EXISTS "Teachers have full access" ON session_date_host;
DROP POLICY IF EXISTS "Students can read session hosts" ON session_date_host;

-- ===== STEP 3: Enable RLS on all tables =====
ALTER TABLE teacher ENABLE ROW LEVEL SECURITY;
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE course ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_date_host ENABLE ROW LEVEL SECURITY;

-- ===== STEP 4: Create Teacher Policies (Full Access) =====

-- Teachers can do everything on all tables
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

-- ===== STEP 5: Create Student Policies (Read + Self Check-in) =====

-- Students can READ all data (needed for check-in pages)
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

-- Students can read, insert, and update THEIR OWN attendance (for check-in)
CREATE POLICY "Students can read own attendance" ON attendance 
  FOR SELECT TO authenticated 
  USING (student_id = get_my_student_id());

CREATE POLICY "Students can insert own attendance" ON attendance 
  FOR INSERT TO authenticated 
  WITH CHECK (student_id = get_my_student_id());

CREATE POLICY "Students can update own attendance" ON attendance 
  FOR UPDATE TO authenticated 
  USING (student_id = get_my_student_id())
  WITH CHECK (student_id = get_my_student_id());

-- ===== STEP 6: QR Sessions and Photo Check-in Sessions =====

DO $$
BEGIN
  -- QR Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qr_sessions' AND table_schema = 'public') THEN
    ALTER TABLE qr_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON qr_sessions;
    DROP POLICY IF EXISTS "Anyone can read QR sessions" ON qr_sessions;
    DROP POLICY IF EXISTS "Students can read QR sessions" ON qr_sessions;
    
    -- Teachers: full access
    EXECUTE 'CREATE POLICY "Teachers have full access" ON qr_sessions FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    -- Students: can read QR tokens for check-in
    EXECUTE 'CREATE POLICY "Students can read QR sessions" ON qr_sessions FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
  
  -- Photo Check-in Sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_checkin_sessions' AND table_schema = 'public') THEN
    ALTER TABLE photo_checkin_sessions ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Anyone can read photo sessions" ON photo_checkin_sessions;
    DROP POLICY IF EXISTS "Students can read photo sessions" ON photo_checkin_sessions;
    
    -- Teachers: full access
    EXECUTE 'CREATE POLICY "Teachers have full access" ON photo_checkin_sessions FOR ALL TO authenticated USING (is_teacher()) WITH CHECK (is_teacher())';
    -- Students: can read photo tokens for check-in
    EXECUTE 'CREATE POLICY "Students can read photo sessions" ON photo_checkin_sessions FOR SELECT TO authenticated USING (NOT is_teacher())';
  END IF;
END $$;

-- ===== STEP 7: Audit Log (teachers only) =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log' AND table_schema = 'public') THEN
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Teachers have full access" ON audit_log;
    
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
  RAISE NOTICE '✅ Corrected Teacher RLS Applied!';
  RAISE NOTICE '';
  RAISE NOTICE 'HOW IT WORKS:';
  RAISE NOTICE '';
  RAISE NOTICE '📚 TEACHERS (email matches teacher table):';
  RAISE NOTICE '   ✓ Full access to all tables';
  RAISE NOTICE '   ✓ Can use Edit buttons';
  RAISE NOTICE '   ✓ Can access Attendance page';
  RAISE NOTICE '   ✓ Can create/update/delete everything';
  RAISE NOTICE '';
  RAISE NOTICE '👨‍🎓 STUDENTS (email matches student table):';
  RAISE NOTICE '   ✓ Can READ all data (for check-in pages)';
  RAISE NOTICE '   ✓ Can INSERT/UPDATE their own attendance';
  RAISE NOTICE '   ✗ Cannot edit teachers, courses, sessions, etc.';
  RAISE NOTICE '';
  RAISE NOTICE '🔐 UNKNOWN USERS (email not in any table):';
  RAISE NOTICE '   ✗ No access to anything';
  RAISE NOTICE '';
END $$;
