-- Migration: Add configurable max tab-switch violations to session table
-- Allows admin/teacher to configure how many times a student can switch tabs
-- before the anti-cheat system auto-submits their feedback test.

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS max_tab_switches INTEGER NOT NULL DEFAULT 3
    CHECK (max_tab_switches >= 1 AND max_tab_switches <= 20);

COMMENT ON COLUMN public.session.max_tab_switches IS
  'Maximum tab-switch violations allowed before anti-cheat auto-submit triggers (1–20, default 3). Only active when feedback questions have correct_answer set (test mode).';
