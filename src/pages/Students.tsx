import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import { StudentForm } from '../components/StudentForm';
import { studentService } from '../services/studentService';
import type { Student, CreateStudent } from '../types/database.types';

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const loadStudents = async () => {
    setLoading(true);
    const { data } = await studentService.getAll();
    if (data) {
      setStudents(data as Student[]);
      setFilteredStudents(data as Student[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredStudents(
        students.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.email.toLowerCase().includes(query) ||
            s.phone?.toLowerCase().includes(query) ||
            s.nationality?.toLowerCase().includes(query)
        )
      );
    } else {
      setFilteredStudents(students);
    }
  }, [searchQuery, students]);

  async function handleAddStudent(data: CreateStudent) {
    const { error } = await studentService.create(data);
    if (!error) {
      setIsModalOpen(false);
      loadStudents();
    }
  }

  async function handleUpdateStudent(data: CreateStudent) {
    if (editingStudent) {
      const { error } = await studentService.update(editingStudent.student_id, data);
      if (!error) {
        setIsModalOpen(false);
        setEditingStudent(undefined);
        loadStudents();
      }
    }
  }

  async function handleDeleteStudent(studentId: string) {
    if (confirm('Are you sure you want to delete this student?')) {
      const { error } = await studentService.delete(studentId);
      if (!error) {
        loadStudents();
      }
    }
  }

  function openAddModal() {
    setEditingStudent(undefined);
    setIsModalOpen(true);
  }

  function openEditModal(student: Student) {
    setEditingStudent(student);
    setIsModalOpen(true);
  }

  if (loading) {
    return <div className="text-center py-12">Loading students...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Students Management</h1>
          <p className="text-gray-600 mt-1">{students.length} total students</p>
        </div>
        <Button onClick={openAddModal} variant="primary">
          <span className="mr-2">+</span> Add Student
        </Button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name, email, phone, or nationality..."
        />
      </div>

      {/* Students Table */}
      {filteredStudents.length === 0 ? (
        <div className="bg-white rounded-lg shadow py-12 text-center text-gray-500">
          {searchQuery
            ? 'No students found matching your search.'
            : 'No students found. Click "Add Student" to get started.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-gray-50">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Nationality</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((student) => (
                    <TableRow key={student.student_id}>
                      <TableCell className="font-medium text-gray-900">{student.name}</TableCell>
                      <TableCell className="text-gray-600">{student.email}</TableCell>
                      <TableCell className="text-gray-600">{student.phone || '-'}</TableCell>
                      <TableCell className="text-gray-600">{student.nationality || '-'}</TableCell>
                      <TableCell className="text-gray-600">{student.age || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="secondary" onClick={() => openEditModal(student)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteStudent(student.student_id)}
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
          
          {filteredStudents.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredStudents.length / itemsPerPage)}
              totalItems={filteredStudents.length}
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

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingStudent(undefined);
        }}
        title={editingStudent ? 'Edit Student' : 'Add New Student'}
      >
        <StudentForm
          student={editingStudent}
          onSubmit={editingStudent ? handleUpdateStudent : handleAddStudent}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingStudent(undefined);
          }}
        />
      </Modal>
    </div>
  );
}
