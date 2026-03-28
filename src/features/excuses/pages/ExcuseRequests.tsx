import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Select } from '@/shared/components/ui/Select';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/components/ui/toastUtils';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useAuth } from '@/features/auth/AuthContext';
import {
  excuseRequestService,
  type ExcuseRequest,
} from '@/features/excuses/services/excuseRequestService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { StatsCard } from '@/features/excuses/components/StatsCard';
import { RequestCard } from '@/features/excuses/components/RequestCard';
import { CreateRequestModal } from '@/features/excuses/components/CreateRequestModal';
import { ReviewModal } from '@/features/excuses/components/ReviewModal';
import { DetailModal } from '@/features/excuses/components/DetailModal';

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
            Ã°Å¸â€œâ€¹ Excuse Requests
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isTeacher
              ? 'Review and manage student absence excuse requests'
              : 'Submit and track your absence excuse requests'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refresh} variant="outline" size="sm">
            Ã°Å¸â€â€ž Refresh
          </Button>
          {!isTeacher && (
            <Button onClick={() => setShowCreateModal(true)} size="sm">
              Ã¢Å¾â€¢ New Request
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatsCard label="Total" value={stats.total} color="text-blue-600 dark:text-blue-400" icon="Ã°Å¸â€œÅ " />
        <StatsCard label="Pending" value={stats.pending} color="text-amber-600 dark:text-amber-400" icon="Ã¢ÂÂ³" highlight={stats.pending > 0} />
        <StatsCard label="Approved" value={stats.approved} color="text-emerald-600 dark:text-emerald-400" icon="Ã¢Å“â€¦" />
        <StatsCard label="Rejected" value={stats.rejected} color="text-red-600 dark:text-red-400" icon="Ã¢ÂÅ’" />
        <StatsCard label="Approval %" value={`${stats.approvalRate}%`} color="text-purple-600 dark:text-purple-400" icon="Ã°Å¸â€œË†" className="hidden lg:block" />
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
                { value: 'pending', label: 'Ã¢ÂÂ³ Pending' },
                { value: 'approved', label: 'Ã¢Å“â€¦ Approved' },
                { value: 'rejected', label: 'Ã¢ÂÅ’ Rejected' },
                { value: 'cancelled', label: 'Ã°Å¸Å¡Â« Cancelled' },
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
            <div className="text-4xl mb-3">Ã°Å¸â€œÂ­</div>
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
