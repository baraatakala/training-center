import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import { StudentForm } from '../components/StudentForm';
import { PhotoUpload } from '../components/PhotoUpload';
import { PhotoAvatar } from '../components/PhotoAvatar';
import { studentService } from '../services/studentService';
import type { Student, CreateStudent } from '../types/database.types';

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | undefined>();
  const [photoStudent, setPhotoStudent] = useState<Student | undefined>();
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
    <div className="space-y-4 md:space-y-6 p-4 md:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Students Management</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{students.length} total students</p>
        </div>
        <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto">
          <span className="mr-2">+</span> Add Student
        </Button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 md:p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search students..."
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
                  <TableHead className="whitespace-nowrap w-12">Photo</TableHead>
                  <TableHead className="whitespace-nowrap">Name</TableHead>
                  <TableHead className="whitespace-nowrap hidden md:table-cell">Email</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell">Nationality</TableHead>
                  <TableHead className="whitespace-nowrap hidden xl:table-cell">Age</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((student) => (
                    <TableRow key={student.student_id}>
                      <TableCell className="w-12">
                        <PhotoAvatar 
                          photoPath={student.photo_url} 
                          name={student.name} 
                          size="md"
                        />
                      </TableCell>
                      <TableCell className="font-medium text-gray-900 min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{student.name}</span>
                          <span className="text-xs text-gray-500 md:hidden">{student.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 hidden md:table-cell min-w-[200px]">{student.email}</TableCell>
                      <TableCell className="text-gray-600 hidden lg:table-cell whitespace-nowrap">{student.phone || '-'}</TableCell>
                      <TableCell className="text-gray-600 hidden lg:table-cell whitespace-nowrap">{student.nationality || '-'}</TableCell>
                      <TableCell className="text-gray-600 hidden xl:table-cell">{student.age || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          <button
                            onClick={() => {
                              setPhotoStudent(student);
                              setIsPhotoModalOpen(true);
                            }}
                            className={`px-2 md:px-3 py-1 text-xs md:text-sm rounded border ${
                              student.photo_url 
                                ? 'text-green-600 border-green-300 bg-green-50 hover:bg-green-100' 
                                : 'text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100'
                            }`}
                            title={student.photo_url ? 'Update photo' : 'Add photo for face check-in'}
                          >
                            📸
                          </button>
                          <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={() => openEditModal(student)} 
                            className="text-xs md:text-sm px-2 md:px-3"
                          >
                            Edit
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

      {/* Photo Upload Modal */}
      <Modal
        isOpen={isPhotoModalOpen}
        onClose={() => {
          setIsPhotoModalOpen(false);
          setPhotoStudent(undefined);
        }}
        title={`Photo for ${photoStudent?.name || 'Student'}`}
      >
        {photoStudent && (
          <PhotoUpload
            studentId={photoStudent.student_id}
            currentPhotoUrl={photoStudent.photo_url}
            onPhotoUploaded={(url) => {
              // Update local state
              setStudents(prev => 
                prev.map(s => 
                  s.student_id === photoStudent.student_id 
                    ? { ...s, photo_url: url || null }
                    : s
                )
              );
              setFilteredStudents(prev =>
                prev.map(s =>
                  s.student_id === photoStudent.student_id
                    ? { ...s, photo_url: url || null }
                    : s
                )
              );
              // Update photoStudent for the modal
              setPhotoStudent(prev => prev ? { ...prev, photo_url: url || null } : undefined);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
