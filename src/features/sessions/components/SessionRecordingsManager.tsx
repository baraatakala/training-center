import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionRecordingService } from '@/features/sessions/services/sessionRecordingService';
import type { SessionRecording } from '@/shared/types/database.types';
import { toast } from '@/shared/components/ui/toastUtils';

type Props = {
  sessionId: string;
  courseName: string;
  canManageInAttendance?: boolean;
};

// ─── Multi-format provider detection ────────────────────────
const PROVIDERS: Array<{ name: string; icon: string; patterns: RegExp[] }> = [
  { name: 'YouTube', icon: '🔴', patterns: [/youtube\.com\/watch/i, /youtu\.be\//i, /youtube\.com\/embed/i, /youtube\.com\/live/i] },
  { name: 'Google Drive', icon: '🟩', patterns: [/drive\.google\.com/i] },
  { name: 'Google Meet', icon: '🟢', patterns: [/meet\.google\.com/i] },
  { name: 'Zoom', icon: '🟦', patterns: [/zoom\.us/i, /zoom\.com/i] },
  { name: 'MS Teams', icon: '🟪', patterns: [/teams\.microsoft\.com/i, /teams\.live\.com/i] },
  { name: 'Vimeo', icon: '🟣', patterns: [/vimeo\.com/i] },
  { name: 'Loom', icon: '🟠', patterns: [/loom\.com/i] },
  { name: 'Telegram', icon: '✈️', patterns: [/t\.me\//i, /telegram\.me\//i] },
  { name: 'WhatsApp', icon: '💬', patterns: [/wa\.me\//i, /whatsapp\.com/i] },
  { name: 'OneDrive', icon: '☁️', patterns: [/onedrive\.live\.com/i, /1drv\.ms/i, /sharepoint\.com/i] },
  { name: 'Dropbox', icon: '📦', patterns: [/dropbox\.com/i, /dl\.dropboxusercontent\.com/i] },
  { name: 'Samsung Recorder', icon: '📱', patterns: [/samsungcloud/i, /samsung\.com/i] },
  { name: 'Apple iCloud', icon: '🍎', patterns: [/icloud\.com/i] },
  { name: 'Upgone', icon: '🎙️', patterns: [/upgone/i] },
  { name: 'SoundCloud', icon: '🎵', patterns: [/soundcloud\.com/i] },
  { name: 'Streamable', icon: '📹', patterns: [/streamable\.com/i] },
  { name: 'Dailymotion', icon: '🎬', patterns: [/dailymotion\.com/i, /dai\.ly/i] },
  { name: 'Facebook', icon: '🔵', patterns: [/facebook\.com\/.*video/i, /fb\.watch/i] },
  { name: 'Instagram', icon: '📸', patterns: [/instagram\.com/i] },
  { name: 'TikTok', icon: '🎶', patterns: [/tiktok\.com/i] },
];

// Direct media file extensions
const MEDIA_EXTENSIONS = /\.(mp4|webm|ogg|mov|avi|mkv|m4v|mp3|wav|aac|m4a|flac|opus|3gp|wmv|flv)(\?|$)/i;

function detectProvider(url: string): { name: string; icon: string } {
  for (const p of PROVIDERS) {
    if (p.patterns.some(rx => rx.test(url))) return { name: p.name, icon: p.icon };
  }
  if (MEDIA_EXTENSIONS.test(url)) return { name: 'Direct Media', icon: '🎞️' };
  return { name: '', icon: '🔗' };
}

// ─── Embeddable URL transformer ─────────────────────────────
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

// ─── Inline Player Component ────────────────────────────────
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

// ─── HTML escape for safe export ────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function SessionRecordingsManager({ sessionId, courseName, canManageInAttendance = false }: Props) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sessionRecordingService.getBySession(sessionId);
    if (error) toast.error('Failed to load recordings.');
    else setRecordings((data || []) as SessionRecording[]);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

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

  // ─── Helper to download a blob ────────────────────────────
  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const filePrefix = `recordings-${courseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

  // ─── Export Recording Catalog as HTML ───────────────────────
  const handleExportCatalog = useCallback(() => {
    if (recordings.length === 0) {
      toast.error('No recordings to export');
      return;
    }

    const dateRows = sortedDates.map(date => {
      const items = grouped[date];
      const dateLabel = date === 'No date' ? 'Undated' : (() => {
        const d = new Date(`${date}T00:00:00`);
        return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      })();

      const linkCards = items.map(r => {
        const provider = detectProvider(r.recording_url || '');
        const title = r.title || provider.name || 'Recording';
        const meta: string[] = [];
        if (provider.name) meta.push(provider.name);
        if (r.duration_seconds) meta.push(`${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`);
        return `<a href="${escapeHtml(r.recording_url || '')}" target="_blank" rel="noopener noreferrer" class="card">
          <span class="icon">${provider.icon}</span>
          <span class="info">
            <span class="title">${escapeHtml(title)}</span>
            ${meta.length ? `<span class="meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
          </span>
          <span class="play">▶</span>
        </a>`;
      }).join('');

      return `<section class="date-group">
        <div class="date-header">
          <span class="date-label">${escapeHtml(dateLabel)}</span>
          <span class="badge">${items.length}</span>
        </div>
        <div class="cards">${linkCards}</div>
      </section>`;
    }).join('');

    const exportDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recording Catalog — ${escapeHtml(courseName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b;padding:24px 16px;min-height:100vh}
  .wrap{max-width:800px;margin:0 auto}
  .hdr{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px 20px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:12px;color:#fff;margin-bottom:20px}
  .hdr h1{font-size:18px;font-weight:700}
  .hdr .sub{font-size:12px;opacity:.85}
  .hdr .stats{display:flex;gap:16px;font-size:12px;font-weight:600}
  .hdr .stats span{background:rgba(255,255,255,.2);padding:3px 10px;border-radius:6px}
  .date-group{margin-bottom:16px}
  .date-header{display:flex;align-items:center;gap:6px;padding:6px 0;margin-bottom:4px}
  .date-label{font-size:13px;font-weight:600;color:#475569}
  .badge{font-size:10px;background:#e2e8f0;color:#64748b;padding:1px 7px;border-radius:99px;font-weight:600}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
  .card{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s}
  .card:hover{border-color:#93c5fd;box-shadow:0 2px 8px rgba(37,99,235,.12)}
  .icon{font-size:20px;flex-shrink:0;width:28px;text-align:center}
  .info{flex:1;min-width:0;overflow:hidden}
  .title{display:block;font-size:13px;font-weight:600;color:#1e40af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .meta{display:block;font-size:11px;color:#94a3b8;margin-top:1px}
  .play{font-size:11px;color:#2563eb;font-weight:700;flex-shrink:0}
  .ftr{text-align:center;margin-top:20px;font-size:11px;color:#94a3b8}
  @media print{body{background:#fff;padding:12px}.hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}.card{break-inside:avoid;box-shadow:none;border:1px solid #ddd}}
  @media(max-width:480px){.cards{grid-template-columns:1fr}.hdr{flex-direction:column;text-align:center}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div>
      <h1>${escapeHtml(courseName)}</h1>
      <div class="sub">Recording Catalog · ${escapeHtml(exportDate)}</div>
    </div>
    <div class="stats">
      <span>${recordings.length} recordings</span>
      <span>${sortedDates.filter(d => d !== 'No date').length} dates</span>
    </div>
  </div>
  ${dateRows}
  <div class="ftr">Generated by Training Center</div>
</div>
</body>
</html>`;

    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${filePrefix}.html`);
    toast.success(`Exported ${recordings.length} recording${recordings.length > 1 ? 's' : ''} as HTML catalog`);
    setShowExportMenu(false);
  }, [recordings, sortedDates, grouped, courseName, downloadBlob, filePrefix]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">🎥 Session Recordings</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Replays for {courseName}, grouped by attendance date. Supports YouTube, Zoom, Drive, Vimeo, Loom, Samsung Recorder, Upgone, direct media files, and more.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recordings.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(prev => !prev)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-sm hover:shadow"
              >
                📥 Export ▾
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-9 z-50 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 overflow-hidden">
                  <button onClick={handleExportCatalog} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2">
                    🌐 <span>HTML Catalog</span>
                  </button>
                </div>
              )}
            </div>
          )}
          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-1 rounded-full">
            {recordings.length} link{recordings.length === 1 ? '' : 's'}
          </span>
        </div>
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
          <span className="text-4xl block mb-2">🎬</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No recordings published yet</p>
          <p className="text-xs text-gray-400 mt-1">When a replay link is saved in Attendance for a session date, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          {sortedDates.map(date => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 px-1 sticky top-0 bg-white dark:bg-gray-900 py-1 z-10">
                📅 {date === 'No date' ? 'No date assigned' : formatRecordingDate(date)}
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
                            {r.duration_seconds ? ` · ${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : ''}
                            {r.mime_type ? ` · ${r.mime_type}` : ''}
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
                              {isExpanded ? '▲ Hide' : '▶ Play'}
                            </button>
                          )}
                          <a
                            href={r.recording_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-700 dark:text-blue-300 px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            Open ↗
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