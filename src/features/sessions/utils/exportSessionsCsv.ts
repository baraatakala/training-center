import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';

export function downloadSessionsCsv(
  sessions: SessionWithDetails[],
  _enrollmentCounts: Record<string, number>,
): void {
  const headers = ['course_name', 'teacher_email', 'start_date', 'end_date', 'day', 'time', 'location', 'grace_period_minutes', 'learning_method', 'virtual_provider', 'virtual_meeting_link', 'requires_recording', 'default_recording_visibility'];
  const rows = sessions.map(s => [
    s.course?.course_name || '',
    s.teacher?.email || '',
    s.start_date,
    s.end_date,
    s.day || '',
    s.time || '',
    s.location || '',
    String(s.grace_period_minutes ?? ''),
    s.learning_method || '',
    s.virtual_provider || '',
    s.virtual_meeting_link || '',
    s.requires_recording ? 'true' : 'false',
    s.default_recording_visibility || '',
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
