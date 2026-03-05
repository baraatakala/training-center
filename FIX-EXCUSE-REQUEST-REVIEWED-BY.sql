-- Fix: reviewed_by column was UUID REFERENCES teacher(teacher_id)
-- but the app sends user email (TEXT). Admins may not be in teacher table.
-- Change from UUID FK to TEXT to store reviewer email.

-- 1. Drop the foreign key constraint
ALTER TABLE excuse_request DROP CONSTRAINT IF EXISTS excuse_request_reviewed_by_fkey;

-- 2. Change column type from UUID to TEXT
ALTER TABLE excuse_request ALTER COLUMN reviewed_by TYPE TEXT USING reviewed_by::TEXT;

-- Verify
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'excuse_request' AND column_name = 'reviewed_by';
