import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { EXCUSE_REASONS, type ExcuseRequest } from '@/features/excuses/services/excuseRequestService';
import { STATUS_CONFIG } from '@/features/excuses/constants/excuseConstants';
import { InfoRow } from '@/features/excuses/components/InfoRow';

export function DetailModal({
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
