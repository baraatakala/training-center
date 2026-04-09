-- Migration 025: Fix scoring_config.teacher_id FK violation
-- 
-- Problem: scoring_config.teacher_id references public.teacher(teacher_id),
-- but the service was inserting with auth.users.id (auth UUID) instead of the
-- actual teacher record UUID, causing FK violation on first-time row insert.
--
-- Fix: Make teacher_id nullable so:
--   a) Admins without a teacher record can still create the global config row.
--   b) The FK constraint remains valid for rows that DO have a teacher_id.
--
-- The scoring_config table is intended to hold ONE global row. The teacher_id
-- column originally tracked ownership but is now vestigial for global config.

-- Make teacher_id nullable (removes NOT NULL constraint, FK stays intact)
ALTER TABLE public.scoring_config
  ALTER COLUMN teacher_id DROP NOT NULL;
