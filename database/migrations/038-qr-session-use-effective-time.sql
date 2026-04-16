-- Migration 038: Fix generate_qr_session to use effective time from session_time_change
-- Previously it always used session.time, ignoring time change overrides.

CREATE OR REPLACE FUNCTION public.generate_qr_session(
  p_session_id UUID,
  p_attendance_date DATE,
  p_created_by TEXT DEFAULT NULL,
  p_check_in_mode TEXT DEFAULT 'qr_code',
  p_linked_photo_token TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID;
  v_qr_session_id UUID;
  v_session_time_str VARCHAR;
  v_effective_time TEXT;
  v_session_time TIME;
  v_grace_period INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_mode TEXT;
  v_linked_photo_token TEXT;
BEGIN
  v_mode := COALESCE(NULLIF(trim(p_check_in_mode), ''), 'qr_code');
  v_linked_photo_token := NULLIF(trim(COALESCE(p_linked_photo_token, '')), '');

  IF v_mode NOT IN ('qr_code', 'photo') THEN
    RAISE EXCEPTION 'Unsupported check-in mode: %', v_mode;
  END IF;

  IF v_mode = 'photo' AND v_linked_photo_token IS NULL THEN
    RAISE EXCEPTION 'Photo mode QR sessions require a linked photo token';
  END IF;

  IF v_mode = 'qr_code' THEN
    v_linked_photo_token := NULL;
  END IF;

  IF p_expires_at IS NOT NULL THEN
    v_expires_at := p_expires_at;
  ELSE
    -- Get default session time and grace period
    SELECT time, grace_period_minutes
    INTO v_session_time_str, v_grace_period
    FROM session
    WHERE session_id = p_session_id;

    -- Check for effective time override from session_time_change
    SELECT new_time INTO v_effective_time
    FROM session_time_change
    WHERE session_id = p_session_id
      AND effective_date <= p_attendance_date
    ORDER BY effective_date DESC
    LIMIT 1;

    -- Use effective time if available, otherwise fall back to session default
    IF v_effective_time IS NOT NULL THEN
      v_session_time_str := v_effective_time;
    END IF;

    IF v_session_time_str IS NULL OR v_session_time_str = '' THEN
      v_expires_at := now() + interval '2 hours';
    ELSE
      v_session_time := split_part(v_session_time_str, '-', 1)::TIME;
      v_expires_at := (p_attendance_date + v_session_time)::TIMESTAMPTZ
                      + (COALESCE(v_grace_period, 15) + 30) * interval '1 minute';
      IF v_expires_at < now() THEN
        v_expires_at := now() + interval '2 hours';
      END IF;
    END IF;
  END IF;

  v_token := gen_random_uuid();

  UPDATE public.qr_sessions
  SET is_valid = false
  WHERE session_id = p_session_id
    AND attendance_date = p_attendance_date
    AND check_in_mode = v_mode
    AND is_valid = true;

  INSERT INTO public.qr_sessions (
    token, session_id, attendance_date, expires_at,
    created_by, check_in_mode, linked_photo_token
  )
  VALUES (
    v_token, p_session_id, p_attendance_date, v_expires_at,
    p_created_by, v_mode, v_linked_photo_token
  )
  RETURNING qr_session_id INTO v_qr_session_id;

  RETURN json_build_object(
    'qr_session_id', v_qr_session_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'check_in_mode', v_mode,
    'linked_photo_token', v_linked_photo_token
  );
END;
$$;
