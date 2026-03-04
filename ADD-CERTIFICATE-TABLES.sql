-- Certificate Generator Tables
-- Supports certificate template management + per-student issued certificates

-- ============================================
-- 1. Certificate Templates
-- ============================================
CREATE TABLE IF NOT EXISTS certificate_template (
  template_id    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  -- Template type: completion, attendance, achievement, participation
  template_type  TEXT NOT NULL DEFAULT 'completion'
    CHECK (template_type IN ('completion', 'attendance', 'achievement', 'participation')),
  -- Minimum score/attendance to qualify
  min_score      NUMERIC(5,2) DEFAULT 0,
  min_attendance NUMERIC(5,2) DEFAULT 0,
  -- Visual customization (stored as JSONB)
  -- Keys: background_color, accent_color, font_family, logo_url, border_style, orientation
  style_config   JSONB DEFAULT '{
    "background_color": "#ffffff",
    "accent_color": "#1e40af",
    "font_family": "serif",
    "border_style": "classic",
    "orientation": "landscape"
  }'::jsonb,
  -- Body template text (supports {{name}}, {{course}}, {{date}}, {{score}}, {{teacher}})
  body_template  TEXT DEFAULT 'This is to certify that {{name}} has successfully completed the course "{{course}}" with a score of {{score}}%.',
  -- Signature fields
  signature_name  TEXT,
  signature_title TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. Issued Certificates
-- ============================================
CREATE TABLE IF NOT EXISTS issued_certificate (
  certificate_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id    UUID NOT NULL REFERENCES certificate_template(template_id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
  session_id     UUID REFERENCES session(session_id) ON DELETE SET NULL,
  course_id      UUID REFERENCES course(course_id) ON DELETE SET NULL,
  -- Generated data
  certificate_number TEXT NOT NULL UNIQUE,
  -- QR verification code (short alphanumeric)
  verification_code  TEXT NOT NULL UNIQUE,
  -- Snapshot of scores at time of issue
  final_score        NUMERIC(5,2),
  attendance_rate    NUMERIC(5,2),
  -- Status: draft, issued, revoked
  status         TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'revoked')),
  issued_by      TEXT,
  issued_at      TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoke_reason  TEXT,
  -- Resolved template body (placeholders filled)
  resolved_body  TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_issued_cert_student ON issued_certificate(student_id);
CREATE INDEX IF NOT EXISTS idx_issued_cert_session ON issued_certificate(session_id);
CREATE INDEX IF NOT EXISTS idx_issued_cert_template ON issued_certificate(template_id);
CREATE INDEX IF NOT EXISTS idx_issued_cert_verification ON issued_certificate(verification_code);
CREATE INDEX IF NOT EXISTS idx_issued_cert_number ON issued_certificate(certificate_number);

-- ============================================
-- updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_certificate_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_certificate_template_updated
  BEFORE UPDATE ON certificate_template
  FOR EACH ROW
  EXECUTE FUNCTION update_certificate_template_timestamp();

CREATE OR REPLACE FUNCTION update_issued_certificate_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issued_certificate_updated
  BEFORE UPDATE ON issued_certificate
  FOR EACH ROW
  EXECUTE FUNCTION update_issued_certificate_timestamp();

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE certificate_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_certificate ENABLE ROW LEVEL SECURITY;

-- Templates: teachers/admins can manage, everyone can view active
CREATE POLICY "Anyone can view active templates"
  ON certificate_template FOR SELECT
  USING (is_active = true);

CREATE POLICY "Teachers can manage templates"
  ON certificate_template FOR ALL
  USING (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

-- Issued certificates: students see their own, teachers/admins see all
CREATE POLICY "Students view own certificates"
  ON issued_certificate FOR SELECT
  USING (
    student_id IN (
      SELECT student_id FROM student WHERE LOWER(email) = LOWER(auth.jwt()->>'email')
    )
  );

CREATE POLICY "Teachers view all certificates"
  ON issued_certificate FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );

CREATE POLICY "Teachers manage certificates"
  ON issued_certificate FOR ALL
  USING (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM teacher WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
    OR EXISTS (SELECT 1 FROM admin WHERE LOWER(email) = LOWER(auth.jwt()->>'email'))
  );
