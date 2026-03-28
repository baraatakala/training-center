import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { EXCUSE_REASONS, type ExcuseRequest } from '@/features/excuses/services/excuseRequestService';
import { STATUS_CONFIG } from '@/features/excuses/constants/excuseConstants';

export function RequestCard({
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
                {' Ã‚Â· '}
                <span className="font-medium">
                  {request.attendance_date ? format(parseISO(request.attendance_date), 'MMM d, yyyy') : 'Ã¢â‚¬â€'}
                </span>
              </p>
            </div>

            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-md">
                {reasonObj?.icon || 'Ã°Å¸â€œÂ'} {reasonObj?.label || request.reason}
              </span>
              {request.supporting_doc_url && (
                <a
                  href={request.supporting_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Ã°Å¸â€œÅ½ {request.supporting_doc_name || 'Document'}
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
                {request.reviewed_at && ` Ã‚Â· ${format(parseISO(request.reviewed_at), 'MMM d, h:mm a')}`}
                {request.review_note && ` Ã¢â‚¬â€ "${request.review_note}"`}
              </p>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end shrink-0">
            <Button variant="outline" size="sm" onClick={onViewDetail} className="min-h-[36px]">
              Ã°Å¸â€˜Â Details
            </Button>
            {isTeacher && isPending && (
              <>
                <Button size="sm" onClick={onQuickApprove} className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[36px]">
                  Ã¢Å“â€¦ Approve
                </Button>
                <Button size="sm" variant="outline" onClick={onQuickReject} className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20 min-h-[36px]">
                  Ã¢ÂÅ’ Reject
                </Button>
                <Button size="sm" variant="outline" onClick={onReview} className="text-gray-600 dark:text-gray-400 min-h-[36px]">
                  Ã°Å¸â€œÂ Review
                </Button>
              </>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={onDelete} className="text-red-500 hover:text-red-700 min-h-[36px]" aria-label="Delete excuse request">
                Ã°Å¸â€”â€˜
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
