import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { messageService } from '../services/communicationService';
import type { Message, CreateMessageData } from '../services/communicationService';
import { format } from 'date-fns';

type TabType = 'inbox' | 'sent';

export function Messages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userType, setUserType] = useState<'teacher' | 'student' | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('inbox');

  // Compose modal states
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [viewingMessage, setViewingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Form states
  const [formRecipientType, setFormRecipientType] = useState<'teacher' | 'student'>('teacher');
  const [formRecipientId, setFormRecipientId] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Recipients lists
  const [teachers, setTeachers] = useState<{ teacher_id: string; name: string; email: string }[]>([]);
  const [students, setStudents] = useState<{ student_id: string; name: string; email: string }[]>([]);

  // Search
  const [searchTerm, setSearchTerm] = useState('');

  const loadMessages = useCallback(async () => {
    if (!userType || !currentUserId) return;

    setLoading(true);
    try {
      const { data, error: err } = activeTab === 'inbox'
        ? await messageService.getInbox(userType, currentUserId)
        : await messageService.getSent(userType, currentUserId);

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
    }
  }, [currentUserId, userType, loadMessages]);

  const handleSendMessage = async () => {
    if (!formRecipientId || !formContent.trim()) {
      alert('Please select a recipient and enter a message');
      return;
    }

    if (!userType || !currentUserId) return;

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

      await loadMessages();
      closeComposeModal();
    } catch (err) {
      console.error('Error sending message:', err);
      alert('Failed to send message');
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

  const handleDelete = async (messageId: string) => {
    if (!window.confirm('Are you sure you want to delete this message?')) return;

    try {
      const { error: err } = await messageService.delete(messageId);
      if (err) {
        console.error('Delete error:', err);
        alert(`Failed to delete message: ${err.message || 'Permission denied. The database may not allow deletion.'}`);
      } else {
        await loadMessages();
        setViewingMessage(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete message. Please try again.');
    }
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

  const unreadCount = messages.filter(m => !m.is_read && activeTab === 'inbox').length;

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
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {messages.length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {messages.filter(m => !m.is_read).length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Unread</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {messages.filter(m => m.is_read).length}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Read</div>
          </CardContent>
        </Card>
      </div>

      {/* Messages List */}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMessages.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <span className="text-5xl mb-4 block">📭</span>
                <p className="text-gray-500 dark:text-gray-400">
                  {activeTab === 'inbox' ? 'Your inbox is empty' : 'No sent messages'}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredMessages.map((message) => (
              <div
                key={message.message_id}
                className={`bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/30 p-4 cursor-pointer transition-all hover:shadow-lg ${
                  !message.is_read && activeTab === 'inbox' ? 'bg-blue-50/50 dark:bg-blue-900/20 border-l-4 border-l-blue-500' : ''
                }`}
                onClick={() => {
                  setViewingMessage(message);
                  if (activeTab === 'inbox') handleMarkAsRead(message);
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {!message.is_read && activeTab === 'inbox' && (
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      )}
                      <span className="font-semibold dark:text-white truncate">
                        {activeTab === 'inbox' 
                          ? `From: ${message.sender?.name || 'Unknown'}`
                          : `To: ${message.recipient?.name || 'Unknown'}`
                        }
                      </span>
                      <Badge variant={message.sender_type === 'teacher' ? 'info' : 'default'}>
                        {activeTab === 'inbox' ? message.sender_type : message.recipient_type}
                      </Badge>
                    </div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                      {message.subject || '(No Subject)'}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
                      {message.content}
                    </p>
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {format(new Date(message.created_at), 'MMM dd, HH:mm')}
                  </div>
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
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm">
              <p className="text-gray-600 dark:text-gray-400">Replying to:</p>
              <p className="font-medium dark:text-white">{replyingTo.sender?.name}</p>
              <p className="text-gray-500 dark:text-gray-400 truncate">{replyingTo.content}</p>
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
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Message *</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white min-h-[150px]"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Type your message..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
            <Button variant="outline" onClick={closeComposeModal}>Cancel</Button>
            <Button onClick={handleSendMessage} disabled={submitting}>
              {submitting ? 'Sending...' : '📤 Send'}
            </Button>
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
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                  {(activeTab === 'inbox' ? viewingMessage.sender?.name : viewingMessage.recipient?.name)?.charAt(0).toUpperCase() || '?'}
                </div>
                <div>
                  <p className="font-semibold dark:text-white">
                    {activeTab === 'inbox' 
                      ? `From: ${viewingMessage.sender?.name}`
                      : `To: ${viewingMessage.recipient?.name}`
                    }
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {format(new Date(viewingMessage.created_at), 'MMMM dd, yyyy \'at\' HH:mm')}
                  </p>
                </div>
              </div>
              <Badge variant={viewingMessage.sender_type === 'teacher' ? 'info' : 'default'}>
                {activeTab === 'inbox' ? viewingMessage.sender_type : viewingMessage.recipient_type}
              </Badge>
            </div>

            <div className="prose dark:prose-invert max-w-none py-4">
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {viewingMessage.content}
              </p>
            </div>

            {viewingMessage.read_at && activeTab === 'sent' && (
              <div className="text-sm text-green-600 dark:text-green-400">
                ✓ Read on {format(new Date(viewingMessage.read_at), 'MMM dd, yyyy \'at\' HH:mm')}
              </div>
            )}

            <div className="flex justify-between pt-4 border-t dark:border-gray-700">
              <Button 
                variant="danger" 
                onClick={() => handleDelete(viewingMessage.message_id)}
              >
                🗑️ Delete
              </Button>
              <div className="flex gap-2">
                {activeTab === 'inbox' && (
                  <Button onClick={() => {
                    setViewingMessage(null);
                    openComposeModal(viewingMessage);
                  }}>
                    ↩️ Reply
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewingMessage(null)}>Close</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Messages;
