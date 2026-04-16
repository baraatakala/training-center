import { useEffect, useState, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { Select } from '@/shared/components/ui/Select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/components/ui/Table';
import { SearchBar } from '@/shared/components/ui/SearchBar';
import { Pagination } from '@/shared/components/ui/Pagination';
import { PageSkeleton } from '@/shared/components/ui/Skeleton';
import { SessionForm } from '@/features/sessions/components/SessionForm';
import { SessionRecordingsManager } from '@/features/sessions/components/SessionRecordingsManager';
import BulkScheduleTable from '@/features/sessions/components/BulkScheduleTable';
import { SessionSummaryCards } from '@/features/sessions/components/SessionSummaryCards';
import { SessionCard } from '@/features/sessions/components/SessionCard';
import { SessionTableRow } from '@/features/sessions/components/SessionTableRow';
import { SessionMergeModal } from '@/features/sessions/components/SessionMergeModal';
import { ScheduleChangeCutoffPicker } from '@/features/sessions/components/ScheduleChangeCutoffPicker';
import { sessionService } from '@/features/sessions/services/sessionService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import type { CreateSession } from '@/shared/types/database.types';
import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { formatLearningMethod, buildConflictMessage } from '@/features/sessions/utils/sessionHelpers';
import { downloadSessionsCsv } from '@/features/sessions/utils/exportSessionsCsv';


export function Sessions() {
  const [sessions, setSessions] = useState<SessionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'course' | 'teacher' | 'startDate' | 'endDate'>('startDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionWithDetails | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSessionForSchedule, setSelectedSessionForSchedule] = useState<SessionWithDetails | null>(null);
  const [selectedSessionForRecordings, setSelectedSessionForRecordings] = useState<SessionWithDetails | null>(null);
  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});
  const { isTeacher, isAdmin } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionWithDetails | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() => {
    // Default to cards on small screens
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'cards';
    return (localStorage.getItem('sessions_view_mode') as 'table' | 'cards') || 'table';
  });

  // Merge session state — mergeTarget is the session receiving attendance FROM another
  const [mergeTarget, setMergeTarget] = useState<SessionWithDetails | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Schedule conflict confirmation state
  const [conflictConfirm, setConflictConfirm] = useState<{
    message: string;
    pendingData: CreateSession;
    action: 'add' | 'edit';
  } | null>(null);

  // Unified schedule-change dialog (replaces the old separate day/time dialogs)
  const [scheduleChangeDialog, setScheduleChangeDialog] = useState<{
    data: CreateSession;
    dayChanged: boolean;
    timeChanged: boolean;
    oldDay: string | null;
    newDay: string | null;
    oldTime: string | null;
    newTime: string | null;
    lastAttendedDate: string | null;
  } | null>(null);
  const [scheduleChanging, setScheduleChanging] = useState(false);

  const loadSessions = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await sessionService.getAllWithJoins();

    if (fetchError) {
      setError('Failed to load sessions. Please try again.');
      toast.error('Failed to load sessions');
      console.error('Load sessions error:', fetchError);
      setLoading(false);
      return;
    }

    if (data) {
      setSessions(data as SessionWithDetails[]);
      
      // Load enrollment counts for each session
      const sessionIds = data.map((s: SessionWithDetails) => s.session_id);
      const { data: enrollments } = await sessionService.getActiveEnrollmentCounts(sessionIds);
      
      if (enrollments) {
        const counts: Record<string, number> = {};
        enrollments.forEach((e: { session_id: string }) => {
          counts[e.session_id] = (counts[e.session_id] || 0) + 1;
        });
        setEnrollmentCounts(counts);
      }
    }
    setLoading(false);
  }, []);

  const checkScheduleConflicts = useCallback(async (input: {
    teacherId: string;
    startDate: string;
    endDate: string;
    day: string | null;
    time?: string | null;
    excludeSessionId?: string;
  }): Promise<string | null> => {
    const { data, error } = await sessionService.checkScheduleConflicts(input);
    if (error) {
      throw new Error(error.message || 'Unable to validate schedule conflicts right now.');
    }
    if (data.length > 0) {
      return buildConflictMessage(data);
    }
    return null;
  }, []);

  useRefreshOnFocus(loadSessions);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filtered = sessions.filter(
      (session) =>
        (session.course?.course_name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.teacher?.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.course?.category || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        formatLearningMethod(session.learning_method).toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.virtual_provider || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (session.location || '').toLowerCase().includes(debouncedSearch.toLowerCase())
    );

    if (statusFilter !== 'all') {
      filtered = filtered.filter((session) => {
        const startDate = new Date(session.start_date);
        const endDate = new Date(session.end_date);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        if (statusFilter === 'active') {
          return startDate <= today && endDate >= today;
        } else if (statusFilter === 'upcoming') {
          return startDate > today;
        } else if (statusFilter === 'completed') {
          return endDate < today;
        }
        return true;
      });
    }

    filtered.sort((a, b) => {
      let aVal: string, bVal: string;
      
      switch (sortBy) {
        case 'course':
          aVal = a.course?.course_name || '';
          bVal = b.course?.course_name || '';
          break;
        case 'teacher':
          aVal = a.teacher?.name || '';
          bVal = b.teacher?.name || '';
          break;
        case 'startDate':
          aVal = a.start_date;
          bVal = b.start_date;
          break;
        case 'endDate':
          aVal = a.end_date;
          bVal = b.end_date;
          break;
        default:
          aVal = a.start_date;
          bVal = b.start_date;
      }
      
      const comparison = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [debouncedSearch, statusFilter, sessions, sortBy, sortOrder]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, statusFilter, sortBy, sortOrder]);

  // Removed unused toggleSort function - sorting is handled by dropdown and toggle button

  const handleAddSession = async (data: CreateSession) => {
    const conflictMsg = await checkScheduleConflicts({
      teacherId: data.teacher_id,
      startDate: data.start_date,
      endDate: data.end_date,
      day: data.day,
      time: data.time,
    });

    if (conflictMsg) {
      setConflictConfirm({ message: conflictMsg, pendingData: data, action: 'add' });
      return;
    }

    await executeAddSession(data);
  };

  const executeAddSession = async (data: CreateSession) => {
    const { error } = await sessionService.create(data);

    if (error) {
      const message = error.message || 'Unknown session creation error';
      toast.error(message.startsWith('Session delivery fields are enabled') ? message : 'Error creating session: ' + message, 7000);
    } else {
      toast.success('Session created successfully');
      setIsModalOpen(false);
      loadSessions();
    }
  };

  const handleUpdateSession = async (data: CreateSession) => {
    if (!editingSession) return;

    const conflictMsg = await checkScheduleConflicts({
      teacherId: data.teacher_id,
      startDate: data.start_date,
      endDate: data.end_date,
      day: data.day,
      time: data.time,
      excludeSessionId: editingSession.session_id,
    });

    if (conflictMsg) {
      setConflictConfirm({ message: conflictMsg, pendingData: data, action: 'edit' });
      return;
    }

    await executeUpdateSession(data);
  };

  const executeUpdateSession = async (data: CreateSession) => {
    if (!editingSession) return;

    // If the day changed, ask user how to handle the schedule transition
    const dayChanged = data.day !== editingSession.day;
    const timeChanged = data.time !== editingSession.time;

    if (dayChanged || timeChanged) {
      const lastAttendedDate = await sessionService.getLastAttendedDate(editingSession.session_id);
      setScheduleChangeDialog({
        data,
        dayChanged,
        timeChanged,
        oldDay: editingSession.day ?? null,
        newDay: data.day ?? null,
        oldTime: editingSession.time ?? null,
        newTime: data.time ?? null,
        lastAttendedDate,
      });
      return; // Wait for user to pick cutoff date via dialog
    }

    // No day or time change — save directly
    const { error } = await sessionService.update(editingSession.session_id, data);

    if (error) {
      const message = error.message || 'Unknown session update error';
      toast.error(message.startsWith('Session delivery fields are enabled') ? message : 'Error updating session: ' + message, 7000);
    } else {
      toast.success('Session updated successfully');
      setIsModalOpen(false);
      setEditingSession(null);
      loadSessions();
    }
  };

  const executeScheduleChange = async (fromDate: string | null, toDate: string | null) => {
    if (!scheduleChangeDialog || !editingSession) return;
    const { data, dayChanged, timeChanged } = scheduleChangeDialog;
    setScheduleChanging(true);
    try {
      const strategy = fromDate === null ? 'from_start' : (toDate ? 'date_range' : 'from_date');
      const { error } = await sessionService.update(
        editingSession.session_id,
        data,
        dayChanged ? strategy : undefined,
        timeChanged ? strategy : undefined,
        dayChanged && fromDate ? fromDate : undefined,
        timeChanged && fromDate ? fromDate : undefined,
        dayChanged && toDate ? toDate : undefined,
        timeChanged && toDate ? toDate : undefined,
      );
      if (error) {
        const message = error.message || 'Unknown session update error';
        toast.error(message.startsWith('Session delivery fields are enabled') ? message : 'Error updating session: ' + message, 7000);
      } else {
        const label = fromDate === null
          ? 'applied from session start'
          : toDate
            ? `applied from ${fromDate} to ${toDate}`
            : `applied from ${fromDate}`;
        toast.success(`Session updated — schedule change ${label}.`);
        setScheduleChangeDialog(null);
        setIsModalOpen(false);
        setEditingSession(null);
        loadSessions();
      }
    } finally {
      setScheduleChanging(false);
    }
  };

  const handleConflictProceed = async () => {
    if (!conflictConfirm) return;
    const { pendingData, action } = conflictConfirm;
    setConflictConfirm(null);
    if (action === 'add') {
      await executeAddSession(pendingData);
    } else {
      await executeUpdateSession(pendingData);
    }
  };

  const openAddModal = () => {
    setEditingSession(null);
    setIsModalOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!deletingSession) return;
    const { error } = await sessionService.delete(deletingSession.session_id);
    if (error) {
      toast.error('Failed to delete session: ' + error.message);
    } else {
      toast.success('Session deleted successfully');
      loadSessions();
    }
    setDeletingSession(null);
  };

  const openEditModal = (session: SessionWithDetails) => {
    setEditingSession(session);
    setIsModalOpen(true);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const activeSessions = sessions.filter((s) => {
    const start = new Date(s.start_date);
    const end = new Date(s.end_date);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return start <= today && end >= today;
  }).length;

  const upcomingSessions = sessions.filter((s) => {
    const start = new Date(s.start_date);
    start.setHours(0, 0, 0, 0);
    return start > today;
  }).length;

  const completedSessions = sessions.filter((s) => {
    const end = new Date(s.end_date);
    end.setHours(0, 0, 0, 0);
    return end < today;
  }).length;

  const exportToCSV = useCallback(() => {
    downloadSessionsCsv(filteredSessions, enrollmentCounts);
    toast.success(`Exported ${filteredSessions.length} sessions to CSV`);
  }, [filteredSessions, enrollmentCounts]);

  const handleDownloadTemplate = async () => {
    const [{ buildImportTemplateWithData }, XLSX] = await Promise.all([
      import('@/features/data-import/services/masterDataImportService'),
      import('xlsx'),
    ]);
    const workbook = await buildImportTemplateWithData('sessions');
    XLSX.writeFile(workbook, 'sessions-import-template.xlsx');
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setImporting(true);
    try {
      const { parseImportFile, importMasterData } = await import('@/features/data-import/services/masterDataImportService');
      const rows = await parseImportFile(file);
      if (rows.length === 0) {
        toast.error('File contains no data rows.');
        return;
      }
      const result = await importMasterData('sessions', rows);
      if (result.errors.length > 0) {
        toast.warning(`Import done with ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      } else if (result.created === 0 && result.updated > 0) {
        toast.info(`${result.updated} existing session(s) updated. No new sessions created — the imported data matched existing records.`);
      } else {
        toast.success(`${result.created} created, ${result.updated} updated.`);
      }
      loadSessions();
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Sessions</h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Manage training sessions and schedules</p>
        </div>
        {isTeacher && (
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <Button onClick={handleDownloadTemplate} variant="outline" className="w-full min-w-0 gap-2" title="Download import template">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              <span className="truncate">Template</span>
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={importing} variant="outline" className="w-full min-w-0 gap-2" title="Import from CSV/Excel">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <span className="truncate">{importing ? 'Importing...' : 'Import'}</span>
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden" onChange={handleImportFile} />
            <Button onClick={exportToCSV} variant="outline" className="w-full min-w-0 gap-2" title="Export to CSV">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="truncate">Export</span>
            </Button>
            <Button onClick={openAddModal} className="w-full min-w-0"><span className="truncate">+ Add Session</span></Button>
          </div>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">
            ⚠️ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 text-sm">❌ {error}</p>
          <button 
            onClick={loadSessions} 
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <SessionSummaryCards
        total={sessions.length}
        active={activeSessions}
        upcoming={upcomingSessions}
        completed={completedSessions}
      />

      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow dark:shadow-gray-900/30 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search sessions..."
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              options={[
                { value: 'all', label: 'All Sessions' },
                { value: 'active', label: 'Active' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'completed', label: 'Completed' }
              ]}
            />
          </div>
        </div>
        
        {/* Sort Controls */}
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'course' | 'teacher' | 'startDate' | 'endDate')}
            aria-label="Sort sessions by"
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-1.5 focus:ring-2 focus:ring-blue-500"
          >
            <option value="startDate">Start Date</option>
            <option value="endDate">End Date</option>
            <option value="course">Course Name</option>
            <option value="teacher">Teacher Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
          >
            {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
          <span className="text-gray-600 dark:text-gray-400 ml-auto hidden sm:inline">
            Showing {filteredSessions.length} of {sessions.length} sessions
          </span>

          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 ml-2">
            <button
              onClick={() => { setViewMode('table'); localStorage.setItem('sessions_view_mode', 'table'); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1 ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Table view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" /></svg>
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              onClick={() => { setViewMode('cards'); localStorage.setItem('sessions_view_mode', 'cards'); }}
              className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1 ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
              title="Card view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              <span className="hidden sm:inline">Cards</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <PageSkeleton statCards={0} tableRows={8} tableColumns={11} hasFilters={false} />
      ) : viewMode === 'cards' ? (
        /* ==================== CARD VIEW ==================== */
        <div>
          {filteredSessions.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 p-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery || statusFilter !== 'all'
                    ? 'No sessions match your filters.'
                    : 'No sessions yet. Click "+ Add Session" to create one.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSessions
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((session) => (
                    <SessionCard
                      key={session.session_id}
                      session={session}
                      enrollmentCount={enrollmentCounts[session.session_id] || 0}
                      isTeacher={isTeacher}
                      isAdmin={isAdmin}
                      onOpenSchedule={(s) => { setSelectedSessionForSchedule(s); setIsScheduleModalOpen(true); }}
                      onOpenRecordings={setSelectedSessionForRecordings}
                      onEdit={openEditModal}
                      onDelete={setDeletingSession}
                      onMerge={setMergeTarget}
                    />
                  ))}
              </div>

              {filteredSessions.length > 0 && (
                <div className="mt-4">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredSessions.length / itemsPerPage)}
                    totalItems={filteredSessions.length}
                    itemsPerPage={itemsPerPage}
                    onPageChange={(page) => setCurrentPage(page)}
                    onItemsPerPageChange={(items) => {
                      setItemsPerPage(items);
                      setCurrentPage(1);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap min-w-[200px]">Course</TableHead>
                <TableHead className="whitespace-nowrap hidden lg:table-cell">Schedule</TableHead>
                <TableHead className="whitespace-nowrap hidden xl:table-cell">Location</TableHead>
                <TableHead className="whitespace-nowrap hidden md:table-cell text-center">Enrolled</TableHead>
                <TableHead className="whitespace-nowrap hidden lg:table-cell">Dates</TableHead>
                <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400">
                        {searchQuery || statusFilter !== 'all'
                          ? 'No sessions match your filters.'
                          : 'No sessions yet. Click "+ Add Session" to create one.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredSessions
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((session) => (
                    <SessionTableRow
                      key={session.session_id}
                      session={session}
                      enrollmentCount={enrollmentCounts[session.session_id] || 0}
                      isTeacher={isTeacher}
                      isAdmin={isAdmin}
                      onOpenSchedule={(s) => { setSelectedSessionForSchedule(s); setIsScheduleModalOpen(true); }}
                      onOpenRecordings={setSelectedSessionForRecordings}
                      onEdit={openEditModal}
                      onDelete={setDeletingSession}
                      onMerge={setMergeTarget}
                    />
                  ))
              )}
            </TableBody>
          </Table>
          </div>

          {filteredSessions.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredSessions.length / itemsPerPage)}
              totalItems={filteredSessions.length}
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
      {/* End of view mode ternary */}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSession(null);
        }}
        title={editingSession ? 'Edit Session' : 'Add New Session'}
      >
        <SessionForm
          onSubmit={editingSession ? handleUpdateSession : handleAddSession}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingSession(null);
          }}
          initialData={
            editingSession
              ? {
                  course_id: editingSession.course_id,
                  teacher_id: editingSession.teacher_id,
                  start_date: editingSession.start_date,
                  end_date: editingSession.end_date,
                  day: editingSession.day,
                  time: editingSession.time,
                  location: editingSession.location,
                  grace_period_minutes: editingSession.grace_period_minutes,
                  learning_method: editingSession.learning_method,
                  virtual_provider: editingSession.virtual_provider,
                  virtual_meeting_link: editingSession.virtual_meeting_link,
                  requires_recording: editingSession.requires_recording,
                  default_recording_visibility: editingSession.default_recording_visibility,
                  feedback_enabled: editingSession.feedback_enabled,
                  feedback_anonymous_allowed: editingSession.feedback_anonymous_allowed,
                  teacher_can_host: editingSession.teacher_can_host,
                }
              : null
          }
        />
      </Modal>

      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setSelectedSessionForSchedule(null);
        }}
        title={selectedSessionForSchedule ? `Host Table - ${selectedSessionForSchedule.course?.course_name}` : 'Host Table'}
        size="full"
      >
        {selectedSessionForSchedule && (
          <BulkScheduleTable
            sessionId={selectedSessionForSchedule.session_id}
            startDate={selectedSessionForSchedule.start_date}
            endDate={selectedSessionForSchedule.end_date}
            day={selectedSessionForSchedule.day}
            time={selectedSessionForSchedule.time}
            onClose={() => {
              setIsScheduleModalOpen(false);
              setSelectedSessionForSchedule(null);
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!selectedSessionForRecordings}
        onClose={() => setSelectedSessionForRecordings(null)}
        title={selectedSessionForRecordings ? `Session Recordings - ${selectedSessionForRecordings.course?.course_name}` : 'Session Recordings'}
        size="lg"
      >
        {selectedSessionForRecordings && (
          <SessionRecordingsManager
            sessionId={selectedSessionForRecordings.session_id}
            courseName={selectedSessionForRecordings.course?.course_name || 'this session'}
            canManageInAttendance={isTeacher || isAdmin}
          />
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingSession}
        title="Delete Session"
        message={`Are you sure you want to delete the session for "${deletingSession?.course?.course_name}"? This will also remove all attendance records.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteSession}
        onCancel={() => setDeletingSession(null)}
      />

      {/* Schedule Conflict Warning */}
      <ConfirmDialog
        isOpen={!!conflictConfirm}
        title="Schedule Conflict Detected"
        message={conflictConfirm
          ? `${conflictConfirm.message}\n\nDo you want to proceed anyway? The teacher will have overlapping sessions on these dates.`
          : ''}
        confirmText="Proceed Anyway"
        cancelText="Go Back"
        type="warning"
        onConfirm={handleConflictProceed}
        onCancel={() => setConflictConfirm(null)}
      />

      {/* Schedule Change Dialog */}
      <Modal
        isOpen={!!scheduleChangeDialog}
        onClose={() => { if (!scheduleChanging) setScheduleChangeDialog(null); }}
        title="Schedule Change"
      >
        {scheduleChangeDialog && (
          <ScheduleChangeCutoffPicker
            dayChanged={scheduleChangeDialog.dayChanged}
            timeChanged={scheduleChangeDialog.timeChanged}
            oldDay={scheduleChangeDialog.oldDay}
            newDay={scheduleChangeDialog.newDay}
            oldTime={scheduleChangeDialog.oldTime}
            newTime={scheduleChangeDialog.newTime}
            sessionStartDate={editingSession?.start_date ?? null}
            lastAttendedDate={scheduleChangeDialog.lastAttendedDate}
            sessionEndDate={editingSession?.end_date ?? null}
            onApply={executeScheduleChange}
            onCancel={() => setScheduleChangeDialog(null)}
            executing={scheduleChanging}
          />
        )}
      </Modal>

      {/* Merge Session Modal */}
      <Modal
        isOpen={!!mergeTarget}
        onClose={() => setMergeTarget(null)}
        title={`Merge Attendance Into — ${mergeTarget?.course?.course_name || ''}`}
        size="xl"
      >
        {mergeTarget && (
          <SessionMergeModal
            targetSession={mergeTarget}
            allSessions={sessions}
            onClose={() => setMergeTarget(null)}
            onSuccess={loadSessions}
          />
        )}
      </Modal>
    </div>
  );
}
