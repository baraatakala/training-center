-- FIX-SCORING-CONFIG-RLS.sql
-- =================================================================
-- Fix scoring_config RLS: Admin-only write, everyone can read
-- =================================================================
--
-- PROBLEM:
--   - The old RLS policy ("Teachers have full access") lets ANY teacher
--     create their own scoring config row.
--   - getScoringConfig() filtered by teacher_id = user.id, so each
--     teacher/admin saw THEIR OWN config → different weighted scores.
--   - Students couldn't read the config at all (no SELECT policy).
--
-- FIX:
--   - Admin (baraatakala2004@gmail.com): full CRUD
--   - Teacher (non-admin): SELECT only (read the admin's config)
--   - Student: SELECT only (read the admin's config for score display)
--   - Delete any non-admin config rows (stale teacher configs)
--
-- Date: 2026-02-13
-- =================================================================

-- ===== STEP 1: Drop ALL existing policies on scoring_config =====
DROP POLICY IF EXISTS "Teachers have full access" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_select" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_insert" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_update" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_delete" ON scoring_config;
DROP POLICY IF EXISTS "Allow all for authenticated" ON scoring_config;
DROP POLICY IF EXISTS "Allow all for anon" ON scoring_config;
DROP POLICY IF EXISTS "Admin full access scoring_config" ON scoring_config;
DROP POLICY IF EXISTS "Authenticated read scoring_config" ON scoring_config;

-- ===== STEP 2: Ensure RLS is enabled =====
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

-- ===== STEP 3: Create new policies =====

-- Admin: full CRUD access
CREATE POLICY "Admin full access scoring_config" ON scoring_config
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- All authenticated users: can READ any config (for score calculations)
CREATE POLICY "Authenticated read scoring_config" ON scoring_config
  FOR SELECT TO authenticated
  USING (true);

-- ===== STEP 4: Delete stale non-admin config rows =====
-- The admin's auth user ID is the one where auth.users.email = 'baraatakala2004@gmail.com'
-- Delete any rows NOT belonging to the admin
DELETE FROM scoring_config
WHERE teacher_id NOT IN (
  SELECT id FROM auth.users 
  WHERE LOWER(email) = 'baraatakala2004@gmail.com'
);

-- ===== VERIFICATION =====
-- Run after executing:
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'scoring_config';
-- Expected: 2 policies (Admin full access, Authenticated read)
--
-- SELECT COUNT(*) FROM scoring_config;
-- Expected: 1 row (admin's config only)
