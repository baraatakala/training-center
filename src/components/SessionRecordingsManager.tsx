import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { sessionRecordingService } from '../services/sessionRecordingService';
import { supabase } from '../lib/supabase';
import type { SessionRecording, CreateSessionRecording } from '../types/database.types';
import { toast } from './ui/toastUtils';

type Props = {
  sessionId: string;
  courseName: string;
  requiresRecording?: boolean;
  defaultVisibility?: SessionRecording['recording_visibility'];
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

export function SessionRecordingsManager({ sessionId, courseName }: Props) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');

  const resetForm = () => { setEditingId(null); setFormDate(''); setFormTitle(''); setFormUrl(''); };

  const loadRecordings = async () => {
    setLoading(true);
    const { data, error } = await sessionRecordingService.getBySession(sessionId);
    if (error) toast.error('Failed to load recordings.');
    else setRecordings((data || []) as SessionRecording[]);
    setLoading(false);
  };

  useEffect(() => { loadRecordings(); }, [sessionId]);

  const handleSubmit = async () => {
    const url = formUrl.trim();
    if (!url) { toast.error('Recording link is required.'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const provider = detectProvider(url);

    if (editingId) {
      const result = await sessionRecordingService.update(editingId, {
        attendance_date: formDate || null,
        title: formTitle.trim() || null,
        recording_url: url,
        provider_name: provider || null,
      });
      if (result.error) { toast.error('Failed to update.'); setSaving(false); return; }
      toast.success('Updated.');
    } else {
      const payload: CreateSessionRecording = {
        session_id: sessionId,
        attendance_date: formDate || null,
        recording_type: 'external_stream',
        recording_url: url,
        recording_storage_location: 'external_link',
        storage_bucket: null,
        storage_path: null,
        recording_uploaded_by: user?.email || null,
        recording_visibility: 'enrolled_students',
        title: formTitle.trim() || null,
        duration_seconds: null,
        file_size_bytes: null,
        mime_type: null,
        provider_name: provider || null,
        provider_recording_id: null,
        is_primary: false,
      };
      const result = await sessionRecordingService.create(payload);
      if (result.error) { toast.error('Failed to add.'); setSaving(false); return; }
      toast.success('Recording added.');
    }
    resetForm();
    await loadRecordings();
    setSaving(false);
  };

  const handleEdit = (r: SessionRecording) => {
    setEditingId(r.recording_id);
    setFormDate(r.attendance_date || '');
    setFormTitle(r.title || '');
    setFormUrl(r.recording_url || '');
  };

  const handleDelete = async (id: string) => {
    const result = await sessionRecordingService.softDelete(id);
    if (result.error) { toast.error('Failed to delete.'); return; }
    if (editingId === id) resetForm();
    toast.success('Removed.');
    await loadRecordings();
  };

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
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">🎥 Recording Links</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Add replay links for {courseName}. Accepts any URL — YouTube, Zoom, Meet, Drive, etc.
          </p>
        </div>
        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-1 rounded-full">
          {recordings.length} link{recordings.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-4 space-y-3">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
          {editingId ? '✏️ Edit Recording' : '➕ Add Recording'}
        </p>
        <input
          type="url"
          value={formUrl}
          onChange={e => setFormUrl(e.target.value)}
          placeholder="Paste recording link..."
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
          onKeyDown={e => { if (e.key === 'Enter' && formUrl.trim()) handleSubmit(); }}
        />
        {formUrl.trim() && detectProvider(formUrl) && (
          <p className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
            {getProviderIcon(formUrl)} Detected: {detectProvider(formUrl)}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            title="Session date (optional)" />
          <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Title (optional)"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400" />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={saving || !formUrl.trim()} size="sm">
            {saving ? 'Saving...' : editingId ? '💾 Update' : '➕ Add'}
          </Button>
          {editingId && <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-gray-400">Loading...</div>
      ) : recordings.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
          <span className="text-4xl block mb-2">🎬</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No recordings yet</p>
          <p className="text-xs text-gray-400 mt-1">Paste a link above to get started.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {sortedDates.map(date => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 px-1 sticky top-0 bg-white dark:bg-gray-900 py-1">
                📅 {date === 'No date' ? 'No date assigned' : date}
              </p>
              <div className="space-y-1.5">
                {grouped[date].map(r => (
                  <div key={r.recording_id} className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 px-3 py-2.5 hover:border-blue-200 dark:hover:border-blue-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{getProviderIcon(r.recording_url || '')}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {r.title || detectProvider(r.recording_url || '') || 'Recording'}
                        </p>
                        <a href={r.recording_url || '#'} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block"
                          onClick={e => e.stopPropagation()}>
                          {r.recording_url}
                        </a>
                      </div>
                      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => handleEdit(r)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600" title="Edit">✏️</button>
                        <button type="button" onClick={() => handleDelete(r.recording_id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500" title="Delete">🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}