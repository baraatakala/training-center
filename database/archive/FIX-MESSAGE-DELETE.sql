-- =====================================================
-- SIMPLE FIX: Allow teachers to delete messages
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add DELETE policy for messages - teachers can delete any messages they sent or received
CREATE POLICY "Teachers can delete messages"
    ON message
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM teacher 
            WHERE LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
            AND (
                teacher.teacher_id = message.sender_id 
                OR teacher.teacher_id = message.recipient_id
            )
        )
    );

-- Verify the policy was created
SELECT polname, polcmd FROM pg_policies WHERE tablename = 'message';
