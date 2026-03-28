-- ============================================================
-- Fix RLS policy on specialization table
-- ============================================================
-- PROBLEM:
--   1. Policy only checked `teacher` table, but admin was
--      decoupled from teacher — admins can't insert/update/delete.
--   2. Missing WITH CHECK clause for write operations.
--   3. Email comparison was case-sensitive.
--
-- FIX:
--   Drop the old FOR ALL policy and recreate it checking both
--   teacher AND admin tables, with LOWER() for email matching.
-- ============================================================

-- Drop the broken policy
DROP POLICY IF EXISTS "Teachers can manage specializations" ON public.specialization;

-- Recreate with admin support + WITH CHECK + case-insensitive emails
CREATE POLICY "Teachers and admins can manage specializations"
  ON public.specialization FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR
    EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR
    EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );
