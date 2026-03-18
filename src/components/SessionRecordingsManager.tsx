import { useCallback, useEffect, useState } from 'react';
import { sessionRecordingService } from '../services/sessionRecordingService';
import type { SessionRecording } from '../types/database.types';
import { toast } from './ui/toastUtils';

type Props = {
  sessionId: string;
  courseName: string;
  canManageInAttendance?: boolean;
};

function detectProvider(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('zoom.us') || u.includes('zoom.com')) return 'Zoom';
  if (u.includes('meet.google.com')) return 'Google Meet';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('drive.google.com')) return 'Google Drive';
  if (u.includes('vimeo.com')) return 'Vimeo';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'MS Teams';
  if (u.includes('loom.com')) return 'Loom';
  return '';
}

function getProviderIcon(url: string): string {
  const p = detectProvider(url);
  if (p === 'Zoom') return '🟦';
  if (p === 'Google Meet' || p === 'Google Drive') return '🟩';
  if (p === 'YouTube') return '🔴';
  if (p === 'Vimeo') return '🟣';
  if (p === 'MS Teams') return '🟪';
  if (p === 'Loom') return '🟠';
  return '🔗';
}

function formatRecordingDate(date: string | null): string {
  if (!date) return 'Undated recording';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function SessionRecordingsManager({ sessionId, courseName, canManageInAttendance = false }: Props) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sessionRecordingService.getBySession(sessionId);
    if (error) toast.error('Failed to load recordings.');
    else setRecordings((data || []) as SessionRecording[]);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  const grouped = recordings.reduce<Record<string, SessionRecording[]>>((acc, r) => {
    const key = r.attendance_date || 'No date';
    (acc[key] ??= []).push(r);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => {
    if (a === 'No date') return 1;
    if (b === 'No date') return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">🎥 Session Recordings</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Replays for {courseName}, grouped by attendance date. These links are read from the Attendance page.
          </p>
        </div>
        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-1 rounded-full">
          {recordings.length} link{recordings.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10 p-4">
        <p className="text-sm text-blue-900 dark:text-blue-100 font-medium">
          Students and staff see the same replay list here.
        </p>
        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
          Recording links are managed per session date from Attendance, then mirrored here automatically.
        </p>
        {canManageInAttendance && (
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
            To add or update a replay, open the session in Attendance, choose the date, then save the recording link there.
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-gray-400">Loading...</div>
      ) : recordings.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
          <span className="text-4xl block mb-2">🎬</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No recordings published yet</p>
          <p className="text-xs text-gray-400 mt-1">When a replay link is saved in Attendance for a session date, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {sortedDates.map(date => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 px-1 sticky top-0 bg-white dark:bg-gray-900 py-1">
                📅 {date === 'No date' ? 'No date assigned' : formatRecordingDate(date)}
              </p>
              <div className="space-y-1.5">
                {grouped[date].map(r => (
                  <a
                    key={r.recording_id}
                    href={r.recording_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 px-3 py-3 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{getProviderIcon(r.recording_url || '')}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {r.title || detectProvider(r.recording_url || '') || 'Recording'}
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                          {r.recording_url}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                          {r.provider_name || detectProvider(r.recording_url || '') || 'External link'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300">
                        Open
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}