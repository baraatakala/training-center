import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { TeacherForm } from '../components/TeacherForm';
import { Badge } from '../components/ui/Badge';
import { Pagination } from '../components/ui/Pagination';
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
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'email' | 'phone' | 'specialization' | 'enrolledCount'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [deletingTeacher, setDeletingTeacher] = useState<Teacher | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const loadTeachers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await teacherService.getAll();
    if (fetchError) {
      setError('Failed to load teachers. Please try again.');
      toast.error('Failed to load teachers');
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
  }, [loadTeachers]);

  const filteredTeachers = useMemo(() => {
    let result = [...teachers];
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.email.toLowerCase().includes(query) ||
          t.phone?.toLowerCase().includes(query) ||
          t.specialization?.toLowerCase().includes(query)
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

  // Reset page when search changes
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch]);

  const paginatedTeachers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTeachers.slice(start, start + itemsPerPage);
  }, [filteredTeachers, currentPage, itemsPerPage]);

  const exportToCSV = useCallback(() => {
    const headers = ['Name', 'Email', 'Phone', 'Specialization', 'Enrolled Students'];
    const rows = filteredTeachers.map(t => [
      t.name,
      t.email,
      t.phone || '',
      t.specialization || '',
      String(t.enrolledCount || 0),
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teachers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredTeachers.length} teachers to CSV`);
  }, [filteredTeachers]);

  const handleDownloadTemplate = async () => {
    const [{ buildImportTemplateWithData }, XLSX] = await Promise.all([
      import('../services/masterDataImportService'),
      import('xlsx'),
    ]);
    const workbook = await buildImportTemplateWithData('teachers');
    XLSX.writeFile(workbook, 'teachers-import-template.xlsx');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const { parseImportFile, importMasterData } = await import('../services/masterDataImportService');
      const rows = await parseImportFile(file);
      if (rows.length === 0) { toast.error('File contains no data rows.'); return; }
      const result = await importMasterData('teachers', rows);
      if (result.errors.length > 0) {
        toast.warning(`Import done with ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      } else {
        toast.success(`${result.created + result.updated} teacher(s) imported successfully.`);
      }
      loadTeachers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

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
          <div className="flex gap-2 w-full sm:w-auto">
            <Button onClick={handleDownloadTemplate} variant="outline" className="flex-1 sm:flex-initial gap-2 text-xs sm:text-sm" title="Download import template">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={importing} variant="outline" className="flex-1 sm:flex-initial gap-2 text-xs sm:text-sm" title="Import from CSV/Excel">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              {importing ? 'Importing...' : 'Import'}
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <Button onClick={exportToCSV} variant="outline" className="flex-1 sm:flex-initial gap-2 text-xs sm:text-sm" title="Export to CSV">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Export
            </Button>
            <Button onClick={openAddModal} variant="primary" className="flex-1 sm:flex-initial gap-2 text-xs sm:text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Teacher
            </Button>
          </div>
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
          <TableSkeleton rows={6} columns={6} />
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
            <>
              {/* Mobile card view */}
              <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {paginatedTeachers.map((teacher) => (
                  <div key={teacher.teacher_id} className="p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-lg shrink-0">
                        {teacher.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">{teacher.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 break-all">{teacher.email}</p>
                        {teacher.specialization && (
                          <span className="inline-block mt-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
                            {teacher.specialization}
                          </span>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide">Phone</p>
                            <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 break-words">{teacher.phone || '-'}</p>
                          </div>
                          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide">Students</p>
                            <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{teacher.enrolledCount || 0}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => openEditModal(teacher)} className="w-full justify-center">
                            Edit Teacher
                          </Button>
                          <button
                            onClick={() => setDeletingTeacher(teacher)}
                            className="w-full px-3 py-2 text-sm rounded-lg border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {!isTeacher && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 px-2 py-2">View only</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden md:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('phone')}>Phone{sortIcon('phone')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden xl:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('specialization')}>Specialization{sortIcon('specialization')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden sm:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('enrolledCount')}>Enrolled Students{sortIcon('enrolledCount')}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {paginatedTeachers.map((teacher) => (
                    <TableRow key={teacher.teacher_id}>
                      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{teacher.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 md:hidden">{teacher.email}</span>
                          {teacher.specialization && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 xl:hidden">{teacher.specialization}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[200px]">{teacher.email}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{teacher.phone || '-'}</TableCell>
                      <TableCell className="hidden xl:table-cell text-gray-600 dark:text-gray-300 max-w-[220px]">
                        {teacher.specialization ? (
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                            {teacher.specialization}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="info">
                          {teacher.enrolledCount || 0} students
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isAdmin && (
                            <>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={() => openEditModal(teacher)} 
                                className="text-xs md:text-sm px-2.5 md:px-3 py-1.5 min-h-[36px]"
                                aria-label={`Edit ${teacher.name}`}
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingTeacher(teacher)}
                                className="px-2.5 md:px-3 py-1.5 text-xs md:text-sm rounded border min-h-[36px] text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete teacher"
                                aria-label={`Delete ${teacher.name}`}
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
            </>
          )}
          {filteredTeachers.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredTeachers.length / itemsPerPage)}
              totalItems={filteredTeachers.length}
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
