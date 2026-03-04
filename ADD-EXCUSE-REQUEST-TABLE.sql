-- ============================================================================
-- EXCUSE REQUEST SYSTEM
-- Students can submit absence excuse requests with supporting documents.
-- Teachers/Admins approve or reject with one click.
-- On approval, the matching attendance record is updated to 'excused'.
-- ============================================================================

-- 1. Create the excuse_request table
CREATE TABLE IF NOT EXISTS excuse_request (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  -- Request details
  reason TEXT NOT NULL,           -- Category: sick, abroad, working, family, emergency, other
  description TEXT,               -- Free-form explanation
  supporting_doc_url TEXT,        -- URL to uploaded document (medical note, etc.)
  supporting_doc_name TEXT,       -- Original file name for display
  -- Status workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- Review info (filled by teacher/admin)
  reviewed_by UUID REFERENCES teacher(teacher_id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,               -- Teacher's note on approval/rejection
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Prevent duplicate requests for same student+session+date
  UNIQUE(student_id, session_id, attendance_date)
);

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_excuse_request_student ON excuse_request(student_id);
CREATE INDEX IF NOT EXISTS idx_excuse_request_session ON excuse_request(session_id);
CREATE INDEX IF NOT EXISTS idx_excuse_request_status ON excuse_request(status);
CREATE INDEX IF NOT EXISTS idx_excuse_request_date ON excuse_request(attendance_date);

-- 3. Updated_at trigger
CREATE OR REPLACE FUNCTION update_excuse_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_excuse_request_updated_at ON excuse_request;
CREATE TRIGGER trigger_excuse_request_updated_at
  BEFORE UPDATE ON excuse_request
  FOR EACH ROW EXECUTE FUNCTION update_excuse_request_updated_at();

-- 4. RLS Policies
ALTER TABLE excuse_request ENABLE ROW LEVEL SECURITY;

-- Students can view their own requests
CREATE POLICY "Students can view own excuse requests"
  ON excuse_request FOR SELECT
  USING (
    student_id IN (
      SELECT student_id FROM student WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- Students can insert their own requests
CREATE POLICY "Students can create own excuse requests"
  ON excuse_request FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT student_id FROM student WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    )
    AND status = 'pending'
  );

-- Students can cancel their own pending requests
CREATE POLICY "Students can cancel own pending requests"
  ON excuse_request FOR UPDATE
  USING (
    student_id IN (
      SELECT student_id FROM student WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    )
    AND status = 'pending'
  )
  WITH CHECK (status = 'cancelled');

-- Teachers can view all requests for their sessions
CREATE POLICY "Teachers can view excuse requests for their sessions"
  ON excuse_request FOR SELECT
  USING (
    session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- Teachers can update (approve/reject) requests for their sessions
CREATE POLICY "Teachers can review excuse requests"
  ON excuse_request FOR UPDATE
  USING (
    session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- Admins have full access
CREATE POLICY "Admins have full access to excuse requests"
  ON excuse_request FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- VERIFY
-- ============================================================================
SELECT 'excuse_request table created successfully' AS result;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'excuse_request' ORDER BY ordinal_position;
