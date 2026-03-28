-- Sample Data for Training Center Database
-- This file contains sample data to test the database schema

-- Insert sample teachers
INSERT INTO teacher (name, phone, email) VALUES
    ('John Smith', '+1-555-0101', 'john.smith@trainingcenter.com'),
    ('Sarah Johnson', '+1-555-0102', 'sarah.johnson@trainingcenter.com'),
    ('Michael Brown', '+1-555-0103', 'michael.brown@trainingcenter.com');

-- Insert sample students
INSERT INTO student (teacher_id, name, phone, email, address, nationality, age) VALUES
    ((SELECT teacher_id FROM teacher WHERE email = 'john.smith@trainingcenter.com'), 
     'Alice Williams', '+1-555-1001', 'alice.williams@example.com', '123 Main St, City', 'USA', 22),
    ((SELECT teacher_id FROM teacher WHERE email = 'john.smith@trainingcenter.com'), 
     'Bob Davis', '+1-555-1002', 'bob.davis@example.com', '456 Oak Ave, City', 'Canada', 24),
    ((SELECT teacher_id FROM teacher WHERE email = 'sarah.johnson@trainingcenter.com'), 
     'Charlie Wilson', '+1-555-1003', 'charlie.wilson@example.com', '789 Pine Rd, City', 'UK', 23),
    ((SELECT teacher_id FROM teacher WHERE email = 'sarah.johnson@trainingcenter.com'), 
     'Diana Martinez', '+1-555-1004', 'diana.martinez@example.com', '321 Elm St, City', 'Spain', 25),
    ((SELECT teacher_id FROM teacher WHERE email = 'michael.brown@trainingcenter.com'), 
     'Ethan Anderson', '+1-555-1005', 'ethan.anderson@example.com', '654 Maple Dr, City', 'Australia', 21);

-- Insert sample courses
INSERT INTO course (teacher_id, course_name, category) VALUES
    ((SELECT teacher_id FROM teacher WHERE email = 'john.smith@trainingcenter.com'), 
     'Web Development Fundamentals', 'Programming'),
    ((SELECT teacher_id FROM teacher WHERE email = 'sarah.johnson@trainingcenter.com'), 
     'Advanced React', 'Programming'),
    ((SELECT teacher_id FROM teacher WHERE email = 'michael.brown@trainingcenter.com'), 
     'Database Design', 'Data Science'),
    ((SELECT teacher_id FROM teacher WHERE email = 'john.smith@trainingcenter.com'), 
     'TypeScript Essentials', 'Programming');

-- Insert sample locations
INSERT INTO location (location_name, address) VALUES
    ('Main Campus - Room 101', '1000 University Ave, Building A, Room 101'),
    ('Main Campus - Room 202', '1000 University Ave, Building B, Room 202'),
    ('Downtown Center - Lab 1', '500 Downtown Blvd, 3rd Floor, Lab 1'),
    ('Online Virtual Room', 'Virtual Meeting Platform');

-- Insert sample sessions
INSERT INTO session (course_id, teacher_id, start_date, end_date, day, time) VALUES
    ((SELECT course_id FROM course WHERE course_name = 'Web Development Fundamentals'),
     (SELECT teacher_id FROM teacher WHERE email = 'john.smith@trainingcenter.com'),
     '2025-01-15', '2025-03-15', 'Monday, Wednesday', '10:00 AM - 12:00 PM'),
    ((SELECT course_id FROM course WHERE course_name = 'Advanced React'),
     (SELECT teacher_id FROM teacher WHERE email = 'sarah.johnson@trainingcenter.com'),
     '2025-01-20', '2025-04-20', 'Tuesday, Thursday', '2:00 PM - 4:00 PM'),
    ((SELECT course_id FROM course WHERE course_name = 'Database Design'),
     (SELECT teacher_id FROM teacher WHERE email = 'michael.brown@trainingcenter.com'),
     '2025-02-01', '2025-04-30', 'Friday', '9:00 AM - 12:00 PM');

-- Insert sample session locations
INSERT INTO session_location (session_id, location_id, date, start_time, end_time) VALUES
    ((SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Web Development Fundamentals'),
     (SELECT location_id FROM location WHERE location_name = 'Main Campus - Room 101'),
     '2025-01-15', '10:00:00', '12:00:00'),
    ((SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Web Development Fundamentals'),
     (SELECT location_id FROM location WHERE location_name = 'Main Campus - Room 101'),
     '2025-01-17', '10:00:00', '12:00:00'),
    ((SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Advanced React'),
     (SELECT location_id FROM location WHERE location_name = 'Downtown Center - Lab 1'),
     '2025-01-21', '14:00:00', '16:00:00'),
    ((SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Database Design'),
     (SELECT location_id FROM location WHERE location_name = 'Main Campus - Room 202'),
     '2025-02-02', '09:00:00', '12:00:00');

-- Insert sample enrollments
INSERT INTO enrollment (student_id, session_id, enrollment_date, status) VALUES
    ((SELECT student_id FROM student WHERE email = 'alice.williams@example.com'),
     (SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Web Development Fundamentals'),
     '2025-01-10', 'active'),
    ((SELECT student_id FROM student WHERE email = 'bob.davis@example.com'),
     (SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Web Development Fundamentals'),
     '2025-01-10', 'active'),
    ((SELECT student_id FROM student WHERE email = 'charlie.wilson@example.com'),
     (SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Advanced React'),
     '2025-01-15', 'active'),
    ((SELECT student_id FROM student WHERE email = 'diana.martinez@example.com'),
     (SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Advanced React'),
     '2025-01-15', 'active'),
    ((SELECT student_id FROM student WHERE email = 'ethan.anderson@example.com'),
     (SELECT session_id FROM session s JOIN course c ON s.course_id = c.course_id WHERE c.course_name = 'Database Design'),
     '2025-01-25', 'active');

-- Insert sample attendance records
INSERT INTO attendance (enrollment_id, session_location_id, student_id, status, check_in_time, notes) VALUES
    ((SELECT e.enrollment_id FROM enrollment e 
      JOIN student s ON e.student_id = s.student_id 
      WHERE s.email = 'alice.williams@example.com'),
     (SELECT id FROM session_location WHERE date = '2025-01-15'),
     (SELECT student_id FROM student WHERE email = 'alice.williams@example.com'),
     'present', '2025-01-15 09:55:00', 'On time'),
    ((SELECT e.enrollment_id FROM enrollment e 
      JOIN student s ON e.student_id = s.student_id 
      WHERE s.email = 'bob.davis@example.com'),
     (SELECT id FROM session_location WHERE date = '2025-01-15'),
     (SELECT student_id FROM student WHERE email = 'bob.davis@example.com'),
     'late', '2025-01-15 10:15:00', 'Arrived 15 minutes late');
