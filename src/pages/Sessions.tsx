import { useEffect, useState } from 'react';
// ...existing code...
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { SearchBar } from '../components/ui/SearchBar';
import { SessionForm } from '../components/SessionForm';
import BulkScheduleTable from '../components/BulkScheduleTable';
import { supabase } from '../lib/supabase';
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'course' | 'teacher' | 'startDate' | 'endDate'>('startDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionWithDetails | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSessionForSchedule, setSelectedSessionForSchedule] = useState<SessionWithDetails | null>(null);
  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});
  const [isTeacher, setIsTeacher] = useState(false);

  const loadSessions = async () => {
    const { data } = await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .order('start_date', { ascending: false });

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
    const checkTeacherAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: teacher } = await supabase
          .from('teacher')
          .select('teacher_id')
          .ilike('email', user.email)
          .single();
        setIsTeacher(!!teacher);
      }
    };
    checkTeacherAccess();
    loadSessions();
  }, []);

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filtered = sessions.filter(
      (session) =>
        session.course.course_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.teacher.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.course.category.toLowerCase().includes(searchQuery.toLowerCase())
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
  }, [searchQuery, statusFilter, sessions, sortBy, sortOrder]);

  // Removed unused toggleSort function - sorting is handled by dropdown and toggle button

  const handleAddSession = async (data: CreateSession) => {
    const { error } = await supabase.from(Tables.SESSION).insert([data]);

    if (error) {
      alert('Error creating session: ' + error.message);
    } else {
      setIsModalOpen(false);
      loadSessions();
    }
  };

  const handleUpdateSession = async (data: CreateSession) => {
    if (!editingSession) return;

    const { error } = await supabase
      .from(Tables.SESSION)
      .update(data)
      .eq('session_id', editingSession.session_id);

    if (error) {
      alert('Error updating session: ' + error.message);
    } else {
      setIsModalOpen(false);
      setEditingSession(null);
      loadSessions();
    }
  };

  const openAddModal = () => {
    setEditingSession(null);
    setIsModalOpen(true);
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Sessions</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Manage training sessions and schedules</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} className="w-full sm:w-auto">+ Add Session</Button>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">
            ⚠️ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-3xl font-bold text-gray-900">{sessions.length}</div>
          <div className="text-sm text-gray-600 mt-1">Total Sessions</div>
        </div>
        <div className="bg-green-50 p-6 rounded-lg shadow border border-green-200">
          <div className="text-3xl font-bold text-green-700">{activeSessions}</div>
          <div className="text-sm text-green-600 mt-1">Active Now</div>
        </div>
        <div className="bg-yellow-50 p-6 rounded-lg shadow border border-yellow-200">
          <div className="text-3xl font-bold text-yellow-700">{upcomingSessions}</div>
          <div className="text-sm text-yellow-600 mt-1">Upcoming</div>
        </div>
        <div className="bg-gray-50 p-6 rounded-lg shadow border border-gray-200">
          <div className="text-3xl font-bold text-gray-700">{completedSessions}</div>
          <div className="text-sm text-gray-600 mt-1">Completed</div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow space-y-4">
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
          <span className="font-medium text-gray-700">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'course' | 'teacher' | 'startDate' | 'endDate')}
            className="border border-gray-300 rounded px-3 py-1.5 focus:ring-2 focus:ring-blue-500"
          >
            <option value="startDate">Start Date</option>
            <option value="endDate">End Date</option>
            <option value="course">Course Name</option>
            <option value="teacher">Teacher Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
          >
            {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
          <span className="text-gray-600 ml-auto">
            Showing {filteredSessions.length} of {sessions.length} sessions
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="text-gray-400">Loading sessions...</div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
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
                  <TableCell className="text-center text-gray-500 py-8">
                    <span className="block">No sessions found</span>
                  </TableCell>
                </TableRow>
              ) : (
                filteredSessions.map((session) => {
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
    </div>
  );
}
