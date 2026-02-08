import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { announcementService, announcementReactionService, announcementCommentService } from '../services/communicationService';
import type { Announcement, AnnouncementPriority, CreateAnnouncementData, AnnouncementComment } from '../services/communicationService';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

// Image upload helper
const uploadAnnouncementImage = async (file: File): Promise<string | null> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `announcements/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('announcement-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      // If bucket doesn't exist, try 'student-photos' bucket as fallback
      const { error: fallbackError } = await supabase.storage
        .from('student-photos')
        .upload(`announcements/${fileName}`, file, { cacheControl: '3600', upsert: false });
      
      if (fallbackError) {
        console.error('Upload failed:', fallbackError);
        return null;
      }
      return `announcements/${fileName}`;
    }
    return filePath;
  } catch (err) {
    console.error('Image upload error:', err);
    return null;
  }
};

const getAnnouncementImageUrl = async (filePath: string): Promise<string | null> => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;

  // Try announcement-images bucket first
  const { data } = await supabase.storage
    .from('announcement-images')
    .createSignedUrl(filePath, 60 * 60);
  
  if (data?.signedUrl) return data.signedUrl;

  // Fallback to student-photos bucket
  const { data: fallback } = await supabase.storage
    .from('student-photos')
    .createSignedUrl(filePath, 60 * 60);
  
  return fallback?.signedUrl || null;
};

// Available reaction emojis
const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😮', '🙏', '💡'];

// Category configurations with icons and colors
const CATEGORIES = {
  general: { icon: '📋', label: 'General', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
  homework: { icon: '📚', label: 'Homework', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  exam: { icon: '📝', label: 'Exam', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  event: { icon: '🎊', label: 'Event', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  reminder: { icon: '⏰', label: 'Reminder', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  urgent: { icon: '🚨', label: 'Urgent', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  celebration: { icon: '🎉', label: 'Celebration', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
} as const;

type CategoryType = keyof typeof CATEGORIES;

// Extended Announcement type with reactions and comments
interface ExtendedAnnouncement extends Announcement {
  reactions?: { emoji: string; count: number; hasReacted: boolean; reactors?: { id: string; name: string }[] }[];
  commentCount?: number;
}

export function Announcements() {
  const [announcements, setAnnouncements] = useState<ExtendedAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [viewingAnnouncement, setViewingAnnouncement] = useState<ExtendedAnnouncement | null>(null);

  // Comments state
  const [comments, setComments] = useState<AnnouncementComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Reaction picker state
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPriority, setFormPriority] = useState<AnnouncementPriority>('normal');
  const [formCourseId, setFormCourseId] = useState<string>('');
  const [formCategory, setFormCategory] = useState<CategoryType>('general');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formExpiresAt, setFormExpiresAt] = useState('');
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Signed URLs cache for announcement images
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  // Courses for dropdown
  const [courses, setCourses] = useState<{ course_id: string; course_name: string }[]>([]);

  // Filter
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCourse, setFilterCourse] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Animation state for new announcements
  const [newAnnouncementId] = useState<string | null>(null);

  // Load reactions for all announcements
  const loadReactionsForAllAnnouncements = useCallback(async (announcementsList: Announcement[], userId: string | null) => {
    if (!announcementsList.length) return;
    
    // Fetch reactions for ALL announcements in parallel
    const reactionsPromises = announcementsList.map(async (ann) => {
      const { data: reactions } = await announcementReactionService.getForAnnouncement(ann.announcement_id, userId || undefined);
      const { data: commentsData } = await announcementCommentService.getForAnnouncement(ann.announcement_id);
      return {
        announcement_id: ann.announcement_id,
        reactions: reactions || [],
        commentCount: commentsData?.length || 0
      };
    });
    
    const reactionsResults = await Promise.all(reactionsPromises);
    
    // Update announcements with reactions
    setAnnouncements(prev => prev.map(ann => {
      const reactionData = reactionsResults.find(r => r.announcement_id === ann.announcement_id);
      return reactionData ? {
        ...ann,
        reactions: reactionData.reactions,
        commentCount: reactionData.commentCount
      } : ann;
    }));
  }, []);

  const loadAnnouncementsForTeacher = useCallback(async (teacherId: string) => {
    const { data, error: err } = await announcementService.getAll();
    if (err) {
      setError('Failed to load announcements');
    } else {
      setAnnouncements(data || []);
      // Load reactions for all announcements (teacher can see but not react)
      await loadReactionsForAllAnnouncements(data || [], teacherId);
    }
  }, [loadReactionsForAllAnnouncements]);

  const loadAnnouncementsForStudent = useCallback(async (studentId: string) => {
    const { data, error: err } = await announcementService.getForStudent(studentId);
    if (err) {
      setError('Failed to load announcements');
    } else {
      setAnnouncements(data || []);
      // Load reactions for all announcements
      await loadReactionsForAllAnnouncements(data || [], studentId);
    }
  }, [loadReactionsForAllAnnouncements]);

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
        await loadAnnouncementsForTeacher(teacher.teacher_id);
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

  // Resolve signed URLs for announcement images
  useEffect(() => {
    const resolveImageUrls = async () => {
      const announcementsWithImages = announcements.filter(a => a.image_url && !imageUrls[a.announcement_id]);
      if (announcementsWithImages.length === 0) return;

      const newUrls: Record<string, string> = {};
      await Promise.all(
        announcementsWithImages.map(async (a) => {
          if (a.image_url) {
            const url = await getAnnouncementImageUrl(a.image_url);
            if (url) newUrls[a.announcement_id] = url;
          }
        })
      );
      if (Object.keys(newUrls).length > 0) {
        setImageUrls(prev => ({ ...prev, ...newUrls }));
      }
    };
    resolveImageUrls();
  }, [announcements]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreateModal = () => {
    setEditingAnnouncement(null);
    setFormTitle('');
    setFormContent('');
    setFormPriority('normal');
    setFormCourseId('');
    setFormCategory('general');
    setFormIsPinned(false);
    setFormExpiresAt('');
    setFormImageFile(null);
    setFormImagePreview(null);
    setShowCreateModal(true);
  };

  const openEditModal = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setFormTitle(announcement.title);
    setFormContent(announcement.content);
    setFormPriority(announcement.priority);
    setFormCourseId(announcement.course_id || '');
    setFormCategory((announcement.category as CategoryType) || 'general');
    setFormIsPinned(announcement.is_pinned);
    setFormExpiresAt(announcement.expires_at ? announcement.expires_at.split('T')[0] : '');
    setFormImageFile(null);
    setFormImagePreview(announcement.image_url ? (imageUrls[announcement.announcement_id] || announcement.image_url) : null);
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingAnnouncement(null);
    setFormImageFile(null);
    setFormImagePreview(null);
  };

  const handleCreateOrUpdate = async () => {
    if (!formTitle || !formContent) {
      toast.warning('Please fill in title and content');
      return;
    }

    if (!currentUserId) return;

    setSubmitting(true);
    try {
      // Upload image if a new file was selected
      let imageUrl: string | null | undefined = undefined;
      if (formImageFile) {
        setUploadingImage(true);
        imageUrl = await uploadAnnouncementImage(formImageFile);
        setUploadingImage(false);
        if (!imageUrl) {
          toast.error('Failed to upload image. The announcement will be saved without the image.');
        }
      }

      const data: CreateAnnouncementData = {
        title: formTitle,
        content: formContent,
        priority: formPriority,
        course_id: formCourseId || undefined,
        category: formCategory,
        is_pinned: formIsPinned,
        expires_at: formExpiresAt || undefined,
        ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
      };

      if (editingAnnouncement) {
        const { error: err } = await announcementService.update(editingAnnouncement.announcement_id, data);
        if (err) throw err;
      } else {
        const { error: err } = await announcementService.create(currentUserId, data);
        if (err) throw err;
      }

      await loadAnnouncementsForTeacher(currentUserId!);
      closeModal();
    } catch (err) {
      console.error('Error saving announcement:', err);
      toast.error('Failed to save announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (announcementId: string) => {
    try {
      const { error: err } = await announcementService.delete(announcementId);
      if (err) {
        console.error('Delete error:', err);
        toast.error(`Failed to delete announcement: ${err.message || 'Permission denied.'}`);
      } else {
        await loadAnnouncementsForTeacher(currentUserId!);
      }
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete announcement. Please try again.');
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

  // Handle image file selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.warning('Please select a valid image file (JPEG, PNG, GIF, or WebP)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.warning('Image must be smaller than 5MB');
      return;
    }

    setFormImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setFormImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setFormImageFile(null);
    setFormImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // Handle reaction toggle
  const handleReaction = async (announcementId: string, emoji: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentUserId || isTeacher) return; // Only students can react

    const { added, error } = await announcementReactionService.toggle(announcementId, currentUserId, emoji);
    
    if (error) {
      console.error('Failed to toggle reaction:', error);
      return;
    }
    
    // Update local state
    setAnnouncements(prev => prev.map(a => {
      if (a.announcement_id !== announcementId) return a;
      
      const reactions = [...(a.reactions || [])];
      const existingIdx = reactions.findIndex(r => r.emoji === emoji);
      
      if (added) {
        if (existingIdx >= 0) {
          reactions[existingIdx] = { ...reactions[existingIdx], count: reactions[existingIdx].count + 1, hasReacted: true };
        } else {
          reactions.push({ emoji, count: 1, hasReacted: true });
        }
      } else {
        if (existingIdx >= 0) {
          if (reactions[existingIdx].count <= 1) {
            reactions.splice(existingIdx, 1);
          } else {
            reactions[existingIdx] = { ...reactions[existingIdx], count: reactions[existingIdx].count - 1, hasReacted: false };
          }
        }
      }
      
      return { ...a, reactions };
    }));

    // Also update viewing announcement if open
    if (viewingAnnouncement?.announcement_id === announcementId) {
      const { data: updatedReactions } = await announcementReactionService.getForAnnouncement(announcementId, currentUserId);
      setViewingAnnouncement(prev => prev ? { ...prev, reactions: updatedReactions } : null);
    }

    setShowReactionPicker(null);
  };

  // Load comments for an announcement
  const loadComments = async (announcementId: string) => {
    setLoadingComments(true);
    const { data, error } = await announcementCommentService.getForAnnouncement(announcementId);
    if (error) {
      console.error('Failed to load comments:', error);
    }
    setComments(data || []);
    setLoadingComments(false);
  };

  // Add a comment
  const handleAddComment = async () => {
    if (!newComment.trim() || !viewingAnnouncement || !currentUserId) return;

    const commenterType = isTeacher ? 'teacher' : 'student';
    const { error } = await announcementCommentService.add(
      viewingAnnouncement.announcement_id,
      commenterType,
      currentUserId,
      newComment.trim()
    );

    if (error) {
      console.error('Failed to add comment:', error);
      toast.error('Failed to add comment. Please try again.');
      return;
    }

    setNewComment('');
    await loadComments(viewingAnnouncement.announcement_id);
    
    // Update comment count
    setAnnouncements(prev => prev.map(a => 
      a.announcement_id === viewingAnnouncement.announcement_id
        ? { ...a, commentCount: (a.commentCount || 0) + 1 }
        : a
    ));

    // Scroll to bottom
    setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // Add a reply
  const handleAddReply = async (parentCommentId: string) => {
    if (!replyContent.trim() || !viewingAnnouncement || !currentUserId) return;

    const commenterType = isTeacher ? 'teacher' : 'student';
    const { error } = await announcementCommentService.add(
      viewingAnnouncement.announcement_id,
      commenterType,
      currentUserId,
      replyContent.trim(),
      parentCommentId
    );

    if (error) {
      console.error('Failed to add reply:', error);
      toast.error('Failed to add reply. Please try again.');
      return;
    }

    setReplyContent('');
    setReplyingTo(null);
    await loadComments(viewingAnnouncement.announcement_id);
  };

  // Delete a comment
  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
  };

  const confirmDeleteComment = async () => {
    if (!deletingCommentId) return;
    const { error } = await announcementCommentService.delete(deletingCommentId);
    
    if (error) {
      console.error('Failed to delete comment:', error);
      toast.error('Failed to delete comment. Please try again.');
      setDeletingCommentId(null);
      return;
    }
    
    setDeletingCommentId(null);
    if (viewingAnnouncement) {
      await loadComments(viewingAnnouncement.announcement_id);
      setAnnouncements(prev => prev.map(a => 
        a.announcement_id === viewingAnnouncement.announcement_id
          ? { ...a, commentCount: Math.max(0, (a.commentCount || 1) - 1) }
          : a
      ));
    }
  };

  // Format time ago
  const formatTimeAgo = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return format(new Date(dateStr), 'MMM dd');
    }
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

  // Get category badge
  const getCategoryBadge = (category: string = 'general') => {
    const cat = CATEGORIES[category as CategoryType] || CATEGORIES.general;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cat.color}`}>
        {cat.icon} {cat.label}
      </span>
    );
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
              className={`relative bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/30 p-5 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                announcement.is_pinned ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : ''
              } ${!isTeacher && !announcement.is_read ? 'border-l-4 border-l-blue-500' : ''} ${
                announcement.priority === 'urgent' ? 'animate-pulse-subtle' : ''
              }`}
              onClick={() => {
                setViewingAnnouncement(announcement);
                loadComments(announcement.announcement_id);
                if (!isTeacher) handleMarkAsRead(announcement);
              }}
            >
              {/* Animated new indicator */}
              {newAnnouncementId === announcement.announcement_id && (
                <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full animate-bounce">
                  NEW!
                </div>
              )}
              
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {announcement.is_pinned && <span className="text-lg animate-pulse">📌</span>}
                  {getCategoryBadge(announcement.category)}
                  {getPriorityBadge(announcement.priority)}
                </div>
              </div>
              
              <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-1 mb-2">{announcement.title}</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2 mb-3">{announcement.content}</p>
              
              {/* Announcement image thumbnail */}
              {announcement.image_url && imageUrls[announcement.announcement_id] && (
                <div className="mb-3 rounded-lg overflow-hidden">
                  <img
                    src={imageUrls[announcement.announcement_id]}
                    alt=""
                    className="w-full h-32 object-cover rounded-lg"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              
              {/* Reactions display with names on hover */}
              {announcement.reactions && announcement.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {announcement.reactions.map(r => (
                    <span 
                      key={r.emoji} 
                      className={`group relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-default ${
                        r.hasReacted 
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' 
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {r.emoji} {r.count}
                      {/* Tooltip showing who reacted */}
                      {r.reactors && r.reactors.length > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-50">
                          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap shadow-lg">
                            <div className="font-semibold mb-1 border-b border-gray-700 dark:border-gray-600 pb-1">
                              {r.emoji} Reacted by:
                            </div>
                            <div className="max-h-32 overflow-y-auto">
                              {r.reactors.slice(0, 10).map((reactor) => (
                                <div key={reactor.id} className="py-0.5">
                                  {reactor.name}
                                </div>
                              ))}
                              {r.reactors.length > 10 && (
                                <div className="text-gray-400 pt-1 border-t border-gray-700">
                                  +{r.reactors.length - 10} more
                                </div>
                              )}
                            </div>
                            {/* Arrow */}
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                          </div>
                        </div>
                      )}
                    </span>
                  ))}
                </div>
              )}
              
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-5 h-5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                    {announcement.teacher?.name?.charAt(0).toUpperCase() || '?'}
                  </span>
                  {announcement.teacher?.name || 'Unknown'}
                </span>
                <span>•</span>
                <span title={format(new Date(announcement.created_at), 'PPpp')}>{formatTimeAgo(announcement.created_at)}</span>
                {announcement.commentCount !== undefined && announcement.commentCount > 0 && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">💬 {announcement.commentCount}</span>
                  </>
                )}
                {announcement.course?.course_name && (
                  <>
                    <span>•</span>
                    <Badge variant="default">{announcement.course.course_name}</Badge>
                  </>
                )}
              </div>
              
              {/* Quick reaction button for students */}
              {!isTeacher && (
                <div className="flex gap-2 mt-3 pt-3 border-t dark:border-gray-700">
                  <div className="relative flex-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReactionPicker(showReactionPicker === announcement.announcement_id ? null : announcement.announcement_id);
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                    >
                      😊 React
                    </button>
                    {showReactionPicker === announcement.announcement_id && (
                      <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-2 flex gap-1 z-10 animate-in fade-in zoom-in duration-200">
                        {REACTION_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={(e) => handleReaction(announcement.announcement_id, emoji, e)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-lg transition-transform hover:scale-125"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingAnnouncement(announcement);
                      loadComments(announcement.announcement_id);
                    }}
                    className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                  >
                    💬 Comment
                  </button>
                </div>
              )}
              
              {isTeacher && (
                <div className="flex gap-2 mt-4 pt-3 border-t dark:border-gray-700">
                  <Button size="sm" variant="outline" onClick={() => openEditModal(announcement)}>
                    ✏️ Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteConfirmId(announcement.announcement_id)}>
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
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Category</label>
              <Select
                value={formCategory}
                onChange={(v) => setFormCategory(v as CategoryType)}
                options={Object.entries(CATEGORIES).map(([key, cat]) => ({
                  value: key,
                  label: `${cat.icon} ${cat.label}`
                }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Expires At (Optional)</label>
              <Input
                type="date"
                value={formExpiresAt}
                onChange={(v) => setFormExpiresAt(v)}
              />
            </div>
          </div>
          <div className="flex items-center">
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

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">📷 Image (Optional)</label>
            {formImagePreview ? (
              <div className="relative group">
                <img
                  src={formImagePreview}
                  alt="Preview"
                  className="w-full max-h-48 object-contain rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 shadow-lg transition-all opacity-80 group-hover:opacity-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                onClick={() => imageInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
              >
                <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">Click to upload an image</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">JPEG, PNG, GIF, WebP • Max 5MB</p>
              </div>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleImageSelect}
              className="hidden"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t dark:border-gray-700">
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleCreateOrUpdate} disabled={submitting || uploadingImage}>
              {uploadingImage ? '📷 Uploading...' : submitting ? 'Saving...' : (editingAnnouncement ? 'Update' : 'Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={!!viewingAnnouncement}
        onClose={() => {
          setViewingAnnouncement(null);
          setComments([]);
          setNewComment('');
          setReplyingTo(null);
        }}
        title={viewingAnnouncement?.title || 'Announcement'}
        size="xl"
      >
        {viewingAnnouncement && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Header with meta info */}
            <div className="flex flex-wrap items-center gap-3 pb-4 border-b dark:border-gray-700">
              {viewingAnnouncement.is_pinned && <span className="text-xl animate-pulse">📌</span>}
              {getCategoryBadge(viewingAnnouncement.category)}
              {getPriorityBadge(viewingAnnouncement.priority)}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {viewingAnnouncement.teacher?.name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-sm font-medium dark:text-white">{viewingAnnouncement.teacher?.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatTimeAgo(viewingAnnouncement.created_at)}</p>
                </div>
              </div>
              {viewingAnnouncement.course?.course_name && (
                <Badge>{viewingAnnouncement.course.course_name}</Badge>
              )}
            </div>
            
            {/* Content */}
            <div className="prose dark:prose-invert max-w-none py-4">
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 text-base leading-relaxed">{viewingAnnouncement.content}</p>
            </div>
            
            {/* Announcement image (full size) */}
            {viewingAnnouncement.image_url && imageUrls[viewingAnnouncement.announcement_id] && (
              <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                <img
                  src={imageUrls[viewingAnnouncement.announcement_id]}
                  alt="Announcement"
                  className="w-full max-h-96 object-contain bg-gray-50 dark:bg-gray-800"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
            
            {viewingAnnouncement.expires_at && (
              <div className="text-sm text-orange-600 dark:text-orange-400 flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 rounded-lg">
                <span className="animate-pulse">⏰</span> Expires: {format(new Date(viewingAnnouncement.expires_at), 'MMMM dd, yyyy')}
              </div>
            )}
            
            {/* Reactions Section */}
            <div className="flex flex-wrap items-center gap-2 py-3 border-y dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400 mr-2">Reactions:</span>
              {REACTION_EMOJIS.map(emoji => {
                const reaction = viewingAnnouncement.reactions?.find(r => r.emoji === emoji);
                return (
                  <div key={emoji} className="group relative">
                    <button
                      onClick={() => !isTeacher && handleReaction(viewingAnnouncement.announcement_id, emoji)}
                      disabled={isTeacher === true}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm transition-all ${
                        reaction?.hasReacted
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-2 ring-blue-300 dark:ring-blue-600'
                          : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                      } ${isTeacher ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
                    >
                      <span className="text-lg">{emoji}</span>
                      {reaction && reaction.count > 0 && <span className="font-medium">{reaction.count}</span>}
                    </button>
                    {/* Tooltip showing who reacted */}
                    {reaction && reaction.reactors && reaction.reactors.length > 0 && (
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-50">
                        <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap shadow-lg">
                          <div className="font-semibold mb-1 border-b border-gray-700 dark:border-gray-600 pb-1">
                            {emoji} Reacted by:
                          </div>
                          <div className="max-h-32 overflow-y-auto">
                            {reaction.reactors.slice(0, 10).map((reactor) => (
                              <div key={reactor.id} className="py-0.5">
                                {reactor.name}
                              </div>
                            ))}
                            {reaction.reactors.length > 10 && (
                              <div className="text-gray-400 pt-1 border-t border-gray-700">
                                +{reaction.reactors.length - 10} more
                              </div>
                            )}
                          </div>
                          {/* Arrow */}
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Comments Section */}
            <div className="pt-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                💬 Comments {comments.length > 0 && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">{comments.length}</span>}
              </h4>
              
              {loadingComments ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-6 text-gray-400 dark:text-gray-500">
                  <span className="text-3xl block mb-2">💭</span>
                  <p className="text-sm">No comments yet. Be the first to comment!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {comments.map(comment => (
                    <div key={comment.comment_id} className={`${comment.is_pinned ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-2 border-yellow-400' : 'bg-gray-50 dark:bg-gray-700/50'} rounded-lg p-3`}>
                      <div className="flex items-start gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                          comment.commenter_type === 'teacher' ? 'bg-gradient-to-br from-purple-500 to-pink-600' : 'bg-gradient-to-br from-blue-500 to-cyan-600'
                        }`}>
                          {comment.commenter?.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium dark:text-white">{comment.commenter?.name}</span>
                            {comment.commenter_type === 'teacher' && (
                              <Badge variant="info" className="text-[10px] px-1.5 py-0">Teacher</Badge>
                            )}
                            {comment.is_pinned && <span className="text-xs">📌</span>}
                            <span className="text-xs text-gray-400">{formatTimeAgo(comment.created_at)}</span>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{comment.content}</p>
                          
                          {/* Reply button */}
                          <div className="flex items-center gap-2 mt-2">
                            <button 
                              onClick={() => setReplyingTo(replyingTo === comment.comment_id ? null : comment.comment_id)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              ↩️ Reply
                            </button>
                            {(isTeacher || comment.commenter_id === currentUserId) && (
                              <button 
                                onClick={() => handleDeleteComment(comment.comment_id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                🗑️ Delete
                              </button>
                            )}
                          </div>
                          
                          {/* Reply input */}
                          {replyingTo === comment.comment_id && (
                            <div className="flex gap-2 mt-2">
                              <input
                                type="text"
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                placeholder="Write a reply..."
                                className="flex-1 text-sm px-3 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddReply(comment.comment_id)}
                              />
                              <button
                                onClick={() => handleAddReply(comment.comment_id)}
                                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                              >
                                Send
                              </button>
                            </div>
                          )}
                          
                          {/* Replies */}
                          {comment.replies && comment.replies.length > 0 && (
                            <div className="mt-3 ml-4 space-y-2 border-l-2 border-gray-200 dark:border-gray-600 pl-3">
                              {comment.replies.map(reply => (
                                <div key={reply.comment_id} className="text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium dark:text-white">{reply.commenter?.name}</span>
                                    {reply.commenter_type === 'teacher' && (
                                      <Badge variant="info" className="text-[10px] px-1 py-0">Teacher</Badge>
                                    )}
                                    <span className="text-xs text-gray-400">{formatTimeAgo(reply.created_at)}</span>
                                  </div>
                                  <p className="text-gray-600 dark:text-gray-400">{reply.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={commentsEndRef} />
                </div>
              )}
              
              {/* Add Comment Input */}
              <div className="flex gap-2 mt-4 pt-3 border-t dark:border-gray-700">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                  isTeacher ? 'bg-gradient-to-br from-purple-500 to-pink-600' : 'bg-gradient-to-br from-blue-500 to-cyan-600'
                }`}>
                  {isTeacher ? 'T' : 'S'}
                </div>
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-full hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Send
                </button>
              </div>
            </div>
            
            <div className="flex justify-end pt-4 border-t dark:border-gray-700">
              <Button variant="outline" onClick={() => setViewingAnnouncement(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        type="danger"
        title="Delete Announcement"
        message="Are you sure you want to delete this announcement?"
        confirmText="Delete"
        onConfirm={() => {
          if (deleteConfirmId) handleDelete(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <ConfirmDialog
        isOpen={!!deletingCommentId}
        type="danger"
        title="Delete Comment"
        message="Are you sure you want to delete this comment?"
        confirmText="Delete"
        onConfirm={confirmDeleteComment}
        onCancel={() => setDeletingCommentId(null)}
      />
    </div>
  );
}

export default Announcements;
