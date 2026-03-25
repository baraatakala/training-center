-- ============================================================
-- Fix session_day_change RLS: Add DELETE and UPDATE policies
-- Currently only SELECT (anyone) and INSERT (teachers) exist.
-- The frontend needs DELETE to clean up old/overlapping records
-- when a day-change strategy is applied.
-- ============================================================

-- Allow authenticated users to delete day-change records
CREATE POLICY "Authenticated users can delete day changes"
  ON public.session_day_change
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to update day-change records
CREATE POLICY "Authenticated users can update day changes"
  ON public.session_day_change
  FOR UPDATE
  USING (auth.role() = 'authenticated');
