import { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { format, parseISO } from 'date-fns';
import { EXCUSE_REASONS, type ExcuseRequest } from '@/features/excuses/services/excuseRequestService';
import { InfoRow } from '@/features/excuses/components/InfoRow';

export function ReviewModal({
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
