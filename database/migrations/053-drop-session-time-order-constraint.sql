-- Migration 053: Drop chk_session_time_order constraint
-- Reason: cross-midnight (overnight) sessions are valid (e.g. 23:04 → 00:04).
-- The constraint end_time > start_time incorrectly rejects these.
ALTER TABLE session DROP CONSTRAINT IF EXISTS chk_session_time_order;
