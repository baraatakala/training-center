import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/toastUtils';
import { TableSkeleton } from '../components/ui/Skeleton';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { useAuth } from '../context/AuthContext';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  excuseRequestService,
  EXCUSE_REASONS,
  type ExcuseRequest,
  type CreateExcuseRequest,
} from '../services/excuseRequestService';
import { supabase } from '../lib/supabase';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';

// =====================================================
// CONSTANTS
// =====================================================

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    icon: '⏳',
    ring: 'ring-amber-300 dark:ring-amber-700',
  },
  approved: {
    label: 'Approved',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: '✅',
    ring: 'ring-emerald-300 dark:ring-emerald-700',
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    icon: '❌',
    ring: 'ring-red-300 dark:ring-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
    icon: '🚫',
    ring: 'ring-gray-300 dark:ring-gray-700',
  },
} as const;

// =====================================================
// MAIN COMPONENT
// =====================================================

export function ExcuseRequests() {
  const { user } = useAuth();
  const { isTeacher, isAdmin, loading: roleLoading } = useIsTeacher();

  // Data
  const [requests, setRequests] = useState<ExcuseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<ExcuseRequest | null>(null);
  const [detailRequest, setDetailRequest] = useState<ExcuseRequest | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ExcuseRequest | null>(null);

  // Stats
  const stats = useMemo(() => {
    const pending = requests.filter(r => r.status === 'pending').length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const rejected = requests.filter(r => r.status === 'rejected').length;
    const total = requests.length;
    const approvalRate = total > 0 ? Math.round(((approved) / Math.max(approved + rejected, 1)) * 100) : 0;
    return { pending, approved, rejected, total, approvalRate };
  }, [requests]);

  // =====================================================
  // DATA LOADING
  // =====================================================

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const filters: { status?: string } = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      const { data, error } = await excuseRequestService.getAll(filters);
      if (error) {
        toast.error('Failed to load excuse requests');
        console.error(error);
      } else {
        setRequests(data || []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Unexpected error loading requests');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, refreshKey]);

  useEffect(() => {
    if (!roleLoading) fetchRequests();
  }, [fetchRequests, roleLoading]);

  useRefreshOnFocus(fetchRequests);

  const refresh = () => setRefreshKey(k => k + 1);

  // =====================================================
  // FILTERED LIST
  // =====================================================

  const filteredRequests = useMemo(() => {
    let list = [...requests];

    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(r =>
        (r.student?.name || '').toLowerCase().includes(term) ||
        (r.reason || '').toLowerCase().includes(term) ||
        (r.description || '').toLowerCase().includes(term) ||
        (r.session?.course?.course_name || '').toLowerCase().includes(term)
      );
    }

    // Date range
    if (dateRange !== 'all') {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      list = list.filter(r => new Date(r.created_at) >= cutoff);
    }

    return list;
  }, [requests, searchTerm, dateRange]);

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleReview = async (requestId: string, status: 'approved' | 'rejected', note?: string) => {
    if (!user?.email) return;
    const { error } = await excuseRequestService.review(requestId, {
      status,
      reviewed_by: user.email,
      review_note: note,
    });
    if (error) {
      toast.error(`Failed to ${status === 'approved' ? 'approve' : 'reject'} request`);
    } else {
      toast.success(`Request ${status === 'approved' ? 'approved' : 'rejected'} successfully`);
      setReviewingRequest(null);
      refresh();
    }
  };

  const handleDelete = async (requestId: string) => {
    const { error } = await excuseRequestService.delete(requestId);
    if (error) {
      toast.error('Failed to delete request');
    } else {
      toast.success('Request deleted');
      setDeleteConfirm(null);
      refresh();
    }
  };

  // =====================================================
  // RENDER
  // =====================================================

  if (roleLoading) {
    return (
      <div className="p-6 space-y-6">
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            📋 Excuse Requests
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isTeacher
              ? 'Review and manage student absence excuse requests'
              : 'Submit and track your absence excuse requests'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refresh} variant="outline" size="sm">
            🔄 Refresh
          </Button>
          {!isTeacher && (
            <Button onClick={() => setShowCreateModal(true)} size="sm">
              ➕ New Request
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatsCard label="Total" value={stats.total} color="text-blue-600 dark:text-blue-400" icon="📊" />
        <StatsCard label="Pending" value={stats.pending} color="text-amber-600 dark:text-amber-400" icon="⏳" highlight={stats.pending > 0} />
        <StatsCard label="Approved" value={stats.approved} color="text-emerald-600 dark:text-emerald-400" icon="✅" />
        <StatsCard label="Rejected" value={stats.rejected} color="text-red-600 dark:text-red-400" icon="❌" />
        <StatsCard label="Approval %" value={`${stats.approvalRate}%`} color="text-purple-600 dark:text-purple-400" icon="📈" className="hidden lg:block" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by student, course, or reason..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={value => setStatusFilter(value)}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'pending', label: '⏳ Pending' },
                { value: 'approved', label: '✅ Approved' },
                { value: 'rejected', label: '❌ Rejected' },
                { value: 'cancelled', label: '🚫 Cancelled' },
              ]}
            />
            <Select
              value={dateRange}
              onChange={value => setDateRange(value as typeof dateRange)}
              options={[
                { value: 'all', label: 'All Time' },
                { value: '7d', label: 'Last 7 Days' },
                { value: '30d', label: 'Last 30 Days' },
                { value: '90d', label: 'Last 90 Days' },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      {loading ? (
        <TableSkeleton />
      ) : filteredRequests.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-4xl mb-3">📭</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No Requests Found</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {statusFilter !== 'all'
                ? `No ${statusFilter} requests match your filters.`
                : 'No excuse requests have been submitted yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map(req => (
            <RequestCard
              key={req.request_id}
              request={req}
              isTeacher={isTeacher}
              isAdmin={isAdmin}
              onReview={() => setReviewingRequest(req)}
              onViewDetail={() => setDetailRequest(req)}
              onDelete={() => setDeleteConfirm(req)}
              onQuickApprove={() => handleReview(req.request_id, 'approved')}
              onQuickReject={() => handleReview(req.request_id, 'rejected')}
            />
          ))}
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-2">
            Showing {filteredRequests.length} of {requests.length} requests
          </p>
        </div>
      )}

      {/* Create Request Modal (Student) */}
      {showCreateModal && (
        <CreateRequestModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); refresh(); }}
          userEmail={user?.email || ''}
        />
      )}

      {/* Review Modal (Teacher/Admin) */}
      {reviewingRequest && (
        <ReviewModal
          request={reviewingRequest}
          onClose={() => setReviewingRequest(null)}
          onReview={handleReview}
        />
      )}

      {/* Detail Modal */}
      {detailRequest && (
        <DetailModal
          request={detailRequest}
          onClose={() => setDetailRequest(null)}
        />
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Request"
          message={`Are you sure you want to permanently delete this excuse request from ${deleteConfirm.student?.name || 'unknown student'}?`}
          confirmText="Delete"
          type="danger"
          onConfirm={() => handleDelete(deleteConfirm.request_id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// =====================================================
// STATS CARD
// =====================================================

function StatsCard({
  label,
  value,
  color,
  icon,
  highlight,
  className = '',
}: {
  label: string;
  value: string | number;
  color: string;
  icon: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card className={`${highlight ? 'ring-2 ring-amber-400 dark:ring-amber-600' : ''} ${className}`}>
      <CardContent className="p-3 flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================================
// REQUEST CARD
// =====================================================

function RequestCard({
  request,
  isTeacher,
  isAdmin,
  onReview,
  onViewDetail,
  onDelete,
  onQuickApprove,
  onQuickReject,
}: {
  request: ExcuseRequest;
  isTeacher: boolean;
  isAdmin: boolean;
  onReview: () => void;
  onViewDetail: () => void;
  onDelete: () => void;
  onQuickApprove: () => void;
  onQuickReject: () => void;
}) {
  const status = STATUS_CONFIG[request.status];
  const reasonObj = EXCUSE_REASONS.find(r => r.value === request.reason);
  const isPending = request.status === 'pending';

  return (
    <Card className={`transition-all hover:shadow-md ${isPending ? `ring-1 ${status.ring}` : ''}`}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left: Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                {status.icon} {status.label}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {formatDistanceToNow(parseISO(request.created_at), { addSuffix: true })}
              </span>
            </div>

            <div className="mt-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {request.student?.name || 'Unknown Student'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {request.session?.course?.course_name || 'Unknown Course'}
                {' · '}
                <span className="font-medium">
                  {request.attendance_date ? format(parseISO(request.attendance_date), 'MMM d, yyyy') : '—'}
                </span>
              </p>
            </div>

            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-md">
                {reasonObj?.icon || '📝'} {reasonObj?.label || request.reason}
              </span>
              {request.supporting_doc_url && (
                <a
                  href={request.supporting_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  📎 {request.supporting_doc_name || 'Document'}
                </a>
              )}
              {request.description && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">
                  &ldquo;{request.description}&rdquo;
                </span>
              )}
            </div>

            {/* Review info */}
            {request.reviewed_by && (
              <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                Reviewed by <span className="font-medium">{request.reviewed_by}</span>
                {request.reviewed_at && ` · ${format(parseISO(request.reviewed_at), 'MMM d, h:mm a')}`}
                {request.review_note && ` — "${request.review_note}"`}
              </p>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end shrink-0">
            <Button variant="outline" size="sm" onClick={onViewDetail} className="min-h-[36px]">
              👁 Details
            </Button>
            {isTeacher && isPending && (
              <>
                <Button size="sm" onClick={onQuickApprove} className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[36px]">
                  ✅ Approve
                </Button>
                <Button size="sm" variant="outline" onClick={onQuickReject} className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20 min-h-[36px]">
                  ❌ Reject
                </Button>
                <Button size="sm" variant="outline" onClick={onReview} className="text-gray-600 dark:text-gray-400 min-h-[36px]">
                  📝 Review
                </Button>
              </>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={onDelete} className="text-red-500 hover:text-red-700 min-h-[36px]" aria-label="Delete excuse request">
                🗑
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================================
// CREATE REQUEST MODAL (Student)
// =====================================================

function CreateRequestModal({
  onClose,
  onCreated,
  userEmail,
}: {
  onClose: () => void;
  onCreated: () => void;
  userEmail: string;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Select session + date
  const [sessions, setSessions] = useState<Array<{
    session_id: string;
    course_name: string;
    day: string | null;
    time: string | null;
  }>>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [attendanceDate, setAttendanceDate] = useState('');

  // Step 2: Reason + details
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [document, setDocument] = useState<File | null>(null);

  // Student ID from Supabase
  const [studentId, setStudentId] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);

  // Attendance status check for selected session + date
  const [attendanceStatus, setAttendanceStatus] = useState<{ status: string; excuse_reason: string | null } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Check attendance status when session + date are selected
  useEffect(() => {
    if (!studentId || !selectedSession || !attendanceDate) {
      setAttendanceStatus(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      setCheckingStatus(true);
      try {
        const result = await excuseRequestService.checkAttendanceStatus(studentId, selectedSession, attendanceDate);
        if (!cancelled) setAttendanceStatus(result);
      } catch {
        if (!cancelled) setAttendanceStatus(null);
      } finally {
        if (!cancelled) setCheckingStatus(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [studentId, selectedSession, attendanceDate]);

  // Auto-fill absence date when session is selected (next upcoming occurrence of session day)
  useEffect(() => {
    if (!selectedSession) return;
    const session = sessions.find(s => s.session_id === selectedSession);
    if (!session?.day) return;

    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const targetDay = dayMap[session.day.toLowerCase()];
    if (targetDay === undefined) return;

    const today = new Date();
    const currentDay = today.getDay();
    // Days ahead: if today IS the session day, use today; otherwise jump forward
    let daysAhead = (targetDay - currentDay + 7) % 7;
    if (daysAhead === 0) daysAhead = 0; // Today is the session day
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysAhead);

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    setAttendanceDate(`${yyyy}-${mm}-${dd}`);
  }, [selectedSession, sessions]);

  // Get the session day number for calendar highlighting
  const sessionDayNum = useMemo(() => {
    if (!selectedSession) return null;
    const session = sessions.find(s => s.session_id === selectedSession);
    if (!session?.day) return null;
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    return dayMap[session.day.toLowerCase()] ?? null;
  }, [selectedSession, sessions]);

  const isScheduledSessionDate = useCallback((dateStr: string) => {
    if (!dateStr || sessionDayNum === null) return false;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1).getDay() === sessionDayNum;
  }, [sessionDayNum]);

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Reset calendar month when attendance date changes via auto-fill
  useEffect(() => {
    if (attendanceDate) {
      const d = new Date(attendanceDate + 'T00:00:00');
      setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
    }
  }, [attendanceDate]);

  useEffect(() => {
    const loadStudentSessions = async () => {
      setLoadingSessions(true);
      try {
        // Get student by email
        const { data: student, error: studentError } = await supabase
          .from('student')
          .select('student_id')
          .ilike('email', userEmail)
          .single();

        if (studentError || !student) {
          toast.error(studentError ? `Failed to load profile: ${studentError.message}` : 'Student profile not found');
          onClose();
          return;
        }
        setStudentId(student.student_id);

        // Get enrolled sessions
        const { data: enrollments, error: enrollError } = await supabase
          .from('enrollment')
          .select(`
            session_id,
            session:session_id(
              session_id,
              day,
              time,
              course:course_id(course_name)
            )
          `)
          .eq('student_id', student.student_id)
          .eq('status', 'active');

        if (enrollError) {
          toast.error(`Failed to load sessions: ${enrollError.message}`);
          setSessions([]);
          return;
        }

        if (enrollments) {
          const sessionList = enrollments
            .filter((e: Record<string, unknown>) => e.session)
            .map((e: Record<string, unknown>) => {
              const sess = e.session as Record<string, unknown>;
              return {
                session_id: sess.session_id as string,
                course_name: (sess.course as Record<string, string> | null)?.course_name || 'Unknown',
                day: sess.day as string | null,
                time: sess.time as string | null,
              };
            });
          setSessions(sessionList);
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to load your sessions');
      } finally {
        setLoadingSessions(false);
      }
    };

    loadStudentSessions();
  }, [userEmail, onClose]);

  const handleSubmit = async () => {
    if (!selectedSession || !attendanceDate || !reason) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!isScheduledSessionDate(attendanceDate)) {
      toast.error('You can only submit an excuse for the scheduled session day');
      return;
    }

    setSubmitting(true);
    try {
      let docUrl: string | undefined;
      let docName: string | undefined;

      // Upload document if provided
      if (document) {
        const { url, error: uploadErr } = await excuseRequestService.uploadDocument(document, studentId);
        if (uploadErr) {
          toast.warning('Document upload failed, but request will be submitted without it');
        } else if (url) {
          docUrl = url;
          docName = document.name;
        }
      }

      const payload: CreateExcuseRequest = {
        student_id: studentId,
        session_id: selectedSession,
        attendance_date: attendanceDate,
        reason,
        description: description.trim() || undefined,
        supporting_doc_url: docUrl,
        supporting_doc_name: docName,
      };

      const { error } = await excuseRequestService.create(payload);
      if (error) {
        toast.error(error.message || 'Failed to submit request');
      } else {
        toast.success('Excuse request submitted successfully');
        onCreated();
      }
    } catch (err) {
      console.error(err);
      toast.error('Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Submit Excuse Request" size="lg">
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${step === 1 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">1</span>
            Session & Date
          </div>
          <div className="w-8 h-px bg-gray-300 dark:bg-gray-600" />
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${step === 2 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">2</span>
            Reason & Details
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {loadingSessions ? (
              <div className="py-8 text-center text-gray-400">Loading your sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-3xl mb-2">📭</div>
                <p className="text-gray-500 dark:text-gray-400">No active enrollments found.</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Session / Course <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedSession}
                    onChange={e => setSelectedSession(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a session...</option>
                    {sessions.map(s => (
                      <option key={s.session_id} value={s.session_id}>
                        {s.course_name} {s.day ? `(${s.day})` : ''} {s.time ? `@ ${s.time}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Absence Date <span className="text-red-500">*</span>
                  </label>

                  {/* Custom Calendar */}
                  {(() => {
                    const { year, month } = calendarMonth;
                    const firstDay = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
                    const today = new Date();
                    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                    const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

                    const cells: Array<{ day: number; dateStr: string; isSessionDay: boolean; isToday: boolean; isSelected: boolean; isPast: boolean }> = [];
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateObj = new Date(year, month, d);
                      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      cells.push({
                        day: d,
                        dateStr: ds,
                        isSessionDay: sessionDayNum !== null && dateObj.getDay() === sessionDayNum,
                        isToday: ds === todayStr,
                        isSelected: ds === attendanceDate,
                        isPast: dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
                      });
                    }

                    return (
                      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                        {/* Month Navigation */}
                        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500">
                          <button
                            type="button"
                            onClick={() => setCalendarMonth(prev => {
                              const d = new Date(prev.year, prev.month - 1);
                              return { year: d.getFullYear(), month: d.getMonth() };
                            })}
                            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-sm font-bold text-white">{monthName}</span>
                          <button
                            type="button"
                            onClick={() => setCalendarMonth(prev => {
                              const d = new Date(prev.year, prev.month + 1);
                              return { year: d.getFullYear(), month: d.getMonth() };
                            })}
                            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>

                        {/* Day Headers */}
                        <div className="grid grid-cols-7 text-center">
                          {dayLabels.map((dl, i) => (
                            <div key={dl} className={`py-2 text-[11px] font-semibold uppercase tracking-wider ${
                              sessionDayNum === i
                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                : 'text-gray-400 dark:text-gray-500'
                            }`}>{dl}</div>
                          ))}
                        </div>

                        {/* Date Grid */}
                        <div className="grid grid-cols-7 text-center gap-px bg-gray-100 dark:bg-gray-700/30 p-1">
                          {/* Empty cells for offset */}
                          {Array.from({ length: firstDay }).map((_, i) => (
                            <div key={`empty-${i}`} className="h-9" />
                          ))}
                          {/* Day cells */}
                          {cells.map(({ day, dateStr, isSessionDay, isToday, isSelected }) => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => isSessionDay && setAttendanceDate(dateStr)}
                              disabled={!isSessionDay}
                              className={`h-9 w-full rounded-lg text-sm font-medium relative transition-all ${
                                isSelected
                                  ? 'bg-blue-600 text-white shadow-md scale-105 ring-2 ring-blue-300 dark:ring-blue-500'
                                  : isToday
                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold ring-1 ring-indigo-300 dark:ring-indigo-600'
                                    : isSessionDay
                                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 font-semibold'
                                      : 'text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-gray-800 cursor-not-allowed opacity-60'
                              }`}
                            >
                              {day}
                              {isSessionDay && !isSelected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                              )}
                              {isToday && !isSelected && (
                                <span className="absolute top-0.5 right-1 text-[8px]">●</span>
                              )}
                            </button>
                          ))}
                        </div>

                        {/* Legend */}
                        <div className="flex items-center justify-center gap-4 px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Session Day</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 ring-1 ring-indigo-300" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Today</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Selected</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Only highlighted session-day dates can be selected.</p>
                </div>

                {/* Attendance Status Indicator */}
                {selectedSession && attendanceDate && (
                  <div className="rounded-lg border p-3 text-sm">
                    {checkingStatus ? (
                      <span className="text-gray-400">Checking attendance status...</span>
                    ) : attendanceStatus ? (
                      attendanceStatus.status === 'excused' ? (
                        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                          <span>ℹ️</span>
                          <span>Your attendance is already marked as <strong>excused</strong>{attendanceStatus.excuse_reason ? ` (${attendanceStatus.excuse_reason})` : ''}. No request needed.</span>
                        </div>
                      ) : attendanceStatus.status === 'on time' ? (
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                          <span>✅</span>
                          <span>You are marked as <strong>present (on time)</strong> for this date.</span>
                        </div>
                      ) : attendanceStatus.status === 'late' ? (
                        <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2">
                          <span>⚡</span>
                          <span>You are marked as <strong>late</strong> for this date.</span>
                        </div>
                      ) : attendanceStatus.status === 'absent' ? (
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                          <span>❗</span>
                          <span>You are marked as <strong>absent</strong> — submitting an excuse may change this to excused.</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <span>📝</span>
                          <span>Current status: <strong>{attendanceStatus.status}</strong></span>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                        <span>📝</span>
                        <span>No attendance record yet for this date.</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!selectedSession || !attendanceDate || !isScheduledSessionDate(attendanceDate) || attendanceStatus?.status === 'excused'}
              >
                Next →
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reason <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXCUSE_REASONS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-sm transition-all
                      ${reason === r.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                  >
                    <span className="text-lg">{r.icon}</span>
                    <span className="font-medium">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Additional Details
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Provide any additional details about your absence..."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Supporting Document (optional)
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 10 * 1024 * 1024) {
                    toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`);
                    e.target.value = '';
                    setDocument(null);
                    return;
                  }
                  setDocument(file || null);
                }}
                className="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/20 dark:file:text-blue-300 hover:file:bg-blue-100"
              />
              {document && (
                <p className="text-xs text-gray-400 mt-1">📎 {document.name} ({(document.size / 1024).toFixed(1)} KB)</p>
              )}
              <p className="text-xs text-gray-400 mt-1">Max 10MB. Accepted: PDF, images, Office docs</p>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={!reason || submitting}>
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting...
                    </span>
                  ) : '📤 Submit Request'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =====================================================
// REVIEW MODAL (Teacher/Admin)
// =====================================================

function ReviewModal({
  request,
  onClose,
  onReview,
}: {
  request: ExcuseRequest;
  onClose: () => void;
  onReview: (id: string, status: 'approved' | 'rejected', note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAction = async (status: 'approved' | 'rejected') => {
    setSubmitting(true);
    try {
      await onReview(request.request_id, status, note.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const reasonObj = EXCUSE_REASONS.find(r => r.value === request.reason);

  return (
    <Modal isOpen={true} onClose={onClose} title="Review Excuse Request" size="lg">
      <div className="space-y-5">
        {/* Request Summary */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-lg">
              🎓
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                {request.student?.name || 'Unknown Student'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {request.student?.email}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Course" value={request.session?.course?.course_name || '—'} />
            <InfoRow label="Date" value={request.attendance_date ? format(parseISO(request.attendance_date), 'EEEE, MMM d, yyyy') : '—'} />
            <InfoRow label="Reason" value={reasonObj ? `${reasonObj.icon} ${reasonObj.label}` : request.reason} />
            <InfoRow label="Submitted" value={format(parseISO(request.created_at), 'MMM d, h:mm a')} />
          </div>

          {request.description && (
            <div className="text-sm">
              <span className="text-gray-500 dark:text-gray-400 text-xs font-medium">Description:</span>
              <p className="mt-0.5 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg p-2 text-xs">
                {request.description}
              </p>
            </div>
          )}

          {request.supporting_doc_url && (
            <a
              href={request.supporting_doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              📎 View Document: {request.supporting_doc_name || 'Attachment'}
            </a>
          )}
        </div>

        {/* Review Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Review Note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Add a note for the student..."
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <div className="flex gap-2">
            <Button
              onClick={() => handleAction('rejected')}
              disabled={submitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {submitting ? '...' : '❌ Reject'}
            </Button>
            <Button
              onClick={() => handleAction('approved')}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? '...' : '✅ Approve'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================
// DETAIL MODAL
// =====================================================

function DetailModal({
  request,
  onClose,
}: {
  request: ExcuseRequest;
  onClose: () => void;
}) {
  const status = STATUS_CONFIG[request.status];
  const reasonObj = EXCUSE_REASONS.find(r => r.value === request.reason);

  return (
    <Modal isOpen={true} onClose={onClose} title="Excuse Request Details" size="lg">
      <div className="space-y-5">
        {/* Status Badge */}
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${status.color}`}>
            {status.icon} {status.label}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            ID: {request.request_id.slice(0, 8)}...
          </span>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailCard label="Student" icon="🎓">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{request.student?.name || '—'}</p>
            <p className="text-xs text-gray-500">{request.student?.email}</p>
            {request.student?.phone && <p className="text-xs text-gray-500">📞 {request.student.phone}</p>}
          </DetailCard>

          <DetailCard label="Session" icon="📚">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{request.session?.course?.course_name || '—'}</p>
            <p className="text-xs text-gray-500">Teacher: {request.session?.teacher?.name || '—'}</p>
          </DetailCard>

          <DetailCard label="Absence Date" icon="📅">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {request.attendance_date ? format(parseISO(request.attendance_date), 'EEEE, MMMM d, yyyy') : '—'}
            </p>
          </DetailCard>

          <DetailCard label="Reason" icon={reasonObj?.icon || '📝'}>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {reasonObj?.label || request.reason}
            </p>
          </DetailCard>
        </div>

        {/* Description */}
        {request.description && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</h4>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {request.description}
            </div>
          </div>
        )}

        {/* Supporting Document */}
        {request.supporting_doc_url && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Supporting Document</h4>
            <a
              href={request.supporting_doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-lg text-sm hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
            >
              📎 {request.supporting_doc_name || 'View Document'}
            </a>
          </div>
        )}

        {/* Review Information */}
        {request.reviewed_by && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Review Information</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow label="Reviewed By" value={request.reviewed_by} />
              <InfoRow label="Reviewed At" value={request.reviewed_at ? format(parseISO(request.reviewed_at), 'MMM d, yyyy h:mm a') : '—'} />
            </div>
            {request.review_note && (
              <div className="mt-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300">
                <span className="text-xs text-gray-400">Note: </span>
                {request.review_note}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Timeline</h4>
          <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
            <TimelineItem label="Created" time={request.created_at} />
            {request.updated_at !== request.created_at && (
              <TimelineItem label="Updated" time={request.updated_at} />
            )}
            {request.reviewed_at && (
              <TimelineItem label={`${request.status === 'approved' ? 'Approved' : 'Rejected'}`} time={request.reviewed_at} />
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================
// HELPERS
// =====================================================

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <p className="text-sm text-gray-900 dark:text-white font-medium">{value}</p>
    </div>
  );
}

function DetailCard({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function TimelineItem({ label, time }: { label: string; time: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
      <span className="font-medium">{label}:</span>
      <span>{format(parseISO(time), 'MMM d, yyyy h:mm a')}</span>
      <span className="text-gray-400">({formatDistanceToNow(parseISO(time), { addSuffix: true })})</span>
    </div>
  );
}

export default ExcuseRequests;
