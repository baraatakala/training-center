# SQL Guide For This Website

This project is a Supabase PostgreSQL app. Most backend work falls into 8 SQL patterns:

## 1. Read Data
Use `SELECT` when you want to inspect tables.

```sql
SELECT *
FROM public.student
ORDER BY created_at DESC;
```

Filter with `WHERE`:

```sql
SELECT student_id, name, email
FROM public.student
WHERE email ILIKE '%gmail.com%';
```

## 2. Join Related Tables
Most project screens join `attendance`, `student`, `session`, `course`, and `teacher`.

```sql
SELECT
  a.attendance_date,
  st.name AS student_name,
  c.course_name,
  t.name AS teacher_name,
  a.status,
  a.excuse_reason
FROM public.attendance a
JOIN public.student st ON st.student_id = a.student_id
JOIN public.session s ON s.session_id = a.session_id
JOIN public.course c ON c.course_id = s.course_id
LEFT JOIN public.teacher t ON t.teacher_id = s.teacher_id
ORDER BY a.attendance_date DESC;
```

## 3. Insert Data
Use `INSERT` for new rows.

```sql
INSERT INTO public.course (course_name, teacher_id)
VALUES ('Fiqh Basics', 'teacher-uuid-here');
```

Insert an excuse request:

```sql
INSERT INTO public.excuse_request (
  student_id,
  session_id,
  attendance_date,
  reason,
  status
)
VALUES (
  'student-uuid',
  'session-uuid',
  '2026-03-19',
  'sick',
  'pending'
);
```

## 4. Update Data
Use `UPDATE` when fixing or changing rows.

```sql
UPDATE public.attendance
SET status = 'excused',
    excuse_reason = 'sick',
    marked_at = now()
WHERE enrollment_id = 'enrollment-uuid'
  AND attendance_date = '2026-03-19';
```

## 5. Delete Data Carefully
Use `DELETE` only with precise filters.

```sql
DELETE FROM public.message
WHERE message_id = 'message-uuid';
```

Always check first:

```sql
SELECT *
FROM public.message
WHERE message_id = 'message-uuid';
```

## 6. Upsert Data
This project uses `UPSERT` heavily for attendance and per-date session data.

```sql
INSERT INTO public.attendance (
  enrollment_id,
  student_id,
  session_id,
  attendance_date,
  status
)
VALUES (
  'enrollment-uuid',
  'student-uuid',
  'session-uuid',
  '2026-03-19',
  'on time'
)
ON CONFLICT (enrollment_id, attendance_date)
DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();
```

## 7. Aggregate Data For Analytics
Use `COUNT`, `SUM`, `AVG`, and `GROUP BY`.

Attendance totals by date:

```sql
SELECT
  attendance_date,
  COUNT(*) FILTER (WHERE status = 'on time') AS on_time_count,
  COUNT(*) FILTER (WHERE status = 'late') AS late_count,
  COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
  COUNT(*) FILTER (WHERE status = 'excused') AS excused_count
FROM public.attendance
GROUP BY attendance_date
ORDER BY attendance_date DESC;
```

Student attendance summary:

```sql
SELECT
  student_id,
  COUNT(*) AS total_records,
  COUNT(*) FILTER (WHERE status = 'on time') AS on_time_count,
  COUNT(*) FILTER (WHERE status = 'late') AS late_count,
  COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
  COUNT(*) FILTER (WHERE status = 'excused') AS excused_count
FROM public.attendance
GROUP BY student_id;
```

## 8. Build Safety Rules
The project often uses SQL for constraints, triggers, and policies.

Example CHECK constraint:

```sql
ALTER TABLE public.message_starred
ADD CONSTRAINT message_starred_user_type_check
CHECK (user_type IN ('teacher', 'student', 'admin'));
```

Example trigger idea:
- Validate an excuse date matches the session weekday.
- Auto-update `updated_at` columns.
- Write audit logs.

## Core Tables You Should Know
- `student`: student profile data
- `teacher`: teacher profile data
- `admin`: admin profile data
- `course`: course metadata
- `session`: scheduled class/session with day and time
- `enrollment`: student-session membership
- `attendance`: one attendance row per student per session date
- `excuse_request`: student excuse submissions
- `message`: internal messaging
- `audit_log`: tracked inserts/updates/deletes

## Common Debug Queries
Find invalid excuse requests that do not match the session weekday:

```sql
SELECT
  er.request_id,
  s.day AS scheduled_day,
  er.attendance_date,
  trim(to_char(er.attendance_date, 'Day')) AS actual_day,
  er.status
FROM public.excuse_request er
JOIN public.session s ON s.session_id = er.session_id
WHERE EXTRACT(DOW FROM er.attendance_date) <> CASE lower(s.day)
  WHEN 'sunday' THEN 0
  WHEN 'monday' THEN 1
  WHEN 'tuesday' THEN 2
  WHEN 'wednesday' THEN 3
  WHEN 'thursday' THEN 4
  WHEN 'friday' THEN 5
  WHEN 'saturday' THEN 6
  ELSE -1
END;
```

Find session-not-held attendance rows:

```sql
SELECT *
FROM public.attendance
WHERE excuse_reason = 'session not held'
ORDER BY attendance_date DESC;
```

Find duplicate attendance keys:

```sql
SELECT enrollment_id, attendance_date, COUNT(*)
FROM public.attendance
GROUP BY enrollment_id, attendance_date
HAVING COUNT(*) > 1;
```

## How To Think About SQL In This Project
- `session.day` defines when a session is supposed to happen.
- `enrollment` decides who is accountable for a session.
- `attendance` is the operational truth for each session date.
- `excuse_request` is a workflow table, not the final attendance truth.
- `audit_log` is the history trail.

## Recommended Learning Order
1. Learn `SELECT`, `WHERE`, `ORDER BY`
2. Learn `JOIN`
3. Learn `INSERT`, `UPDATE`, `DELETE`
4. Learn `GROUP BY` and `FILTER`
5. Learn `ON CONFLICT DO UPDATE`
6. Learn constraints and triggers
7. Learn policies and RLS once you are comfortable with the tables

## Safe Workflow
1. Run `SELECT` first.
2. Confirm the target rows.
3. Run `UPDATE` or `DELETE` only after checking.
4. Prefer transactions for risky changes.

Example:

```sql
BEGIN;

UPDATE public.attendance
SET status = 'excused'
WHERE attendance_id = 'some-id';

SELECT *
FROM public.attendance
WHERE attendance_id = 'some-id';

ROLLBACK;
```

When you want, I can also generate a second file focused only on Supabase RLS, triggers, and performance tuning for this schema.