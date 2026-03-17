import { useEffect, useMemo, useState } from 'react';
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

type RecordingFormState = {
  attendance_date: string;
  title: string;
  recording_type: SessionRecording['recording_type'];
  recording_url: string;
  recording_storage_location: SessionRecording['recording_storage_location'];
  recording_visibility: SessionRecording['recording_visibility'];
  provider_name: string;
  is_primary: boolean;
};

const defaultForm = (visibility?: SessionRecording['recording_visibility']): RecordingFormState => ({
  attendance_date: '',
  title: '',
  recording_type: 'uploaded_recording',
  recording_url: '',
  recording_storage_location: 'external_link',
  recording_visibility: visibility || 'course_staff',
  provider_name: '',
  is_primary: false,
});

function formatVisibility(value: SessionRecording['recording_visibility']) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatRecordingType(value: SessionRecording['recording_type']) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function SessionRecordingsManager({ sessionId, courseName, requiresRecording, defaultVisibility }: Props) {
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecordingFormState>(() => defaultForm(defaultVisibility));

  const resetForm = () => {
    setEditingId(null);
    setForm(defaultForm(defaultVisibility));
  };

  const loadRecordings = async () => {
    setLoading(true);
    const { data, error } = await sessionRecordingService.getBySession(sessionId);
    if (error) {
      console.error('Load recordings error:', error);
      toast.error('Failed to load session recordings.');
    } else {
      setRecordings((data || []) as SessionRecording[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRecordings();
  }, [sessionId]);

  useEffect(() => {
    if (!editingId) {
      setForm(defaultForm(defaultVisibility));
    }
  }, [defaultVisibility, editingId]);

  const primaryRecording = useMemo(
    () => recordings.find((recording) => recording.is_primary) || null,
    [recordings]
  );

  const applyPrimaryState = async (nextPrimaryId?: string) => {
    const updates = recordings
      .filter((recording) => recording.recording_id !== nextPrimaryId && recording.is_primary)
      .map((recording) => sessionRecordingService.update(recording.recording_id, { is_primary: false }));

    if (updates.length > 0) {
      await Promise.all(updates);
    }
  };

  const handleSubmit = async () => {
    if (!form.recording_url.trim()) {
      toast.error('Recording link is required.');
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload: CreateSessionRecording = {
      session_id: sessionId,
      attendance_date: form.attendance_date || null,
      recording_type: form.recording_type,
      recording_url: form.recording_url.trim(),
      recording_storage_location: form.recording_storage_location,
      storage_bucket: null,
      storage_path: null,
      recording_uploaded_by: user?.email || null,
      recording_visibility: form.recording_visibility,
      title: form.title.trim() || null,
      duration_seconds: null,
      file_size_bytes: null,
      mime_type: null,
      provider_name: form.provider_name.trim() || null,
      provider_recording_id: null,
      is_primary: form.is_primary,
    };

    if (form.is_primary) {
      await applyPrimaryState(editingId || undefined);
    }

    const result = editingId
      ? await sessionRecordingService.update(editingId, payload)
      : await sessionRecordingService.create(payload);

    if (result.error) {
      console.error('Save recording error:', result.error);
      toast.error('Failed to save recording.');
      setSaving(false);
      return;
    }

    toast.success(editingId ? 'Recording updated.' : 'Recording added.');
    resetForm();
    await loadRecordings();
    setSaving(false);
  };

  const handleEdit = (recording: SessionRecording) => {
    setEditingId(recording.recording_id);
    setForm({
      attendance_date: recording.attendance_date || '',
      title: recording.title || '',
      recording_type: recording.recording_type,
      recording_url: recording.recording_url || '',
      recording_storage_location: recording.recording_storage_location,
      recording_visibility: recording.recording_visibility,
      provider_name: recording.provider_name || '',
      is_primary: recording.is_primary,
    });
  };

  const handleDelete = async (recordingId: string) => {
    const result = await sessionRecordingService.softDelete(recordingId);
    if (result.error) {
      console.error('Delete recording error:', result.error);
      toast.error('Failed to archive recording.');
      return;
    }

    if (editingId === recordingId) {
      resetForm();
    }

    toast.success('Recording archived.');
    await loadRecordings();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/80 dark:bg-blue-900/10 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">Session Recordings</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Manage replay links and uploaded recording references for {courseName}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${requiresRecording ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
              {requiresRecording ? 'Session expects recordings' : 'Optional recording session'}
            </span>
            {primaryRecording && (
              <span className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-3 py-1 text-xs font-medium">
                Primary: {primaryRecording.title || 'Untitled recording'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr,1.05fr] gap-6">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 sm:p-5 space-y-4">
          <div>
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">
              {editingId ? 'Edit Recording' : 'Add Recording'}
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Use external links or hosted replay URLs. Storage metadata can be expanded later if you move files into Supabase Storage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Recording Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Week 3 revision session"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Attendance Date</label>
              <input
                type="date"
                value={form.attendance_date}
                onChange={(e) => setForm((prev) => ({ ...prev, attendance_date: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Provider</label>
              <input
                value={form.provider_name}
                onChange={(e) => setForm((prev) => ({ ...prev, provider_name: e.target.value }))}
                placeholder="Zoom, Google Meet, YouTube"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Recording Type</label>
              <select
                value={form.recording_type}
                onChange={(e) => setForm((prev) => ({ ...prev, recording_type: e.target.value as SessionRecording['recording_type'] }))}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              >
                <option value="uploaded_recording">Uploaded Recording</option>
                <option value="zoom_recording">Zoom Recording</option>
                <option value="google_meet_recording">Google Meet Recording</option>
                <option value="teacher_mobile_recording">Teacher Mobile Recording</option>
                <option value="external_stream">External Stream</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Storage Mode</label>
              <select
                value={form.recording_storage_location}
                onChange={(e) => setForm((prev) => ({ ...prev, recording_storage_location: e.target.value as SessionRecording['recording_storage_location'] }))}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              >
                <option value="external_link">External Link</option>
                <option value="streaming_link">Streaming Link</option>
                <option value="provider_managed">Provider Managed</option>
                <option value="supabase_storage">Supabase Storage</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Recording Link</label>
              <input
                type="url"
                value={form.recording_url}
                onChange={(e) => setForm((prev) => ({ ...prev, recording_url: e.target.value }))}
                placeholder="https://..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Visibility</label>
              <select
                value={form.recording_visibility}
                onChange={(e) => setForm((prev) => ({ ...prev, recording_visibility: e.target.value as SessionRecording['recording_visibility'] }))}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
              >
                <option value="private_staff">Private Staff</option>
                <option value="course_staff">Course Staff</option>
                <option value="enrolled_students">Enrolled Students</option>
                <option value="organization">Organization</option>
                <option value="public_link">Public Link</option>
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5 mt-5">
              <input
                type="checkbox"
                checked={form.is_primary}
                onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Mark as primary session recording</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update Recording' : 'Add Recording'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm}>
                Cancel Edit
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 sm:p-5 space-y-4">
          <div>
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">Saved Recordings</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Archive links by session date so staff and students can find the right replay quickly.
            </p>
          </div>

          {loading ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-sm text-gray-500 dark:text-gray-400 text-center">
              Loading recordings...
            </div>
          ) : recordings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-sm text-gray-500 dark:text-gray-400 text-center">
              No recordings saved for this session yet.
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {recordings.map((recording) => (
                <div key={recording.recording_id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {recording.title || 'Untitled recording'}
                        </p>
                        {recording.is_primary && (
                          <span className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-1 text-gray-700 dark:text-gray-300">
                          {formatRecordingType(recording.recording_type)}
                        </span>
                        <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-1 text-blue-700 dark:text-blue-300">
                          {formatVisibility(recording.recording_visibility)}
                        </span>
                        {recording.attendance_date && (
                          <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                            {recording.attendance_date}
                          </span>
                        )}
                        {recording.provider_name && (
                          <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-1 text-amber-700 dark:text-amber-300">
                            {recording.provider_name}
                          </span>
                        )}
                      </div>
                      {recording.recording_url && (
                        <a
                          href={recording.recording_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block mt-3 text-sm text-blue-600 dark:text-blue-400 break-all hover:underline"
                        >
                          {recording.recording_url}
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto sm:min-w-[220px]">
                      <Button variant="outline" onClick={() => handleEdit(recording)} className="w-full justify-center">
                        Edit
                      </Button>
                      <Button variant="outline" onClick={() => handleDelete(recording.recording_id)} className="w-full justify-center">
                        Archive
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}