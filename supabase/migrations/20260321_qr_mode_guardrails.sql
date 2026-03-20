BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'qr_sessions_photo_link_guard'
      AND conrelid = 'public.qr_sessions'::regclass
  ) THEN
    ALTER TABLE public.qr_sessions
      ADD CONSTRAINT qr_sessions_photo_link_guard
      CHECK (
        (check_in_mode = 'photo' AND linked_photo_token IS NOT NULL)
        OR (check_in_mode = 'qr_code' AND linked_photo_token IS NULL)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.generate_qr_session(
  p_session_id uuid,
  p_attendance_date date,
  p_created_by text DEFAULT NULL,
  p_check_in_mode text DEFAULT 'qr_code',
  p_linked_photo_token text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
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
  v_mode text;
  v_linked_photo_token text;
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

    IF v_session_time_str IS NULL OR v_session_time_str = '' THEN
      v_expires_at := now() + interval '2 hours';
    ELSE
      v_session_time := split_part(v_session_time_str, '-', 1)::time;
      v_expires_at := (p_attendance_date + v_session_time)::timestamptz
                      + (COALESCE(v_grace_period, 15) + 30) * interval '1 minute';

      IF v_expires_at < now() THEN
        v_expires_at := now() + interval '2 hours';
      END IF;
    END IF;
  END IF;

  v_token := uuid_generate_v4();

  INSERT INTO public.qr_sessions (
    token,
    session_id,
    attendance_date,
    expires_at,
    created_by,
    check_in_mode,
    linked_photo_token
  )
  VALUES (
    v_token,
    p_session_id,
    p_attendance_date,
    v_expires_at,
    p_created_by,
    v_mode,
    v_linked_photo_token
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

COMMENT ON CONSTRAINT qr_sessions_photo_link_guard ON public.qr_sessions IS 'Ensures face-mode QR rows always carry a linked photo token and standard QR rows do not.';

COMMIT;