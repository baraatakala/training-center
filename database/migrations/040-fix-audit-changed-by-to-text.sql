-- migration 040: Fix: audit_log.changed_by was UUID type but we write email strings.
-- deleted_by is already TEXT. Make changed_by consistent.
ALTER TABLE public.audit_log
  ALTER COLUMN changed_by TYPE text USING changed_by::text;
