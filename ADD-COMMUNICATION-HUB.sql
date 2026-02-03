-- =====================================================
-- COMMUNICATION HUB MIGRATION
-- Adds announcements and messaging system
-- =====================================================

-- 1. ANNOUNCEMENTS TABLE
-- Teachers can post announcements to courses
CREATE TABLE IF NOT EXISTS announcement (
    announcement_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_by UUID NOT NULL REFERENCES teacher(teacher_id) ON DELETE CASCADE,
    course_id UUID REFERENCES course(course_id) ON DELETE CASCADE, -- NULL means all courses (global)
    is_pinned BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE, -- NULL means no expiration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_announcement_course ON announcement(course_id);
CREATE INDEX IF NOT EXISTS idx_announcement_created_by ON announcement(created_by);
CREATE INDEX IF NOT EXISTS idx_announcement_created_at ON announcement(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_priority ON announcement(priority);
CREATE INDEX IF NOT EXISTS idx_announcement_pinned ON announcement(is_pinned) WHERE is_pinned = TRUE;

-- 2. ANNOUNCEMENT READ STATUS
-- Track which announcements have been read by students
CREATE TABLE IF NOT EXISTS announcement_read (
    read_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    announcement_id UUID NOT NULL REFERENCES announcement(announcement_id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(announcement_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_read_student ON announcement_read(student_id);
CREATE INDEX IF NOT EXISTS idx_announcement_read_announcement ON announcement_read(announcement_id);

-- 3. MESSAGES TABLE
-- Direct messaging between teachers and students
CREATE TABLE IF NOT EXISTS message (
    message_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('teacher', 'student')),
    sender_id UUID NOT NULL,
    recipient_type VARCHAR(10) NOT NULL CHECK (recipient_type IN ('teacher', 'student')),
    recipient_id UUID NOT NULL,
    subject VARCHAR(255),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    parent_message_id UUID REFERENCES message(message_id) ON DELETE SET NULL, -- For replies/threads
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_sender ON message(sender_type, sender_id);
CREATE INDEX IF NOT EXISTS idx_message_recipient ON message(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_message_created_at ON message(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_thread ON message(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_message_unread ON message(is_read) WHERE is_read = FALSE;

-- 4. MESSAGE ATTACHMENTS (optional for future)
CREATE TABLE IF NOT EXISTS message_attachment (
    attachment_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES message(message_id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER,
    file_type VARCHAR(100),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_message ON message_attachment(message_id);

-- 5. NOTIFICATION PREFERENCES
CREATE TABLE IF NOT EXISTS notification_preference (
    preference_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('teacher', 'student')),
    user_id UUID NOT NULL,
    email_announcements BOOLEAN DEFAULT TRUE,
    email_messages BOOLEAN DEFAULT TRUE,
    push_announcements BOOLEAN DEFAULT TRUE,
    push_messages BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_type, user_id)
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS
ALTER TABLE announcement ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_read ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;

-- ANNOUNCEMENT POLICIES
-- Teachers can create/update/delete their own announcements
CREATE POLICY "Teachers can manage their announcements"
    ON announcement
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM teacher 
            WHERE teacher.teacher_id = announcement.created_by 
            AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

-- Students can read announcements for their enrolled courses or global announcements
CREATE POLICY "Students can read relevant announcements"
    ON announcement
    FOR SELECT
    USING (
        -- Global announcements (no course specified)
        course_id IS NULL
        OR
        -- Course-specific: student must be enrolled
        EXISTS (
            SELECT 1 FROM enrollment e
            JOIN session s ON e.session_id = s.session_id
            JOIN student st ON e.student_id = st.student_id
            WHERE s.course_id = announcement.course_id
            AND LOWER(st.email) = LOWER(auth.jwt() ->> 'email')
        )
        OR
        -- Teachers can see all announcements
        EXISTS (
            SELECT 1 FROM teacher
            WHERE LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

-- ANNOUNCEMENT READ POLICIES
CREATE POLICY "Students can mark announcements as read"
    ON announcement_read
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM student
            WHERE student.student_id = announcement_read.student_id
            AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

CREATE POLICY "Teachers can view read status"
    ON announcement_read
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM teacher
            WHERE LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

-- MESSAGE POLICIES
-- Users can read messages they sent or received
CREATE POLICY "Users can view their messages"
    ON message
    FOR SELECT
    USING (
        -- Sender is current user
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
        -- Recipient is current user
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

-- Users can send messages
CREATE POLICY "Teachers can send messages"
    ON message
    FOR INSERT
    WITH CHECK (
        sender_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = message.sender_id
            AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

CREATE POLICY "Students can send messages"
    ON message
    FOR INSERT
    WITH CHECK (
        sender_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = message.sender_id
            AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
        )
    );

-- Users can update messages they received (mark as read)
CREATE POLICY "Recipients can update message read status"
    ON message
    FOR UPDATE
    USING (
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

-- NOTIFICATION PREFERENCE POLICIES
CREATE POLICY "Users can manage their notification preferences"
    ON notification_preference
    FOR ALL
    USING (
        (user_type = 'teacher' AND EXISTS (
            SELECT 1 FROM teacher WHERE teacher.teacher_id = notification_preference.user_id
            AND LOWER(teacher.email) = LOWER(auth.jwt() ->> 'email')
        ))
        OR
        (user_type = 'student' AND EXISTS (
            SELECT 1 FROM student WHERE student.student_id = notification_preference.user_id
            AND LOWER(student.email) = LOWER(auth.jwt() ->> 'email')
        ))
    );

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get unread announcement count for a student
CREATE OR REPLACE FUNCTION get_unread_announcement_count(p_student_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM announcement a
        LEFT JOIN announcement_read ar ON a.announcement_id = ar.announcement_id 
            AND ar.student_id = p_student_id
        WHERE ar.read_id IS NULL
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
        AND (
            a.course_id IS NULL  -- Global announcements
            OR EXISTS (
                SELECT 1 FROM enrollment e
                JOIN session s ON e.session_id = s.session_id
                WHERE e.student_id = p_student_id
                AND s.course_id = a.course_id
            )
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get unread message count
CREATE OR REPLACE FUNCTION get_unread_message_count(p_user_type VARCHAR, p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM message
        WHERE recipient_type = p_user_type
        AND recipient_id = p_user_id
        AND is_read = FALSE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp trigger for announcements
CREATE OR REPLACE FUNCTION update_announcement_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_announcement_timestamp
    BEFORE UPDATE ON announcement
    FOR EACH ROW
    EXECUTE FUNCTION update_announcement_timestamp();

-- =====================================================
-- SAMPLE DATA (Optional - for testing)
-- =====================================================

-- Uncomment to insert sample data:
/*
-- Get first teacher ID
DO $$
DECLARE
    v_teacher_id UUID;
    v_course_id UUID;
BEGIN
    SELECT teacher_id INTO v_teacher_id FROM teacher LIMIT 1;
    SELECT course_id INTO v_course_id FROM course LIMIT 1;
    
    IF v_teacher_id IS NOT NULL THEN
        -- Create a global announcement
        INSERT INTO announcement (title, content, priority, created_by, is_pinned)
        VALUES (
            'Welcome to the Training Center!',
            'We are excited to have you here. Please check your course schedules and make sure to attend all sessions on time.',
            'high',
            v_teacher_id,
            true
        );
        
        -- Create a course-specific announcement
        IF v_course_id IS NOT NULL THEN
            INSERT INTO announcement (title, content, priority, created_by, course_id)
            VALUES (
                'Upcoming Assessment',
                'Please prepare for the upcoming assessment next week. Review chapters 5-8.',
                'normal',
                v_teacher_id,
                v_course_id
            );
        END IF;
    END IF;
END $$;
*/

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check tables created
SELECT 'announcement' as table_name, COUNT(*) as row_count FROM announcement
UNION ALL
SELECT 'announcement_read', COUNT(*) FROM announcement_read
UNION ALL
SELECT 'message', COUNT(*) FROM message
UNION ALL
SELECT 'message_attachment', COUNT(*) FROM message_attachment
UNION ALL
SELECT 'notification_preference', COUNT(*) FROM notification_preference;

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('announcement', 'announcement_read', 'message', 'message_attachment', 'notification_preference');
