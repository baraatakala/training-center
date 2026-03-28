import type { SessionWithDetails, ScheduleConflicts } from '@/features/sessions/constants/sessionConstants';

export function formatLearningMethod(method?: SessionWithDetails['learning_method']) {
  if (method === 'online') return 'Online';
  if (method === 'hybrid') return 'Hybrid';
  return 'Face to Face';
}

export function formatVirtualProvider(provider?: SessionWithDetails['virtual_provider']) {
  if (provider === 'google_meet') return 'Google Meet';
  if (provider === 'microsoft_teams') return 'Microsoft Teams';
  if (provider === 'zoom') return 'Zoom';
  if (provider === 'other') return 'Other';
  return '';
}

export function formatRecordingVisibility(visibility?: SessionWithDetails['default_recording_visibility']) {
  if (!visibility) return '';
  return visibility
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildConflictMessage(conflicts: ScheduleConflicts) {
  if (!conflicts || conflicts.length === 0) return '';

  const preview = conflicts.slice(0, 3).map((conflict) => {
    const timePart = conflict.existingTime ? ` at ${conflict.existingTime}` : '';
    return `${conflict.conflictDate}: ${conflict.courseName}${timePart}`;
  });
  const remaining = conflicts.length - preview.length;

  return [
    'This teacher already has another session on overlapping teaching dates/times.',
    ...preview,
    remaining > 0 ? `+ ${remaining} more conflict${remaining === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join('\n');
}
