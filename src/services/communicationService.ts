import { supabase } from '../lib/supabase';

// =====================================================
// TYPES
// =====================================================

export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Announcement {
  announcement_id: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  created_by: string;
  course_id: string | null;
  is_pinned: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  teacher?: {
    name: string;
    email: string;
  };
  course?: {
    course_name: string;
  } | null;
  read_count?: number;
  is_read?: boolean;
}

export interface Message {
  message_id: string;
  sender_type: 'teacher' | 'student';
  sender_id: string;
  recipient_type: 'teacher' | 'student';
  recipient_id: string;
  subject: string | null;
  content: string;
  is_read: boolean;
  read_at: string | null;
  parent_message_id: string | null;
  created_at: string;
  // Joined data
  sender?: {
    name: string;
    email: string;
  };
  recipient?: {
    name: string;
    email: string;
  };
}

export interface CreateAnnouncementData {
  title: string;
  content: string;
  priority?: AnnouncementPriority;
  course_id?: string | null;
  is_pinned?: boolean;
  expires_at?: string | null;
}

export interface CreateMessageData {
  recipient_type: 'teacher' | 'student';
  recipient_id: string;
  subject?: string;
  content: string;
  parent_message_id?: string;
}

// =====================================================
// ANNOUNCEMENT SERVICES
// =====================================================

export const announcementService = {
  /**
   * Get all announcements (for teachers)
   */
  async getAll(): Promise<{ data: Announcement[] | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('announcement')
        .select(`
          *,
          teacher:created_by (name, email),
          course:course_id (course_name)
        `)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching announcements:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Get announcements for a student (only enrolled courses + global)
   */
  async getForStudent(studentId: string): Promise<{ data: Announcement[] | null; error: Error | null }> {
    try {
      // First get the courses the student is enrolled in
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('enrollment')
        .select('session:session_id (course_id)')
        .eq('student_id', studentId);

      if (enrollmentError) throw enrollmentError;

      // Extract course IDs from enrollments
      const courseIds: string[] = [];
      if (enrollments) {
        for (const e of enrollments) {
          const session = e.session as { course_id?: string } | null;
          if (session?.course_id) {
            courseIds.push(session.course_id);
          }
        }
      }
      const uniqueCourseIds = [...new Set(courseIds)];

      // Get announcements that are global or for enrolled courses
      const { data, error } = await supabase
        .from('announcement')
        .select(`
          *,
          teacher:created_by (name, email),
          course:course_id (course_name)
        `)
        .or(`course_id.is.null,course_id.in.(${uniqueCourseIds.join(',')})`)
        .or('expires_at.is.null,expires_at.gt.now()')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Check which ones are read
      const { data: readStatus } = await supabase
        .from('announcement_read')
        .select('announcement_id')
        .eq('student_id', studentId);

      const readIds = new Set(readStatus?.map(r => r.announcement_id) || []);

      const announcementsWithReadStatus = data?.map(a => ({
        ...a,
        is_read: readIds.has(a.announcement_id)
      })) || [];

      return { data: announcementsWithReadStatus, error: null };
    } catch (error) {
      console.error('Error fetching student announcements:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Create a new announcement
   */
  async create(teacherId: string, data: CreateAnnouncementData): Promise<{ data: Announcement | null; error: Error | null }> {
    try {
      const { data: announcement, error } = await supabase
        .from('announcement')
        .insert({
          ...data,
          created_by: teacherId
        })
        .select(`
          *,
          teacher:created_by (name, email),
          course:course_id (course_name)
        `)
        .single();

      if (error) throw error;
      return { data: announcement, error: null };
    } catch (error) {
      console.error('Error creating announcement:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Update an announcement
   */
  async update(announcementId: string, data: Partial<CreateAnnouncementData>): Promise<{ data: Announcement | null; error: Error | null }> {
    try {
      const { data: announcement, error } = await supabase
        .from('announcement')
        .update(data)
        .eq('announcement_id', announcementId)
        .select(`
          *,
          teacher:created_by (name, email),
          course:course_id (course_name)
        `)
        .single();

      if (error) throw error;
      return { data: announcement, error: null };
    } catch (error) {
      console.error('Error updating announcement:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Delete an announcement
   */
  async delete(announcementId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('announcement')
        .delete()
        .eq('announcement_id', announcementId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error deleting announcement:', error);
      return { error: error as Error };
    }
  },

  /**
   * Mark announcement as read
   */
  async markAsRead(announcementId: string, studentId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('announcement_read')
        .upsert({
          announcement_id: announcementId,
          student_id: studentId
        }, {
          onConflict: 'announcement_id,student_id'
        });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error marking announcement as read:', error);
      return { error: error as Error };
    }
  },

  /**
   * Get unread count for a student
   */
  async getUnreadCount(studentId: string): Promise<{ count: number; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .rpc('get_unread_announcement_count', { p_student_id: studentId });

      if (error) throw error;
      return { count: data || 0, error: null };
    } catch (error) {
      console.error('Error getting unread count:', error);
      return { count: 0, error: error as Error };
    }
  }
};

// =====================================================
// MESSAGE SERVICES
// =====================================================

export const messageService = {
  /**
   * Get all messages for a user (inbox + sent)
   */
  async getAll(userType: 'teacher' | 'student', userId: string): Promise<{ data: Message[] | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('message')
        .select('*')
        .or(`and(sender_type.eq.${userType},sender_id.eq.${userId}),and(recipient_type.eq.${userType},recipient_id.eq.${userId})`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch sender and recipient details
      const messagesWithDetails = await Promise.all(
        (data || []).map(async (msg) => {
          // Get sender info
          let sender = null;
          if (msg.sender_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.sender_id)
              .single();
            sender = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.sender_id)
              .single();
            sender = s;
          }

          // Get recipient info
          let recipient = null;
          if (msg.recipient_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.recipient_id)
              .single();
            recipient = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.recipient_id)
              .single();
            recipient = s;
          }

          return { ...msg, sender, recipient };
        })
      );

      return { data: messagesWithDetails, error: null };
    } catch (error) {
      console.error('Error fetching messages:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Get inbox messages
   */
  async getInbox(userType: 'teacher' | 'student', userId: string): Promise<{ data: Message[] | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('message')
        .select('*')
        .eq('recipient_type', userType)
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch sender details
      const messagesWithSender = await Promise.all(
        (data || []).map(async (msg) => {
          let sender = null;
          if (msg.sender_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.sender_id)
              .single();
            sender = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.sender_id)
              .single();
            sender = s;
          }
          return { ...msg, sender };
        })
      );

      return { data: messagesWithSender, error: null };
    } catch (error) {
      console.error('Error fetching inbox:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Get sent messages
   */
  async getSent(userType: 'teacher' | 'student', userId: string): Promise<{ data: Message[] | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('message')
        .select('*')
        .eq('sender_type', userType)
        .eq('sender_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch recipient details
      const messagesWithRecipient = await Promise.all(
        (data || []).map(async (msg) => {
          let recipient = null;
          if (msg.recipient_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.recipient_id)
              .single();
            recipient = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.recipient_id)
              .single();
            recipient = s;
          }
          return { ...msg, recipient };
        })
      );

      return { data: messagesWithRecipient, error: null };
    } catch (error) {
      console.error('Error fetching sent messages:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Send a message
   */
  async send(senderType: 'teacher' | 'student', senderId: string, data: CreateMessageData): Promise<{ data: Message | null; error: Error | null }> {
    try {
      const { data: message, error } = await supabase
        .from('message')
        .insert({
          ...data,
          sender_type: senderType,
          sender_id: senderId
        })
        .select()
        .single();

      if (error) throw error;
      return { data: message, error: null };
    } catch (error) {
      console.error('Error sending message:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('message')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('message_id', messageId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error marking message as read:', error);
      return { error: error as Error };
    }
  },

  /**
   * Get unread count
   */
  async getUnreadCount(userType: 'teacher' | 'student', userId: string): Promise<{ count: number; error: Error | null }> {
    try {
      const { count, error } = await supabase
        .from('message')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_type', userType)
        .eq('recipient_id', userId)
        .eq('is_read', false);

      if (error) throw error;
      return { count: count || 0, error: null };
    } catch (error) {
      console.error('Error getting unread count:', error);
      return { count: 0, error: error as Error };
    }
  },

  /**
   * Delete a message
   */
  async delete(messageId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('message')
        .delete()
        .eq('message_id', messageId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error deleting message:', error);
      return { error: error as Error };
    }
  },

  /**
   * Get starred messages for a user
   */
  async getStarred(userType: 'teacher' | 'student', userId: string): Promise<{ data: Message[] | null; error: Error | null }> {
    try {
      // Get starred message IDs
      const { data: starredData, error: starredError } = await supabase
        .from('message_starred')
        .select('message_id')
        .eq('user_type', userType)
        .eq('user_id', userId);

      if (starredError) throw starredError;
      
      if (!starredData || starredData.length === 0) {
        return { data: [], error: null };
      }

      const starredIds = starredData.map(s => s.message_id);

      // Get full message details for starred messages
      const { data: messages, error: msgError } = await supabase
        .from('message')
        .select('*')
        .in('message_id', starredIds)
        .order('created_at', { ascending: false });

      if (msgError) throw msgError;

      // Fetch sender/recipient details
      const messagesWithDetails = await Promise.all(
        (messages || []).map(async (msg) => {
          let sender = null;
          let recipient = null;
          
          // Get sender
          if (msg.sender_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.sender_id)
              .single();
            sender = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.sender_id)
              .single();
            sender = s;
          }
          
          // Get recipient
          if (msg.recipient_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', msg.recipient_id)
              .single();
            recipient = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', msg.recipient_id)
              .single();
            recipient = s;
          }
          
          return { ...msg, sender, recipient, isStarred: true };
        })
      );

      return { data: messagesWithDetails, error: null };
    } catch (error) {
      console.error('Error fetching starred messages:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Toggle starred status for a message
   */
  async toggleStarred(messageId: string, userType: 'teacher' | 'student', userId: string): Promise<{ isStarred: boolean; error: Error | null }> {
    try {
      // Check if already starred
      const { data: existing } = await supabase
        .from('message_starred')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_type', userType)
        .eq('user_id', userId)
        .single();

      if (existing) {
        // Unstar
        await supabase
          .from('message_starred')
          .delete()
          .eq('id', existing.id);
        return { isStarred: false, error: null };
      } else {
        // Star
        await supabase
          .from('message_starred')
          .insert({ message_id: messageId, user_type: userType, user_id: userId });
        return { isStarred: true, error: null };
      }
    } catch (error) {
      console.error('Error toggling star:', error);
      return { isStarred: false, error: error as Error };
    }
  },

  /**
   * Add reaction to a message
   */
  async addReaction(messageId: string, reactorType: 'teacher' | 'student', reactorId: string, emoji: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('message_reaction')
        .upsert({
          message_id: messageId,
          reactor_type: reactorType,
          reactor_id: reactorId,
          emoji
        }, { onConflict: 'message_id,reactor_type,reactor_id' });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error adding reaction:', error);
      return { error: error as Error };
    }
  },

  /**
   * Remove reaction from a message
   */
  async removeReaction(messageId: string, reactorType: 'teacher' | 'student', reactorId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('message_reaction')
        .delete()
        .eq('message_id', messageId)
        .eq('reactor_type', reactorType)
        .eq('reactor_id', reactorId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error removing reaction:', error);
      return { error: error as Error };
    }
  },

  /**
   * Get reactions for a message
   */
  async getReactions(messageId: string): Promise<{ data: { emoji: string; count: number; reactors: string[] }[]; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('message_reaction')
        .select('emoji, reactor_type, reactor_id')
        .eq('message_id', messageId);

      if (error) throw error;

      // Group by emoji
      const emojiMap = new Map<string, string[]>();
      (data || []).forEach(r => {
        const key = r.emoji;
        if (!emojiMap.has(key)) emojiMap.set(key, []);
        emojiMap.get(key)!.push(`${r.reactor_type}:${r.reactor_id}`);
      });

      const result = Array.from(emojiMap.entries()).map(([emoji, reactors]) => ({
        emoji,
        count: reactors.length,
        reactors
      }));

      return { data: result, error: null };
    } catch (error) {
      console.error('Error getting reactions:', error);
      return { data: [], error: error as Error };
    }
  }
};

// =====================================================
// ANNOUNCEMENT REACTION & COMMENT SERVICES
// =====================================================

export const announcementReactionService = {
  /**
   * Toggle a reaction on an announcement
   */
  async toggle(announcementId: string, studentId: string, emoji: string): Promise<{ added: boolean; error: Error | null }> {
    try {
      // Check if reaction exists
      const { data: existing } = await supabase
        .from('announcement_reaction')
        .select('reaction_id')
        .eq('announcement_id', announcementId)
        .eq('student_id', studentId)
        .eq('emoji', emoji)
        .single();

      if (existing) {
        // Remove reaction
        await supabase
          .from('announcement_reaction')
          .delete()
          .eq('reaction_id', existing.reaction_id);
        return { added: false, error: null };
      } else {
        // Add reaction
        await supabase
          .from('announcement_reaction')
          .insert({ announcement_id: announcementId, student_id: studentId, emoji });
        return { added: true, error: null };
      }
    } catch (error) {
      console.error('Error toggling reaction:', error);
      return { added: false, error: error as Error };
    }
  },

  /**
   * Get all reactions for an announcement with reactor names
   */
  async getForAnnouncement(announcementId: string, currentStudentId?: string): Promise<{ 
    data: { emoji: string; count: number; hasReacted: boolean; reactors: { id: string; name: string }[] }[]; 
    error: Error | null 
  }> {
    try {
      // Fetch reactions with student names
      const { data, error } = await supabase
        .from('announcement_reaction')
        .select('emoji, student_id, student:student_id(name)')
        .eq('announcement_id', announcementId);

      if (error) throw error;

      // Group by emoji with reactor info
      const emojiMap = new Map<string, { count: number; studentIds: string[]; reactors: { id: string; name: string }[] }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data || []).forEach((r: any) => {
        const emoji = r.emoji as string;
        const studentId = r.student_id as string;
        const studentName = r.student?.name || 'Unknown Student';
        
        if (!emojiMap.has(emoji)) emojiMap.set(emoji, { count: 0, studentIds: [], reactors: [] });
        const entry = emojiMap.get(emoji)!;
        entry.count++;
        entry.studentIds.push(studentId);
        entry.reactors.push({ 
          id: studentId, 
          name: studentName 
        });
      });

      const result = Array.from(emojiMap.entries()).map(([emoji, { count, studentIds, reactors }]) => ({
        emoji,
        count,
        hasReacted: currentStudentId ? studentIds.includes(currentStudentId) : false,
        reactors
      }));

      return { data: result, error: null };
    } catch (error) {
      console.error('Error getting reactions:', error);
      return { data: [], error: error as Error };
    }
  }
};

export interface AnnouncementComment {
  comment_id: string;
  announcement_id: string;
  commenter_type: 'teacher' | 'student';
  commenter_id: string;
  content: string;
  parent_comment_id: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  commenter?: {
    name: string;
    email: string;
  };
  replies?: AnnouncementComment[];
}

export const announcementCommentService = {
  /**
   * Get comments for an announcement
   */
  async getForAnnouncement(announcementId: string): Promise<{ data: AnnouncementComment[]; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('announcement_comment')
        .select('*')
        .eq('announcement_id', announcementId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch commenter details
      const commentsWithDetails = await Promise.all(
        (data || []).map(async (comment) => {
          let commenter = null;
          if (comment.commenter_type === 'teacher') {
            const { data: t } = await supabase
              .from('teacher')
              .select('name, email')
              .eq('teacher_id', comment.commenter_id)
              .single();
            commenter = t;
          } else {
            const { data: s } = await supabase
              .from('student')
              .select('name, email')
              .eq('student_id', comment.commenter_id)
              .single();
            commenter = s;
          }
          return { ...comment, commenter } as AnnouncementComment;
        })
      );

      // Organize into threads (parent comments with replies)
      const parentComments = commentsWithDetails.filter(c => !c.parent_comment_id);
      const replies = commentsWithDetails.filter(c => c.parent_comment_id);

      parentComments.forEach(parent => {
        parent.replies = replies.filter(r => r.parent_comment_id === parent.comment_id);
      });

      return { data: parentComments, error: null };
    } catch (error) {
      console.error('Error getting comments:', error);
      return { data: [], error: error as Error };
    }
  },

  /**
   * Add a comment
   */
  async add(
    announcementId: string, 
    commenterType: 'teacher' | 'student', 
    commenterId: string, 
    content: string,
    parentCommentId?: string
  ): Promise<{ data: AnnouncementComment | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('announcement_comment')
        .insert({
          announcement_id: announcementId,
          commenter_type: commenterType,
          commenter_id: commenterId,
          content,
          parent_comment_id: parentCommentId || null
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error adding comment:', error);
      return { data: null, error: error as Error };
    }
  },

  /**
   * Delete a comment
   */
  async delete(commentId: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase
        .from('announcement_comment')
        .delete()
        .eq('comment_id', commentId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Error deleting comment:', error);
      return { error: error as Error };
    }
  },

  /**
   * Toggle pin on a comment (teacher only)
   */
  async togglePin(commentId: string): Promise<{ isPinned: boolean; error: Error | null }> {
    try {
      // Get current state
      const { data: comment } = await supabase
        .from('announcement_comment')
        .select('is_pinned')
        .eq('comment_id', commentId)
        .single();

      const newPinned = !comment?.is_pinned;

      await supabase
        .from('announcement_comment')
        .update({ is_pinned: newPinned })
        .eq('comment_id', commentId);

      return { isPinned: newPinned, error: null };
    } catch (error) {
      console.error('Error toggling pin:', error);
      return { isPinned: false, error: error as Error };
    }
  },

  /**
   * Get comment count for an announcement
   */
  async getCount(announcementId: string): Promise<{ count: number; error: Error | null }> {
    try {
      const { count, error } = await supabase
        .from('announcement_comment')
        .select('*', { count: 'exact', head: true })
        .eq('announcement_id', announcementId);

      if (error) throw error;
      return { count: count || 0, error: null };
    } catch (error) {
      console.error('Error getting comment count:', error);
      return { count: 0, error: error as Error };
    }
  }
};

export default { announcementService, messageService, announcementReactionService, announcementCommentService };
