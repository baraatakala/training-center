-- ============================================================================
-- Migration 024: Add admin full access policy on session_feedback
-- ============================================================================
-- Problem: Admin users get zero rows from session_feedback queries because
--          no RLS policy grants admin SELECT/INSERT/UPDATE/DELETE access.
--          The teacher policy uses NOT is_admin(), so admin-teachers are also blocked.
-- Fix:     Add standard "Admin has full access" policy matching all other tables.
-- ============================================================================

DROP POLICY IF EXISTS "Admin has full access" ON session_feedback;
CREATE POLICY "Admin has full access" ON session_feedback
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
