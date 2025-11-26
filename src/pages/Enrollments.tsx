import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { EnrollmentForm } from '../components/EnrollmentForm';
import { enrollmentService } from '../services/enrollmentService';
import type { CreateEnrollment } from '../types/database.types';

interface EnrollmentWithDetails {
  enrollment_id: string;
  enrollment_date: string;
  status: string;
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
    loadEnrollments();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredEnrollments(
        enrollments.filter(
          (e) =>
            e.student.name.toLowerCase().includes(query) ||
            e.session.course.course_name.toLowerCase().includes(query) ||
            e.status.toLowerCase().includes(query)
        )
      );
    } else {
      setFilteredEnrollments(enrollments);
    }
  }, [searchQuery, enrollments]);

  const handleAddEnrollment = async (data: CreateEnrollment) => {
    const { error } = await enrollmentService.create(data);
    if (error) {
      alert('Error enrolling student: ' + error.message);
    } else {
      setIsModalOpen(false);
      loadEnrollments();
    }
  };

  const handleUpdateStatus = async (enrollmentId: string, newStatus: string) => {
    const { error } = await enrollmentService.updateStatus(enrollmentId, newStatus as 'active' | 'completed' | 'dropped' | 'pending');
    if (!error) {
      loadEnrollments();
    }
  };

  const handleDeleteEnrollment = async (enrollmentId: string) => {
    if (confirm('Are you sure you want to delete this enrollment?')) {
      const { error } = await enrollmentService.delete(enrollmentId);
      if (!error) {
        loadEnrollments();
      }
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
        <Button onClick={() => setIsModalOpen(true)} variant="primary" className="w-full sm:w-auto">
          <span className="mr-2">+</span> Enroll Student
        </Button>
      </div>

      <div className="bg-white p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by student name, course, or status..."
        />
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
                  <TableHead>Student</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Enrollment Date</TableHead>
                  <TableHead>Status</TableHead>
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
                    <TableCell>
                      <div className="flex gap-2 justify-end">
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
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteEnrollment(enrollment.enrollment_id)}
                        >
                          Delete
                        </Button>
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
          onSubmit={handleAddEnrollment}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
