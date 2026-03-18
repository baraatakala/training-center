import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { formatDate } from '../utils/formatDate';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { SearchBar } from '../components/ui/SearchBar';
import { Pagination } from '../components/ui/Pagination';
import { PageSkeleton } from '../components/ui/Skeleton';
import { SessionForm } from '../components/SessionForm';
import { SessionRecordingsManager } from '../components/SessionRecordingsManager';
import BulkScheduleTable from '../components/BulkScheduleTable';
import { supabase } from '../lib/supabase';
import { sessionService } from '../services/sessionService';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { useDebounce } from '../hooks/useDebounce';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { Tables, type CreateSession } from '../types/database.types';

type SessionWithDetails = {
  session_id: string;
  course_id: string;
  teacher_id: string;
  start_date: string;
  end_date: string;
  day: string | null;
  time: string | null;
  location: string | null;
  grace_period_minutes?: number;
  learning_method?: 'face_to_face' | 'online' | 'hybrid';
  virtual_provider?: 'zoom' | 'google_meet' | 'microsoft_teams' | 'other' | null;
  virtual_meeting_link?: string | null;
  requires_recording?: boolean;
  default_recording_visibility?: 'private_staff' | 'course_staff' | 'enrolled_students' | 'organization' | 'public_link' | null;
  feedback_enabled?: boolean;
  feedback_anonymous_allowed?: boolean;
  teacher_can_host?: boolean;
  course: {
    course_name: string;
    category: string;
  };
  teacher: {
    name: string;
  };
};

function formatLearningMethod(method?: SessionWithDetails['learning_method']) {
  if (method === 'online') return 'Online';
  if (method === 'hybrid') return 'Hybrid';
  return 'Face to Face';
}

function formatVirtualProvider(provider?: SessionWithDetails['virtual_provider']) {
  if (provider === 'google_meet') return 'Google Meet';
  if (provider === 'microsoft_teams') return 'Microsoft Teams';
  if (provider === 'zoom') return 'Zoom';
  if (provider === 'other') return 'Other';
  return '';
}

function formatRecordingVisibility(visibility?: SessionWithDetails['default_recording_visibility']) {
  if (!visibility) return '';
  return visibility
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildConflictMessage(conflicts: Awaited<ReturnType<typeof sessionService.checkScheduleConflicts>>['data']) {
  if (!conflicts || conflicts.length === 0) return '';

  const preview = conflicts.slice(0, 3).map((conflict) => {
    const timePart = conflict.existingTime ? ` at ${conflict.existingTime}` : '';
    return `${conflict.conflictDate}: ${conflict.courseName}${timePart}`;
  });
  const remaining = conflicts.length - preview.length;

  return [
    'This teacher already has another session on overlapping teaching dates/times.',
    ...preview,
    remaining > 0 ? `+ ${remaining} more conflict${remaining === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join('\n');
}

export function Sessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'course' | 'teacher' | 'startDate' | 'endDate'>('startDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionWithDetails | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSessionForSchedule, setSelectedSessionForSchedule] = useState<SessionWithDetails | null>(null);
  const [selectedSessionForRecordings, setSelectedSessionForRecordings] = useState<SessionWithDetails | null>(null);
  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionWithDetails | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() => {
    // Default to cards on small screens
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'cards';
    return (localStorage.getItem('sessions_view_mode') as 'table' | 'cards') || 'table';
  });

  // Clone session state
  const [cloneSource, setCloneSource] = useState<SessionWithDetails | null>(null);
  const [cloneForm, setCloneForm] = useState({
    start_date: '',
    end_date: '',
    day: '' as string,
    time: '',
    location: '',
    copyEnrollments: true,
  });
  const [cloning, setCloning] = useState(false);
  const [selectedCloneDays, setSelectedCloneDays] = useState<string[]>([]);

  const loadSessions = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .order('start_date', { ascending: false });

    if (fetchError) {
      setError('Failed to load sessions. Please try again.');
      toast.error('Failed to load sessions');
      console.error('Load sessions error:', fetchError);
      setLoading(false);
      return;
    }

    if (data) {
      setSessions(data as SessionWithDetails[]);
      
      // Load enrollment counts for each session
      const sessionIds = data.map((s: SessionWithDetails) => s.session_id);
      const { data: enrollments } = await supabase
        .from(Tables.ENROLLMENT)
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('status', 'active');
      
      if (enrollments) {
        const counts: Record<string, number> = {};
        enrollments.forEach((e: { session_id: string }) => {
          counts[e.session_id] = (counts[e.session_id] || 0) + 1;
        });
        setEnrollmentCounts(counts);
      }
    }
    setLoading(false);
  }, []);

  const ensureNoScheduleConflicts = useCallback(async (input: {
    teacherId: string;
    startDate: string;
    endDate: string;
    day: string | null;
    time?: string | null;
    excludeSessionId?: string;
  }) => {
    const { data, error } = await sessionService.checkScheduleConflicts(input);
    if (error) {
      throw new Error(error.message || 'Unable to validate schedule conflicts right now.');
    }
    if (data.length > 0) {
      throw new Error(buildConflictMessage(data));
    }
  }, []);

  useRefreshOnFocus(loadSessions);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filtered = sessions.filter(
      (session) =>
        session.course.course_name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.teacher.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.course.category.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        formatLearningMethod(session.learning_method).toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.virtual_provider || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.location || '').toLowerCase().includes(debouncedSearch.toLowerCase())
    );

    if (statusFilter !== 'all') {
      filtered = filtered.filter((session) => {
        const startDate = new Date(session.start_date);
        const endDate = new Date(session.end_date);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        if (statusFilter === 'active') {
          return startDate <= today && endDate >= today;
        } else if (statusFilter === 'upcoming') {
          return startDate > today;
        } else if (statusFilter === 'completed') {
          return endDate < today;
        }
        return true;
      });
    }

    filtered.sort((a, b) => {
      let aVal: string, bVal: string;
      
      switch (sortBy) {
        case 'course':
          aVal = a.course.course_name;
          bVal = b.course.course_name;
          break;
        case 'teacher':
          aVal = a.teacher.name;
          bVal = b.teacher.name;
          break;
        case 'startDate':
          aVal = a.start_date;
          bVal = b.start_date;
          break;
        case 'endDate':
          aVal = a.end_date;
          bVal = b.end_date;
          break;
        default:
          aVal = a.start_date;
          bVal = b.start_date;
      }
      
      const comparison = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [debouncedSearch, statusFilter, sessions, sortBy, sortOrder]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, sortBy, sortOrder]);

  // Removed unused toggleSort function - sorting is handled by dropdown and toggle button

  const handleAddSession = async (data: CreateSession) => {
    await ensureNoScheduleConflicts({
      teacherId: data.teacher_id,
      startDate: data.start_date,
      endDate: data.end_date,
      day: data.day,
      time: data.time,
    });

    const { error } = await sessionService.create(data);

    if (error) {
      const message = error.message || 'Unknown session creation error';
      toast.error(message.startsWith('Session delivery fields are enabled') ? message : 'Error creating session: ' + message, 7000);
    } else {
      toast.success('Session created successfully');
      setIsModalOpen(false);
      loadSessions();
    }
  };

  const handleUpdateSession = async (data: CreateSession) => {
    if (!editingSession) return;

    await ensureNoScheduleConflicts({
      teacherId: data.teacher_id,
      startDate: data.start_date,
      endDate: data.end_date,
      day: data.day,
      time: data.time,
      excludeSessionId: editingSession.session_id,
    });

    const { error } = await sessionService.update(editingSession.session_id, data);

    if (error) {
      const message = error.message || 'Unknown session update error';
      toast.error(message.startsWith('Session delivery fields are enabled') ? message : 'Error updating session: ' + message, 7000);
    } else {
      toast.success('Session updated successfully');
      setIsModalOpen(false);
      setEditingSession(null);
      loadSessions();
    }
  };

  const openAddModal = () => {
    setEditingSession(null);
    setIsModalOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!deletingSession) return;
    const { error } = await sessionService.delete(deletingSession.session_id);
    if (error) {
      toast.error('Failed to delete session: ' + error.message);
    } else {
      toast.success('Session deleted successfully');
      loadSessions();
    }
    setDeletingSession(null);
  };

  const openEditModal = (session: SessionWithDetails) => {
    setEditingSession(session);
    setIsModalOpen(true);
  };

  const openCloneModal = (session: SessionWithDetails) => {
    const sourceStart = parseLocalDate(session.start_date);
    const sourceEnd = parseLocalDate(session.end_date);
    const sessionDurationDays = sourceStart && sourceEnd
      ? Math.max(0, Math.round((sourceEnd.getTime() - sourceStart.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    const suggestedStart = sourceEnd ? new Date(sourceEnd.getFullYear(), sourceEnd.getMonth(), sourceEnd.getDate() + 1) : null;
    const suggestedEnd = suggestedStart
      ? new Date(suggestedStart.getFullYear(), suggestedStart.getMonth(), suggestedStart.getDate() + sessionDurationDays)
      : null;
    setCloneSource(session);
    const days = session.day ? session.day.split(',').map(d => d.trim()) : [];
    setSelectedCloneDays(days);
    setCloneForm({
      start_date: suggestedStart ? formatLocalDate(suggestedStart) : '',
      end_date: suggestedEnd ? formatLocalDate(suggestedEnd) : '',
      day: session.day || '',
      time: session.time || '',
      location: session.location || '',
      copyEnrollments: true,
    });
  };

  const handleCloneSession = async () => {
    if (!cloneSource) return;
    if (!cloneForm.start_date || !cloneForm.end_date || selectedCloneDays.length === 0) {
      toast.error('Please fill in start date, end date, and select at least one day');
      return;
    }
    if (new Date(cloneForm.end_date) < new Date(cloneForm.start_date)) {
      toast.error('End date cannot be before start date');
      return;
    }
    setCloning(true);
    try {
      await ensureNoScheduleConflicts({
        teacherId: cloneSource.teacher_id,
        startDate: cloneForm.start_date,
        endDate: cloneForm.end_date,
        day: selectedCloneDays.join(', ') || null,
        time: cloneForm.time || null,
      });

      const { error, copied } = await sessionService.cloneSession(
        cloneSource.session_id,
        {
          start_date: cloneForm.start_date,
          end_date: cloneForm.end_date,
          day: selectedCloneDays.join(', '),
          time: cloneForm.time || undefined,
          location: cloneForm.location || undefined,
        },
        cloneForm.copyEnrollments,
      );
      if (error) {
        toast.error('Failed to clone session: ' + error.message);
      } else {
        const msg = cloneForm.copyEnrollments
          ? `Session cloned! ${copied} students copied.`
          : 'Session cloned (without students).';
        toast.success(msg);
        setCloneSource(null);
        loadSessions();
      }
    } finally {
      setCloning(false);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const activeSessions = sessions.filter((s) => {
    const start = new Date(s.start_date);
    const end = new Date(s.end_date);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return start <= today && end >= today;
  }).length;

  const upcomingSessions = sessions.filter((s) => {
    const start = new Date(s.start_date);
    start.setHours(0, 0, 0, 0);
    return start > today;
  }).length;

  const completedSessions = sessions.filter((s) => {
    const end = new Date(s.end_date);
    end.setHours(0, 0, 0, 0);
    return end < today;
  }).length;

  const exportToCSV = useCallback(() => {
    const headers = ['Course', 'Category', 'Teacher', 'Start Date', 'End Date', 'Day', 'Time', 'Location', 'Learning Method', 'Virtual Provider', 'Meeting Link', 'Requires Recording', 'Recording Visibility', 'Enrolled'];
    const rows = filteredSessions.map(s => [
      s.course?.course_name || '',
      s.course?.category || '',
      s.teacher?.name || '',
      s.start_date,
      s.end_date,
      s.day || '',
      s.time || '',
      s.location || '',
      formatLearningMethod(s.learning_method),
      formatVirtualProvider(s.virtual_provider),
      s.virtual_meeting_link || '',
      s.requires_recording ? 'Yes' : 'No',
      formatRecordingVisibility(s.default_recording_visibility),
      String(enrollmentCounts[s.session_id] || 0),
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sessions-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredSessions.length} sessions to CSV`);
  }, [filteredSessions, enrollmentCounts]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Sessions</h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Manage training sessions and schedules</p>
        </div>
        {isTeacher && (
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <Button onClick={exportToCSV} variant="outline" className="w-full min-w-0 gap-2" title="Export to CSV">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="truncate">Export</span>
            </Button>
            <Button onClick={openAddModal} className="w-full min-w-0"><span className="truncate">+ Add Session</span></Button>
          </div>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">
            ⚠️ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">❌ {error}</p>
          <button 
            onClick={loadSessions} 
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-900/30">
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{sessions.length}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Total Sessions</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/30 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-green-200 dark:border-green-700">
          <div className="text-3xl font-bold text-green-700 dark:text-green-400">{activeSessions}</div>
          <div className="text-sm text-green-600 dark:text-green-400 mt-1">Active Now</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/30 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-yellow-200 dark:border-yellow-700">
          <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{upcomingSessions}</div>
          <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">Upcoming</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-600">
          <div className="text-3xl font-bold text-gray-700 dark:text-gray-300">{completedSessions}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Completed</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow dark:shadow-gray-900/30 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search sessions..."
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              options={[
                { value: 'all', label: 'All Sessions' },
                { value: 'active', label: 'Active' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'completed', label: 'Completed' }
              ]}
            />
          </div>
        </div>
        
        {/* Sort Controls */}
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'course' | 'teacher' | 'startDate' | 'endDate')}
            aria-label="Sort sessions by"
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-1.5 focus:ring-2 focus:ring-blue-500"
          >
            <option value="startDate">Start Date</option>
            <option value="endDate">End Date</option>
            <option value="course">Course Name</option>
            <option value="teacher">Teacher Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
          >
            {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
          <span className="text-gray-600 dark:text-gray-400 ml-auto hidden sm:inline">
            Showing {filteredSessions.length} of {sessions.length} sessions
          </span>

          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 ml-2">
            <button
              onClick={() => { setViewMode('table'); localStorage.setItem('sessions_view_mode', 'table'); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1 ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Table view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" /></svg>
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              onClick={() => { setViewMode('cards'); localStorage.setItem('sessions_view_mode', 'cards'); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1 ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Card view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              <span className="hidden sm:inline">Cards</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <PageSkeleton statCards={0} tableRows={8} tableColumns={11} hasFilters={false} />
      ) : viewMode === 'cards' ? (
        /* ==================== CARD VIEW ==================== */
        <div>
          {filteredSessions.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 p-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery || statusFilter !== 'all'
                    ? 'No sessions match your filters.'
                    : 'No sessions yet. Click "+ Add Session" to create one.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSessions
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((session) => {
                    const todayDate = new Date();
                    todayDate.setHours(0, 0, 0, 0);
                    const startDate = new Date(session.start_date);
                    const endDate = new Date(session.end_date);
                    startDate.setHours(0, 0, 0, 0);
                    endDate.setHours(0, 0, 0, 0);

                    let sessionStatus: 'active' | 'upcoming' | 'completed' = 'active';
                    let statusVariant: 'success' | 'warning' | 'default' = 'success';
                    let statusColor = 'border-green-300 dark:border-green-700';

                    if (endDate < todayDate) {
                      sessionStatus = 'completed';
                      statusVariant = 'default';
                      statusColor = 'border-gray-300 dark:border-gray-600';
                    } else if (startDate > todayDate) {
                      sessionStatus = 'upcoming';
                      statusVariant = 'warning';
                      statusColor = 'border-yellow-300 dark:border-yellow-700';
                    }

                    return (
                      <div
                        key={session.session_id}
                        className={`bg-white dark:bg-gray-800 rounded-xl shadow dark:shadow-gray-900/30 border-l-4 ${statusColor} p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-gray-900 dark:text-white truncate text-lg">
                              {session.course.course_name}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                              {session.teacher.name}
                            </p>
                          </div>
                          <Badge variant={statusVariant}>{sessionStatus}</Badge>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                            <Badge
                              variant={
                                session.course.category === 'Programming'
                                  ? 'info'
                                  : session.course.category === 'Design'
                                  ? 'success'
                                  : 'warning'
                              }
                            >
                              {session.course.category}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            <span className="font-medium text-blue-700 dark:text-blue-400">{enrollmentCounts[session.session_id] || 0} enrolled</span>
                          </div>
                          {session.day && (
                            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              <span>{session.day}</span>
                            </div>
                          )}
                          {session.time && (
                            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              <span>{session.time}</span>
                            </div>
                          )}
                          {session.location && (
                            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 col-span-2">
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              <span className="truncate">{session.location}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={session.learning_method === 'online' ? 'info' : session.learning_method === 'hybrid' ? 'warning' : 'default'}>
                            {formatLearningMethod(session.learning_method)}
                          </Badge>
                          {session.virtual_provider && (
                            <Badge variant="info">{formatVirtualProvider(session.virtual_provider)}</Badge>
                          )}
                          {session.requires_recording && (
                            <Badge variant="success">🎥 {formatRecordingVisibility(session.default_recording_visibility) || 'Recording'}</Badge>
                          )}
                          {session.feedback_enabled && (
                            <Badge variant="info">💜 {!isTeacher && !isAdmin ? 'After Check-In' : 'Feedback'}</Badge>
                          )}
                          {session.grace_period_minutes != null && session.grace_period_minutes > 0 && (
                            <Badge variant="default">⏱ {session.grace_period_minutes}m grace</Badge>
                          )}
                          {session.teacher_can_host === false && (
                            <Badge variant="warning">🔒 Student-hosted</Badge>
                          )}
                        </div>

                        {session.virtual_meeting_link && (
                          <a
                            href={session.virtual_meeting_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 truncate"
                          >
                            {session.virtual_meeting_link}
                          </a>
                        )}

                        {/* Dates */}
                        <div className="text-xs text-gray-500 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2">
                          {formatDate(session.start_date)} — {formatDate(session.end_date)}
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-1 space-y-2">
                          {isTeacher && (
                            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                              <Button
                                size="sm"
                                variant="success"
                                onClick={() => navigate(`/attendance/${session.session_id}`)}
                                className="w-full min-h-[36px] justify-center"
                              >
                                📋 Attendance
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedSessionForSchedule(session); setIsScheduleModalOpen(true); }}
                                className="w-full min-h-[36px] justify-center"
                              >
                                📅 Host Schedule
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedSessionForRecordings(session)}
                                className="w-full min-h-[36px] justify-center"
                              >
                                🎥 Recordings
                              </Button>
                              {session.feedback_enabled && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)}
                                  className="w-full min-h-[36px] justify-center"
                                >
                                  💜 Feedback
                                </Button>
                              )}
                            </div>
                          )}
                          {isAdmin && (
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openCloneModal(session)}
                                title="Clone session with new dates and copy all students"
                                className="w-full min-h-[36px] justify-center"
                              >
                                📋 Clone
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditModal(session)}
                                className="w-full min-h-[36px] justify-center"
                              >
                                ✏️ Edit
                              </Button>
                              {!isTeacher && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedSessionForRecordings(session)}
                                  className="w-full min-h-[36px] justify-center"
                                >
                                  🎥 Recordings
                                </Button>
                              )}
                              {session.feedback_enabled && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)}
                                  className="w-full min-h-[36px] justify-center"
                                >
                                  💜 Feedback
                                </Button>
                              )}
                              <button
                                onClick={() => setDeletingSession(session)}
                                className="px-3 py-2 text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors min-h-[36px]"
                                title="Delete session"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          )}
                          {!isTeacher && !isAdmin && (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                              {session.requires_recording && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedSessionForRecordings(session)}
                                  className="min-h-[36px] justify-center"
                                >
                                  🎥 View Recordings
                                </Button>
                              )}
                              <span className="text-xs text-gray-400 px-2 py-1">View only</span>
                              </div>
                              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                                <p>Check-in opens from the teacher&apos;s QR or face link on the session date.</p>
                                {session.feedback_enabled && <p className="mt-1">Feedback appears after successful check-in.</p>}
                                {session.requires_recording && <p className="mt-1">Replay links appear here after staff publish them for a date.</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {filteredSessions.length > 0 && (
                <div className="mt-4">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredSessions.length / itemsPerPage)}
                    totalItems={filteredSessions.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={(page) => setCurrentPage(page)}
                    onItemsPerPageChange={(items) => {
                      setItemsPerPage(items);
                      setCurrentPage(1);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Enrolled</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400">
                        {searchQuery || statusFilter !== 'all'
                          ? 'No sessions match your filters.'
                          : 'No sessions yet. Click "+ Add Session" to create one.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredSessions
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((session) => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const startDate = new Date(session.start_date);
                  const endDate = new Date(session.end_date);
                  startDate.setHours(0, 0, 0, 0);
                  endDate.setHours(0, 0, 0, 0);

                  let sessionStatus: 'active' | 'upcoming' | 'completed' = 'active';
                  let statusVariant: 'success' | 'warning' | 'default' = 'success';
                  
                  if (endDate < today) {
                    sessionStatus = 'completed';
                    statusVariant = 'default';
                  } else if (startDate > today) {
                    sessionStatus = 'upcoming';
                    statusVariant = 'warning';
                  }

                  return (
                    <TableRow key={session.session_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{session.course.course_name}</span>
                          <Badge variant={statusVariant}>
                            {sessionStatus}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{session.teacher.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            session.course.category === 'Programming'
                              ? 'info'
                              : session.course.category === 'Design'
                              ? 'success'
                              : 'warning'
                          }
                        >
                          {session.course.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium">
                          {enrollmentCounts[session.session_id] || 0}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-[180px]">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {formatLearningMethod(session.learning_method)}
                          </span>
                          {session.virtual_provider && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatVirtualProvider(session.virtual_provider)}
                            </span>
                          )}
                          {session.requires_recording && (
                            <span className="text-xs text-green-600 dark:text-green-400">
                              Recording: {formatRecordingVisibility(session.default_recording_visibility) || 'Enabled'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{session.day || 'N/A'}</TableCell>
                      <TableCell>{session.time || 'N/A'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{session.location || 'N/A'}</span>
                          {session.virtual_meeting_link && (
                            <a
                              href={session.virtual_meeting_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 truncate max-w-[220px]"
                            >
                              {session.virtual_meeting_link}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(session.start_date)}</TableCell>
                      <TableCell>{formatDate(session.end_date)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant}>{sessionStatus}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2 justify-end max-w-[380px] ml-auto">
                          {isTeacher && (
                            <>
                              <Button
                                size="sm"
                                variant="success"
                                onClick={() => navigate(`/attendance/${session.session_id}`)}
                                className="min-h-[36px]"
                              >
                                Attendance
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedSessionForSchedule(session); setIsScheduleModalOpen(true); }} className="min-h-[36px]">
                                Host Schedule
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setSelectedSessionForRecordings(session)} className="min-h-[36px]">
                                Recordings
                              </Button>
                              {session.feedback_enabled && (
                                <Button size="sm" variant="outline" onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)} className="min-h-[36px]">
                                  Feedback
                                </Button>
                              )}
                            </>
                          )}
                          {isAdmin && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openCloneModal(session)} className="min-h-[36px]">
                                Clone
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => openEditModal(session)}
                                className="min-h-[36px]"
                              >
                                Edit
                              </Button>
                              {!isTeacher && (
                                <Button size="sm" variant="outline" onClick={() => setSelectedSessionForRecordings(session)} className="min-h-[36px]">
                                  Recordings
                                </Button>
                              )}
                              {session.feedback_enabled && (
                                <Button size="sm" variant="outline" onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)} className="min-h-[36px]">
                                  Feedback
                                </Button>
                              )}
                              <button
                                onClick={() => setDeletingSession(session)}
                                className="px-2 md:px-3 py-2 text-xs md:text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors min-h-[36px]"
                                title="Delete session"
                                aria-label={`Delete session ${session.course?.course_name || ''}`}
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {!isTeacher && !isAdmin && (
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex flex-wrap gap-2 justify-end">
                              {session.requires_recording && (
                                <Button size="sm" variant="outline" onClick={() => setSelectedSessionForRecordings(session)} className="min-h-[36px]">
                                  View Recordings
                                </Button>
                              )}
                              <span className="text-xs text-gray-400 px-2 self-center">View only</span>
                              </div>
                              <div className="max-w-[260px] text-right text-xs text-gray-500 dark:text-gray-400">
                                Check-in comes from the teacher&apos;s QR or face link. Feedback shows only after a successful check-in.
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>

          {filteredSessions.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredSessions.length / itemsPerPage)}
              totalItems={filteredSessions.length}
              itemsPerPage={itemsPerPage}
              onPageChange={(page) => setCurrentPage(page)}
              onItemsPerPageChange={(items) => {
                setItemsPerPage(items);
                setCurrentPage(1);
              }}
            />
          )}
        </div>
      )}
      {/* End of view mode ternary */}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSession(null);
        }}
        title={editingSession ? 'Edit Session' : 'Add New Session'}
      >
        <SessionForm
          onSubmit={editingSession ? handleUpdateSession : handleAddSession}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingSession(null);
          }}
          initialData={
            editingSession
              ? {
                  course_id: editingSession.course_id,
                  teacher_id: editingSession.teacher_id,
                  start_date: editingSession.start_date,
                  end_date: editingSession.end_date,
                  day: editingSession.day,
                  time: editingSession.time,
                  location: editingSession.location,
                  grace_period_minutes: editingSession.grace_period_minutes,
                  learning_method: editingSession.learning_method,
                  virtual_provider: editingSession.virtual_provider,
                  virtual_meeting_link: editingSession.virtual_meeting_link,
                  requires_recording: editingSession.requires_recording,
                  default_recording_visibility: editingSession.default_recording_visibility,
                  feedback_enabled: editingSession.feedback_enabled,
                  feedback_anonymous_allowed: editingSession.feedback_anonymous_allowed,
                  teacher_can_host: editingSession.teacher_can_host,
                }
              : null
          }
        />
      </Modal>

      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setSelectedSessionForSchedule(null);
        }}
        title={selectedSessionForSchedule ? `Host Table - ${selectedSessionForSchedule.course?.course_name}` : 'Host Table'}
        size="full"
      >
        {selectedSessionForSchedule && (
          <BulkScheduleTable
            sessionId={selectedSessionForSchedule.session_id}
            startDate={selectedSessionForSchedule.start_date}
            endDate={selectedSessionForSchedule.end_date}
            day={selectedSessionForSchedule.day}
            time={selectedSessionForSchedule.time}
            onClose={() => {
              setIsScheduleModalOpen(false);
              setSelectedSessionForSchedule(null);
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!selectedSessionForRecordings}
        onClose={() => setSelectedSessionForRecordings(null)}
        title={selectedSessionForRecordings ? `Session Recordings - ${selectedSessionForRecordings.course?.course_name}` : 'Session Recordings'}
        size="lg"
      >
        {selectedSessionForRecordings && (
          <SessionRecordingsManager
            sessionId={selectedSessionForRecordings.session_id}
            courseName={selectedSessionForRecordings.course?.course_name || 'this session'}
            canManageInAttendance={isTeacher || isAdmin}
          />
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingSession}
        title="Delete Session"
        message={`Are you sure you want to delete the session for "${deletingSession?.course?.course_name}"? This will also remove all attendance records.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteSession}
        onCancel={() => setDeletingSession(null)}
      />

      {/* Clone Session Modal */}
      <Modal
        isOpen={!!cloneSource}
        onClose={() => setCloneSource(null)}
        title={`Clone Session — ${cloneSource?.course?.course_name || ''}`}
      >
        {cloneSource && (
          <div className="space-y-4">
            {/* Source info */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Cloning from:</strong> {cloneSource.course.course_name} — {cloneSource.teacher.name}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Original: {cloneSource.day} · {cloneSource.time || 'No time set'} · {enrollmentCounts[cloneSource.session_id] || 0} students
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Suggested clone starts the day after this session ends and keeps the same duration.
              </p>
            </div>

            {/* New date range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Start Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={cloneForm.start_date}
                  onChange={e => {
                    const nextStart = e.target.value;
                    setCloneForm(f => {
                      if (!nextStart) return { ...f, start_date: nextStart };
                      if (f.end_date) return { ...f, start_date: nextStart };
                      const originalStart = parseLocalDate(cloneSource.start_date);
                      const originalEnd = parseLocalDate(cloneSource.end_date);
                      const newStart = parseLocalDate(nextStart);
                      if (!originalStart || !originalEnd || !newStart) return { ...f, start_date: nextStart };
                      const durationDays = Math.max(0, Math.round((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)));
                      const newEnd = new Date(newStart.getFullYear(), newStart.getMonth(), newStart.getDate() + durationDays);
                      return { ...f, start_date: nextStart, end_date: formatLocalDate(newEnd) };
                    });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New End Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={cloneForm.end_date}
                  onChange={e => setCloneForm(f => ({ ...f, end_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
                {cloneForm.start_date && !cloneForm.end_date && (
                  <button
                    type="button"
                    onClick={() => setCloneForm(f => ({ ...f, end_date: f.start_date }))}
                    className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Use same day
                  </button>
                )}
              </div>
            </div>

            {/* Days */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Day(s) <span className="text-red-500">*</span></label>
              {cloneForm.start_date && (
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseLocalDate(cloneForm.start_date);
                    if (!parsed) return;
                    const matchedDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parsed.getDay()];
                    setSelectedCloneDays([matchedDay]);
                  }}
                  className="mb-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Match start date day
                </button>
              )}
              <div className="flex flex-wrap gap-2">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                  <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCloneDays.includes(day)}
                      onChange={e => {
                        const newDays = e.target.checked
                          ? [...selectedCloneDays, day]
                          : selectedCloneDays.filter(d => d !== day);
                        setSelectedCloneDays(newDays);
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{day}</span>
                  </label>
                ))}
              </div>
              {selectedCloneDays.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">Selected: {selectedCloneDays.join(', ')}</p>
              )}
            </div>

            {/* Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Time Range</label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="time"
                  value={cloneForm.time?.split('-')[0]?.trim() || ''}
                  onChange={e => {
                    const endTime = cloneForm.time?.split('-')[1]?.trim() || '';
                    setCloneForm(f => ({ ...f, time: endTime ? `${e.target.value}-${endTime}` : e.target.value }));
                  }}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
                <input
                  type="time"
                  value={cloneForm.time?.split('-')[1]?.trim() || ''}
                  onChange={e => {
                    const startTime = cloneForm.time?.split('-')[0]?.trim() || '';
                    setCloneForm(f => ({ ...f, time: startTime ? `${startTime}-${e.target.value}` : e.target.value }));
                  }}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
            </div>

            {/* Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
              <input
                type="text"
                value={cloneForm.location}
                onChange={e => setCloneForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g., Main Campus - Room 202"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
              {cloneSource.location && (
                <button
                  type="button"
                  onClick={() => setCloneForm(f => ({ ...f, location: cloneSource.location || '' }))}
                  className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Reuse original location
                </button>
              )}
            </div>

            {/* Copy enrollments toggle */}
            <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 cursor-pointer">
              <input
                type="checkbox"
                checked={cloneForm.copyEnrollments}
                onChange={e => setCloneForm(f => ({ ...f, copyEnrollments: e.target.checked }))}
                className="h-5 w-5 text-blue-600 rounded border-gray-300"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Copy all {enrollmentCounts[cloneSource.session_id] || 0} students to new session
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Active enrollments will be duplicated automatically
                </p>
              </div>
            </label>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <Button variant="outline" onClick={() => setCloneSource(null)}>Cancel</Button>
              <Button
                onClick={handleCloneSession}
                disabled={cloning || !cloneForm.start_date || !cloneForm.end_date || selectedCloneDays.length === 0}
              >
                {cloning ? 'Cloning...' : `📋 Clone Session${cloneForm.copyEnrollments ? ' + Students' : ''}`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
