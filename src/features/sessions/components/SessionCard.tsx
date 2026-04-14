import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { formatDate } from '@/shared/utils/formatDate';
import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { formatLearningMethod, formatVirtualProvider, formatRecordingVisibility } from '@/features/sessions/utils/sessionHelpers';

export function SessionCard({
  session,
  enrollmentCount,
  isTeacher,
  isAdmin,
  cloneCount: _cloneCount,
  onOpenSchedule,
  onOpenRecordings,
  onClone,
  onEdit,
  onDelete,
  onMerge,
}: {
  session: SessionWithDetails;
  enrollmentCount: number;
  isTeacher: boolean;
  isAdmin: boolean;
  cloneCount?: number;
  onOpenSchedule: (session: SessionWithDetails) => void;
  onOpenRecordings: (session: SessionWithDetails) => void;
  onClone: (session: SessionWithDetails) => void;
  onEdit: (session: SessionWithDetails) => void;
  onDelete: (session: SessionWithDetails) => void;
  onMerge: (session: SessionWithDetails) => void;
}) {
  const navigate = useNavigate();

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const startDate = new Date(session.start_date);
  const endDate = new Date(session.end_date);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  let sessionStatus: 'active' | 'upcoming' | 'completed' = 'active';
  let statusVariant: 'success' | 'warning' | 'default' = 'success';
  let statusColor = 'border-green-300 dark:border-green-700';

  if (endDate < todayDate) {
    sessionStatus = 'completed';
    statusVariant = 'default';
    statusColor = 'border-gray-300 dark:border-gray-600';
  } else if (startDate > todayDate) {
    sessionStatus = 'upcoming';
    statusVariant = 'warning';
    statusColor = 'border-yellow-300 dark:border-yellow-700';
  }

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow dark:shadow-gray-900/30 border-l-4 ${statusColor} p-4 flex flex-col gap-3 hover:shadow-md transition-shadow`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate text-lg">
            {session.course?.course_name || 'Unknown Course'}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {session.teacher?.name || 'Unknown'}
          </p>
        </div>
        <Badge variant={statusVariant}>{sessionStatus}</Badge>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
          <Badge
            variant={
            session.course?.category === 'Programming'
                ? 'info'
                : session.course?.category === 'Design'
                ? 'success'
                : 'warning'
            }
          >
            {session.course?.category || ''}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <span className="font-medium text-blue-700 dark:text-blue-400">{enrollmentCount} enrolled</span>
        </div>
        {session.day && (
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span>{session.day}</span>
          </div>
        )}
        {session.time && (
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{session.time}</span>
          </div>
        )}
        {session.location && (
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 col-span-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="truncate">{session.location}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={session.learning_method === 'online' ? 'info' : session.learning_method === 'hybrid' ? 'warning' : 'default'}>
          {formatLearningMethod(session.learning_method)}
        </Badge>
        {session.virtual_provider && (
          <Badge variant="info">{formatVirtualProvider(session.virtual_provider)}</Badge>
        )}
        {session.requires_recording && (
          <Badge variant="success">🎥 {formatRecordingVisibility(session.default_recording_visibility) || 'Recording'}</Badge>
        )}
        {session.feedback_enabled && (
          <Badge variant="info">💬 {!isTeacher && !isAdmin ? 'After Check-In' : 'Feedback'}</Badge>
        )}
        {session.grace_period_minutes != null && session.grace_period_minutes > 0 && (
          <Badge variant="default">⏱ {session.grace_period_minutes}m grace</Badge>
        )}
        {session.teacher_can_host === false && (
          <Badge variant="warning">🏫 Student-hosted</Badge>
        )}
      </div>

      {session.virtual_meeting_link && (
        <a
          href={session.virtual_meeting_link}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 truncate"
        >
          {session.virtual_meeting_link}
        </a>
      )}

      {/* Dates */}
      <div className="text-xs text-gray-500 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2">
        {formatDate(session.start_date)} — {formatDate(session.end_date)}
      </div>

      {/* Action Buttons */}
      <div className="pt-1 space-y-2">
        {isTeacher && (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
            <Button
              size="sm"
              variant="success"
              onClick={() => navigate(`/attendance/${session.session_id}`)}
              className="w-full min-h-[36px] justify-center"
            >
              📋 Attendance
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenSchedule(session)}
              className="w-full min-h-[36px] justify-center"
            >
              📅 Host Schedule
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenRecordings(session)}
              className="w-full min-h-[36px] justify-center"
            >
              🎥 Recordings
            </Button>
            {session.feedback_enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)}
                className="w-full min-h-[36px] justify-center"
              >
                💬 Feedback
              </Button>
            )}
          </div>
        )}
        {isAdmin && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onClone(session)}
              title="Clone session with new dates and copy all students"
              className="w-full min-h-[36px] justify-center"
            >
              📋 Clone
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMerge(session)}
              title="Merge attendance from another session into this one"
              className="w-full min-h-[36px] justify-center"
            >
              ⇄ Merge From
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(session)}
              className="w-full min-h-[36px] justify-center"
            >
              ✏️ Edit
            </Button>
            {!isTeacher && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenRecordings(session)}
                className="w-full min-h-[36px] justify-center"
              >
                🎥 Recordings
              </Button>
            )}
            {!isTeacher && session.feedback_enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)}
                className="w-full min-h-[36px] justify-center"
              >
                💬 Feedback
              </Button>
            )}
            <button
              onClick={() => onDelete(session)}
              className="px-3 py-2 text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors min-h-[36px]"
              title="Delete session"
            >
              🗑️ Delete
            </button>
          </div>
        )}
        {!isTeacher && !isAdmin && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
            {session.requires_recording && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenRecordings(session)}
                className="min-h-[36px] justify-center"
              >
                🎥 View Recordings
              </Button>
            )}
            <span className="text-xs text-gray-400 px-2 py-1">View only</span>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              <p>Check-in opens from the teacher&apos;s QR or face link on the session date.</p>
              {session.feedback_enabled && <p className="mt-1">Feedback appears after successful check-in.</p>}
              {session.requires_recording && <p className="mt-1">Replay links appear here after staff publish them for a date.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
