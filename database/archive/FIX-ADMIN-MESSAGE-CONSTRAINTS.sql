-- Fix CHECK constraints on message_starred and message_reaction
-- to allow 'admin' user type (currently only 'teacher' | 'student')
-- Run this in the Supabase SQL Editor

-- 1. Fix message_starred.user_type to include 'admin'
ALTER TABLE public.message_starred
  DROP CONSTRAINT IF EXISTS message_starred_user_type_check;

ALTER TABLE public.message_starred
  ADD CONSTRAINT message_starred_user_type_check
  CHECK (user_type::text = ANY (ARRAY['teacher', 'student', 'admin']::text[]));

-- 2. Fix message_reaction.reactor_type to include 'admin'
ALTER TABLE public.message_reaction
  DROP CONSTRAINT IF EXISTS message_reaction_reactor_type_check;

ALTER TABLE public.message_reaction
  ADD CONSTRAINT message_reaction_reactor_type_check
  CHECK (reactor_type::text = ANY (ARRAY['teacher', 'student', 'admin']::text[]));

-- 3. Fix notification_preference.user_type to include 'admin'
ALTER TABLE public.notification_preference
  DROP CONSTRAINT IF EXISTS notification_preference_user_type_check;

ALTER TABLE public.notification_preference
  ADD CONSTRAINT notification_preference_user_type_check
  CHECK (user_type::text = ANY (ARRAY['teacher', 'student', 'admin']::text[]));
