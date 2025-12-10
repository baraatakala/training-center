import { supabase } from '../lib/supabase';
import type { 
  CreateAttendance, 
  UpdateAttendance
} from '../types/database.types';
import { logDelete } from './auditService';
import { Tables } from '../types/database.types';

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
        enrollment:enrollment_id(*),
        session_location:session_location_id(
          *,
          location:location_id(*),
          session:session_id(
            *,
            course:course_id(*),
            teacher:teacher_id(*)
          )
        )
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
        session_location:session_location_id(
          date,
          start_time,
          end_time,
          location:location_id(location_name),
          session:session_id(
            course:course_id(course_name)
          )
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
        student:student_id(name, email),
        session_location:session_location_id(date, start_time, end_time)
      `)
      .eq('session_location.session_id', sessionId)
      .order('session_location.date', { ascending: true });
  },

  // Get attendance for a specific session location
  async getBySessionLocation(sessionLocationId: string) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .select(`
        *,
        student:student_id(name, email, phone),
        enrollment:enrollment_id(status)
      `)
      .eq('session_location_id', sessionLocationId)
      .order('student.name', { ascending: true });
  },

  // Get attendance statistics for a session
  async getSessionStats(sessionId: string) {
    const { data, error } = await supabase
      .rpc('get_session_attendance_stats', { session_id_param: sessionId });
    
    if (error) return { data: null, error };
    
    return { data, error: null };
  },

  // Create new attendance record
  async create(attendance: CreateAttendance) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .insert(attendance)
      .select()
      .single();
  },

  // Bulk create attendance records for a session location
  async createBulk(attendanceRecords: CreateAttendance[]) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .insert(attendanceRecords)
      .select();
  },

  // Update attendance record
  async update(id: string, updates: UpdateAttendance) {
    return await supabase
      .from(Tables.ATTENDANCE)
      .update(updates)
      .eq('attendance_id', id)
      .select()
      .single();
  },

  // Mark student as present
  async markPresent(attendanceId: string, checkInTime?: string) {
    return await this.update(attendanceId, {
      status: 'present',
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
      await logDelete('attendance', id, attendance as Record<string, unknown>);
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
      .select('status, session_location:session_location_id(session_id)')
      .eq('student_id', studentId)
      .eq('session_location.session_id', sessionId);

    if (error) return { data: null, error };

    const total = data.length;
    const present = data.filter((a: { status: string }) => a.status === 'present' || a.status === 'late').length;
    const rate = total > 0 ? (present / total) * 100 : 0;

    return { 
      data: { 
        total, 
        present, 
        absent: total - present,
        rate: Math.round(rate * 100) / 100 
      }, 
      error: null 
    };
  },
};
