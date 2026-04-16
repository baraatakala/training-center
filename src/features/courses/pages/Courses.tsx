import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Modal } from '@/shared/components/ui/Modal';
import { SearchBar } from '@/shared/components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/components/ui/Table';
import { Pagination } from '@/shared/components/ui/Pagination';
import { CourseForm } from '@/features/courses/components/CourseForm';
import { BookReferencesManager } from '@/features/courses/components/BookReferencesManager';
import { courseService } from '@/features/courses/services/courseService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import type { CreateCourse } from '@/shared/types/database.types';

interface CourseWithTeacher {
  course_id: string;
  teacher_id: string;
  course_name: string;
  category: string;
  description?: string | null;
  description_format?: 'markdown' | 'plain_text' | null;
  description_updated_at?: string | null;
  teacher: {
    name: string;
    email: string;
  };
}

function getDescriptionPreview(description?: string | null) {
  if (!description) return '';
  return description
    .replace(/[#*_`>-]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function Courses() {
  const [courses, setCourses] = useState<CourseWithTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseWithTeacher | undefined>();
  const [isBookReferencesOpen, setIsBookReferencesOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseWithTeacher | null>(null);
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<CourseWithTeacher | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [sortField, setSortField] = useState<'course_name' | 'category' | 'teacher'>('course_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const categories = useMemo(() => {
    const cats = [...new Set(courses.map(c => c.category).filter(Boolean))].sort();
    return cats;
  }, [courses]);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await courseService.getAll();
    if (fetchError) {
      setError('Failed to load courses. Please try again.');
      toast.error('Failed to load courses');
      console.error('Load courses error:', fetchError);
    } else if (data) {
      setCourses(data as CourseWithTeacher[]);
    }
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadCourses);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  const filteredCourses = useMemo(() => {
    let result = [...courses];
    if (selectedCategory !== 'all') {
      result = result.filter(c => c.category === selectedCategory);
    }
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.course_name.toLowerCase().includes(query) ||
          (c.category || '').toLowerCase().includes(query) ||
          (c.teacher?.name && c.teacher.name.toLowerCase().includes(query)) ||
          (c.description || '').toLowerCase().includes(query)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'teacher') {
        const aVal = (a.teacher?.name || '').toLowerCase();
        const bVal = (b.teacher?.name || '').toLowerCase();
        cmp = aVal.localeCompare(bVal);
      } else {
        const aVal = (a[sortField] || '').toLowerCase();
        const bVal = (b[sortField] || '').toLowerCase();
        cmp = aVal.localeCompare(bVal);
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [debouncedSearch, courses, sortField, sortDirection, selectedCategory]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, sortField, sortDirection, selectedCategory]);

  const exportToCSV = useCallback(() => {
    const headers = ['course_name', 'category', 'teacher_email', 'description', 'description_format'];
    const rows = filteredCourses.map(c => [
      c.course_name,
      c.category || '',
      c.teacher?.email || '',
      c.description || '',
      c.description_format || '',
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(col => `"${col.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `courses-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredCourses.length} courses to CSV`);
  }, [filteredCourses]);

  const handleDownloadTemplate = async () => {
    const [{ buildImportTemplateWithData }, XLSX] = await Promise.all([
      import('@/features/data-import/services/masterDataImportService'),
      import('xlsx'),
    ]);
    const workbook = await buildImportTemplateWithData('courses');
    XLSX.writeFile(workbook, 'courses-import-template.xlsx');
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
      const result = await importMasterData('courses', rows);
      if (result.errors.length > 0) {
        toast.warning(`Import done with ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      } else if (result.created === 0 && result.updated > 0) {
        toast.info(`${result.updated} existing course(s) updated. No new courses created — the imported data matched existing records.`);
      } else {
        toast.success(`${result.created} created, ${result.updated} updated.`);
      }
      loadCourses();
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

  const handleAddCourse = async (data: CreateCourse) => {
    const { error } = await courseService.create(data);
    if (error) {
      toast.error('Failed to add course: ' + error.message);
    } else {
      toast.success('Course added successfully');
      setIsModalOpen(false);
      loadCourses();
    }
  };

  const handleUpdateCourse = async (data: CreateCourse) => {
    if (editingCourse) {
      const { error } = await courseService.update(editingCourse.course_id, data);
      if (error) {
        toast.error('Failed to update course: ' + error.message);
      } else {
        toast.success('Course updated successfully');
        setIsModalOpen(false);
        setEditingCourse(undefined);
        loadCourses();
      }
    }
  };

  const openAddModal = () => {
    setEditingCourse(undefined);
    setIsModalOpen(true);
  };

  const openEditModal = (course: CourseWithTeacher) => {
    setEditingCourse(course);
    setIsModalOpen(true);
  };

  const openBookReferences = (course: CourseWithTeacher) => {
    setSelectedCourse(course);
    setIsBookReferencesOpen(true);
  };

  const handleDeleteCourse = async () => {
    if (!deletingCourse) return;
    const { error } = await courseService.delete(deletingCourse.course_id);
    if (error) {
      toast.error('Failed to delete course: ' + error.message);
    } else {
      toast.success(`"${deletingCourse.course_name}" deleted successfully`);
      loadCourses();
    }
    setDeletingCourse(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Courses Management</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{courses.length} total courses</p>
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
              <span className="truncate">Add Course</span>
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
              onClick={loadCourses} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search courses by name, category, or instructor..."
            />
          </div>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white w-full md:w-48"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <TableSkeleton rows={6} columns={5} />
        </div>
      ) : (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          {filteredCourses.length === 0 ? (
            <div className="py-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? 'No courses found matching your search.'
                    : 'No courses found. Click "Add Course" to get started.'}
                </p>
              </div>
            </div>
          ) : (
            <>
            {/* Mobile card view */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filteredCourses
                .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                .map((course) => (
                <div key={course.course_id} className="p-4 space-y-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white truncate">{course.course_name}</p>
                      <span className="shrink-0 rounded-full bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-300">
                        {course.category || 'Uncategorized'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{course.teacher?.name || 'No instructor'}</p>
                    {course.description && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">{getDescriptionPreview(course.description)}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {isTeacher && (
                      <button
                        onClick={() => openBookReferences(course)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                      >
                        📚 Book References
                      </button>
                    )}
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => openEditModal(course)} className="w-full justify-center">
                          Edit Course
                        </Button>
                        <button
                          onClick={() => setDeletingCourse(course)}
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
                    <TableHead className="whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('course_name')}>Course Name{sortIcon('course_name')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('category')}>Category{sortIcon('category')}</TableHead>
                    <TableHead className="whitespace-nowrap hidden md:table-cell cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400" onClick={() => toggleSort('teacher')}>Instructor{sortIcon('teacher')}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCourses
                    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                    .map((course) => (
                    <TableRow key={course.course_id}>
                      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{course.course_name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 md:hidden">{course.teacher?.name || 'No instructor'}</span>
                          {course.description && (
                            <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {getDescriptionPreview(course.description)}
                              {course.description.length > 140 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="info">{course.category || 'Uncategorized'}</Badge>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{course.teacher?.name || 'No instructor'}</span>
                          {course.description_updated_at && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Description updated {new Date(course.description_updated_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isTeacher && (
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => openBookReferences(course)}
                                className="text-xs md:text-sm px-2.5 md:px-3 py-1.5 min-h-[36px]"
                                aria-label={`Manage book references for ${course.course_name}`}
                                title="Manage book references"
                              >
                                📚
                              </Button>
                          )}
                          {isAdmin && (
                            <>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={() => openEditModal(course)} 
                                className="text-xs md:text-sm px-2.5 md:px-3 py-1.5 min-h-[36px]"
                                aria-label={`Edit ${course.course_name}`}
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingCourse(course)}
                                className="px-2.5 md:px-3 py-1.5 text-xs md:text-sm rounded border min-h-[36px] text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete course"
                                aria-label={`Delete ${course.course_name}`}
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

            {filteredCourses.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(filteredCourses.length / itemsPerPage)}
                totalItems={filteredCourses.length}
                itemsPerPage={itemsPerPage}
                onPageChange={(page) => setCurrentPage(page)}
                onItemsPerPageChange={(items) => {
                  setItemsPerPage(items);
                  setCurrentPage(1);
                }}
              />
            )}
            </>
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingCourse(undefined);
        }}
        title={editingCourse ? 'Edit Course' : 'Add New Course'}
      >
        <CourseForm
          course={editingCourse}
          onSubmit={editingCourse ? handleUpdateCourse : handleAddCourse}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCourse(undefined);
          }}
        />
      </Modal>

      <Modal
        isOpen={isBookReferencesOpen}
        onClose={() => {
          setIsBookReferencesOpen(false);
          setSelectedCourse(null);
        }}
        title="Manage Book References"
        size="xl"
      >
        {selectedCourse && (
          <BookReferencesManager
            courseId={selectedCourse.course_id}
            courseName={selectedCourse.course_name}
            onClose={() => {
              setIsBookReferencesOpen(false);
              setSelectedCourse(null);
            }}
          />
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingCourse}
        title="Delete Course"
        message={`Are you sure you want to delete "${deletingCourse?.course_name}"? This will also remove all associated sessions and enrollments.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteCourse}
        onCancel={() => setDeletingCourse(null)}
      />
    </div>
  );
}
