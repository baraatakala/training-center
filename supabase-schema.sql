-- Training Center Database Schema for Supabase
-- This schema implements the data model for managing students, teachers, courses, sessions, locations, enrollments, and attendance

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: teacher
-- Stores teacher information
CREATE TABLE teacher (
    teacher_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: student
-- Stores student information with reference to their assigned teacher
CREATE TABLE student (
    student_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID REFERENCES teacher(teacher_id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255) UNIQUE NOT NULL,
    address TEXT,
    nationality VARCHAR(100),
    age INTEGER CHECK (age > 0 AND age < 150),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: course
-- Stores course information
CREATE TABLE course (
    course_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID REFERENCES teacher(teacher_id) ON DELETE SET NULL,
    course_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: session
-- Stores session information (a session is a scheduled course instance)
CREATE TABLE session (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teacher(teacher_id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    day VARCHAR(20), -- e.g., "Monday", "Tuesday"
    time VARCHAR(50), -- e.g., "10:00 AM - 12:00 PM"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

-- Table: location
-- Stores location/venue information
CREATE TABLE location (
    location_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_name VARCHAR(255) NOT NULL,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: session_location
-- Junction table linking sessions to specific locations with date and time details
CREATE TABLE session_location (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES location(location_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_time > start_time),
    UNIQUE(session_id, date, start_time)
);

-- Table: enrollment
-- Stores student enrollments in sessions
CREATE TABLE enrollment (
    enrollment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
    enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'active', -- e.g., 'active', 'completed', 'dropped', 'pending'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, session_id)
);

-- Table: attendance
-- Tracks student attendance at specific session locations
CREATE TABLE attendance (
    attendance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollment(enrollment_id) ON DELETE CASCADE,
    session_location_id UUID NOT NULL REFERENCES session_location(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'absent', -- 'present', 'absent', 'late', 'excused'
    check_in_time TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(enrollment_id, session_location_id)
);

-- Create indexes for better query performance
CREATE INDEX idx_student_teacher ON student(teacher_id);
CREATE INDEX idx_student_email ON student(email);
CREATE INDEX idx_course_teacher ON course(teacher_id);
CREATE INDEX idx_session_course ON session(course_id);
CREATE INDEX idx_session_teacher ON session(teacher_id);
CREATE INDEX idx_session_dates ON session(start_date, end_date);
CREATE INDEX idx_session_location_session ON session_location(session_id);
CREATE INDEX idx_session_location_location ON session_location(location_id);
CREATE INDEX idx_session_location_date ON session_location(date);
CREATE INDEX idx_enrollment_student ON enrollment(student_id);
CREATE INDEX idx_enrollment_session ON enrollment(session_id);
CREATE INDEX idx_enrollment_status ON enrollment(status);
CREATE INDEX idx_attendance_enrollment ON attendance(enrollment_id);
CREATE INDEX idx_attendance_session_location ON attendance(session_location_id);
CREATE INDEX idx_attendance_student ON attendance(student_id);
CREATE INDEX idx_attendance_status ON attendance(status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables
CREATE TRIGGER update_teacher_updated_at BEFORE UPDATE ON teacher
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_updated_at BEFORE UPDATE ON student
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_updated_at BEFORE UPDATE ON course
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_updated_at BEFORE UPDATE ON session
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_location_updated_at BEFORE UPDATE ON location
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_location_updated_at BEFORE UPDATE ON session_location
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enrollment_updated_at BEFORE UPDATE ON enrollment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE teacher ENABLE ROW LEVEL SECURITY;
ALTER TABLE student ENABLE ROW LEVEL SECURITY;
ALTER TABLE course ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies (adjust based on your authentication requirements)
-- These are permissive policies for authenticated users - customize as needed

CREATE POLICY "Enable read access for authenticated users" ON teacher
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON student
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON course
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON session
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON location
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON session_location
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON enrollment
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" ON attendance
    FOR SELECT TO authenticated USING (true);

-- Insert policies (adjust permissions as needed)
CREATE POLICY "Enable insert for authenticated users" ON teacher
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON student
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON course
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON session
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON location
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON session_location
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON enrollment
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users" ON attendance
    FOR INSERT TO authenticated WITH CHECK (true);

-- Update policies
CREATE POLICY "Enable update for authenticated users" ON teacher
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON student
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON course
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON session
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON location
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON session_location
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON enrollment
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable update for authenticated users" ON attendance
    FOR UPDATE TO authenticated USING (true);

-- Delete policies
CREATE POLICY "Enable delete for authenticated users" ON teacher
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON student
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON course
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON session
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON location
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON session_location
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON enrollment
    FOR DELETE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON attendance
    FOR DELETE TO authenticated USING (true);
