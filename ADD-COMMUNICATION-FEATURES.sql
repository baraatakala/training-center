-- =====================================================
-- INTERACTIVE COMMUNICATION FEATURES
-- Adds reactions, comments, and engagement tracking
-- =====================================================

-- Table: announcement_reaction
-- Allows students to react with emojis to announcements
CREATE TABLE IF NOT EXISTS announcement_reaction (
    reaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    announcement_id UUID NOT NULL REFERENCES announcement(announcement_id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL, -- '👍', '❤️', '🎉', '😮', '😢', '🙏'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(announcement_id, student_id, emoji)
);

-- Table: announcement_comment
-- Allows students and teachers to comment on announcements
CREATE TABLE IF NOT EXISTS announcement_comment (
    comment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    announcement_id UUID NOT NULL REFERENCES announcement(announcement_id) ON DELETE CASCADE,
    commenter_type VARCHAR(20) NOT NULL CHECK (commenter_type IN ('teacher', 'student')),
    commenter_id UUID NOT NULL,
    content TEXT NOT NULL,
    parent_comment_id UUID REFERENCES announcement_comment(comment_id) ON DELETE CASCADE,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: message_reaction
-- Allows reactions to messages (like WhatsApp)
CREATE TABLE IF NOT EXISTS message_reaction (
    reaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES message(message_id) ON DELETE CASCADE,
    reactor_type VARCHAR(20) NOT NULL CHECK (reactor_type IN ('teacher', 'student')),
    reactor_id UUID NOT NULL,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, reactor_type, reactor_id)
);

-- Table: message_starred
-- Allows users to star/bookmark important messages
CREATE TABLE IF NOT EXISTS message_starred (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES message(message_id) ON DELETE CASCADE,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('teacher', 'student')),
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_type, user_id)
);

-- Add category field to announcements for better organization
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general';
-- Categories: 'general', 'homework', 'exam', 'event', 'reminder', 'urgent', 'celebration'

-- Add attachments support (JSON array of URLs)
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Add view count to announcements
ALTER TABLE announcement ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Add delivery status to messages
ALTER TABLE message ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Add starred field to messages for quick access
ALTER TABLE message ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_announcement_reaction_announcement ON announcement_reaction(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reaction_student ON announcement_reaction(student_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_announcement ON announcement_comment(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_parent ON announcement_comment(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_message_reaction_message ON message_reaction(message_id);
CREATE INDEX IF NOT EXISTS idx_message_starred_message ON message_starred(message_id);
CREATE INDEX IF NOT EXISTS idx_announcement_category ON announcement(category);

-- Enable RLS
ALTER TABLE announcement_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_starred ENABLE ROW LEVEL SECURITY;

-- RLS Policies for announcement_reaction
CREATE POLICY "Enable read for authenticated users" ON announcement_reaction
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON announcement_reaction
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for own reactions" ON announcement_reaction
    FOR DELETE TO authenticated USING (true);

-- RLS Policies for announcement_comment
CREATE POLICY "Enable read for authenticated users" ON announcement_comment
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON announcement_comment
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update for own comments" ON announcement_comment
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable delete for own comments" ON announcement_comment
    FOR DELETE TO authenticated USING (true);

-- RLS Policies for message_reaction
CREATE POLICY "Enable read for authenticated users" ON message_reaction
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON message_reaction
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for own reactions" ON message_reaction
    FOR DELETE TO authenticated USING (true);

-- RLS Policies for message_starred
CREATE POLICY "Enable read for authenticated users" ON message_starred
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON message_starred
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for own stars" ON message_starred
    FOR DELETE TO authenticated USING (true);

-- Trigger for announcement_comment updated_at
CREATE TRIGGER update_announcement_comment_updated_at 
    BEFORE UPDATE ON announcement_comment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
