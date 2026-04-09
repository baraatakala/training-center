import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { SearchBar } from '@/shared/components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/components/ui/Table';
import { Pagination } from '@/shared/components/ui/Pagination';
import { StudentForm } from '@/features/students/components/StudentForm';
import { PhotoAvatar } from '@/shared/components/PhotoAvatar';
import { studentService } from '@/features/students/services/studentService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import type { Student, CreateStudent } from '@/shared/types/database.types';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import { Specializations } from '@/features/specializations/pages/Specializations';
import { StudentDetailModal } from '@/features/students/components/StudentDetailModal';

const PhotoUpload = lazy(() => import('@/features/students/components/PhotoUpload').then((module) => ({ default: module.PhotoUpload })));
const Certificates = lazy(() => import('@/features/certificates/pages/Certificates').then((module) => ({ default: module.Certificates })));

type Tab = 'students' | 'specializations' | 'certificates';

export function Students() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'students';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | undefined>();
  const [photoStudent, setPhotoStudent] = useState<Student | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'email' | 'phone' | 'nationality' | 'specialization' | 'age'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [detailStudent, setDetailStudent] = useState<Student | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await studentService.getAll();
    if (fetchError) {
      setError('Failed to load students. Please try again.');
      toast.error('Failed to load students');
      console.error('Load students error:', fetchError);
    } else if (data) {
      setStudents(data as Student[]);
    }
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadStudents);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const filteredStudents = useMemo(() => {
    let result = [...students];
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.email.toLowerCase().includes(query) ||
          s.phone?.toLowerCase().includes(query) ||
          s.nationality?.toLowerCase().includes(query) ||
          s.specialization?.toLowerCase().includes(query)
      );
    }
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
    return result;
  }, [debouncedSearch, students, sortField, sortDirection]);

  const paginatedStudents = useMemo(
    () => filteredStudents.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredStudents, currentPage, itemsPerPage]
  );

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, sortField, sortDirection]);

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

  const exportToCSV = useCallback(() => {
    const headers = ['Name', 'Email', 'Phone', 'Nationality', 'Specialization', 'Age'];
    const rows = filteredStudents.map(s => [
      s.name,
      s.email,
      s.phone || '',
      s.nationality || '',
      s.specialization || '',
      String(s.age || ''),
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredStudents.length} students to CSV`);
  }, [filteredStudents]);

  const handleDownloadTemplate = async () => {
    const [{ buildImportTemplateWithData }, XLSX] = await Promise.all([
      import('@/features/data-import/services/masterDataImportService'),
      import('xlsx'),
    ]);
    const workbook = await buildImportTemplateWithData('students');
    XLSX.writeFile(workbook, 'students-import-template.xlsx');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const { parseImportFile, importMasterData } = await import('@/features/data-import/services/masterDataImportService');
      const rows = await parseImportFile(file);
      if (rows.length === 0) { toast.error('File contains no data rows.'); return; }
      const result = await importMasterData('students', rows);
      if (result.errors.length > 0) {
        toast.warning(`Import done with ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      } else if (result.created === 0 && result.updated > 0) {
        toast.info(`${result.updated} existing student(s) updated. No new students created — the imported data matched existing records.`);
      } else {
        toast.success(`${result.created} created, ${result.updated} updated.`);
      }
      loadStudents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

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

  if (loading && activeTab === 'students') {
    return (
      <div className="space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-4" aria-label="Tabs">
            <button onClick={() => setActiveTab('students')} className="px-1 pb-3 text-sm font-semibold border-b-2 border-blue-500 text-blue-600 dark:text-blue-400">Students</button>
            <button onClick={() => setActiveTab('specializations')} className="px-1 pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300">Specializations</button>
            <button onClick={() => setActiveTab('certificates')} className="px-1 pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300">Certificates</button>
          </nav>
        </div>
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
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-4" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('students')}
            className={`px-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'students'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              Students
            </span>
          </button>
          <button
            onClick={() => setActiveTab('specializations')}
            className={`px-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'specializations'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
              Specializations
            </span>
          </button>
          <button
            onClick={() => setActiveTab('certificates')}
            className={`px-1 pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'certificates'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
              Certificates
            </span>
          </button>
        </nav>
      </div>

      {/* Specializations Tab */}
      {activeTab === 'specializations' && <Specializations />}

      {/* Certificates Tab */}
      {activeTab === 'certificates' && (
        <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
          <Certificates embedded />
        </Suspense>
      )}

      {/* Students Tab */}
      {activeTab === 'students' && (
      <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Students Management</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{students.length} total students</p>
        </div>
        {isTeacher && (
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <Button onClick={handleDownloadTemplate} variant="outline" className="w-full min-w-0 gap-2 text-xs sm:text-sm" title="Download import template">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              <span className="truncate">Template</span>
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={importing} variant="outline" className="w-full min-w-0 gap-2 text-xs sm:text-sm" title="Import from CSV/Excel">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <span className="truncate">{importing ? 'Importing...' : 'Import'}</span>
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <Button onClick={exportToCSV} variant="outline" className="w-full min-w-0 gap-2 text-xs sm:text-sm" title="Export to CSV">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="truncate">Export</span>
            </Button>
            <Button onClick={openAddModal} variant="primary" className="w-full min-w-0 gap-2 text-xs sm:text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              <span className="truncate">Add Student</span>
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
          placeholder="Search students, email, phone, or specialization..."
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
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {paginatedStudents.map((student) => (
              <div key={student.student_id} className="p-4 space-y-4 overflow-hidden cursor-pointer" onClick={() => setDetailStudent(student)}>
                <div className="flex items-start gap-3">
                  <PhotoAvatar
                    photoPath={student.photo_url}
                    name={student.name}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">{student.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 break-all">{student.email}</p>
                      </div>
                      {student.specialization && (
                        <span className="w-fit max-w-full rounded-full bg-blue-50 dark:bg-blue-900/20 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-300 break-words">
                          {student.specialization}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide">Phone</p>
                        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 break-words">{student.phone || '-'}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide">Nationality</p>
                        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 break-words">{student.nationality || '-'}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide">Age</p>
                        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{student.age || '-'}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide">Status</p>
                        <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{student.photo_url ? 'Photo ready' : 'No photo'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => {
                          setPhotoStudent(student);
                          setIsPhotoModalOpen(true);
                        }}
                        className={`w-full px-3 py-2 text-sm rounded-lg border ${
                          student.photo_url
                            ? 'text-green-600 border-green-300 bg-green-50 hover:bg-green-100 dark:text-green-400 dark:border-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40'
                            : 'text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100 dark:text-orange-400 dark:border-orange-700 dark:bg-orange-900/20 dark:hover:bg-orange-900/40'
                        }`}
                      >
                        {student.photo_url ? 'Update Photo' : 'Add Photo'}
                      </button>
                      <Button size="sm" variant="secondary" onClick={() => openEditModal(student)} className="w-full justify-center">
                        Edit Student
                      </Button>
                      <button
                        onClick={() => setDeletingStudent(student)}
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

          <div className="hidden md:block overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-700/95 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="whitespace-nowrap w-12">Photo</TableHead>
                  <TableHead className="whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden md:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('phone')}>Phone{sortIcon('phone')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('nationality')}>Nationality{sortIcon('nationality')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden xl:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('specialization')}>Specialization{sortIcon('specialization')}</TableHead>
                  <TableHead className="whitespace-nowrap hidden xl:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('age')}>Age{sortIcon('age')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedStudents.map((student) => (
                    <TableRow key={student.student_id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors" onClick={() => setDetailStudent(student)}>
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
                          {student.specialization && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 xl:hidden">{student.specialization}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[200px]">{student.email}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{student.phone || '-'}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden lg:table-cell whitespace-nowrap">{student.nationality || '-'}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden xl:table-cell whitespace-nowrap">{student.specialization || '-'}</TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden xl:table-cell">{student.age || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => {
                                  setPhotoStudent(student);
                                  setIsPhotoModalOpen(true);
                                }}
                                className={`px-2.5 md:px-3 py-1.5 text-xs md:text-sm rounded border min-h-[36px] ${
                                  student.photo_url 
                                    ? 'text-green-600 border-green-300 bg-green-50 hover:bg-green-100 dark:text-green-400 dark:border-green-700 dark:bg-green-900/20 dark:hover:bg-green-900/40' 
                                    : 'text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100 dark:text-orange-400 dark:border-orange-700 dark:bg-orange-900/20 dark:hover:bg-orange-900/40'
                                }`}
                                title={student.photo_url ? 'Update photo' : 'Add photo for face check-in'}
                                aria-label={`${student.photo_url ? 'Update' : 'Add'} photo for ${student.name}`}
                              >
                                📸
                              </button>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={() => openEditModal(student)} 
                                className="text-xs md:text-sm px-2.5 md:px-3 py-1.5 min-h-[36px]"
                                aria-label={`Edit ${student.name}`}
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingStudent(student)}
                                className="px-2.5 md:px-3 py-1.5 text-xs md:text-sm rounded border min-h-[36px] text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete student"
                                aria-label={`Delete ${student.name}`}
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
          <Suspense fallback={<div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading photo tools...</div>}>
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
                // Update photoStudent for the modal
                setPhotoStudent(prev => prev ? { ...prev, photo_url: url || null } : undefined);
                toast.success(url ? 'Photo updated successfully' : 'Photo removed');
              }}
            />
          </Suspense>
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
      {detailStudent && (
        <StudentDetailModal student={detailStudent} onClose={() => setDetailStudent(null)} />
      )}
      </>
      )}
    </div>
  );
}
