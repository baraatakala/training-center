import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { messageService } from '../services/communicationService';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import type { Message, CreateMessageData } from '../services/communicationService';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

type TabType = 'inbox' | 'sent' | 'starred';

// Quick reply suggestions
const QUICK_REPLIES = [
  '👍 Got it!',
  '✅ Thanks!',
  '📝 I will check',
  '🙏 Thank you',
  '⏰ Will do ASAP',
  '❓ Can you explain more?',
];

// Message reactions
const MESSAGE_REACTIONS = ['👍', '❤️', '😊', '🎉', '👏'];

// Extended message with additional features
interface ExtendedMessage extends Message {
  isStarred?: boolean;
  reaction?: string;
}

export function Messages() {
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userType, setUserType] = useState<'teacher' | 'student' | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('inbox');
  const [starredCount, setStarredCount] = useState(0);

  // Compose modal states
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<ExtendedMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Form states
  const [formRecipientType, setFormRecipientType] = useState<'teacher' | 'student'>('teacher');
  const [formRecipientId, setFormRecipientId] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Quick reply state
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  // Reaction picker state
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);

  // Message input ref for auto-focus
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Recipients lists
  const [teachers, setTeachers] = useState<{ teacher_id: string; name: string; email: string }[]>([]);
  const [students, setStudents] = useState<{ student_id: string; name: string; email: string }[]>([]);

  // Search
  const [searchTerm, setSearchTerm] = useState('');

  // Rate limiting for students (60s cooldown)
  const STUDENT_COOLDOWN_SECONDS = 60;
  const [lastSentAt, setLastSentAt] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Format time intelligently
  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return 'Yesterday';
    } else {
      return format(date, 'MMM dd');
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return format(new Date(dateStr), 'MMM dd');
    }
  };

  // Load starred count separately
  const loadStarredCount = useCallback(async () => {
    if (!userType || !currentUserId) return;
    const { data } = await messageService.getStarred(userType, currentUserId);
    setStarredCount(data?.length || 0);
  }, [userType, currentUserId]);

  const loadMessages = useCallback(async () => {
    if (!userType || !currentUserId) return;

    setLoading(true);
    try {
      let data: Message[] | null = null;
      let err: Error | null = null;

      if (activeTab === 'starred') {
        // Use dedicated getStarred function
        const result = await messageService.getStarred(userType, currentUserId);
        data = result.data;
        err = result.error;
        setStarredCount(result.data?.length || 0);
      } else if (activeTab === 'inbox') {
        const result = await messageService.getInbox(userType, currentUserId);
        data = result.data;
        err = result.error;
      } else {
        const result = await messageService.getSent(userType, currentUserId);
        data = result.data;
        err = result.error;
      }

      if (err) {
        setError('Failed to load messages');
      } else {
        setMessages(data || []);
      }
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [userType, currentUserId, activeTab]);

  const loadRecipients = useCallback(async () => {
    const { data: teacherList } = await supabase
      .from('teacher')
      .select('teacher_id, name, email')
      .order('name');
    setTeachers(teacherList || []);

    const { data: studentList } = await supabase
      .from('student')
      .select('student_id, name, email')
      .order('name');
    setStudents(studentList || []);
  }, []);

  const checkUserAndLoadData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      // Check if teacher
      const { data: teacher } = await supabase
        .from('teacher')
        .select('teacher_id')
        .ilike('email', user.email)
        .single();

      if (teacher) {
        setUserType('teacher');
        setCurrentUserId(teacher.teacher_id);
      } else {
        // Check if student
        const { data: student } = await supabase
          .from('student')
          .select('student_id')
          .ilike('email', user.email)
          .single();

        if (student) {
          setUserType('student');
          setCurrentUserId(student.student_id);
        } else {
          setError('User not found in system');
          setLoading(false);
          return;
        }
      }

      // Load recipients lists
      await loadRecipients();
    } catch (err) {
      console.error('Error:', err);
      setError('Failed to load data');
    }
  }, [loadRecipients]);

  useEffect(() => {
    checkUserAndLoadData();
  }, [checkUserAndLoadData]);

  useEffect(() => {
    if (currentUserId && userType) {
      loadMessages();
      loadStarredCount(); // Load starred count on initial load
    }
  }, [currentUserId, userType, loadMessages, loadStarredCount]);

  // Cooldown timer for student rate limiting
  useEffect(() => {
    if (userType !== 'student' || cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastSentAt) / 1000);
      const remaining = Math.max(0, STUDENT_COOLDOWN_SECONDS - elapsed);
      setCooldownRemaining(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [userType, lastSentAt, cooldownRemaining, STUDENT_COOLDOWN_SECONDS]);

  const handleSendMessage = async () => {
    if (!formRecipientId || !formContent.trim()) {
      toast.warning('Please select a recipient and enter a message');
      return;
    }

    if (!userType || !currentUserId) return;

    // Rate limit for students
    if (userType === 'student') {
      const elapsed = Math.floor((Date.now() - lastSentAt) / 1000);
      if (elapsed < STUDENT_COOLDOWN_SECONDS && lastSentAt > 0) {
        const remaining = STUDENT_COOLDOWN_SECONDS - elapsed;
        toast.warning(`Please wait ${remaining}s before sending another message.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const messageData: CreateMessageData = {
        recipient_type: formRecipientType,
        recipient_id: formRecipientId,
        subject: formSubject || undefined,
        content: formContent,
        parent_message_id: replyingTo?.message_id
      };

      const { error: err } = await messageService.send(userType, currentUserId, messageData);
      if (err) throw err;

      // Record send time for rate limiting
      if (userType === 'student') {
        setLastSentAt(Date.now());
        setCooldownRemaining(STUDENT_COOLDOWN_SECONDS);
      }

      await loadMessages();
      closeComposeModal();
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error('Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkAsRead = async (message: Message) => {
    if (message.is_read) return;

    await messageService.markAsRead(message.message_id);
    setMessages(prev => prev.map(m =>
      m.message_id === message.message_id
        ? { ...m, is_read: true, read_at: new Date().toISOString() }
        : m
    ));
  };

  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  const handleDelete = async (messageId: string) => {
    setDeletingMessageId(messageId);
  };

  const confirmDelete = async () => {
    if (!deletingMessageId) return;
    try {
      const { error: err } = await messageService.delete(deletingMessageId);
      if (err) {
        console.error('Delete error:', err);
        toast.error(`Failed to delete message: ${err.message || 'Permission denied.'}`);
      } else {
        toast.success('Message deleted');
        await loadMessages();
        setViewingMessage(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete message. Please try again.');
    }
    setDeletingMessageId(null);
  };

  const openComposeModal = (replyTo?: Message) => {
    if (replyTo) {
      setReplyingTo(replyTo);
      setFormRecipientType(replyTo.sender_type);
      setFormRecipientId(replyTo.sender_id);
      setFormSubject(`Re: ${replyTo.subject || 'No Subject'}`);
      setFormContent('');
    } else {
      setReplyingTo(null);
      setFormRecipientType('teacher');
      setFormRecipientId('');
      setFormSubject('');
      setFormContent('');
    }
    setShowComposeModal(true);
  };

  const closeComposeModal = () => {
    setShowComposeModal(false);
    setReplyingTo(null);
    setShowQuickReplies(false);
  };

  // Toggle star on a message
  const handleToggleStar = async (messageId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!userType || !currentUserId) return;

    const { isStarred, error } = await messageService.toggleStarred(messageId, userType, currentUserId);
    
    if (error) {
      console.error('Failed to toggle star:', error);
      return;
    }
    
    setMessages(prev => prev.map(m =>
      m.message_id === messageId ? { ...m, isStarred } : m
    ));

    // Update starred count
    setStarredCount(prev => isStarred ? prev + 1 : Math.max(0, prev - 1));

    if (viewingMessage?.message_id === messageId) {
      setViewingMessage(prev => prev ? { ...prev, isStarred } : null);
    }
  };

  // Toggle reaction on a message (add or remove)
  const handleToggleReaction = async (messageId: string, emoji: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!userType || !currentUserId) return;

    // Find current reaction for this message
    const currentMessage = messages.find(m => m.message_id === messageId);
    const currentReaction = currentMessage?.reaction;

    // If clicking the same emoji, remove it; otherwise add the new one
    if (currentReaction === emoji) {
      // Remove reaction
      const { error } = await messageService.removeReaction(messageId, userType, currentUserId);
      if (error) {
        console.error('Failed to remove reaction:', error);
        return;
      }
      
      setMessages(prev => prev.map(m =>
        m.message_id === messageId ? { ...m, reaction: undefined } : m
      ));

      if (viewingMessage?.message_id === messageId) {
        setViewingMessage(prev => prev ? { ...prev, reaction: undefined } : null);
      }
    } else {
      // Add or change reaction
      const { error } = await messageService.addReaction(messageId, userType, currentUserId, emoji);
      if (error) {
        console.error('Failed to add reaction:', error);
        return;
      }
      
      setMessages(prev => prev.map(m =>
        m.message_id === messageId ? { ...m, reaction: emoji } : m
      ));

      if (viewingMessage?.message_id === messageId) {
        setViewingMessage(prev => prev ? { ...prev, reaction: emoji } : null);
      }
    }

    setShowReactionPicker(null);
  };

  // Quick reply handler
  const handleQuickReply = (quickReply: string) => {
    setFormContent(quickReply);
    setShowQuickReplies(false);
    messageInputRef.current?.focus();
  };

  const filteredMessages = messages.filter(m => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (m.subject?.toLowerCase().includes(term)) ||
      (m.content.toLowerCase().includes(term)) ||
      (m.sender?.name?.toLowerCase().includes(term)) ||
      (m.recipient?.name?.toLowerCase().includes(term))
    );
  });

  // Group messages by date for better organization
  const groupedMessages = filteredMessages.reduce((groups, message) => {
    const date = new Date(message.created_at);
    let key = 'Older';
    if (isToday(date)) key = 'Today';
    else if (isYesterday(date)) key = 'Yesterday';
    else if (Date.now() - date.getTime() < 7 * 24 * 60 * 60 * 1000) key = 'This Week';
    
    if (!groups[key]) groups[key] = [];
    groups[key].push(message);
    return groups;
  }, {} as Record<string, ExtendedMessage[]>);

  const unreadCount = messages.filter(m => !m.is_read && activeTab === 'inbox').length;
  // starredCount is now managed by state, loaded on page load

  if (loading && !currentUserId) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="inline-block p-6 bg-red-50 dark:bg-red-900/30 border-2 border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-semibold">⚠️ {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold dark:text-white">💬 Messages</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Communicate with {userType === 'teacher' ? 'students and other teachers' : 'your teachers'}
          </p>
        </div>
        <Button onClick={() => openComposeModal()} className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
          ✉️ Compose
        </Button>
      </div>

      {/* Tabs and Search */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant={activeTab === 'inbox' ? 'primary' : 'outline'}
                onClick={() => setActiveTab('inbox')}
                className="relative"
              >
                📥 Inbox
                {unreadCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </Button>
              <Button
                variant={activeTab === 'sent' ? 'primary' : 'outline'}
                onClick={() => setActiveTab('sent')}
              >
                📤 Sent
              </Button>
              <Button
                variant={activeTab === 'starred' ? 'primary' : 'outline'}
                onClick={() => setActiveTab('starred')}
                className="relative"
              >
                ⭐ Starred
                {starredCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-yellow-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {starredCount}
                  </span>
                )}
              </Button>
            </div>
            <div className="w-full sm:w-auto">
              <Input
                placeholder="🔍 Search messages..."
                value={searchTerm}
                onChange={(v) => setSearchTerm(v)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats with animations */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 border-0">
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {messages.length}
            </div>
            <div className="text-sm text-blue-700 dark:text-blue-300">📨 Total</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/30 dark:to-red-800/30 border-0">
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              {messages.filter(m => !m.is_read).length}
            </div>
            <div className="text-sm text-red-700 dark:text-red-300">🔴 Unread</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 border-0">
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">
              {messages.filter(m => m.is_read).length}
            </div>
            <div className="text-sm text-green-700 dark:text-green-300">✅ Read</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/30 dark:to-yellow-800/30 border-0">
          <CardContent className="pt-4 text-center">
            <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
              {starredCount}
            </div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300">⭐ Starred</div>
          </CardContent>
        </Card>
      </div>

      {/* Messages List - Grouped by Date */}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMessages.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <span className="text-5xl mb-4 block">{activeTab === 'starred' ? '⭐' : '📭'}</span>
                <p className="text-gray-500 dark:text-gray-400">
                  {activeTab === 'inbox' ? 'Your inbox is empty' : activeTab === 'starred' ? 'No starred messages' : 'No sent messages'}
                </p>
                {activeTab === 'inbox' && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Messages from teachers will appear here</p>
                )}
              </CardContent>
            </Card>
          ) : (
            Object.entries(groupedMessages).map(([dateGroup, groupMessages]) => (
              <div key={dateGroup}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{dateGroup}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
                </div>
                <div className="space-y-2">
                  {groupMessages.map((message) => (
              <div
                key={message.message_id}
                className={`group relative bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/30 p-4 cursor-pointer transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${
                  !message.is_read && activeTab === 'inbox' ? 'bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/30 dark:to-gray-800 border-l-4 border-l-blue-500' : ''
                } ${message.isStarred ? 'ring-1 ring-yellow-300 dark:ring-yellow-600' : ''}`}
                onClick={() => {
                  setViewingMessage(message);
                  if (activeTab === 'inbox') handleMarkAsRead(message);
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${
                    (activeTab === 'inbox' ? message.sender_type : message.recipient_type) === 'teacher'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-600'
                      : 'bg-gradient-to-br from-blue-500 to-cyan-600'
                  }`}>
                    {(activeTab === 'inbox' ? message.sender?.name : message.recipient?.name)?.charAt(0).toUpperCase() || '?'}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {!message.is_read && activeTab === 'inbox' && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse flex-shrink-0"></span>
                        )}
                        <span className="font-semibold dark:text-white truncate">
                          {activeTab === 'inbox' 
                            ? message.sender?.name || 'Unknown'
                            : message.recipient?.name || 'Unknown'
                          }
                        </span>
                        <Badge variant={(activeTab === 'inbox' ? message.sender_type : message.recipient_type) === 'teacher' ? 'info' : 'default'} className="text-xs flex-shrink-0">
                          {activeTab === 'inbox' ? message.sender_type : message.recipient_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {message.reaction && (
                          <span className="text-lg">{message.reaction}</span>
                        )}
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {formatMessageTime(message.created_at)}
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate mb-0.5">
                      {message.subject || '(No Subject)'}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {message.content}
                    </p>
                    
                    {/* Quick actions */}
                    <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleToggleStar(message.message_id, e)}
                        className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                          message.isStarred ? 'text-yellow-500' : 'text-gray-400 dark:text-gray-500'
                        }`}
                        title={message.isStarred ? 'Unstar' : 'Star'}
                      >
                        {message.isStarred ? '⭐' : '☆'}
                      </button>
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowReactionPicker(showReactionPicker === message.message_id ? null : message.message_id);
                          }}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                          title="React"
                        >
                          😊
                        </button>
                        {showReactionPicker === message.message_id && (
                          <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-2 flex gap-1 z-10">
                            {MESSAGE_REACTIONS.map(emoji => (
                              <button
                                key={emoji}
                                onClick={(e) => handleToggleReaction(message.message_id, emoji, e)}
                                className={`w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-lg transition-transform hover:scale-125 ${
                                  message.reaction === emoji ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400' : ''
                                }`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Read status for sent messages */}
                {activeTab === 'sent' && (
                  <div className="absolute bottom-2 right-3 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                    {message.is_read ? (
                      <span className="text-blue-500" title={`Read ${message.read_at ? formatTimeAgo(message.read_at) : ''}`}>✓✓</span>
                    ) : (message as Message & { delivered_at?: string }).delivered_at ? (
                      <span title="Delivered">✓✓</span>
                    ) : (
                      <span title="Sent">✓</span>
                    )}
                  </div>
                )}
              </div>
            ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Compose Modal */}
      <Modal
        isOpen={showComposeModal}
        onClose={closeComposeModal}
        title={replyingTo ? '↩️ Reply' : '✉️ New Message'}
        size="lg"
      >
        <div className="space-y-4">
          {replyingTo && (
            <div className="p-3 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 rounded-lg text-sm border-l-4 border-blue-500">
              <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Replying to:</p>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                  {replyingTo.sender?.name?.charAt(0).toUpperCase() || '?'}
                </div>
                <p className="font-medium dark:text-white">{replyingTo.sender?.name}</p>
              </div>
              <p className="text-gray-600 dark:text-gray-300 line-clamp-2">{replyingTo.content}</p>
            </div>
          )}
          
          {!replyingTo && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Recipient Type</label>
                  <Select
                    value={formRecipientType}
                    onChange={(v) => {
                      setFormRecipientType(v as 'teacher' | 'student');
                      setFormRecipientId('');
                    }}
                    options={[
                      { value: 'teacher', label: '👨‍🏫 Teacher' },
                      { value: 'student', label: '👨‍🎓 Student' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Recipient *</label>
                  <Select
                    value={formRecipientId}
                    onChange={(v) => setFormRecipientId(v)}
                    options={[
                      { value: '', label: 'Select recipient...' },
                      ...(formRecipientType === 'teacher' 
                        ? teachers.map(t => ({ value: t.teacher_id, label: `${t.name} (${t.email})` }))
                        : students.map(s => ({ value: s.student_id, label: `${s.name} (${s.email})` }))
                      )
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Subject</label>
            <Input
              value={formSubject}
              onChange={(v) => setFormSubject(v)}
              placeholder="Message subject..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium dark:text-gray-300">Message *</label>
              <button
                onClick={() => setShowQuickReplies(!showQuickReplies)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                ⚡ Quick Replies
              </button>
            </div>
            
            {/* Quick Replies */}
            {showQuickReplies && (
              <div className="flex flex-wrap gap-2 mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                {QUICK_REPLIES.map(reply => (
                  <button
                    key={reply}
                    onClick={() => handleQuickReply(reply)}
                    className="px-3 py-1.5 text-xs bg-white dark:bg-gray-700 rounded-full shadow-sm hover:shadow-md transition-all hover:scale-105"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}
            
            <textarea
              ref={messageInputRef}
              className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white min-h-[150px] resize-none"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Type your message..."
            />
            <div className="text-xs text-gray-400 dark:text-gray-500 text-right mt-1">{formContent.length} characters</div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t dark:border-gray-700">
            <div className="text-xs text-gray-400 dark:text-gray-500">
              {userType === 'student' && cooldownRemaining > 0
                ? `⏳ Wait ${cooldownRemaining}s before sending again`
                : '💡 Tip: Be clear and concise'}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={closeComposeModal}>Cancel</Button>
              <Button 
                onClick={handleSendMessage} 
                disabled={submitting || !formContent.trim() || (userType === 'student' && cooldownRemaining > 0)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span> Sending...
                  </span>
                ) : cooldownRemaining > 0 && userType === 'student' ? `⏳ ${cooldownRemaining}s` : '📤 Send Message'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* View Message Modal */}
      <Modal
        isOpen={!!viewingMessage}
        onClose={() => setViewingMessage(null)}
        title={viewingMessage?.subject || '(No Subject)'}
        size="lg"
      >
        {viewingMessage && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                  (activeTab === 'inbox' ? viewingMessage.sender_type : viewingMessage.recipient_type) === 'teacher'
                    ? 'bg-gradient-to-br from-purple-500 to-pink-600'
                    : 'bg-gradient-to-br from-blue-500 to-cyan-600'
                }`}>
                  {(activeTab === 'inbox' ? viewingMessage.sender?.name : viewingMessage.recipient?.name)?.charAt(0).toUpperCase() || '?'}
                </div>
                <div>
                  <p className="font-semibold dark:text-white text-lg">
                    {activeTab === 'inbox' 
                      ? viewingMessage.sender?.name
                      : viewingMessage.recipient?.name
                    }
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400" title={format(new Date(viewingMessage.created_at), 'PPpp')}>
                    {formatTimeAgo(viewingMessage.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleStar(viewingMessage.message_id)}
                  className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                    viewingMessage.isStarred ? 'text-yellow-500' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {viewingMessage.isStarred ? '⭐' : '☆'}
                </button>
                <Badge variant={(activeTab === 'inbox' ? viewingMessage.sender_type : viewingMessage.recipient_type) === 'teacher' ? 'info' : 'default'}>
                  {activeTab === 'inbox' ? viewingMessage.sender_type : viewingMessage.recipient_type}
                </Badge>
              </div>
            </div>

            {/* Message content with chat bubble style */}
            <div className={`rounded-2xl p-4 max-w-[85%] ${
              activeTab === 'inbox' 
                ? 'bg-gray-100 dark:bg-gray-700 rounded-tl-none' 
                : 'bg-blue-500 text-white ml-auto rounded-tr-none'
            }`}>
              <p className={`whitespace-pre-wrap ${activeTab === 'inbox' ? 'text-gray-700 dark:text-gray-300' : 'text-white'}`}>
                {viewingMessage.content}
              </p>
            </div>

            {/* Reaction section */}
            <div className="flex items-center gap-2 pt-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">React:</span>
              {MESSAGE_REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleToggleReaction(viewingMessage.message_id, emoji)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-all hover:scale-125 ${
                    viewingMessage.reaction === emoji ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="prose dark:prose-invert max-w-none py-4">
            </div>

            {viewingMessage.read_at && activeTab === 'sent' && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                <span>✓✓</span> Read {formatTimeAgo(viewingMessage.read_at)}
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t dark:border-gray-700">
              <Button 
                variant="danger" 
                size="sm"
                onClick={() => handleDelete(viewingMessage.message_id)}
              >
                🗑️ Delete
              </Button>
              <div className="flex gap-2">
                {activeTab === 'inbox' && (
                  <Button 
                    onClick={() => {
                      setViewingMessage(null);
                      openComposeModal(viewingMessage);
                    }}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    ↩️ Quick Reply
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewingMessage(null)}>Close</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingMessageId}
        title="Delete Message"
        message="Are you sure you want to delete this message? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeletingMessageId(null)}
      />
    </div>
  );
}

export default Messages;
