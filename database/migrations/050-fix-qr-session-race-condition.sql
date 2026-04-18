-- Migration 050: Fix QR session race condition
-- Problem: Two concurrent generate_qr_session calls (from 3-min auto-refresh)
-- both see no is_valid=true row, both INSERT, second fails with 23505.
-- Fix: ON CONFLICT upsert + session_schedule_exception time lookup.
-- Applied to live Supabase via mcp_supabase_apply_migration.

BEGIN;

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
    SELECT time, grace_period_minutes
    INTO v_session_time_str, v_grace_period
    FROM session
    WHERE session_id = p_session_id;

    -- Check session_schedule_exception FIRST (new 046-048 table)
    SELECT new_start_time::TEXT INTO v_effective_time
    FROM session_schedule_exception
    WHERE session_id = p_session_id
      AND original_date = p_attendance_date
      AND exception_type IN ('time_change', 'time_and_day_change')
      AND new_start_time IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    -- Fall back to legacy session_time_change
    IF v_effective_time IS NULL THEN
      SELECT new_time INTO v_effective_time
      FROM session_time_change
      WHERE session_id = p_session_id
        AND effective_date <= p_attendance_date
      ORDER BY effective_date DESC
      LIMIT 1;
    END IF;

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

  -- Invalidate any existing active token
  UPDATE public.qr_sessions
  SET is_valid = false
  WHERE session_id = p_session_id
    AND attendance_date = p_attendance_date
    AND check_in_mode = v_mode
    AND is_valid = true;

  -- Insert with ON CONFLICT to handle race condition
  INSERT INTO public.qr_sessions (
    token, session_id, attendance_date, expires_at,
    created_by, check_in_mode, linked_photo_token
  )
  VALUES (
    v_token, p_session_id, p_attendance_date, v_expires_at,
    p_created_by, v_mode, v_linked_photo_token
  )
  ON CONFLICT (session_id, attendance_date, check_in_mode) WHERE (is_valid = true)
  DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    created_by = EXCLUDED.created_by,
    linked_photo_token = EXCLUDED.linked_photo_token,
    used_count = 0,
    created_at = now(),
    last_used_at = NULL
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

COMMIT;
