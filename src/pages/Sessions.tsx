import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
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
  const [sessions, setSessions] = useState<SessionWithDetails[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<SessionWithDetails[]>([]);
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
  const { isTeacher } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionWithDetails | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const loadSessions = async () => {
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
      setFilteredSessions(data as SessionWithDetails[]);
      
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
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filtered = sessions.filter(
      (session) =>
        session.course.course_name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.teacher.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        session.course.category.toLowerCase().includes(debouncedSearch.toLowerCase())
    );

    // Apply status filter
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

    // Apply sorting
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

    setFilteredSessions(filtered);
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, sessions, sortBy, sortOrder]);

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
          <span className="text-gray-600 dark:text-gray-400 ml-auto">
            Showing {filteredSessions.length} of {sessions.length} sessions
          </span>
        </div>
      </div>

      {loading ? (
        <PageSkeleton statCards={0} tableRows={8} tableColumns={11} hasFilters={false} />
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
                      <TableCell>{new Date(session.start_date).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(session.end_date).toLocaleDateString()}</TableCell>
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
                                onClick={() => window.location.href = `/attendance/${session.session_id}`}
                              >
                                Attendance
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedSessionForSchedule(session); setIsScheduleModalOpen(true); }}>
                                Host Schedule
                              </Button>
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
