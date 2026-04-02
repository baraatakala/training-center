-- ============================================================================
-- Migration 015: Security Audit — RLS fixes, dead-reference cleanup, constraints
-- ============================================================================

-- ============================================================================
-- 1. FIX: announcement_comment — INSERT/UPDATE/DELETE were USING(true)
-- ============================================================================

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON announcement_comment;
CREATE POLICY "Enable insert for authenticated users" ON announcement_comment
  FOR INSERT TO authenticated WITH CHECK (
    (commenter_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = announcement_comment.commenter_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (commenter_type = 'student' AND commenter_id = get_my_student_id())
  );

DROP POLICY IF EXISTS "Enable update for own comments" ON announcement_comment;
CREATE POLICY "Enable update for own comments" ON announcement_comment
  FOR UPDATE TO authenticated USING (
    (commenter_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = announcement_comment.commenter_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (commenter_type = 'student' AND commenter_id = get_my_student_id())
  );

DROP POLICY IF EXISTS "Enable delete for own comments" ON announcement_comment;
CREATE POLICY "Enable delete for own comments" ON announcement_comment
  FOR DELETE TO authenticated USING (
    (commenter_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = announcement_comment.commenter_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (commenter_type = 'student' AND commenter_id = get_my_student_id())
  );

-- ============================================================================
-- 2. FIX: announcement_reaction — INSERT/DELETE were USING(true)
-- ============================================================================

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON announcement_reaction;
CREATE POLICY "Enable insert for authenticated users" ON announcement_reaction
  FOR INSERT TO authenticated WITH CHECK (
    student_id = get_my_student_id()
  );

DROP POLICY IF EXISTS "Enable delete for own reactions" ON announcement_reaction;
CREATE POLICY "Enable delete for own reactions" ON announcement_reaction
  FOR DELETE TO authenticated USING (
    student_id = get_my_student_id()
  );

-- ============================================================================
-- 3. FIX: message_reaction — INSERT/DELETE were USING(true)
-- ============================================================================

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON message_reaction;
CREATE POLICY "Enable insert for authenticated users" ON message_reaction
  FOR INSERT TO authenticated WITH CHECK (
    (reactor_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message_reaction.reactor_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (reactor_type = 'student' AND reactor_id = get_my_student_id())
    OR (reactor_type = 'admin' AND EXISTS (
      SELECT 1 FROM admin WHERE LOWER(admin.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS "Enable delete for own reactions" ON message_reaction;
CREATE POLICY "Enable delete for own reactions" ON message_reaction
  FOR DELETE TO authenticated USING (
    (reactor_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message_reaction.reactor_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (reactor_type = 'student' AND reactor_id = get_my_student_id())
    OR (reactor_type = 'admin' AND EXISTS (
      SELECT 1 FROM admin WHERE LOWER(admin.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- ============================================================================
-- 4. FIX: message_starred — INSERT/DELETE were USING(true)
-- ============================================================================

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON message_starred;
CREATE POLICY "Enable insert for authenticated users" ON message_starred
  FOR INSERT TO authenticated WITH CHECK (
    (user_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message_starred.user_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (user_type = 'student' AND user_id = get_my_student_id())
    OR (user_type = 'admin' AND EXISTS (
      SELECT 1 FROM admin WHERE LOWER(admin.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

DROP POLICY IF EXISTS "Enable delete for own stars" ON message_starred;
CREATE POLICY "Enable delete for own stars" ON message_starred
  FOR DELETE TO authenticated USING (
    (user_type = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher WHERE teacher.teacher_id = message_starred.user_id
        AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
    ))
    OR (user_type = 'student' AND user_id = get_my_student_id())
    OR (user_type = 'admin' AND EXISTS (
      SELECT 1 FROM admin WHERE LOWER(admin.email) = LOWER(auth.jwt() ->> 'email')
    ))
  );

-- ============================================================================
-- 5. FIX: session_feedback DELETE — referenced non-existent enrollment_id column
-- ============================================================================

DROP POLICY IF EXISTS "Teachers can delete session feedback" ON session_feedback;
CREATE POLICY "Teachers can delete session feedback" ON session_feedback
  FOR DELETE TO authenticated
  USING (
    is_teacher() AND NOT is_admin()
    AND session_id IN (
      SELECT s.session_id FROM session s
      JOIN teacher t ON s.teacher_id = t.teacher_id
      WHERE LOWER(t.email) = LOWER(auth.jwt() ->> 'email')
    )
  );

-- ============================================================================
-- 6. FIX: Remove phantom indexes on non-existent tables
-- ============================================================================

DROP INDEX IF EXISTS idx_late_brackets_session;
DROP INDEX IF EXISTS idx_attachment_message;

-- ============================================================================
-- 7. FIX: Functions referencing non-existent late_brackets table
--    Rewritten to use scoring_config.late_brackets JSONB column
-- ============================================================================

CREATE OR REPLACE FUNCTION get_late_score_weight(
  p_late_minutes INTEGER,
  p_session_id UUID DEFAULT NULL
)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_weight DECIMAL(3,2);
  v_teacher_id UUID;
  v_brackets JSONB;
  v_bracket JSONB;
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN 1.00;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM scoring_config sc
  WHERE (v_teacher_id IS NOT NULL AND sc.teacher_id = v_teacher_id)
  ORDER BY sc.is_default DESC
  LIMIT 1;

  IF v_brackets IS NOT NULL THEN
    FOR v_bracket IN SELECT * FROM jsonb_array_elements(v_brackets)
    LOOP
      IF p_late_minutes >= (v_bracket->>'min')::INT
         AND (v_bracket->>'max' IS NULL OR p_late_minutes <= (v_bracket->>'max')::INT) THEN
        v_weight := COALESCE((v_bracket->>'score_weight')::DECIMAL(3,2), 0.50);
        RETURN v_weight;
      END IF;
    END LOOP;
  END IF;

  RETURN 0.50;
END;
$$ LANGUAGE plpgsql STABLE;

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
DECLARE
  v_teacher_id UUID;
  v_brackets JSONB;
  v_bracket JSONB;
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN QUERY SELECT
      'On Time'::VARCHAR(50),
      'في الوقت'::VARCHAR(50),
      1.00::DECIMAL(3,2),
      '#22c55e'::VARCHAR(20);
    RETURN;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.teacher_id INTO v_teacher_id
    FROM session s WHERE s.session_id = p_session_id;
  END IF;

  SELECT sc.late_brackets INTO v_brackets
  FROM scoring_config sc
  WHERE (v_teacher_id IS NOT NULL AND sc.teacher_id = v_teacher_id)
  ORDER BY sc.is_default DESC
  LIMIT 1;

  IF v_brackets IS NOT NULL THEN
    FOR v_bracket IN SELECT * FROM jsonb_array_elements(v_brackets)
    LOOP
      IF p_late_minutes >= (v_bracket->>'min')::INT
         AND (v_bracket->>'max' IS NULL OR p_late_minutes <= (v_bracket->>'max')::INT) THEN
        RETURN QUERY SELECT
          COALESCE((v_bracket->>'name')::VARCHAR(50), 'Late'::VARCHAR(50)),
          COALESCE((v_bracket->>'name_ar')::VARCHAR(50), 'متأخر'::VARCHAR(50)),
          COALESCE((v_bracket->>'score_weight')::DECIMAL(3,2), 0.50::DECIMAL(3,2)),
          COALESCE((v_bracket->>'color')::VARCHAR(20), '#ef4444'::VARCHAR(20));
        RETURN;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT
    'Late'::VARCHAR(50),
    'متأخر'::VARCHAR(50),
    0.50::DECIMAL(3,2),
    '#ef4444'::VARCHAR(20);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 8. ADD: Schema integrity constraints
-- ============================================================================

-- Prevent contradictory late_minutes + early_minutes on attendance
ALTER TABLE attendance
  ADD CONSTRAINT IF NOT EXISTS attendance_not_both_late_and_early
  CHECK (NOT (late_minutes IS NOT NULL AND early_minutes IS NOT NULL));

-- Ensure excuse_request has reviewer info when approved/rejected
-- (use DO block because ADD CONSTRAINT IF NOT EXISTS is PG16+ only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'excuse_request' AND constraint_name = 'excuse_request_review_fields'
  ) THEN
    ALTER TABLE excuse_request
      ADD CONSTRAINT excuse_request_review_fields CHECK (
        (status IN ('pending', 'cancelled'))
        OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      );
  END IF;
END$$;
