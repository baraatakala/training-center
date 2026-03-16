import { supabase } from '../lib/supabase';
import {
  Tables,
  type CreateSessionRecording,
  type UpdateSessionRecording,
} from '../types/database.types';
import { logDelete, logInsert, logUpdate } from './auditService';

export const sessionRecordingService = {
  async getBySession(sessionId: string, attendanceDate?: string) {
    let query = supabase
      .from(Tables.SESSION_RECORDING)
      .select('*')
      .eq('session_id', sessionId)
      .is('deleted_at', null)
      .order('attendance_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (attendanceDate) {
      query = query.eq('attendance_date', attendanceDate);
    }

    return await query;
  },

  async create(recording: CreateSessionRecording) {
    const result = await supabase
      .from(Tables.SESSION_RECORDING)
      .insert(recording)
      .select()
      .single();

    if (result.data) {
      try { await logInsert('session_recording', result.data.recording_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return result;
  },

  async update(recordingId: string, updates: UpdateSessionRecording) {
    const { data: oldData } = await supabase
      .from(Tables.SESSION_RECORDING)
      .select('*')
      .eq('recording_id', recordingId)
      .single();

    const result = await supabase
      .from(Tables.SESSION_RECORDING)
      .update(updates)
      .eq('recording_id', recordingId)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logUpdate('session_recording', recordingId, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return result;
  },

  async softDelete(recordingId: string) {
    const { data: oldData } = await supabase
      .from(Tables.SESSION_RECORDING)
      .select('*')
      .eq('recording_id', recordingId)
      .single();

    const result = await supabase
      .from(Tables.SESSION_RECORDING)
      .update({ deleted_at: new Date().toISOString(), is_primary: false })
      .eq('recording_id', recordingId)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logDelete('session_recording', recordingId, oldData as Record<string, unknown>, 'Soft deleted recording'); } catch { /* audit non-critical */ }
    }

    return result;
  },
};