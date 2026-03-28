-- CREATE AUDIT LOG TABLE FOR DELETE OPERATIONS
-- Run this in Supabase SQL Editor to enable audit logging

-- ================================================================
-- CREATE AUDIT LOG TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  audit_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('DELETE', 'UPDATE', 'INSERT')),
  old_data jsonb,
  new_data jsonb,
  deleted_by text,
  deleted_at timestamp with time zone DEFAULT now(),
  reason text,
  CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id)
);

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON public.audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_deleted_at ON public.audit_log(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_deleted_by ON public.audit_log(deleted_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_operation ON public.audit_log(operation);

-- ================================================================
-- ENABLE RLS (Row Level Security)
-- ================================================================

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read audit logs
CREATE POLICY "Allow authenticated users to read audit logs"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow authenticated users to insert audit logs
CREATE POLICY "Allow authenticated users to insert audit logs"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ Audit log table created successfully';
  RAISE NOTICE '✓ Indexes created';
  RAISE NOTICE '✓ RLS policies enabled';
  RAISE NOTICE '';
  RAISE NOTICE 'Audit logging is now ready!';
  RAISE NOTICE '';
  RAISE NOTICE 'Table structure:';
  RAISE NOTICE '  - audit_id: Unique identifier';
  RAISE NOTICE '  - table_name: Which table was affected (e.g., student, course, session)';
  RAISE NOTICE '  - record_id: ID of the deleted record';
  RAISE NOTICE '  - operation: Type of operation (DELETE, UPDATE, INSERT)';
  RAISE NOTICE '  - old_data: Full record data before deletion (as JSON)';
  RAISE NOTICE '  - new_data: New data for UPDATE operations';
  RAISE NOTICE '  - deleted_by: Email of user who performed the action';
  RAISE NOTICE '  - deleted_at: Timestamp of deletion';
  RAISE NOTICE '  - reason: Optional reason for deletion';
END $$;

-- Show table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_log'
ORDER BY ordinal_position;
