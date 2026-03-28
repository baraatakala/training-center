-- ================================================================
-- FIX ATTENDANCE CONSTRAINT MISMATCH
-- Just drop the wrong constraint. The correct one already exists.
-- ================================================================

-- Drop the WRONG constraint added by ChatGPT
ALTER TABLE attendance 
DROP CONSTRAINT IF EXISTS unique_attendance_student_session_date;

-- That's it! The correct constraint (enrollment_id, attendance_date) 
-- is already in place. Run CHECK-ATTENDANCE-CONSTRAINTS.sql to verify.
