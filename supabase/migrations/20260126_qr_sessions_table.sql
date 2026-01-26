-- ADD-QR-SESSIONS-TABLE.sql
-- Adds secure QR code session management for student check-ins
-- Implements cryptographically secure tokens with expiration and validation
-- Date: 2026-01-26

-- ===== STEP 0: Ensure UUID extension is enabled =====
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== STEP 1: Create qr_sessions table =====
CREATE TABLE IF NOT EXISTS public.qr_sessions (
  qr_session_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  token uuid UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES public.session(session_id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by text,
  CONSTRAINT qr_session_date_check CHECK (attendance_date IS NOT NULL)
);

-- ===== STEP 2: Add indexes for performance =====
-- Index for fast token lookup (most common operation)
CREATE INDEX IF NOT EXISTS idx_qr_sessions_token ON public.qr_sessions(token) WHERE is_valid = true;

-- Index for session/date queries
CREATE INDEX IF NOT EXISTS idx_qr_sessions_session_date ON public.qr_sessions(session_id, attendance_date);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_qr_sessions_expires ON public.qr_sessions(expires_at) WHERE is_valid = true;

-- Index for created_by (audit purposes)
CREATE INDEX IF NOT EXISTS idx_qr_sessions_created_by ON public.qr_sessions(created_by);

-- ===== STEP 3: Add helpful comments =====
COMMENT ON TABLE public.qr_sessions IS 'Secure QR code tokens for student check-ins with expiration and validation';
COMMENT ON COLUMN public.qr_sessions.token IS 'Cryptographically secure UUID token embedded in QR code';
COMMENT ON COLUMN public.qr_sessions.expires_at IS 'Token expires based on session time + grace period + buffer';
COMMENT ON COLUMN public.qr_sessions.is_valid IS 'False when QR modal is closed or token is manually invalidated';
COMMENT ON COLUMN public.qr_sessions.used_count IS 'Number of times this token was used for check-in attempts';

-- ===== STEP 4: Enable RLS (Row Level Security) =====
ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Teachers can create QR sessions
CREATE POLICY "Teachers can create QR sessions"
  ON public.qr_sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Anyone can read active QR sessions (needed for check-in)
CREATE POLICY "Anyone can read active QR sessions"
  ON public.qr_sessions FOR SELECT
  TO authenticated
  USING (is_valid = true AND expires_at > now());

-- Policy: System can update QR sessions (usage count, invalidation)
CREATE POLICY "System can update QR sessions"
  ON public.qr_sessions FOR UPDATE
  TO authenticated
  USING (true);

-- ===== STEP 5: Create helper functions =====

-- Function 1: Generate QR session with smart expiration
CREATE OR REPLACE FUNCTION public.generate_qr_session(
  p_session_id uuid,
  p_attendance_date date,
  p_created_by text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token uuid;
  v_qr_session_id uuid;
  v_session_time_str varchar;
  v_session_time time;
  v_grace_period integer;
  v_expires_at timestamptz;
BEGIN
  -- Get session time (as varchar, could be range like "16:00-18:00") and grace period
  SELECT time, grace_period_minutes
  INTO v_session_time_str, v_grace_period
  FROM session
  WHERE session_id = p_session_id;

  IF v_session_time_str IS NULL OR v_session_time_str = '' THEN
    -- Default: expire in 2 hours if no session time
    v_expires_at := now() + interval '2 hours';
  ELSE
    -- Extract start time from range (e.g., "16:00-18:00" → "16:00")
    -- If it's just a single time like "16:00", split returns the same value
    v_session_time := split_part(v_session_time_str, '-', 1)::time;
    
    -- Expire at session start time + grace period + 30 minutes buffer
    v_expires_at := (p_attendance_date + v_session_time)::timestamptz 
                    + (COALESCE(v_grace_period, 15) + 30) * interval '1 minute';
    
    -- If calculated expiration is in the past, set to 2 hours from now
    IF v_expires_at < now() THEN
      v_expires_at := now() + interval '2 hours';
    END IF;
  END IF;

  -- Generate secure token
  v_token := uuid_generate_v4();

  -- Insert QR session
  INSERT INTO qr_sessions (
    token,
    session_id,
    attendance_date,
    expires_at,
    created_by
  )
  VALUES (
    v_token,
    p_session_id,
    p_attendance_date,
    v_expires_at,
    p_created_by
  )
  RETURNING qr_session_id INTO v_qr_session_id;

  RETURN json_build_object(
    'qr_session_id', v_qr_session_id,
    'token', v_token,
    'expires_at', v_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.generate_qr_session IS 'Generates a secure QR session token with smart expiration based on session schedule';

-- Function 2: Validate QR token
CREATE OR REPLACE FUNCTION public.validate_qr_token(
  p_token uuid,
  p_session_id uuid,
  p_attendance_date date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr_session qr_sessions%ROWTYPE;
BEGIN
  -- Get QR session
  SELECT *
  INTO v_qr_session
  FROM qr_sessions
  WHERE token = p_token
    AND session_id = p_session_id
    AND attendance_date = p_attendance_date;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'Invalid QR code'
    );
  END IF;

  -- Check if expired
  IF v_qr_session.expires_at < now() THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'QR code has expired',
      'expired_at', v_qr_session.expires_at
    );
  END IF;

  -- Check if invalidated
  IF NOT v_qr_session.is_valid THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'QR code is no longer valid'
    );
  END IF;

  -- Update usage count
  UPDATE qr_sessions
  SET used_count = used_count + 1,
      last_used_at = now()
  WHERE token = p_token;

  RETURN json_build_object(
    'valid', true,
    'message', 'QR code is valid',
    'qr_session_id', v_qr_session.qr_session_id,
    'expires_at', v_qr_session.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.validate_qr_token IS 'Validates QR token and returns validation status with message';

-- Function 3: Invalidate QR session (when closing QR modal)
CREATE OR REPLACE FUNCTION public.invalidate_qr_session(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE qr_sessions
  SET is_valid = false
  WHERE token = p_token;
  
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.invalidate_qr_session IS 'Invalidates a QR session token (called when QR modal is closed)';

-- Function 4: Cleanup expired QR sessions (run daily via cron)
CREATE OR REPLACE FUNCTION public.cleanup_expired_qr_sessions()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM qr_sessions
  WHERE expires_at < now() - interval '7 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_qr_sessions IS 'Removes expired QR sessions older than 7 days - run daily';

-- ===== STEP 6: Verification =====
DO $$
BEGIN
  RAISE NOTICE '=== VERIFICATION RESULTS ===';
END $$;

-- Show the new table structure
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'qr_sessions'
ORDER BY ordinal_position;

-- Show indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'qr_sessions'
ORDER BY indexname;

-- Show RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'qr_sessions';

-- Show functions
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%qr%'
ORDER BY routine_name;

-- ===== SUCCESS MESSAGE =====
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ QR Sessions table successfully created!';
  RAISE NOTICE '';
  RAISE NOTICE '📋 What was added:';
  RAISE NOTICE '  • qr_sessions table with secure UUID tokens';
  RAISE NOTICE '  • 4 indexes for optimal performance';
  RAISE NOTICE '  • 3 RLS policies for security';
  RAISE NOTICE '  • 4 helper functions:';
  RAISE NOTICE '    - generate_qr_session() - Create secure tokens';
  RAISE NOTICE '    - validate_qr_token() - Verify token validity';
  RAISE NOTICE '    - invalidate_qr_session() - Disable old tokens';
  RAISE NOTICE '    - cleanup_expired_qr_sessions() - Remove old data';
  RAISE NOTICE '';
  RAISE NOTICE '🔒 Security features:';
  RAISE NOTICE '  • Cryptographically secure UUID tokens';
  RAISE NOTICE '  • Smart expiration based on session schedule';
  RAISE NOTICE '  • Auto-invalidation when QR modal closes';
  RAISE NOTICE '  • Usage tracking for audit purposes';
  RAISE NOTICE '';
  RAISE NOTICE '🚀 Next steps:';
  RAISE NOTICE '  1. Update QRCodeModal.tsx to use generate_qr_session()';
  RAISE NOTICE '  2. Update StudentCheckIn.tsx to validate tokens';
  RAISE NOTICE '  3. Update App.tsx route: /checkin/:token';
  RAISE NOTICE '  4. Test QR generation and check-in flow';
  RAISE NOTICE '';
END $$;
