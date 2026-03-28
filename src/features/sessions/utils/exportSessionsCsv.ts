import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { formatLearningMethod, formatVirtualProvider, formatRecordingVisibility } from '@/features/sessions/utils/sessionHelpers';

export function downloadSessionsCsv(
  sessions: SessionWithDetails[],
  enrollmentCounts: Record<string, number>,
): void {
  const headers = ['Course', 'Category', 'Teacher', 'Start Date', 'End Date', 'Day', 'Time', 'Location', 'Learning Method', 'Virtual Provider', 'Meeting Link', 'Requires Recording', 'Recording Visibility', 'Feedback Enabled', 'Anonymous Feedback', 'Teacher Can Host', 'Enrolled'];
  const rows = sessions.map(s => [
    s.course?.course_name || '',
    s.course?.category || '',
    s.teacher?.name || '',
    s.start_date,
    s.end_date,
    s.day || '',
    s.time || '',
    s.location || '',
    formatLearningMethod(s.learning_method),
    formatVirtualProvider(s.virtual_provider),
    s.virtual_meeting_link || '',
    s.requires_recording ? 'Yes' : 'No',
    formatRecordingVisibility(s.default_recording_visibility),
    s.feedback_enabled ? 'Yes' : 'No',
    s.feedback_anonymous_allowed ? 'Yes' : 'No',
    s.teacher_can_host ? 'Yes' : 'No',
    String(enrollmentCounts[s.session_id] || 0),
  ]);
  const csvContent = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sessions-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
