-- ADD-ADMIN-TABLE.sql
-- =================================================================
-- Create a dedicated admin table + update is_admin() to use it
-- =================================================================
--
-- PROBLEM (old approach):
--   - is_admin() was hardcoded to a single email address
--   - Admin had to be manually inserted into the teacher table for
--     announcements/messages to work (FK constraints)
--   - Not scalable: adding a new admin = code change + redeploy
--
-- FIX (new approach):
--   - Create an `admin` table to store admin users
--   - Update is_admin() to check the admin table (dynamic, scalable)
--   - Admin users MUST also exist in the teacher table for FK
--     compatibility (announcements.created_by, message.sender_id, etc.)
--   - A trigger auto-ensures every admin has a teacher record
--
-- Date: 2026-02-13
-- =================================================================

-- ===== STEP 1: Create the admin table =====
CREATE TABLE IF NOT EXISTS admin (
  admin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Admin',
  auth_user_id UUID UNIQUE,  -- links to auth.users.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== STEP 2: Seed current admin into the table =====
INSERT INTO admin (email, name)
VALUES ('baraatakala2004@gmail.com', 'Admin')
ON CONFLICT (email) DO NOTHING;

-- ===== STEP 3: Ensure admin also exists in teacher table =====
-- (Required for FK constraints on announcement.created_by, message.sender_id, etc.)
INSERT INTO teacher (name, email)
VALUES ('Admin', 'baraatakala2004@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- ===== STEP 4: Update is_admin() to check admin table =====
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== STEP 5: Enable RLS on admin table =====
ALTER TABLE admin ENABLE ROW LEVEL SECURITY;

-- Admins can read the admin table
CREATE POLICY "Admin read admin table" ON admin
  FOR SELECT TO authenticated
  USING (is_admin());

-- Admins can insert new admins
CREATE POLICY "Admin insert admin table" ON admin
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Admins can update admin records
CREATE POLICY "Admin update admin table" ON admin
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Admins can delete admin records
CREATE POLICY "Admin delete admin table" ON admin
  FOR DELETE TO authenticated
  USING (is_admin());

-- ===== STEP 6: Trigger to auto-sync admin → teacher =====
-- When an admin is inserted or updated, ensure they also exist in teacher table
CREATE OR REPLACE FUNCTION sync_admin_to_teacher()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.email IS DISTINCT FROM NEW.email THEN
    -- Email changed: update the teacher record
    UPDATE teacher SET email = NEW.email, name = NEW.name
    WHERE email = OLD.email;
  ELSE
    -- Insert: create teacher record if not exists
    INSERT INTO teacher (name, email)
    VALUES (NEW.name, NEW.email)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_admin_to_teacher ON admin;
CREATE TRIGGER trg_sync_admin_to_teacher
  AFTER INSERT OR UPDATE ON admin
  FOR EACH ROW
  EXECUTE FUNCTION sync_admin_to_teacher();

-- ===== VERIFICATION =====
-- Run after executing:
-- SELECT * FROM admin;
-- Expected: 1 row (baraatakala2004@gmail.com)
--
-- SELECT is_admin(); -- when logged in as admin
-- Expected: true
--
-- SELECT * FROM teacher WHERE email = 'baraatakala2004@gmail.com';
-- Expected: 1 row (auto-synced)
