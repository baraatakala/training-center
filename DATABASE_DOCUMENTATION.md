# Training Center Database Documentation

## Overview
This database schema is designed for a training center attendance management system. It tracks students, teachers, courses, sessions, locations, enrollments, and attendance records.

## Database Relationships

### Entity Relationship Diagram (Text Representation)

```
teacher
  ├── student (1:N - one teacher can have multiple students)
  ├── course (1:N - one teacher can teach multiple courses)
  └── session (1:N - one teacher can conduct multiple sessions)

course
  └── session (1:N - one course can have multiple sessions)

session
  ├── enrollment (1:N - one session can have multiple enrollments)
  └── session_location (1:N - one session can have multiple location assignments)

location
  └── session_location (1:N - one location can host multiple sessions)

student
  ├── enrollment (1:N - one student can have multiple enrollments)
  └── attendance (1:N - one student can have multiple attendance records)

enrollment
  └── attendance (1:N - one enrollment can have multiple attendance records)

session_location
  └── attendance (1:N - one session location can have multiple attendance records)
```

## Tables

### 1. `teacher`
Stores information about teachers/instructors.

**Columns:**
- `teacher_id` (UUID, PK) - Unique identifier for teacher
- `name` (VARCHAR) - Teacher's full name
- `phone` (VARCHAR) - Contact phone number
- `email` (VARCHAR, UNIQUE) - Email address
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

### 2. `student`
Stores information about students enrolled in the training center.

**Columns:**
- `student_id` (UUID, PK) - Unique identifier for student
- `teacher_id` (UUID, FK) - Reference to assigned teacher
- `name` (VARCHAR) - Student's full name
- `phone` (VARCHAR) - Contact phone number
- `email` (VARCHAR, UNIQUE) - Email address
- `address` (TEXT) - Residential address
- `nationality` (VARCHAR) - Student's nationality
- `age` (INTEGER) - Student's age
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `teacher` (via `teacher_id`)

### 3. `course`
Stores information about available courses.

**Columns:**
- `course_id` (UUID, PK) - Unique identifier for course
- `teacher_id` (UUID, FK) - Reference to primary teacher
- `course_name` (VARCHAR) - Name of the course
- `category` (VARCHAR) - Course category (e.g., Programming, Data Science)
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `teacher` (via `teacher_id`)

### 4. `session`
Stores information about scheduled course sessions (course instances with specific dates).

**Columns:**
- `session_id` (UUID, PK) - Unique identifier for session
- `course_id` (UUID, FK) - Reference to course
- `teacher_id` (UUID, FK) - Reference to instructor
- `start_date` (DATE) - Session start date
- `end_date` (DATE) - Session end date
- `day` (VARCHAR) - Days of the week (e.g., "Monday, Wednesday")
- `time` (VARCHAR) - Time range (e.g., "10:00 AM - 12:00 PM")
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `course` (via `course_id`)
- Many-to-One with `teacher` (via `teacher_id`)

**Constraints:**
- `end_date` must be >= `start_date`

### 5. `location`
Stores information about physical or virtual locations where sessions are held.

**Columns:**
- `location_id` (UUID, PK) - Unique identifier for location
- `location_name` (VARCHAR) - Name of the location
- `address` (TEXT) - Full address or details
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

### 6. `session_location`
Junction table linking sessions to specific locations with date and time details.

**Columns:**
- `id` (UUID, PK) - Unique identifier
- `session_id` (UUID, FK) - Reference to session
- `location_id` (UUID, FK) - Reference to location
- `date` (DATE) - Specific date for this session instance
- `start_time` (TIME) - Start time
- `end_time` (TIME) - End time
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `session` (via `session_id`)
- Many-to-One with `location` (via `location_id`)

**Constraints:**
- `end_time` must be > `start_time`
- Unique combination of `session_id`, `date`, and `start_time`

### 7. `enrollment`
Stores student enrollments in sessions.

**Columns:**
- `enrollment_id` (UUID, PK) - Unique identifier for enrollment
- `student_id` (UUID, FK) - Reference to student
- `session_id` (UUID, FK) - Reference to session
- `enrollment_date` (DATE) - Date of enrollment
- `status` (VARCHAR) - Enrollment status (active, completed, dropped, pending)
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `student` (via `student_id`)
- Many-to-One with `session` (via `session_id`)

**Constraints:**
- Unique combination of `student_id` and `session_id`

### 8. `attendance`
Tracks student attendance at specific session locations.

**Columns:**
- `attendance_id` (UUID, PK) - Unique identifier for attendance record
- `enrollment_id` (UUID, FK) - Reference to enrollment
- `session_location_id` (UUID, FK) - Reference to specific session location
- `student_id` (UUID, FK) - Reference to student
- `status` (VARCHAR) - Attendance status (present, absent, late, excused)
- `check_in_time` (TIMESTAMPTZ) - Actual check-in timestamp
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships:**
- Many-to-One with `enrollment` (via `enrollment_id`)
- Many-to-One with `session_location` (via `session_location_id`)
- Many-to-One with `student` (via `student_id`)

**Constraints:**
- Unique combination of `enrollment_id` and `session_location_id`

## Key Features

### 1. UUID Primary Keys
All tables use UUID as primary keys for better scalability and security.

### 2. Timestamps
All tables have `created_at` and `updated_at` timestamps that are automatically managed via triggers.

### 3. Row Level Security (RLS)
RLS is enabled on all tables with basic policies for authenticated users. You can customize these policies based on your specific security requirements.

### 4. Indexes
Performance indexes are created on:
- Foreign key columns
- Email columns
- Date columns
- Status columns

### 5. Cascading Deletes
- When a session is deleted, all related enrollments and session_locations are deleted
- When an enrollment is deleted, all related attendance records are deleted
- When a session_location is deleted, all related attendance records are deleted

## Setup Instructions

### 1. Create Database in Supabase
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `supabase-schema.sql`
4. Paste and run the SQL script

### 2. Insert Sample Data (Optional)
1. In the SQL Editor, copy the contents of `sample-data.sql`
2. Paste and run the script to populate with sample data

### 3. Configure Row Level Security Policies
The basic RLS policies allow all authenticated users to perform CRUD operations. You should customize these based on your requirements:

- Teachers should only see their own students and sessions
- Students should only see their own enrollment and attendance records
- Admins should have full access

Example custom policy for students viewing their own data:
```sql
CREATE POLICY "Students can view own records" ON student
    FOR SELECT TO authenticated 
    USING (auth.uid() = student_id OR auth.jwt()->>'role' = 'admin');
```

## Common Queries

### Get all students in a specific session
```sql
SELECT s.*, e.status, e.enrollment_date
FROM student s
JOIN enrollment e ON s.student_id = e.student_id
WHERE e.session_id = 'YOUR_SESSION_ID';
```

### Get attendance for a student in a session
```sql
SELECT 
    sl.date,
    sl.start_time,
    sl.end_time,
    l.location_name,
    a.status,
    a.check_in_time,
    a.notes
FROM attendance a
JOIN session_location sl ON a.session_location_id = sl.id
JOIN location l ON sl.location_id = l.location_id
WHERE a.student_id = 'YOUR_STUDENT_ID'
    AND sl.session_id = 'YOUR_SESSION_ID'
ORDER BY sl.date;
```

### Get all sessions for a course
```sql
SELECT 
    s.*,
    t.name as teacher_name,
    c.course_name
FROM session s
JOIN teacher t ON s.teacher_id = t.teacher_id
JOIN course c ON s.course_id = c.course_id
WHERE c.course_id = 'YOUR_COURSE_ID';
```

### Get attendance statistics for a session
```sql
SELECT 
    a.status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM attendance a
JOIN session_location sl ON a.session_location_id = sl.id
WHERE sl.session_id = 'YOUR_SESSION_ID'
GROUP BY a.status;
```

## Next Steps

1. Set up Supabase client in your React/TypeScript application
2. Create TypeScript types based on the database schema
3. Implement authentication using Supabase Auth
4. Create API functions to interact with the database
5. Build UI components for attendance tracking
6. Implement real-time updates using Supabase subscriptions
