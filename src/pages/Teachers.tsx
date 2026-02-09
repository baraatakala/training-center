import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { TeacherForm } from '../components/TeacherForm';
import { Badge } from '../components/ui/Badge';
import { teacherService } from '../services/teacherService';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { useDebounce } from '../hooks/useDebounce';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import type { Teacher, CreateTeacher } from '../types/database.types';
import { TableSkeleton } from '../components/ui/Skeleton';

interface TeacherWithCount extends Teacher {
  enrolledCount?: number;
}

export function Teachers() {
  const [teachers, setTeachers] = useState<TeacherWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | undefined>();
  const { isTeacher } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'email' | 'phone' | 'enrolledCount'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [deletingTeacher, setDeletingTeacher] = useState<Teacher | null>(null);

  const loadTeachers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await teacherService.getAll();
    if (fetchError) {
      setError('Failed to load teachers. Please try again.');
      console.error('Load teachers error:', fetchError);
      setLoading(false);
      return;
    }
    if (data) {
      // Batch fetch enrolled student counts in 3 queries (instead of 3*N)
      const countsMap = await teacherService.getAllEnrolledStudentCounts();
      const teachersWithCounts = data.map((teacher) => ({
        ...teacher,
        enrolledCount: countsMap.get(teacher.teacher_id) || 0,
      }));
      setTeachers(teachersWithCounts);
    }
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadTeachers);

  useEffect(() => {
    loadTeachers();
  }, []);

  const filteredTeachers = useMemo(() => {
    let result = [...teachers];
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.email.toLowerCase().includes(query) ||
          t.phone?.toLowerCase().includes(query)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'enrolledCount') {
        cmp = (a.enrolledCount || 0) - (b.enrolledCount || 0);
      } else {
        const aVal = (a[sortField] || '').toLowerCase();
        const bVal = (b[sortField] || '').toLowerCase();
        cmp = aVal.localeCompare(bVal);
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [debouncedSearch, teachers, sortField, sortDirection]);

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

  const handleAddTeacher = async (data: CreateTeacher) => {
    const { error } = await teacherService.create(data);
    if (error) {
      toast.error('Failed to add teacher: ' + error.message);
    } else {
      toast.success('Teacher added successfully');
      setIsModalOpen(false);
      loadTeachers();
    }
  };

  const handleUpdateTeacher = async (data: CreateTeacher) => {
    if (editingTeacher) {
      const { error } = await teacherService.update(editingTeacher.teacher_id, data);
      if (error) {
        toast.error('Failed to update teacher: ' + error.message);
      } else {
        toast.success('Teacher updated successfully');
        setIsModalOpen(false);
        setEditingTeacher(undefined);
        loadTeachers();
      }
    }
  };

  const handleDeleteTeacher = async () => {
    if (!deletingTeacher) return;
    const { error } = await teacherService.delete(deletingTeacher.teacher_id);
    if (error) {
      toast.error('Failed to delete teacher: ' + error.message);
    } else {
      toast.success(`"${deletingTeacher.name}" deleted successfully`);
      loadTeachers();
    }
    setDeletingTeacher(null);
  };

  const openAddModal = () => {
    setEditingTeacher(undefined);
    setIsModalOpen(true);
  };

  const openEditModal = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Teachers Management</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{teachers.length} total teachers</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Teacher
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
              onClick={loadTeachers} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search teachers by name, email, or phone..."
        />
      </div>

      {loading ? (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <TableSkeleton rows={6} columns={5} />
        </div>
      ) : (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          {filteredTeachers.length === 0 ? (
            <div className="py-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? 'No teachers found matching your search.'
                    : 'No teachers found. Click "Add Teacher" to get started.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden md:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('phone')}>Phone{sortIcon('phone')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden sm:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('enrolledCount')}>Enrolled Students{sortIcon('enrolledCount')}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeachers.map((teacher) => (
                    <TableRow key={teacher.teacher_id}>
                      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{teacher.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 md:hidden">{teacher.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[200px]">{teacher.email}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{teacher.phone || '-'}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="info">
                          {teacher.enrolledCount || 0} students
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isTeacher && (
                            <>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={() => openEditModal(teacher)} 
                                className="text-xs md:text-sm px-2 md:px-3"
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingTeacher(teacher)}
                                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete teacher"
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
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTeacher(undefined);
        }}
        title={editingTeacher ? 'Edit Teacher' : 'Add New Teacher'}
      >
        <TeacherForm
          teacher={editingTeacher}
          onSubmit={editingTeacher ? handleUpdateTeacher : handleAddTeacher}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingTeacher(undefined);
          }}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingTeacher}
        title="Delete Teacher"
        message={`Are you sure you want to delete "${deletingTeacher?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteTeacher}
        onCancel={() => setDeletingTeacher(null)}
      />
    </div>
  );
}
