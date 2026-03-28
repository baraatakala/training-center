-- Session Day Change Tracking
-- When a teacher changes the day of a session (e.g., Saturday → Thursday),
-- we log the change with the effective date so analytics can show
-- when the day changed and for reporting purposes.

-- ============================================
-- Day Change Log
-- ============================================
CREATE TABLE IF NOT EXISTS session_day_change (
  change_id    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  old_day      TEXT,            -- Previous day value (e.g., "Saturday")
  new_day      TEXT NOT NULL,   -- New day value (e.g., "Thursday")
  effective_date DATE NOT NULL, -- When the change takes effect
  reason       TEXT,            -- Optional reason for the change
  changed_by   TEXT,            -- Email of who made the change
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_day_change_session ON session_day_change(session_id);
CREATE INDEX IF NOT EXISTS idx_session_day_change_effective ON session_day_change(effective_date);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE session_day_change ENABLE ROW LEVEL SECURITY;

-- Everyone can view day change history
CREATE POLICY "Anyone can view day changes"
  ON session_day_change FOR SELECT
  USING (true);

-- Only teachers/admins can insert
CREATE POLICY "Teachers can log day changes"
  ON session_day_change FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );
