-- ADD-TIERED-LATE-SCORING.sql
-- Purpose: Implement fair, tiered late scoring system
-- Date: 2026-02-03
-- 
-- Problem: Currently all "late" statuses are treated equally
-- Solution: Track late_minutes and apply proportional scoring

-- ============================================================================
-- SECTION 1: Add late_minutes column to attendance
-- ============================================================================

ALTER TABLE public.attendance 
ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.attendance.late_minutes IS 
'Number of minutes the student was late. NULL for non-late statuses. Used for tiered late scoring.';

-- Create index for analytics queries
CREATE INDEX IF NOT EXISTS idx_attendance_late_minutes 
ON public.attendance(late_minutes) WHERE late_minutes IS NOT NULL;

-- ============================================================================
-- SECTION 2: Create late_brackets configuration table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.late_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.session(session_id) ON DELETE CASCADE,
  -- NULL session_id = global default brackets
  min_minutes INTEGER NOT NULL,
  max_minutes INTEGER, -- NULL = unlimited (e.g., 60+ minutes)
  bracket_name VARCHAR(50) NOT NULL,
  bracket_name_ar VARCHAR(50),
  score_weight DECIMAL(3,2) NOT NULL CHECK (score_weight >= 0 AND score_weight <= 1),
  display_color VARCHAR(20), -- For UI display
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, min_minutes)
);

COMMENT ON TABLE public.late_brackets IS 
'Configurable late scoring brackets. Per-session or global (session_id=NULL). Score weight is multiplier (0.0 to 1.0).';

-- Create index
CREATE INDEX IF NOT EXISTS idx_late_brackets_session ON public.late_brackets(session_id);

-- Enable RLS
ALTER TABLE public.late_brackets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'late_brackets' AND policyname = 'Enable all access for authenticated users') THEN
    CREATE POLICY "Enable all access for authenticated users" ON public.late_brackets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- SECTION 3: Insert default global brackets
-- ============================================================================

-- Clear existing defaults if any (session_id IS NULL = global)
DELETE FROM public.late_brackets WHERE session_id IS NULL;

-- Insert new global defaults
INSERT INTO public.late_brackets (session_id, min_minutes, max_minutes, bracket_name, bracket_name_ar, score_weight, display_color) VALUES
  (NULL, 1, 5, 'Minor', 'بسيط', 0.95, '#22c55e'),       -- Green - almost full credit
  (NULL, 6, 15, 'Moderate', 'متوسط', 0.80, '#eab308'),  -- Yellow - 80%
  (NULL, 16, 30, 'Significant', 'ملحوظ', 0.60, '#f97316'), -- Orange - 60%
  (NULL, 31, 60, 'Severe', 'شديد', 0.40, '#ef4444'),    -- Red - 40%
  (NULL, 61, NULL, 'Very Late', 'متأخر جداً', 0.20, '#991b1b'); -- Dark red - 20%

-- ============================================================================
-- SECTION 4: Create helper function to get score weight
-- ============================================================================

CREATE OR REPLACE FUNCTION get_late_score_weight(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_weight DECIMAL(3,2);
BEGIN
  -- If not late or no minutes recorded, return full weight
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN 1.00;
  END IF;

  -- Try session-specific brackets first
  SELECT score_weight INTO v_weight
  FROM late_brackets
  WHERE session_id = p_session_id
    AND p_late_minutes >= min_minutes
    AND (max_minutes IS NULL OR p_late_minutes <= max_minutes)
  ORDER BY min_minutes DESC
  LIMIT 1;

  -- If no session-specific, use global defaults
  IF v_weight IS NULL THEN
    SELECT score_weight INTO v_weight
    FROM late_brackets
    WHERE session_id IS NULL
      AND p_late_minutes >= min_minutes
      AND (max_minutes IS NULL OR p_late_minutes <= max_minutes)
    ORDER BY min_minutes DESC
    LIMIT 1;
  END IF;

  -- Fallback if no brackets match
  RETURN COALESCE(v_weight, 0.50);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SECTION 5: Create function to get bracket info
-- ============================================================================

CREATE OR REPLACE FUNCTION get_late_bracket_info(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  bracket_name VARCHAR(50),
  bracket_name_ar VARCHAR(50),
  score_weight DECIMAL(3,2),
  display_color VARCHAR(20)
) AS $$
BEGIN
  -- If not late
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN QUERY SELECT 
      'On Time'::VARCHAR(50), 
      'في الوقت'::VARCHAR(50), 
      1.00::DECIMAL(3,2), 
      '#22c55e'::VARCHAR(20);
    RETURN;
  END IF;

  -- Try session-specific first, then global
  RETURN QUERY
  SELECT lb.bracket_name, lb.bracket_name_ar, lb.score_weight, lb.display_color
  FROM late_brackets lb
  WHERE (lb.session_id = p_session_id OR lb.session_id IS NULL)
    AND p_late_minutes >= lb.min_minutes
    AND (lb.max_minutes IS NULL OR p_late_minutes <= lb.max_minutes)
  ORDER BY lb.session_id NULLS LAST, lb.min_minutes DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SECTION 6: Verification
-- ============================================================================

SELECT '=== Late Scoring System Verification ===' AS status;

-- Check column exists
SELECT 'attendance.late_minutes' AS column_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance' AND column_name = 'late_minutes')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

-- Check table exists
SELECT 'late_brackets table' AS table_check,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'late_brackets')
  THEN '✓ EXISTS' ELSE '✗ MISSING' END AS result;

-- Show default brackets
SELECT '=== Default Late Brackets ===' AS info;
SELECT bracket_name, min_minutes || '-' || COALESCE(max_minutes::TEXT, '∞') || ' min' AS range, 
       (score_weight * 100)::INTEGER || '%' AS weight, display_color
FROM late_brackets 
WHERE session_id IS NULL 
ORDER BY min_minutes;

-- Test the function
SELECT '=== Function Test ===' AS info;
SELECT 
  minutes AS test_minutes,
  (SELECT bracket_name FROM get_late_bracket_info(minutes)) AS bracket,
  (SELECT score_weight FROM get_late_bracket_info(minutes)) AS weight
FROM (VALUES (0), (3), (10), (25), (45), (90)) AS t(minutes);

SELECT '=== Late Scoring System Ready ===' AS status;
