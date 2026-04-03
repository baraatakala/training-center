-- ============================================================================
-- Migration 017: Cleanup dead columns, tables, and functions
-- ============================================================================
-- Full DB vs frontend audit revealed several columns/tables/functions with
-- ZERO frontend integration. This migration removes them.
--
-- Run AFTER migration 016 (remove-override-add-session-time-change).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DROP DEAD COLUMNS ON audit_log
-- ============================================================================
-- ip_address and user_agent are never written by the frontend (would need
-- server middleware). They are fetched via select('*') but never read/displayed.

ALTER TABLE public.audit_log DROP COLUMN IF EXISTS ip_address;
ALTER TABLE public.audit_log DROP COLUMN IF EXISTS user_agent;

-- ============================================================================
-- 2. DROP DEAD TABLE: notification_preference
-- ============================================================================
-- Zero frontend integration — no reads, no writes, no service, no component.
-- The table was scaffolded for a future email/push notification system that
-- was never built.

DROP TABLE IF EXISTS public.notification_preference;

-- ============================================================================
-- 3. DROP DEAD COLUMNS ON message
-- ============================================================================
-- is_starred: superseded by the message_starred junction table.
--   The frontend exclusively uses message_starred (5 references in
--   communicationService.ts). The boolean column is never read or written.
--
-- delivered_at: never populated by any frontend or backend code.
--   Read once in Messages.tsx (delivery indicator) but always null,
--   so the indicator never fires.

ALTER TABLE public.message DROP COLUMN IF EXISTS is_starred;
ALTER TABLE public.message DROP COLUMN IF EXISTS delivered_at;

-- ============================================================================
-- 4. DROP DEAD COLUMNS ON session_recording
-- ============================================================================
-- provider_name and provider_recording_id are always written as null.
-- The UI detects the provider from the URL pattern (detectProvider()) instead.

ALTER TABLE public.session_recording DROP COLUMN IF EXISTS provider_name;
ALTER TABLE public.session_recording DROP COLUMN IF EXISTS provider_recording_id;

-- ============================================================================
-- 5. DROP DEAD FUNCTION: get_unread_message_count
-- ============================================================================
-- Defined in functions.sql but never called from frontend or any trigger/RLS
-- policy. The announcement equivalent (get_unread_announcement_count) IS used.

DROP FUNCTION IF EXISTS public.get_unread_message_count(VARCHAR, UUID);

COMMIT;
