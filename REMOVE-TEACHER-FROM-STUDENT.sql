-- Migration: Remove teacher_id from student table
-- Date: 2026-01-27
-- Reason: Student-teacher relationship should only exist through enrollments
--         (student → enrollment → session → course → teacher)
--         Direct assignment is redundant and confusing

-- Drop the index first
DROP INDEX IF EXISTS idx_student_teacher;

-- Drop the foreign key constraint and column
ALTER TABLE student DROP COLUMN IF EXISTS teacher_id;

-- Verification query (should show no teacher_id column)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'student'
ORDER BY ordinal_position;
