import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { EnrollmentForm } from '../components/EnrollmentForm';
import { enrollmentService } from '../services/enrollmentService';
import { supabase } from '../lib/supabase';
import type { CreateEnrollment, UpdateEnrollment } from '../types/database.types';

interface EnrollmentWithDetails {
  enrollment_id: string;
  enrollment_date: string;
  status: string;
  can_host?: boolean | null;
  student: {
    name: string;
    email: string;
  };
  session: {
    start_date: string;
    course: {
      course_name: string;
    };
  };
}

export function Enrollments() {
  const [enrollments, setEnrollments] = useState<EnrollmentWithDetails[]>([]);
  const [filteredEnrollments, setFilteredEnrollments] = useState<EnrollmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentWithDetails | null>(null);
  const [showOnlyHosting, setShowOnlyHosting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'student' | 'course' | 'date' | 'status' | 'canHost'>('student');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isTeacher, setIsTeacher] = useState(false);

  const loadEnrollments = async () => {
    setLoading(true);
    const { data } = await enrollmentService.getAll();
    if (data) {
      setEnrollments(data as EnrollmentWithDetails[]);
      setFilteredEnrollments(data as EnrollmentWithDetails[]);
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
    loadEnrollments();
  }, []);

  useEffect(() => {
    let filtered = [...enrollments];
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.student.name.toLowerCase().includes(query) ||
          e.session.course.course_name.toLowerCase().includes(query) ||
          e.status.toLowerCase().includes(query)
      );
    }
    
    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((e) => e.status === statusFilter);
    }
    
    // Apply hosting filter
    if (showOnlyHosting) {
      filtered = filtered.filter((e) => e.can_host === true);
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let comparison: number;
      
      switch (sortBy) {
        case 'student':
          comparison = a.student.name.localeCompare(b.student.name);
          break;
        case 'course':
          comparison = a.session.course.course_name.localeCompare(b.session.course.course_name);
          break;
        case 'date':
          comparison = a.enrollment_date.localeCompare(b.enrollment_date);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'canHost': {
          // Sort by can_host: true values first, then false
          const aHost = a.can_host ? 1 : 0;
          const bHost = b.can_host ? 1 : 0;
          comparison = bHost - aHost; // Descending by default (true first)
          break;
        }
        default:
          comparison = a.student.name.localeCompare(b.student.name);
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    setFilteredEnrollments(filtered);
  }, [searchQuery, enrollments, showOnlyHosting, statusFilter, sortBy, sortOrder]);

  const toggleSort = (column: 'student' | 'course' | 'date' | 'status' | 'canHost') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const handleAddEnrollment = async (data: CreateEnrollment) => {
    const { error } = await enrollmentService.create(data);
    if (error) {
      alert('Error enrolling student: ' + error.message);
    } else {
      setIsModalOpen(false);
      loadEnrollments();
    }
  };

  const handleUpdateEnrollment = async (data: CreateEnrollment) => {
    if (!editingEnrollment) return;
    const { error } = await enrollmentService.update(editingEnrollment.enrollment_id, data as UpdateEnrollment);
    if (error) {
      alert('Error updating enrollment: ' + error.message);
    } else {
      setIsModalOpen(false);
      setEditingEnrollment(null);
      loadEnrollments();
    }
  };

  const handleUpdateStatus = async (enrollmentId: string, newStatus: string) => {
    const statusValue = newStatus as 'active' | 'completed' | 'dropped' | 'pending';
    const { error } = await enrollmentService.updateStatusWithCanHost(enrollmentId, statusValue);
    if (!error) {
      loadEnrollments();
    }
  };


  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'completed': return 'info';
      case 'dropped': return 'danger';
      case 'pending': return 'warning';
      default: return 'default';
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Enrollments Management</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">{enrollments.length} total enrollments</p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyHosting}
              onChange={(e) => setShowOnlyHosting(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Can Host Only</span>
          </label>
          {isTeacher && (
            <Button onClick={() => setIsModalOpen(true)} variant="primary" className="w-full sm:w-auto">
              <span className="mr-2">+</span> Enroll Student
            </Button>
          )}
        </div>
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">
            ⚠️ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by student name, course, or status..."
        />
        
        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="dropped">Dropped</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'student' | 'course' | 'date' | 'status' | 'canHost')}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="student">Student Name</option>
              <option value="course">Course</option>
              <option value="date">Enrollment Date</option>
              <option value="status">Status</option>
              <option value="canHost">Can Host</option>
            </select>
          </div>
          
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 transition"
            title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
          >
            {sortOrder === 'asc' ? '↑ A-Z' : '↓ Z-A'}
          </button>
          
          <div className="text-sm text-gray-600">
            Showing {filteredEnrollments.length} of {enrollments.length} enrollments
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">Loading enrollments...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {filteredEnrollments.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchQuery
                ? 'No enrollments found matching your search.'
                : 'No enrollments found. Click "Enroll Student" to get started.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-gray-100 select-none">
                    <div className="flex items-center gap-1" onClick={() => toggleSort('student')}>
                      Student
                      {sortBy === 'student' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-gray-100 select-none">
                    <div className="flex items-center gap-1" onClick={() => toggleSort('course')}>
                      Course
                      {sortBy === 'course' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead className="cursor-pointer hover:bg-gray-100 select-none">
                    <div className="flex items-center gap-1" onClick={() => toggleSort('date')}>
                      Enrollment Date
                      {sortBy === 'date' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-gray-100 select-none">
                    <div className="flex items-center gap-1" onClick={() => toggleSort('status')}>
                      Status
                      {sortBy === 'status' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-gray-100 select-none text-center">
                    <div className="flex items-center justify-center gap-1" onClick={() => toggleSort('canHost')}>
                      Can Host
                      {sortBy === 'canHost' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnrollments.map((enrollment) => (
                  <TableRow key={enrollment.enrollment_id}>
                    <TableCell className="font-medium text-gray-900">
                      {enrollment.student.name}
                      <div className="text-sm text-gray-500">{enrollment.student.email}</div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {enrollment.session.course.course_name}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {new Date(enrollment.session.start_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {new Date(enrollment.enrollment_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(enrollment.status)}>
                        {enrollment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {isTeacher ? (
                        enrollment.status === 'active' ? (
                          <button
                            onClick={async () => {
                              const newValue = !enrollment.can_host;
                              const { error } = await enrollmentService.update(enrollment.enrollment_id, { can_host: newValue });
                              if (!error) loadEnrollments();
                            }}
                            className={`inline-flex items-center justify-center h-8 w-8 rounded-full cursor-pointer transition ${
                              enrollment.can_host 
                                ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            }`}
                            title={enrollment.can_host ? 'Click to mark as former host' : 'Click to mark as active host'}
                          >
                            {enrollment.can_host ? '✓' : '—'}
                          </button>
                        ) : (
                          <span className="text-gray-300" title={`Cannot host (status: ${enrollment.status})`}>✕</span>
                        )
                      ) : (
                        <span className="text-gray-400">{enrollment.can_host ? '✓' : '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                                    <div className="flex gap-2 justify-end">
                                      {isTeacher && (
                                        <>
                                          <button
                                            className="text-sm border rounded px-2 py-1 bg-white hover:bg-gray-50"
                                            onClick={() => {
                                              setEditingEnrollment(enrollment);
                                              setIsModalOpen(true);
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <select
                                            className="text-sm border rounded px-2 py-1"
                                            value={enrollment.status}
                                            onChange={(e) => handleUpdateStatus(enrollment.enrollment_id, e.target.value)}
                                          >
                                            <option value="active">Active</option>
                                            <option value="pending">Pending</option>
                                        <option value="completed">Completed</option>
                                        <option value="dropped">Dropped</option>
                                      </select>
                                        </>
                                      )}
                                      {!isTeacher && (
                                        <span className="text-xs text-gray-400 px-2">View only</span>
                                      )}
                                    </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Enroll Student in Session"
      >
        <EnrollmentForm
          onSubmit={editingEnrollment ? handleUpdateEnrollment : handleAddEnrollment}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingEnrollment(null);
          }}
          initialData={editingEnrollment ? {
            student_id: (editingEnrollment as EnrollmentWithDetails & { student_id?: string }).student_id || undefined,
            session_id: (editingEnrollment as EnrollmentWithDetails & { session_id?: string }).session_id || undefined,
            enrollment_date: editingEnrollment.enrollment_date,
            status: editingEnrollment.status as 'active' | 'completed' | 'dropped' | 'pending',
            can_host: (editingEnrollment as EnrollmentWithDetails & { can_host?: boolean }).can_host,
          } : null}
        />
      </Modal>
    </div>
  );
}
