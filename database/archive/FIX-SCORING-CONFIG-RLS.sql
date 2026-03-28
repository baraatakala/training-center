-- FIX-SCORING-CONFIG-RLS.sql
-- =================================================================
-- Fix scoring_config RLS: Teacher + Admin write, everyone can read
-- =================================================================
--
-- PROBLEM:
--   - The old RLS policy ("Teachers have full access") lets ANY teacher
--     create their own scoring config row (per-user).
--   - getScoringConfig() filtered by teacher_id = user.id, so each
--     teacher/admin saw THEIR OWN config → different weighted scores.
--   - Students couldn't read the config at all (no SELECT policy).
--
-- FIX:
--   - Admin + Teachers: full CRUD (both can edit the global config)
--   - Student: SELECT only (read the config for score display)
--   - Delete any stale duplicate config rows (keep only one)
--
-- Date: 2026-02-13 (updated)
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
DROP POLICY IF EXISTS "Teacher and admin write scoring_config" ON scoring_config;
DROP POLICY IF EXISTS "Authenticated read scoring_config" ON scoring_config;

-- ===== STEP 2: Ensure RLS is enabled =====
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

-- ===== STEP 3: Create new policies =====

-- Admin + Teachers: full CRUD access (both can modify the global config)
CREATE POLICY "Teacher and admin write scoring_config" ON scoring_config
  FOR ALL TO authenticated
  USING (is_admin() OR is_teacher())
  WITH CHECK (is_admin() OR is_teacher());

-- All authenticated users: can READ any config (for score calculations)
CREATE POLICY "Authenticated read scoring_config" ON scoring_config
  FOR SELECT TO authenticated
  USING (true);

-- ===== STEP 4: Clean up — keep only one config row =====
-- Delete all but the oldest (original) config row to ensure a single global config
DELETE FROM scoring_config
WHERE id NOT IN (
  SELECT id FROM scoring_config
  WHERE is_default = true
  ORDER BY created_at ASC
  LIMIT 1
);

-- ===== VERIFICATION =====
-- Run after executing:
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'scoring_config';
-- Expected: 2 policies (Teacher and admin write, Authenticated read)
--
-- SELECT COUNT(*) FROM scoring_config;
-- Expected: 1 row (global config)
