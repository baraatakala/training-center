-- =====================================================
-- FIX COMMUNICATION HUB POLICIES
-- Adds missing DELETE policies for messages
-- =====================================================

-- 1. Add DELETE policy for messages - users can delete their own sent/received messages
CREATE POLICY "Users can delete their messages"
    ON message
    FOR DELETE
    USING (
        -- Sender can delete their sent messages
        (sender_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
            AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        ))
        OR
        (sender_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = message.sender_id
            AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
        ))
        OR
        -- Recipient can delete messages sent to them
        (recipient_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = message.recipient_id
            AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        ))
        OR
        (recipient_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = message.recipient_id
            AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
        ))
    );

-- 2. Add DELETE policy for message attachments
CREATE POLICY "Users can delete attachments of their messages"
    ON message_attachment
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM message m
            WHERE m.message_id = message_attachment.message_id
            AND (
                -- Sender can delete
                (m.sender_type = 'teacher' AND EXISTS (
                    SELECT 1 FROM teacher WHERE teacher.teacher_id = m.sender_id
                    AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
                ))
                OR
                (m.sender_type = 'student' AND EXISTS (
                    SELECT 1 FROM student WHERE student.student_id = m.sender_id
                    AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
                ))
            )
        )
    );

-- Verify the policy was created
SELECT polname, polcmd 
FROM pg_policies 
WHERE tablename = 'message';
