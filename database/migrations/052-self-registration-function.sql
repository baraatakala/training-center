-- Migration 052-054: Self-registration function
-- Allows users whose email exists in student/teacher/admin tables
-- to create their own Supabase Auth account.
-- Applied to live Supabase via mcp_supabase_apply_migration (3 iterations
-- to handle generated columns: confirmed_at, identities.email).

BEGIN;

CREATE OR REPLACE FUNCTION public.register_system_user(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_role TEXT;
  v_user_id UUID;
  v_encrypted_password TEXT;
  v_lower_email TEXT;
BEGIN
  v_lower_email := LOWER(TRIM(p_email));

  IF v_lower_email IS NULL OR v_lower_email = '' THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin WHERE LOWER(email) = v_lower_email) THEN
    v_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.teacher WHERE LOWER(email) = v_lower_email) THEN
    v_role := 'teacher';
  ELSIF EXISTS (SELECT 1 FROM public.student WHERE LOWER(email) = v_lower_email) THEN
    v_role := 'student';
  ELSE
    RAISE EXCEPTION 'Email not registered in the system. Contact your administrator to add your email first.';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE LOWER(email) = v_lower_email) THEN
    RAISE EXCEPTION 'An account with this email already exists. Use the login form or reset your password.';
  END IF;

  v_user_id := gen_random_uuid();
  v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    aud, role, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_current, email_change_token_new, reauthentication_token,
    is_sso_user, is_anonymous
  )
  VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_lower_email,
    v_encrypted_password,
    now(),
    'authenticated',
    'authenticated',
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('email_verified', true),
    now(), now(),
    '', '',
    '', '', '',
    false, false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_lower_email, 'email_verified', true),
    'email',
    v_user_id::text,
    now(), now(), now()
  );

  IF v_role = 'admin' THEN
    UPDATE public.admin SET auth_user_id = v_user_id WHERE LOWER(email) = v_lower_email AND auth_user_id IS NULL;
  END IF;

  RETURN json_build_object(
    'user_id', v_user_id,
    'role', v_role,
    'message', 'Account created successfully. You can now log in.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_system_user(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.register_system_user(TEXT, TEXT) TO authenticated;

COMMIT;
