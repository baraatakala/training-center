BEGIN;

ALTER TABLE public.qr_sessions
  ADD COLUMN IF NOT EXISTS check_in_mode text,
  ADD COLUMN IF NOT EXISTS linked_photo_token text;

UPDATE public.qr_sessions
SET check_in_mode = 'qr_code'
WHERE check_in_mode IS NULL;

ALTER TABLE public.qr_sessions
  ALTER COLUMN check_in_mode SET DEFAULT 'qr_code',
  ALTER COLUMN check_in_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'qr_sessions_check_in_mode_check'
      AND conrelid = 'public.qr_sessions'::regclass
  ) THEN
    ALTER TABLE public.qr_sessions
      ADD CONSTRAINT qr_sessions_check_in_mode_check
      CHECK (check_in_mode IN ('qr_code', 'photo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_qr_sessions_check_in_mode
  ON public.qr_sessions(check_in_mode);

CREATE INDEX IF NOT EXISTS idx_qr_sessions_linked_photo_token
  ON public.qr_sessions(linked_photo_token)
  WHERE linked_photo_token IS NOT NULL;

COMMENT ON COLUMN public.qr_sessions.check_in_mode IS 'Public QR route target: qr_code stays in StudentCheckIn, photo redirects to PhotoCheckIn.';
COMMENT ON COLUMN public.qr_sessions.linked_photo_token IS 'Optional linked token in photo_checkin_sessions used when check_in_mode = photo.';

DROP FUNCTION IF EXISTS public.generate_qr_session(uuid, date, text);

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
BEGIN
  v_mode := COALESCE(NULLIF(trim(p_check_in_mode), ''), 'qr_code');

  IF v_mode NOT IN ('qr_code', 'photo') THEN
    RAISE EXCEPTION 'Unsupported check-in mode: %', v_mode;
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
    CASE WHEN v_mode = 'photo' THEN p_linked_photo_token ELSE NULL END
  )
  RETURNING qr_session_id INTO v_qr_session_id;

  RETURN json_build_object(
    'qr_session_id', v_qr_session_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'check_in_mode', v_mode,
    'linked_photo_token', CASE WHEN v_mode = 'photo' THEN p_linked_photo_token ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.generate_qr_session IS 'Generates a secure QR session token and records whether the public QR should open standard or face check-in.';

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
  v_qr_session public.qr_sessions%ROWTYPE;
BEGIN
  SELECT *
  INTO v_qr_session
  FROM public.qr_sessions
  WHERE token = p_token
    AND session_id = p_session_id
    AND attendance_date = p_attendance_date;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'Invalid QR code'
    );
  END IF;

  IF v_qr_session.expires_at < now() THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'QR code has expired',
      'expired_at', v_qr_session.expires_at
    );
  END IF;

  IF NOT v_qr_session.is_valid THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'QR code is no longer valid'
    );
  END IF;

  UPDATE public.qr_sessions
  SET used_count = used_count + 1,
      last_used_at = now()
  WHERE token = p_token;

  RETURN json_build_object(
    'valid', true,
    'message', 'QR code is valid',
    'qr_session_id', v_qr_session.qr_session_id,
    'expires_at', v_qr_session.expires_at,
    'check_in_mode', v_qr_session.check_in_mode,
    'linked_photo_token', v_qr_session.linked_photo_token
  );
END;
$$;

COMMENT ON FUNCTION public.validate_qr_token IS 'Validates a public QR token and returns routing metadata for the check-in flow.';

COMMIT;