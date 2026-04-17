import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { formatDate } from '@/shared/utils/formatDate';
import { TableRow, TableCell } from '@/shared/components/ui/Table';
import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { formatLearningMethod } from '@/features/sessions/utils/sessionHelpers';

export function SessionTableRow({
  session,
  enrollmentCount,
  isTeacher,
  isAdmin: _isAdmin,
  onOpenSchedule,
  onOpenRecordings,
  onEdit,
  onDelete,
  onMerge,
}: {
  session: SessionWithDetails;
  enrollmentCount: number;
  isTeacher: boolean;
  isAdmin: boolean;
  onOpenSchedule: (session: SessionWithDetails) => void;
  onOpenRecordings: (session: SessionWithDetails) => void;
  onEdit: (session: SessionWithDetails) => void;
  onDelete: (session: SessionWithDetails) => void;
  onMerge: (session: SessionWithDetails) => void;
}) {
  const navigate = useNavigate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(session.start_date);
  const endDate = new Date(session.end_date);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  let sessionStatus: 'active' | 'upcoming' | 'completed' = 'active';
  let statusVariant: 'success' | 'warning' | 'default' = 'success';

  if (endDate < today) {
    sessionStatus = 'completed';
    statusVariant = 'default';
  } else if (startDate > today) {
    sessionStatus = 'upcoming';
    statusVariant = 'warning';
  }

  const courseName = session.course?.course_name || 'Unknown Course';
  const teacherName = session.teacher?.name || 'Unknown';
  const category = session.course?.category || '';

  return (
    <TableRow key={session.session_id}>
      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[200px]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{courseName}</span>
            <Badge variant={statusVariant}>{sessionStatus}</Badge>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">{teacherName}</span>
          <div className="flex flex-wrap gap-1 lg:hidden">
            {session.day && <span className="text-xs text-gray-500 dark:text-gray-400">{session.day} {session.time ? `@ ${session.time}` : ''}</span>}
          </div>
          {category && (
            <span className="w-fit">
              <Badge variant={category === 'Programming' ? 'info' : category === 'Design' ? 'success' : 'warning'}>
                {category}
              </Badge>
            </span>
          )}
          <div className="flex flex-wrap gap-1 mt-0.5">
            <Badge variant={session.learning_method === 'online' ? 'info' : session.learning_method === 'hybrid' ? 'warning' : 'default'}>
              {formatLearningMethod(session.learning_method)}
            </Badge>
            {session.feedback_enabled && <Badge variant="info">💬 Feedback</Badge>}
            {session.requires_recording && <Badge variant="success">🎥 Rec</Badge>}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell whitespace-nowrap">
        <div className="flex flex-col">
          <span className="text-sm text-gray-900 dark:text-white">{session.day || 'N/A'}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{session.time || 'N/A'}</span>
        </div>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">{session.location || 'N/A'}</span>
          {session.virtual_meeting_link && (
            <a href={session.virtual_meeting_link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 truncate max-w-[180px]">
              {session.virtual_meeting_link}
            </a>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-center">
        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-sm font-medium">
          {enrollmentCount}
        </span>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex flex-col text-xs text-gray-600 dark:text-gray-300">
          <span>{formatDate(session.start_date)}</span>
          <span className="text-gray-400">→ {formatDate(session.end_date)}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end flex-nowrap">
          {isTeacher && (
            <>
              <Button size="sm" variant="success" onClick={() => navigate(`/attendance/${session.session_id}`)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Attendance">
                📋
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenSchedule(session)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Host Schedule">
                📅
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenRecordings(session)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Recordings">
                🎥
              </Button>
              {session.feedback_enabled && (
                <Button size="sm" variant="outline" onClick={() => navigate(`/feedback-analytics?session=${session.session_id}`)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Feedback">
                  💬
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onMerge(session)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Merge attendance from another session into this one">
                ⇄
              </Button>
              <Button size="sm" variant="outline" onClick={() => onEdit(session)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Edit">
                ✏️
              </Button>
              <button
                onClick={() => onDelete(session)}
                className="px-2.5 py-1.5 text-xs rounded border min-h-[36px] text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                title="Delete"
              >
                🗑️
              </button>
            </>
          )}
          {!isTeacher && (
            <div className="flex gap-1">
              {session.requires_recording && (
                <Button size="sm" variant="outline" onClick={() => onOpenRecordings(session)} className="text-xs px-2.5 py-1.5 min-h-[36px]" title="Recordings">
                  🎥
                </Button>
              )}
              <span className="text-xs text-gray-400 px-2 self-center">View only</span>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
