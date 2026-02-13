-- DECOUPLE-ADMIN-FROM-TEACHER.sql
-- =================================================================
-- Remove the dependency that forces admin to exist in teacher table
-- =================================================================
--
-- PROBLEM:
--   announcement.created_by has FK → teacher(teacher_id)
--   This forces admin to have a fake teacher record just to create
--   announcements. Admin, teacher, student should be fully separate.
--
-- FIX:
--   1. Drop the FK on announcement.created_by (keep column as UUID)
--   2. Add creator_type column so we know which table to resolve name from
--   3. Add 'admin' to message sender_type/recipient_type CHECK constraints
--   4. Drop the admin→teacher sync trigger (no longer needed)
--   5. Clean up the fake admin teacher record
--
-- Date: 2026-02-13
-- =================================================================

-- ===== STEP 1: Drop FK constraint on announcement.created_by =====
ALTER TABLE announcement DROP CONSTRAINT IF EXISTS announcement_created_by_fkey;

-- ===== STEP 2: Add creator_type column =====
-- Default 'teacher' for all existing records (backwards compatible)
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS creator_type TEXT DEFAULT 'teacher';

-- Update existing admin announcements to have creator_type = 'admin'
-- (Match by the admin's email → old teacher record → announcements)
UPDATE announcement SET creator_type = 'admin'
WHERE created_by IN (
  SELECT t.teacher_id FROM teacher t
  INNER JOIN admin a ON LOWER(t.email) = LOWER(a.email)
);

-- ===== STEP 3: Migrate admin announcements to use admin_id =====
-- Change created_by from the fake teacher_id to the real admin_id
UPDATE announcement SET created_by = a.admin_id
FROM admin a
INNER JOIN teacher t ON LOWER(t.email) = LOWER(a.email)
WHERE announcement.created_by = t.teacher_id
AND announcement.creator_type = 'admin';

-- ===== STEP 4: Add 'admin' to message sender_type CHECK =====
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_sender_type_check;
ALTER TABLE message ADD CONSTRAINT message_sender_type_check
  CHECK (sender_type IN ('teacher', 'student', 'admin'));

-- ===== STEP 5: Add 'admin' to message recipient_type CHECK =====
ALTER TABLE message DROP CONSTRAINT IF EXISTS message_recipient_type_check;
ALTER TABLE message ADD CONSTRAINT message_recipient_type_check
  CHECK (recipient_type IN ('teacher', 'student', 'admin'));

-- ===== STEP 6: Migrate admin's existing messages to sender_type='admin' =====
-- Update messages sent by admin (currently stored as sender_type='teacher' with the fake teacher_id)
UPDATE message SET sender_type = 'admin', sender_id = a.admin_id
FROM admin a
INNER JOIN teacher t ON LOWER(t.email) = LOWER(a.email)
WHERE message.sender_type = 'teacher'
AND message.sender_id = t.teacher_id;

-- Update messages received by admin
UPDATE message SET recipient_type = 'admin', recipient_id = a.admin_id
FROM admin a
INNER JOIN teacher t ON LOWER(t.email) = LOWER(a.email)
WHERE message.recipient_type = 'teacher'
AND message.recipient_id = t.teacher_id;

-- ===== STEP 7: Drop the admin→teacher sync trigger =====
DROP TRIGGER IF EXISTS trg_sync_admin_to_teacher ON admin;
DROP FUNCTION IF EXISTS sync_admin_to_teacher();

-- ===== STEP 8: Delete the fake admin teacher record =====
-- Only safe AFTER migrating all FK references above
-- Check for any remaining references first:
-- DELETE FROM teacher WHERE email IN (SELECT email FROM admin)
--   AND teacher_id NOT IN (SELECT teacher_id FROM session)
--   AND teacher_id NOT IN (SELECT teacher_id FROM ... any other FK);
-- 
-- For safety, we'll do a conditional delete — only if no real sessions reference this teacher:
DELETE FROM teacher t
USING admin a
WHERE LOWER(t.email) = LOWER(a.email)
AND NOT EXISTS (SELECT 1 FROM session s WHERE s.teacher_id = t.teacher_id);

-- ===== VERIFICATION =====
-- Run after executing:
--
-- 1. Check announcement FK is gone:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'announcement'::regclass AND conname LIKE '%created_by%';
-- Expected: 0 rows
--
-- 2. Check creator_type column exists:
-- SELECT creator_type, count(*) FROM announcement GROUP BY creator_type;
-- Expected: 'admin' for admin's announcements, 'teacher' for rest
--
-- 3. Check admin is NOT in teacher table:
-- SELECT * FROM teacher WHERE email IN (SELECT email FROM admin);
-- Expected: 0 rows (if no real sessions assigned)
--
-- 4. Check message CHECK constraint includes admin:
-- SELECT conname, consrc FROM pg_constraint WHERE conrelid = 'message'::regclass AND conname LIKE '%sender_type%';
