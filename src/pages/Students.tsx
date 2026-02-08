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
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { useDebounce } from '../hooks/useDebounce';
import type { Student, CreateStudent } from '../types/database.types';
import { TableSkeleton } from '../components/ui/Skeleton';

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | undefined>();
  const [photoStudent, setPhotoStudent] = useState<Student | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const { isTeacher } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'email' | 'phone' | 'nationality' | 'age'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);

  const loadStudents = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await studentService.getAll();
    if (fetchError) {
      setError('Failed to load students. Please try again.');
      console.error('Load students error:', fetchError);
    } else if (data) {
      setStudents(data as Student[]);
      setFilteredStudents(data as Student[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStudents();
  }, []);

  useEffect(() => {
    let result = [...students];
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.email.toLowerCase().includes(query) ||
          s.phone?.toLowerCase().includes(query) ||
          s.nationality?.toLowerCase().includes(query)
      );
    }
    // Apply sorting
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'age') {
        cmp = (a.age || 0) - (b.age || 0);
      } else {
        const aVal = (a[sortField] || '').toLowerCase();
        const bVal = (b[sortField] || '').toLowerCase();
        cmp = aVal.localeCompare(bVal);
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
    setFilteredStudents(result);
    setCurrentPage(1);
  }, [debouncedSearch, students, sortField, sortDirection]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortIcon = (field: typeof sortField) => (
    <svg className={`w-3 h-3 inline ml-1 ${sortField === field ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {sortField === field && sortDirection === 'desc'
        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />}
    </svg>
  );

  async function handleAddStudent(data: CreateStudent) {
    const { error } = await studentService.create(data);
    if (error) {
      toast.error('Failed to add student: ' + error.message);
    } else {
      toast.success('Student added successfully');
      setIsModalOpen(false);
      loadStudents();
    }
  }

  async function handleUpdateStudent(data: CreateStudent) {
    if (editingStudent) {
      const { error } = await studentService.update(editingStudent.student_id, data);
      if (error) {
        toast.error('Failed to update student: ' + error.message);
      } else {
        toast.success('Student updated successfully');
        setIsModalOpen(false);
        setEditingStudent(undefined);
        loadStudents();
      }
    }
  }

  async function handleDeleteStudent() {
    if (!deletingStudent) return;
    const { error } = await studentService.delete(deletingStudent.student_id);
    if (error) {
      toast.error('Failed to delete student: ' + error.message);
    } else {
      toast.success(`"${deletingStudent.name}" deleted successfully`);
      loadStudents();
    }
    setDeletingStudent(null);
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
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-pulse">
          <div className="space-y-2">
            <div className="h-8 w-56 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
          <TableSkeleton rows={8} columns={7} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Students Management</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{students.length} total students</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Student
          </Button>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <p className="text-amber-700 dark:text-amber-300 text-sm">
            You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            <button 
              onClick={loadStudents} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search students by name, email, phone, or nationality..."
        />
      </div>

      {/* Students Table */}
      {filteredStudents.length === 0 ? (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 py-16 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400">
              {searchQuery
                ? 'No students found matching your search.'
                : 'No students found. Click "Add Student" to get started.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-700/95 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="whitespace-nowrap w-12">Photo</TableHead>
                  <TableHead className="whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden md:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('phone')}>Phone{sortIcon('phone')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('nationality')}>Nationality{sortIcon('nationality')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden xl:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('age')}>Age{sortIcon('age')}</TableHead>
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
                      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{student.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 md:hidden">{student.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[200px]">{student.email}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{student.phone || '-'}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{student.nationality || '-'}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden xl:table-cell">{student.age || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isTeacher && (
                            <>
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
                              <button
                                onClick={() => setDeletingStudent(student)}
                                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete student"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {!isTeacher && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 px-2">View only</span>
                          )}
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

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingStudent}
        title="Delete Student"
        message={`Are you sure you want to delete "${deletingStudent?.name}"? This action cannot be undone and will remove all associated records.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteStudent}
        onCancel={() => setDeletingStudent(null)}
      />
    </div>
  );
}
