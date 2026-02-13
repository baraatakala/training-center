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
  course: {
    course_name: string;
    category: string;
  };
  teacher: {
    name: string;
  };
};

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
        .in('session_id', sessionIds);
      
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

  useRefreshOnFocus(loadSessions);

  useEffect(() => {
    loadSessions();
  }, []);

  const filteredSessions = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filtered = sessions.filter(
      (session) =>
        session.course.course_name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.teacher.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.course.category.toLowerCase().includes(debouncedSearch.toLowerCase())
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
    const { error } = await sessionService.create(data);

    if (error) {
      toast.error('Error creating session: ' + error.message);
    } else {
      toast.success('Session created successfully');
      setIsModalOpen(false);
      loadSessions();
    }
  };

  const handleUpdateSession = async (data: CreateSession) => {
    if (!editingSession) return;

    const { error } = await sessionService.update(editingSession.session_id, data);

    if (error) {
      toast.error('Error updating session: ' + error.message);
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

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Sessions</h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Manage training sessions and schedules</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} className="w-full sm:w-auto">+ Add Session</Button>
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

                        {/* Dates */}
                        <div className="text-xs text-gray-500 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2">
                          {formatDate(session.start_date)} — {formatDate(session.end_date)}
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {isTeacher && (
                            <>
                              <Button
                                size="sm"
                                variant="success"
                                onClick={() => navigate(`/attendance/${session.session_id}`)}
                                className="w-full text-xs"
                              >
                                📋 Attendance
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedSessionForSchedule(session); setIsScheduleModalOpen(true); }}
                                className="w-full text-xs"
                              >
                                📅 Schedule
                              </Button>
                            </>
                          )}
                          {isAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditModal(session)}
                                className="w-full text-xs"
                              >
                                ✏️ Edit
                              </Button>
                              <button
                                onClick={() => setDeletingSession(session)}
                                className="w-full px-2 py-1 text-xs rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete session"
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                          {!isTeacher && (
                            <span className="text-xs text-gray-400 px-2 py-1 col-span-2 text-center">View only</span>
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
                  <TableCell colSpan={11} className="text-center py-16">
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
                      <TableCell>{session.day || 'N/A'}</TableCell>
                      <TableCell>{session.time || 'N/A'}</TableCell>
                      <TableCell>{session.location || 'N/A'}</TableCell>
                      <TableCell>{formatDate(session.start_date)}</TableCell>
                      <TableCell>{formatDate(session.end_date)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant}>{sessionStatus}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          {isTeacher && (
                            <>
                              <Button
                                size="sm"
                                variant="success"
                                onClick={() => navigate(`/attendance/${session.session_id}`)}
                              >
                                Attendance
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedSessionForSchedule(session); setIsScheduleModalOpen(true); }}>
                                Host Schedule
                              </Button>
                            </>
                          )}
                          {isAdmin && (
                            <>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => openEditModal(session)}
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingSession(session)}
                                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete session"
                                aria-label={`Delete session ${session.course?.course_name || ''}`}
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {!isTeacher && (
                            <span className="text-xs text-gray-400 px-2">View only</span>
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
    </div>
  );
}
