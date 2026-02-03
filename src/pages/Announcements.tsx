import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { announcementService } from '../services/communicationService';
import type { Announcement, AnnouncementPriority, CreateAnnouncementData } from '../services/communicationService';
import { format } from 'date-fns';

export function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [viewingAnnouncement, setViewingAnnouncement] = useState<Announcement | null>(null);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPriority, setFormPriority] = useState<AnnouncementPriority>('normal');
  const [formCourseId, setFormCourseId] = useState<string>('');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formExpiresAt, setFormExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Courses for dropdown
  const [courses, setCourses] = useState<{ course_id: string; course_name: string }[]>([]);

  // Filter
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCourse, setFilterCourse] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const loadAnnouncementsForTeacher = useCallback(async () => {
    const { data, error: err } = await announcementService.getAll();
    if (err) {
      setError('Failed to load announcements');
    } else {
      setAnnouncements(data || []);
    }
  }, []);

  const loadAnnouncementsForStudent = useCallback(async (studentId: string) => {
    const { data, error: err } = await announcementService.getForStudent(studentId);
    if (err) {
      setError('Failed to load announcements');
    } else {
      setAnnouncements(data || []);
    }
  }, []);

  const loadCourses = useCallback(async () => {
    const { data } = await supabase
      .from('course')
      .select('course_id, course_name')
      .order('course_name');
    setCourses(data || []);
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
        setIsTeacher(true);
        setCurrentUserId(teacher.teacher_id);
        await loadAnnouncementsForTeacher();
        await loadCourses();
      } else {
        // Check if student
        const { data: student } = await supabase
          .from('student')
          .select('student_id')
          .ilike('email', user.email)
          .single();

        if (student) {
          setIsTeacher(false);
          setCurrentUserId(student.student_id);
          await loadAnnouncementsForStudent(student.student_id);
        } else {
          setError('User not found in system');
        }
      }
    } catch (err) {
      console.error('Error:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [loadAnnouncementsForTeacher, loadAnnouncementsForStudent, loadCourses]);

  useEffect(() => {
    checkUserAndLoadData();
  }, [checkUserAndLoadData]);

  const openCreateModal = () => {
    setEditingAnnouncement(null);
    setFormTitle('');
    setFormContent('');
    setFormPriority('normal');
    setFormCourseId('');
    setFormIsPinned(false);
    setFormExpiresAt('');
    setShowCreateModal(true);
  };

  const openEditModal = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setFormTitle(announcement.title);
    setFormContent(announcement.content);
    setFormPriority(announcement.priority);
    setFormCourseId(announcement.course_id || '');
    setFormIsPinned(announcement.is_pinned);
    setFormExpiresAt(announcement.expires_at ? announcement.expires_at.split('T')[0] : '');
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingAnnouncement(null);
  };

  const handleCreateOrUpdate = async () => {
    if (!formTitle || !formContent) {
      alert('Please fill in title and content');
      return;
    }

    if (!currentUserId) return;

    setSubmitting(true);
    try {
      const data: CreateAnnouncementData = {
        title: formTitle,
        content: formContent,
        priority: formPriority,
        course_id: formCourseId || undefined,
        is_pinned: formIsPinned,
        expires_at: formExpiresAt || undefined
      };

      if (editingAnnouncement) {
        const { error: err } = await announcementService.update(editingAnnouncement.announcement_id, data);
        if (err) throw err;
      } else {
        const { error: err } = await announcementService.create(currentUserId, data);
        if (err) throw err;
      }

      await loadAnnouncementsForTeacher();
      closeModal();
    } catch (err) {
      console.error('Error saving announcement:', err);
      alert('Failed to save announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (announcementId: string) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;

    const { error: err } = await announcementService.delete(announcementId);
    if (err) {
      alert('Failed to delete announcement');
    } else {
      await loadAnnouncementsForTeacher();
    }
  };

  const handleMarkAsRead = async (announcement: Announcement) => {
    if (!currentUserId || announcement.is_read) return;
    
    await announcementService.markAsRead(announcement.announcement_id, currentUserId);
    setAnnouncements(prev => prev.map(a =>
      a.announcement_id === announcement.announcement_id
        ? { ...a, is_read: true }
        : a
    ));
  };

  const getPriorityBadge = (priority: AnnouncementPriority) => {
    const styles: Record<AnnouncementPriority, { variant: 'default' | 'info' | 'warning' | 'success' | 'danger'; text: string }> = {
      urgent: { variant: 'danger', text: '🚨 Urgent' },
      high: { variant: 'warning', text: 'High' },
      normal: { variant: 'info', text: 'Normal' },
      low: { variant: 'default', text: 'Low' }
    };
    const style = styles[priority];
    return <Badge variant={style.variant}>{style.text}</Badge>;
  };

  // Filter announcements
  const filteredAnnouncements = announcements.filter(a => {
    if (filterPriority !== 'all' && a.priority !== filterPriority) return false;
    if (filterCourse !== 'all' && a.course_id !== filterCourse) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (!a.title.toLowerCase().includes(term) && !a.content.toLowerCase().includes(term)) {
        return false;
      }
    }
    return true;
  });

  // Sort: pinned first, then by date
  const sortedAnnouncements = [...filteredAnnouncements].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const unreadCount = announcements.filter(a => !a.is_read).length;

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
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
          <h1 className="text-2xl sm:text-3xl font-bold dark:text-white">📢 Announcements</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {isTeacher ? 'Manage announcements for your courses' : `Stay updated with course announcements${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          </p>
        </div>
        {isTeacher && (
          <Button onClick={openCreateModal} className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
            ✨ New Announcement
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="🔍 Search announcements..."
                value={searchTerm}
                onChange={(v) => setSearchTerm(v)}
              />
            </div>
            <Select
              value={filterPriority}
              onChange={(v) => setFilterPriority(v)}
              options={[
                { value: 'all', label: 'All Priorities' },
                { value: 'urgent', label: '🚨 Urgent' },
                { value: 'high', label: 'High' },
                { value: 'normal', label: 'Normal' },
                { value: 'low', label: 'Low' }
              ]}
            />
            <Select
              value={filterCourse}
              onChange={(v) => setFilterCourse(v)}
              options={[
                { value: 'all', label: 'All Courses' },
                ...courses.map(c => ({ value: c.course_id, label: c.course_name }))
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {isTeacher && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{announcements.length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{announcements.filter(a => a.priority === 'urgent').length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Urgent</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{announcements.filter(a => a.is_pinned).length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Pinned</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{announcements.filter(a => !a.course_id).length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Global</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Announcements List */}
      {sortedAnnouncements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <span className="text-5xl mb-4 block">📭</span>
            <p className="text-gray-500 dark:text-gray-400">No announcements found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedAnnouncements.map((announcement) => (
            <div
              key={announcement.announcement_id}
              className={`bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/30 p-6 cursor-pointer transition-all hover:shadow-lg ${
                announcement.is_pinned ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : ''
              } ${!isTeacher && !announcement.is_read ? 'border-l-4 border-l-blue-500' : ''}`}
              onClick={() => {
                setViewingAnnouncement(announcement);
                if (!isTeacher) handleMarkAsRead(announcement);
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  {announcement.is_pinned && <span>📌</span>}
                  <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-1">{announcement.title}</h3>
                </div>
                {getPriorityBadge(announcement.priority)}
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2 mb-3">{announcement.content}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
                <span>👤 {announcement.teacher?.name || 'Unknown'}</span>
                <span>•</span>
                <span>{format(new Date(announcement.created_at), 'MMM dd')}</span>
                {announcement.course?.course_name && (
                  <>
                    <span>•</span>
                    <Badge variant="default">{announcement.course.course_name}</Badge>
                  </>
                )}
              </div>
              {isTeacher && (
                <div className="flex gap-2 mt-4 pt-3 border-t dark:border-gray-700">
                  <Button size="sm" variant="outline" onClick={() => openEditModal(announcement)}>
                    ✏️ Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(announcement.announcement_id)}>
                    🗑️ Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={closeModal}
        title={editingAnnouncement ? '✏️ Edit Announcement' : '✨ New Announcement'}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Title *</label>
            <Input
              value={formTitle}
              onChange={(v) => setFormTitle(v)}
              placeholder="Announcement title..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Content *</label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white min-h-[150px]"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Write your announcement..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Priority</label>
              <Select
                value={formPriority}
                onChange={(v) => setFormPriority(v as AnnouncementPriority)}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' },
                  { value: 'urgent', label: '🚨 Urgent' }
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Course</label>
              <Select
                value={formCourseId}
                onChange={(v) => setFormCourseId(v)}
                options={[
                  { value: '', label: '🌐 All Courses (Global)' },
                  ...courses.map(c => ({ value: c.course_id, label: c.course_name }))
                ]}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Expires At (Optional)</label>
              <Input
                type="date"
                value={formExpiresAt}
                onChange={(v) => setFormExpiresAt(v)}
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsPinned}
                  onChange={(e) => setFormIsPinned(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded"
                />
                <span className="text-sm dark:text-gray-300">📌 Pin to top</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleCreateOrUpdate} disabled={submitting}>
              {submitting ? 'Saving...' : (editingAnnouncement ? 'Update' : 'Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={!!viewingAnnouncement}
        onClose={() => setViewingAnnouncement(null)}
        title={viewingAnnouncement?.title || 'Announcement'}
        size="lg"
      >
        {viewingAnnouncement && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 pb-4 border-b dark:border-gray-700">
              {viewingAnnouncement.is_pinned && <span className="text-lg">📌</span>}
              {getPriorityBadge(viewingAnnouncement.priority)}
              <span>👤 {viewingAnnouncement.teacher?.name}</span>
              <span>📅 {format(new Date(viewingAnnouncement.created_at), 'MMMM dd, yyyy \'at\' HH:mm')}</span>
              {viewingAnnouncement.course?.course_name && (
                <Badge>{viewingAnnouncement.course.course_name}</Badge>
              )}
            </div>
            <div className="prose dark:prose-invert max-w-none py-4">
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{viewingAnnouncement.content}</p>
            </div>
            {viewingAnnouncement.expires_at && (
              <div className="text-sm text-orange-600 dark:text-orange-400">
                ⏰ Expires: {format(new Date(viewingAnnouncement.expires_at), 'MMMM dd, yyyy')}
              </div>
            )}
            <div className="flex justify-end pt-4 border-t dark:border-gray-700">
              <Button variant="outline" onClick={() => setViewingAnnouncement(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Announcements;
