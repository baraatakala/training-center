-- ============================================================
-- Fix session_day_change RLS
-- Align with project role model:
--   Admin  → full CRUD  (SELECT, INSERT, UPDATE, DELETE)
--   Teacher → SELECT + INSERT only (no UPDATE/DELETE)
--   Student → SELECT only
--
-- Current state (ADD-SESSION-DAY-CHANGE-LOG.sql):
--   "Anyone can view day changes"  → SELECT USING (true)
--   "Teachers can log day changes" → INSERT (teacher OR admin)
--
-- This migration adds:
--   1. Admin full access (FOR ALL) — covers UPDATE & DELETE
--   2. Student read-only SELECT
--   3. Replaces the broad "Anyone can view" with role-specific policies
-- ============================================================

-- Step 1: Drop the overly-broad SELECT policy (anyone = including anon)
DROP POLICY IF EXISTS "Anyone can view day changes" ON session_day_change;

-- Step 2: Drop the old INSERT policy so we can recreate cleanly
DROP POLICY IF EXISTS "Teachers can log day changes" ON session_day_change;

-- Step 3: Drop any previously-created policies from bad migration
DROP POLICY IF EXISTS "Authenticated users can delete day changes" ON session_day_change;
DROP POLICY IF EXISTS "Authenticated users can update day changes" ON session_day_change;
DROP POLICY IF EXISTS "Admin has full access" ON session_day_change;
DROP POLICY IF EXISTS "Teachers can read" ON session_day_change;
DROP POLICY IF EXISTS "Teachers can insert" ON session_day_change;
DROP POLICY IF EXISTS "Students can read day changes" ON session_day_change;

-- Step 4: Admin — full access (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Admin has full access"
  ON session_day_change
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Step 5: Teacher — SELECT + INSERT only (no UPDATE/DELETE)
CREATE POLICY "Teachers can read"
  ON session_day_change
  FOR SELECT TO authenticated
  USING (is_teacher() AND NOT is_admin());

CREATE POLICY "Teachers can insert"
  ON session_day_change
  FOR INSERT TO authenticated
  WITH CHECK (is_teacher() AND NOT is_admin());

-- Step 6: Student — SELECT only
CREATE POLICY "Students can read day changes"
  ON session_day_change
  FOR SELECT TO authenticated
  USING (NOT is_teacher() AND NOT is_admin());
