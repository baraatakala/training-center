import { supabase } from '@/shared/lib/supabase';
import type { 
  CreateAttendance, 
  UpdateAttendance
} from '@/shared/types/database.types';
import { logDelete, logUpdate, logInsert } from '@/shared/services/auditService';
import { Tables } from '@/shared/types/database.types';
import { DEFAULT_SCORING_CONFIG } from '@/features/scoring/services/scoringConfigService';

type AttendanceSummaryRecord = {
  status: string;
  attendance_date: string;
  excuse_reason?: string | null;
  host_address?: string | null;
  late_minutes?: number | null;
};

function isHeldAttendanceRecord(record: AttendanceSummaryRecord) {
  if (!record.attendance_date) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (new Date(record.attendance_date) > today) return false;
  if (record.excuse_reason === 'session not held') return false;
  if (record.host_address === 'SESSION_NOT_HELD') return false;
  return true;
}

function summarizeAttendanceRecords(records: AttendanceSummaryRecord[]) {
  const filtered = records.filter(isHeldAttendanceRecord);
  const byDate = new Map<string, AttendanceSummaryRecord>();

  const priority = (status: string) => {
    if (status === 'absent') return 5;
    if (status === 'late') return 4;
    if (status === 'on time' || status === 'present') return 3;
    if (status === 'excused') return 2;
    if (status === 'not enrolled') return 1;
    return 0;
  };

  for (const record of filtered) {
    const existing = byDate.get(record.attendance_date);
    if (!existing || priority(record.status) > priority(existing.status)) {
      byDate.set(record.attendance_date, record);
    }
  }

  const unique = [...byDate.values()];
  const held = unique.length;
  const excused = unique.filter((record) => record.status === 'excused').length;
  const present = unique.filter((record) => record.status === 'on time' || record.status === 'late' || record.status === 'present').length;
  const late = unique.filter((record) => record.status === 'late').length;
  const absent = unique.filter((record) => record.status === 'absent').length;
  const accountable = unique.filter((record) => record.status !== 'excused' && record.status !== 'not enrolled').length;

  let qualitySum = 0;
  for (const record of unique) {
    if (record.status === 'on time' || record.status === 'present') qualitySum += 1;
    else if (record.status === 'late') {
      qualitySum += Math.max(
        DEFAULT_SCORING_CONFIG.late_minimum_credit,
        Math.exp(-((record.late_minutes || 0) / DEFAULT_SCORING_CONFIG.late_decay_constant))
      );
    }
  }

  return {
    held,
    present,
    late,
    excused,
    absent,
    accountable,
    attendanceRate: accountable > 0 ? Math.round((present / accountable) * 1000) / 10 : 0,
    qualityRate: accountable > 0 ? Math.round((qualitySum / accountable) * 1000) / 10 : 0,
  };
}

export const attendanceService = {
  // Get all attendance records
  async getAll() {
    return await supabase
      .from(Tables.ATTENDANCE)
      .select('*')
      .order('created_at', { ascending: false });
  },

  // Get attendance by ID with full details
  async getById(id: string) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .select(`
        *,
        student:student_id(*),
        enrollment:enrollment_id(*)
      `)
      .eq('attendance_id', id)
      .single();
  },

  // Get attendance for a specific student
  async getByStudent(studentId: string) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .select(`
        *,
        session:session_id(
          *,
          course:course_id(course_name)
        )
      `)
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
  },

  // Get attendance for a specific session
  async getBySession(sessionId: string) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .select(`
        *,
        student:student_id(name, email)
      `)
      .eq('session_id', sessionId)
      .order('attendance_date', { ascending: true });
  },

  // Create or update attendance record (upsert to prevent duplicate key errors)
  async create(attendance: CreateAttendance) {
    const result = await supabase
      .from(Tables.ATTENDANCE)
      .upsert(attendance, {
        onConflict: 'enrollment_id,attendance_date',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (result.data) {
      try { await logInsert('attendance', result.data.attendance_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Bulk create/update attendance records (upsert to prevent duplicate key errors)
  async createBulk(attendanceRecords: CreateAttendance[]) {
    const result = await supabase
      .from(Tables.ATTENDANCE)
      .upsert(attendanceRecords, {
        onConflict: 'enrollment_id,attendance_date',
        ignoreDuplicates: false
      })
      .select();

    if (result.data && result.data.length > 0) {
      try {
        await Promise.allSettled(
          result.data.map(record =>
            logInsert('attendance', record.attendance_id, record as Record<string, unknown>)
          )
        );
      } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Update attendance record
  async update(id: string, updates: UpdateAttendance) {
    // Fetch old data for audit
    const { data: oldData } = await supabase
      .from(Tables.ATTENDANCE)
      .select('*')
      .eq('attendance_id', id)
      .single();

    const result = await supabase
      .from(Tables.ATTENDANCE)
      .update(updates)
      .eq('attendance_id', id)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logUpdate('attendance', id, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Mark student as on time (present)
  async markPresent(attendanceId: string, checkInTime?: string) {
    return await this.update(attendanceId, {
      status: 'on time',
      check_in_time: checkInTime || new Date().toISOString(),
    });
  },

  // Mark student as absent
  async markAbsent(attendanceId: string, notes?: string) {
    return await this.update(attendanceId, {
      status: 'absent',
      notes,
    });
  },

  // Mark student as late
  async markLate(attendanceId: string, checkInTime?: string, notes?: string) {
    return await this.update(attendanceId, {
      status: 'late',
      check_in_time: checkInTime || new Date().toISOString(),
      notes,
    });
  },

  // Delete attendance record
  async delete(id: string) {
    // Fetch attendance data before deletion for audit log
    const { data: attendance } = await supabase
      .from(Tables.ATTENDANCE)
      .select('*')
      .eq('attendance_id', id)
      .single();

    // Log the deletion
    if (attendance) {
      try { await logDelete('attendance', id, attendance as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return await supabase
      .from(Tables.ATTENDANCE)
      .delete()
      .eq('attendance_id', id);
  },

  // Get attendance rate for a student in a session
  async getStudentAttendanceRate(studentId: string, sessionId: string) {
    const { data, error } = await supabase
      .from(Tables.ATTENDANCE)
      .select('status, attendance_date, excuse_reason, host_address, late_minutes')
      .eq('student_id', studentId)
      .eq('session_id', sessionId);

    if (error) return { data: null, error };

    const summary = summarizeAttendanceRecords((data || []) as AttendanceSummaryRecord[]);

    return { 
      data: { 
        total: summary.held,
        present: summary.present,
        excused: summary.excused,
        absent: summary.absent,
        late: summary.late,
        accountable: summary.accountable,
        rate: summary.attendanceRate,
        qualityRate: summary.qualityRate,
      }, 
      error: null 
    };
  },

  async getStudentAttendanceSummary(studentId: string, sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return {
        data: { total: 0, present: 0, excused: 0, absent: 0, late: 0, accountable: 0, rate: 0, qualityRate: 0 },
        error: null,
      };
    }

    const { data, error } = await supabase
      .from(Tables.ATTENDANCE)
      .select('status, attendance_date, excuse_reason, host_address, late_minutes')
      .eq('student_id', studentId)
      .in('session_id', sessionIds);

    if (error) return { data: null, error };

    const summary = summarizeAttendanceRecords((data || []) as AttendanceSummaryRecord[]);
    return {
      data: {
        total: summary.held,
        present: summary.present,
        excused: summary.excused,
        absent: summary.absent,
        late: summary.late,
        accountable: summary.accountable,
        rate: summary.attendanceRate,
        qualityRate: summary.qualityRate,
      },
      error: null,
    };
  },

  // Bulk upsert attendance records
  async bulkUpsert(records: Record<string, unknown>[]) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .upsert(records, { onConflict: 'enrollment_id,attendance_date', ignoreDuplicates: false });
  },

  // Delete feedback for a session+date (used when unmarking session-not-held)
  async deleteFeedbackForDate(sessionId: string, date: string) {
    return await supabase
      .from('session_feedback')
      .delete()
      .eq('session_id', sessionId)
      .eq('attendance_date', date);
  },
};
