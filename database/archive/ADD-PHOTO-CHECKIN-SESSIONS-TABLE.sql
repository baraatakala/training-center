-- Migration: Create photo_checkin_sessions table for face recognition attendance
-- Date: 2026-01-28

-- Create table to store photo check-in session tokens (similar to qr_sessions)
CREATE TABLE IF NOT EXISTS photo_checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_photo_checkin_sessions_token ON photo_checkin_sessions(token);

-- Create index for session lookups
CREATE INDEX IF NOT EXISTS idx_photo_checkin_sessions_session ON photo_checkin_sessions(session_id, attendance_date);

-- Add comment for documentation
COMMENT ON TABLE photo_checkin_sessions IS 'Stores tokens for face recognition check-in sessions. Similar to qr_sessions but for photo-based attendance.';

-- Verification query
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'photo_checkin_sessions'
ORDER BY ordinal_position;
