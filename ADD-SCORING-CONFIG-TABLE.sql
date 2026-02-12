-- =====================================================
-- SCORING CONFIGURATION TABLE
-- Allows teachers to dynamically configure weighted score parameters
-- =====================================================
-- Date: 2026-02-12
-- Matches the project's existing RLS pattern from FINAL-TEACHER-ONLY-RLS.sql
-- Uses is_teacher() function (must already exist from earlier migrations)
-- =====================================================

-- ===== STEP 0: Ensure helper function exists =====
CREATE OR REPLACE FUNCTION is_teacher()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM teacher 
    WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== STEP 1: Drop old table if it exists (clean slate) =====
DROP TABLE IF EXISTS scoring_config CASCADE;

-- ===== STEP 2: Create the scoring_config table =====
CREATE TABLE scoring_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_name TEXT NOT NULL DEFAULT 'Default Scoring',
  is_default BOOLEAN NOT NULL DEFAULT true,
  
  -- Component weights (should sum to 100, validated in frontend)
  weight_quality NUMERIC(5,2) NOT NULL DEFAULT 55.00,
  weight_attendance NUMERIC(5,2) NOT NULL DEFAULT 35.00,
  weight_punctuality NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  
  -- Late decay parameters
  late_decay_constant NUMERIC(6,2) NOT NULL DEFAULT 43.30,
  late_minimum_credit NUMERIC(4,3) NOT NULL DEFAULT 0.050,
  late_null_estimate NUMERIC(4,3) NOT NULL DEFAULT 0.600,
  
  -- Coverage factor settings
  coverage_enabled BOOLEAN NOT NULL DEFAULT true,
  coverage_method TEXT NOT NULL DEFAULT 'sqrt' CHECK (coverage_method IN ('sqrt', 'linear', 'log', 'none')),
  coverage_minimum NUMERIC(4,3) NOT NULL DEFAULT 0.100,
  
  -- Display brackets (JSON array)
  late_brackets JSONB NOT NULL DEFAULT '[
    {"id":"1","min":1,"max":5,"name":"Minor","color":"bg-green-100 text-green-800"},
    {"id":"2","min":6,"max":15,"name":"Moderate","color":"bg-yellow-100 text-yellow-800"},
    {"id":"3","min":16,"max":30,"name":"Significant","color":"bg-orange-100 text-orange-800"},
    {"id":"4","min":31,"max":60,"name":"Severe","color":"bg-red-100 text-red-800"},
    {"id":"5","min":61,"max":999,"name":"Very Late","color":"bg-red-200 text-red-900"}
  ]'::jsonb,
  
  -- Bonus/penalty modifiers
  perfect_attendance_bonus NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  streak_bonus_per_week NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  absence_penalty_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique: one default config per teacher
  CONSTRAINT unique_teacher_default UNIQUE (teacher_id, is_default)
  -- NOTE: No CHECK constraint on weights sum — frontend handles validation
  -- This avoids floating-point mismatch between JS numbers and PG NUMERIC
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_scoring_config_teacher ON scoring_config(teacher_id);

-- ===== STEP 3: Enable RLS =====
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

-- ===== STEP 4: Drop any old policies =====
DROP POLICY IF EXISTS "scoring_config_select" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_insert" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_update" ON scoring_config;
DROP POLICY IF EXISTS "scoring_config_delete" ON scoring_config;
DROP POLICY IF EXISTS "Teachers have full access" ON scoring_config;
DROP POLICY IF EXISTS "Allow all for authenticated" ON scoring_config;
DROP POLICY IF EXISTS "Allow all for anon" ON scoring_config;

-- ===== STEP 5: Create RLS policies matching project pattern =====
-- Teachers get full access (same pattern as all other tables)
CREATE POLICY "Teachers have full access" ON scoring_config
  FOR ALL TO authenticated
  USING (is_teacher())
  WITH CHECK (is_teacher());

-- ===== STEP 6: Auto-update timestamp trigger =====
CREATE OR REPLACE FUNCTION update_scoring_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scoring_config_updated ON scoring_config;
CREATE TRIGGER scoring_config_updated
  BEFORE UPDATE ON scoring_config
  FOR EACH ROW
  EXECUTE FUNCTION update_scoring_config_timestamp();

-- ===== STEP 7: Comments =====
COMMENT ON TABLE scoring_config IS 'Stores per-teacher weighted score configuration for attendance scoring';
COMMENT ON COLUMN scoring_config.weight_quality IS 'Weight for quality-adjusted rate (0-100, default 55)';
COMMENT ON COLUMN scoring_config.weight_attendance IS 'Weight for simple attendance rate (0-100, default 35)';
COMMENT ON COLUMN scoring_config.weight_punctuality IS 'Weight for punctuality bonus (0-100, default 10)';
COMMENT ON COLUMN scoring_config.late_decay_constant IS 'τ in e^(-t/τ) for late score decay. 43.3 gives 50% at 30min';
COMMENT ON COLUMN scoring_config.coverage_method IS 'How to penalize low coverage: sqrt (gentle), linear, log, or none';

-- ===== VERIFICATION =====
-- Run this after executing the above to verify:
-- SELECT tablename FROM pg_tables WHERE tablename = 'scoring_config';
-- SELECT policyname FROM pg_policies WHERE tablename = 'scoring_config';
-- Expected: 1 table, 1 policy ("Teachers have full access")
