import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { SearchBar } from '../components/ui/SearchBar';
import { SessionForm } from '../components/SessionForm';
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionWithDetails | null>(null);

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

    setFilteredSessions(filtered);
  }, [searchQuery, statusFilter, sessions]);

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

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    const { error } = await supabase.from(Tables.SESSION).delete().eq('session_id', sessionId);

    if (error) {
      alert('Error deleting session: ' + error.message);
    } else {
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sessions</h1>
          <p className="text-gray-600 mt-1">Manage training sessions and schedules</p>
        </div>
        <Button onClick={openAddModal}>+ Add Session</Button>
      </div>

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

      <div className="flex gap-4">
        <div className="flex-1">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search sessions by course, teacher, or category..."
          />
        </div>
        <div className="w-48">
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

      {loading ? (
        <div className="text-center py-12">
          <div className="text-gray-400">Loading sessions...</div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
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
                      <TableCell>{session.day || 'N/A'}</TableCell>
                      <TableCell>{session.time || 'N/A'}</TableCell>
                      <TableCell>{session.location || 'N/A'}</TableCell>
                      <TableCell>{new Date(session.start_date).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(session.end_date).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          <Link to={`/attendance/${session.session_id}`}>
                            <Button size="sm" variant="success">
                              Attendance
                            </Button>
                          </Link>
                          <Button size="sm" variant="outline" onClick={() => openEditModal(session)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteSession(session.session_id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
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
    </div>
  );
}
