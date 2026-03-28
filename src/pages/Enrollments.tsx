import { useEffect, useState, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Modal } from '@/shared/components/ui/Modal';
import { SearchBar } from '@/shared/components/ui/SearchBar';
import { formatDate } from '@/shared/utils/formatDate';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/components/ui/Table';
import { Pagination } from '@/shared/components/ui/Pagination';
import { EnrollmentForm } from '../components/EnrollmentForm';
import { enrollmentService } from '../services/enrollmentService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import type { CreateEnrollment, UpdateEnrollment } from '@/shared/types/database.types';

interface EnrollmentWithDetails {
  enrollment_id: string;
  enrollment_date: string;
  status: string;
  can_host?: boolean | null;
  host_date?: string | null;
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<EnrollmentWithDetails | null>(null);
  const [showOnlyHosting, setShowOnlyHosting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'student' | 'course' | 'date' | 'status' | 'canHost'>('student');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const loadEnrollments = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await enrollmentService.getAll();
    if (fetchError) {
      setError('Failed to load enrollments. Please try again.');
      toast.error('Failed to load enrollments');
      console.error('Load enrollments error:', fetchError);
    } else if (data) {
      setEnrollments(data as EnrollmentWithDetails[]);
    }
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadEnrollments);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  const filteredEnrollments = useMemo(() => {
    let filtered = [...enrollments];
    
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.student.name.toLowerCase().includes(query) ||
          e.session.course.course_name.toLowerCase().includes(query) ||
          e.status.toLowerCase().includes(query)
      );
    }
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter((e) => e.status === statusFilter);
    }
    
    if (showOnlyHosting) {
      filtered = filtered.filter((e) => e.can_host === true);
    }
    
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
          const aHost = a.can_host ? 1 : 0;
          const bHost = b.can_host ? 1 : 0;
          comparison = bHost - aHost;
          break;
        }
        default:
          comparison = a.student.name.localeCompare(b.student.name);
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  }, [debouncedSearch, enrollments, showOnlyHosting, statusFilter, sortBy, sortOrder]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, showOnlyHosting, statusFilter, sortBy, sortOrder]);

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
      toast.error('Error enrolling student: ' + error.message);
    } else {
      toast.success('Student enrolled successfully');
      setIsModalOpen(false);
      loadEnrollments();
    }
  };

  const handleUpdateEnrollment = async (data: CreateEnrollment) => {
    if (!editingEnrollment) return;
    const { error } = await enrollmentService.update(editingEnrollment.enrollment_id, data as UpdateEnrollment);
    if (error) {
      toast.error('Error updating enrollment: ' + error.message);
    } else {
      toast.success('Enrollment updated successfully');
      setIsModalOpen(false);
      setEditingEnrollment(null);
      loadEnrollments();
    }
  };

  const handleUpdateStatus = async (enrollmentId: string, newStatus: string) => {
    const statusValue = newStatus as 'active' | 'completed' | 'dropped' | 'pending';
    const { error } = await enrollmentService.updateStatusWithCanHost(enrollmentId, statusValue);
    if (error) {
      toast.error('Failed to update status: ' + error.message);
    } else {
      toast.success(`Status updated to ${statusValue}`);
      loadEnrollments();
    }
  };


  const handleDelete = (enrollmentId: string) => {
    setDeletingEnrollmentId(enrollmentId);
  };

  const confirmDelete = async () => {
    if (!deletingEnrollmentId) return;
    const { error } = await enrollmentService.delete(deletingEnrollmentId);
    if (error) {
      toast.error('Failed to delete enrollment: ' + error.message);
    } else {
      toast.success('Enrollment deleted successfully');
      loadEnrollments();
    }
    setDeletingEnrollmentId(null);
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

  const exportToCSV = useCallback(() => {
    const headers = ['Student', 'Email', 'Course', 'Enrollment Date', 'Status', 'Can Host', 'Host Date'];
    const rows = filteredEnrollments.map(e => [
      e.student?.name || '',
      e.student?.email || '',
      e.session?.course?.course_name || '',
      e.enrollment_date,
      e.status,
      e.can_host ? 'Yes' : 'No',
      e.host_date || '',
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollments-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredEnrollments.length} enrollments to CSV`);
  }, [filteredEnrollments]);

  const handleDownloadTemplate = async () => {
    const [{ buildImportTemplateWithData }, XLSX] = await Promise.all([
      import('../services/masterDataImportService'),
      import('xlsx'),
    ]);
    const workbook = await buildImportTemplateWithData('enrollments');
    XLSX.writeFile(workbook, 'enrollments-import-template.xlsx');
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setImporting(true);
    try {
      const { parseImportFile, importMasterData } = await import('../services/masterDataImportService');
      const rows = await parseImportFile(file);
      if (rows.length === 0) {
        toast.error('File contains no data rows.');
        return;
      }
      const result = await importMasterData('enrollments', rows);
      if (result.errors.length > 0) {
        toast.warning(`Import done with ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      } else if (result.created === 0 && result.updated > 0) {
        toast.info(`${result.updated} existing enrollment(s) updated. No new enrollments created â€” the imported data matched existing records.`);
      } else {
        toast.success(`${result.created} created, ${result.updated} updated.`);
      }
      loadEnrollments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Enrollments Management</h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">{enrollments.length} total enrollments</p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyHosting}
              onChange={(e) => setShowOnlyHosting(e.target.checked)}
              className="h-4 w-4 dark:bg-gray-700"
            />
            <span className="text-sm font-medium dark:text-gray-300">Can Host Only</span>
          </label>
          {isTeacher && (
            <>
              <Button onClick={handleDownloadTemplate} variant="outline" className="gap-2" title="Download import template">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Template
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={importing} variant="outline" className="gap-2" title="Import from CSV/Excel">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {importing ? 'Importing...' : 'Import'}
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden" onChange={handleImportFile} />
              <Button onClick={exportToCSV} variant="outline" className="gap-2" title="Export to CSV">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Export
              </Button>
              <Button onClick={() => setIsModalOpen(true)} variant="primary" className="w-full sm:w-auto">
                <span className="mr-2">+</span> Enroll Student
              </Button>
            </>
          )}
        </div>
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">
            âš ï¸ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">âŒ {error}</p>
          <button 
            onClick={loadEnrollments} 
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-900/30 space-y-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by student name, course, or status..."
        />
        
        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="dropped">Dropped</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'student' | 'course' | 'date' | 'status' | 'canHost')}
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-label="Sort enrollments by"
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
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition"
            title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
          >
            {sortOrder === 'asc' ? 'â†‘ A-Z' : 'â†“ Z-A'}
          </button>
          
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing {filteredEnrollments.length} of {enrollments.length} enrollments
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
          <TableSkeleton rows={8} columns={7} />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
          {filteredEnrollments.length === 0 ? (
            <div className="py-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? 'No enrollments found matching your search.'
                    : 'No enrollments found. Click "Enroll Student" to get started.'}
                </p>
              </div>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead onClick={() => toggleSort('student')}>
                    <span className="flex items-center gap-1">
                      Student
                      {sortBy === 'student' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? 'â†‘' : 'â†“'}</span>
                      )}
                    </span>
                  </TableHead>
                  <TableHead onClick={() => toggleSort('course')}>
                    <span className="flex items-center gap-1">
                      Course
                      {sortBy === 'course' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? 'â†‘' : 'â†“'}</span>
                      )}
                    </span>
                  </TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead onClick={() => toggleSort('date')}>
                    <span className="flex items-center gap-1">
                      Enrollment Date
                      {sortBy === 'date' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? 'â†‘' : 'â†“'}</span>
                      )}
                    </span>
                  </TableHead>
                  <TableHead onClick={() => toggleSort('status')}>
                    <span className="flex items-center gap-1">
                      Status
                      {sortBy === 'status' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? 'â†‘' : 'â†“'}</span>
                      )}
                    </span>
                  </TableHead>
                  <TableHead onClick={() => toggleSort('canHost')} className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      Can Host
                      {sortBy === 'canHost' && (
                        <span className="text-blue-600">{sortOrder === 'asc' ? 'â†‘' : 'â†“'}</span>
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnrollments
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((enrollment) => (
                  <TableRow key={enrollment.enrollment_id}>
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {enrollment.student.name}
                      <div className="text-sm text-gray-500 dark:text-gray-400">{enrollment.student.email}</div>
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {enrollment.session.course.course_name}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {formatDate(enrollment.session.start_date)}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {formatDate(enrollment.enrollment_date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(enrollment.status)}>
                        {enrollment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {isAdmin ? (
                        enrollment.status === 'active' ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              onClick={async () => {
                                const newValue = !enrollment.can_host;
                                const { error } = await enrollmentService.update(enrollment.enrollment_id, { can_host: newValue });
                                if (error) {
                                  toast.error('Failed to update host status: ' + error.message);
                                } else {
                                  toast.success(`Host status ${newValue ? 'enabled' : 'disabled'}`);
                                  loadEnrollments();
                                }
                              }}
                              className={`inline-flex items-center justify-center h-8 w-8 rounded-full cursor-pointer transition ${
                                enrollment.can_host 
                                  ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60' 
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                              title={enrollment.can_host ? 'Click to mark as former host' : 'Click to mark as active host'}
                            >
                              {enrollment.can_host ? 'âœ“' : 'â€”'}
                            </button>
                            {enrollment.can_host && enrollment.host_date && (
                              <span className="text-[10px] text-green-600 dark:text-green-400">{enrollment.host_date}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600" title={`Cannot host (status: ${enrollment.status})`}>âœ•</span>
                        )
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">{enrollment.can_host ? 'âœ“' : 'â€”'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                                    <div className="flex gap-2 justify-end">
                                      {isAdmin && (
                                        <>
                                          <button
                                            className="text-sm border dark:border-gray-600 rounded px-2.5 py-1.5 min-h-[36px] bg-white dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                                            onClick={() => {
                                              setEditingEnrollment(enrollment);
                                              setIsModalOpen(true);
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <select
                                            aria-label={`Change status for ${enrollment.student?.name || 'student'}`}
                                            className="text-sm border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-2.5 py-1.5 min-h-[36px]"
                                            value={enrollment.status}
                                            onChange={(e) => handleUpdateStatus(enrollment.enrollment_id, e.target.value)}
                                          >
                                            <option value="active">Active</option>
                                            <option value="pending">Pending</option>
                                        <option value="completed">Completed</option>
                                        <option value="dropped">Dropped</option>
                                      </select>
                                          <button
                                            className="text-sm border border-red-300 dark:border-red-700 rounded px-2.5 py-1.5 min-h-[36px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                                            onClick={() => handleDelete(enrollment.enrollment_id)}
                                            aria-label={`Delete enrollment for ${enrollment.student?.name || 'student'}`}
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

            {filteredEnrollments.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(filteredEnrollments.length / itemsPerPage)}
                totalItems={filteredEnrollments.length}
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

      <ConfirmDialog
        isOpen={!!deletingEnrollmentId}
        type="danger"
        title="Delete Enrollment"
        message="Are you sure you want to delete this enrollment? This action cannot be undone."
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeletingEnrollmentId(null)}
      />
    </div>
  );
}
