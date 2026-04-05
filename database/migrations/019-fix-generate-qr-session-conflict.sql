-- Migration 019: Fix generate_qr_session 409 duplicate-key conflict
--
-- Root cause: the function did a blind INSERT without first invalidating any
-- existing active token for the same (session_id, attendance_date, check_in_mode).
-- The partial unique index qr_sessions_active_unique (WHERE is_valid = true)
-- then raises 23505 whenever a teacher opens the QR modal a second time for the
-- same date and mode without having properly closed (and therefore invalidated)
-- the previous modal.
--
-- Fix: before inserting the new token, UPDATE any active rows for the same
-- session/date/mode to is_valid = false.  The partial index only covers
-- is_valid = true rows, so the conflict is eliminated.

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
AS $$
DECLARE
  v_token UUID;
  v_qr_session_id UUID;
  v_session_time_str VARCHAR;
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

  -- ── Compute expiration time ──────────────────────────────────────────────
  IF p_expires_at IS NOT NULL THEN
    v_expires_at := p_expires_at;
  ELSE
    SELECT time, grace_period_minutes
    INTO v_session_time_str, v_grace_period
    FROM public.session
    WHERE session_id = p_session_id;

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

  -- ── Invalidate any existing active token for the same slot ───────────────
  -- This prevents 23505 from qr_sessions_active_unique (partial index on is_valid=true)
  -- when a teacher reopens the QR modal without the previous one being closed cleanly.
  UPDATE public.qr_sessions
  SET is_valid = false
  WHERE session_id = p_session_id
    AND attendance_date = p_attendance_date
    AND check_in_mode = v_mode
    AND is_valid = true;

  -- ── Insert fresh token ────────────────────────────────────────────────────
  v_token := uuid_generate_v4();

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
