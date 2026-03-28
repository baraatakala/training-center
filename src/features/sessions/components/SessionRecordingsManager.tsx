import { useCallback, useEffect, useState } from 'react';
import { sessionRecordingService } from '@/features/sessions/services/sessionRecordingService';
import type { SessionRecording } from '@/shared/types/database.types';
import { toast } from '@/shared/components/ui/toastUtils';

type Props = {
  sessionId: string;
  courseName: string;
  canManageInAttendance?: boolean;
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Multi-format provider detection Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const PROVIDERS: Array<{ name: string; icon: string; patterns: RegExp[] }> = [
  { name: 'YouTube', icon: 'Ã°Å¸â€Â´', patterns: [/youtube\.com\/watch/i, /youtu\.be\//i, /youtube\.com\/embed/i, /youtube\.com\/live/i] },
  { name: 'Google Drive', icon: 'Ã°Å¸Å¸Â©', patterns: [/drive\.google\.com/i] },
  { name: 'Google Meet', icon: 'Ã°Å¸Å¸Â¢', patterns: [/meet\.google\.com/i] },
  { name: 'Zoom', icon: 'Ã°Å¸Å¸Â¦', patterns: [/zoom\.us/i, /zoom\.com/i] },
  { name: 'MS Teams', icon: 'Ã°Å¸Å¸Âª', patterns: [/teams\.microsoft\.com/i, /teams\.live\.com/i] },
  { name: 'Vimeo', icon: 'Ã°Å¸Å¸Â£', patterns: [/vimeo\.com/i] },
  { name: 'Loom', icon: 'Ã°Å¸Å¸Â ', patterns: [/loom\.com/i] },
  { name: 'Telegram', icon: 'Ã¢Å“Ë†Ã¯Â¸Â', patterns: [/t\.me\//i, /telegram\.me\//i] },
  { name: 'WhatsApp', icon: 'Ã°Å¸â€™Â¬', patterns: [/wa\.me\//i, /whatsapp\.com/i] },
  { name: 'OneDrive', icon: 'Ã¢ËœÂÃ¯Â¸Â', patterns: [/onedrive\.live\.com/i, /1drv\.ms/i, /sharepoint\.com/i] },
  { name: 'Dropbox', icon: 'Ã°Å¸â€œÂ¦', patterns: [/dropbox\.com/i, /dl\.dropboxusercontent\.com/i] },
  { name: 'Samsung Recorder', icon: 'Ã°Å¸â€œÂ±', patterns: [/samsungcloud/i, /samsung\.com/i] },
  { name: 'Apple iCloud', icon: 'Ã°Å¸ÂÅ½', patterns: [/icloud\.com/i] },
  { name: 'Upgone', icon: 'Ã°Å¸Å½â„¢Ã¯Â¸Â', patterns: [/upgone/i] },
  { name: 'SoundCloud', icon: 'Ã°Å¸Å½Âµ', patterns: [/soundcloud\.com/i] },
  { name: 'Streamable', icon: 'Ã°Å¸â€œÂ¹', patterns: [/streamable\.com/i] },
  { name: 'Dailymotion', icon: 'Ã°Å¸Å½Â¬', patterns: [/dailymotion\.com/i, /dai\.ly/i] },
  { name: 'Facebook', icon: 'Ã°Å¸â€Âµ', patterns: [/facebook\.com\/.*video/i, /fb\.watch/i] },
  { name: 'Instagram', icon: 'Ã°Å¸â€œÂ¸', patterns: [/instagram\.com/i] },
  { name: 'TikTok', icon: 'Ã°Å¸Å½Â¶', patterns: [/tiktok\.com/i] },
];

// Direct media file extensions
const MEDIA_EXTENSIONS = /\.(mp4|webm|ogg|mov|avi|mkv|m4v|mp3|wav|aac|m4a|flac|opus|3gp|wmv|flv)(\?|$)/i;

function detectProvider(url: string): { name: string; icon: string } {
  for (const p of PROVIDERS) {
    if (p.patterns.some(rx => rx.test(url))) return { name: p.name, icon: p.icon };
  }
  if (MEDIA_EXTENSIONS.test(url)) return { name: 'Direct Media', icon: 'Ã°Å¸Å½Å¾Ã¯Â¸Â' };
  return { name: '', icon: 'Ã°Å¸â€â€”' };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Embeddable URL transformer Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function getEmbedUrl(url: string): string | null {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  // Loom
  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;

  // Streamable
  const streamableMatch = url.match(/streamable\.com\/([a-zA-Z0-9]+)/);
  if (streamableMatch) return `https://streamable.com/e/${streamableMatch[1]}`;

  // Dailymotion
  const dmMatch = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/);
  if (dmMatch) return `https://www.dailymotion.com/embed/video/${dmMatch[1]}`;

  // Google Drive video
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;

  return null;
}

function isDirectMediaUrl(url: string): boolean {
  return MEDIA_EXTENSIONS.test(url);
}

function getMediaType(url: string): 'video' | 'audio' {
  if (/\.(mp3|wav|aac|m4a|flac|opus|ogg)(\?|$)/i.test(url)) return 'audio';
  return 'video';
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Inline Player Component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function RecordingPlayer({ url }: { url: string }) {
  const embedUrl = getEmbedUrl(url);

  if (embedUrl) {
    return (
      <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black aspect-video">
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Recording"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>
    );
  }

  if (isDirectMediaUrl(url)) {
    const mediaType = getMediaType(url);
    if (mediaType === 'audio') {
      return (
        <div className="mt-2">
          <audio controls className="w-full rounded-lg" preload="metadata">
            <source src={url} />
            Your browser does not support the audio element.
          </audio>
        </div>
      );
    }
    return (
      <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black aspect-video">
        <video controls className="w-full h-full" preload="metadata">
          <source src={url} />
          Your browser does not support the video element.
        </video>
      </div>
    );
  }

  return null;
}

export function SessionRecordingsManager({ sessionId, courseName, canManageInAttendance = false }: Props) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Ã°Å¸Å½Â¥ Session Recordings</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Replays for {courseName}, grouped by attendance date. Supports YouTube, Zoom, Drive, Vimeo, Loom, Samsung Recorder, Upgone, direct media files, and more.
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
          Videos from YouTube, Vimeo, Loom, Streamable, Dailymotion, and Google Drive play inline.
          Audio and video files (MP4, MP3, WAV, etc.) play directly in the browser.
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
          <span className="text-4xl block mb-2">Ã°Å¸Å½Â¬</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No recordings published yet</p>
          <p className="text-xs text-gray-400 mt-1">When a replay link is saved in Attendance for a session date, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          {sortedDates.map(date => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 px-1 sticky top-0 bg-white dark:bg-gray-900 py-1 z-10">
                Ã°Å¸â€œâ€¦ {date === 'No date' ? 'No date assigned' : formatRecordingDate(date)}
                <span className="ml-2 text-[10px] text-gray-400">({grouped[date].length} recording{grouped[date].length > 1 ? 's' : ''})</span>
              </p>
              <div className="space-y-1.5">
                {grouped[date].map(r => {
                  const provider = detectProvider(r.recording_url || '');
                  const hasPlayer = !!(getEmbedUrl(r.recording_url || '') || isDirectMediaUrl(r.recording_url || ''));
                  const isExpanded = expandedId === r.recording_id;

                  return (
                    <div key={r.recording_id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 transition-colors">
                      <div className="flex items-center gap-3 px-3 py-3">
                        <span className="text-lg shrink-0">{provider.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {r.title || provider.name || 'Recording'}
                          </p>
                          <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{r.recording_url}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                            {provider.name || 'External link'}
                            {r.duration_seconds ? ` Ã‚Â· ${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : ''}
                            {r.mime_type ? ` Ã‚Â· ${r.mime_type}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {hasPlayer && (
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : r.recording_id)}
                              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                                isExpanded
                                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                              }`}
                            >
                              {isExpanded ? 'Ã¢â€“Â² Hide' : 'Ã¢â€“Â¶ Play'}
                            </button>
                          )}
                          <a
                            href={r.recording_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-700 dark:text-blue-300 px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            Open Ã¢â€ â€”
                          </a>
                        </div>
                      </div>
                      {isExpanded && r.recording_url && (
                        <div className="px-3 pb-3">
                          <RecordingPlayer url={r.recording_url} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}