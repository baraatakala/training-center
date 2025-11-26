-- Temporary fix: Disable RLS and allow anonymous access for development
-- Run this in Supabase SQL Editor to allow your app to work without authentication

-- Disable RLS on all tables
ALTER TABLE teacher DISABLE ROW LEVEL SECURITY;
ALTER TABLE student DISABLE ROW LEVEL SECURITY;
ALTER TABLE course DISABLE ROW LEVEL SECURITY;
ALTER TABLE session DISABLE ROW LEVEL SECURITY;
ALTER TABLE location DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_location DISABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;

-- OR keep RLS enabled but add policies for anonymous users (anon role)
-- Drop existing policies first
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON teacher;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON teacher;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON student;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON student;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON course;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON course;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON location;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON location;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON location;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON location;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON session_location;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON session_location;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON session_location;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON session_location;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON enrollment;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON enrollment;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON attendance;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON attendance;

-- Create new policies that allow anonymous access
-- Teacher policies
CREATE POLICY "Allow all for anon" ON teacher FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON teacher FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Student policies
CREATE POLICY "Allow all for anon" ON student FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON student FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Course policies
CREATE POLICY "Allow all for anon" ON course FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON course FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Session policies
CREATE POLICY "Allow all for anon" ON session FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON session FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Location policies
CREATE POLICY "Allow all for anon" ON location FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON location FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Session Location policies
CREATE POLICY "Allow all for anon" ON session_location FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON session_location FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enrollment policies
CREATE POLICY "Allow all for anon" ON enrollment FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON enrollment FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Attendance policies
CREATE POLICY "Allow all for anon" ON attendance FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
