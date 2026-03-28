import { supabase } from '@/shared/lib/supabase';

export const checkinService = {
  async validateQrToken(token: string) {
    return await supabase
      .from('qr_sessions')
      .select('session_id, attendance_date, expires_at, is_valid, check_in_mode, linked_photo_token')
      .eq('token', token)
      .single();
  },

  async validatePhotoToken(token: string) {
    return await supabase
      .from('photo_checkin_sessions')
      .select('session_id, attendance_date, expires_at, is_valid')
      .eq('token', token)
      .single();
  },

  async getStudentByEmail(email: string) {
    return await supabase
      .from('student')
      .select('student_id, name, email, photo_url')
      .ilike('email', email)
      .single();
  },

  async getSessionDetails(sessionId: string) {
    return await supabase
      .from('session')
      .select(`
        session_id,
        time,
        location,
        course_id,
        grace_period_minutes,
        proximity_radius,
        course:course_id (
          course_name
        )
      `)
      .eq('session_id', sessionId)
      .single();
  },

  async getEnrollment(sessionId: string, studentId: string) {
    return await supabase
      .from('enrollment')
      .select('enrollment_id, can_host')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .eq('status', 'active')
      .single();
  },

  async getExistingAttendance(sessionId: string, studentId: string, date: string) {
    return await supabase
      .from('attendance')
      .select('attendance_id, status')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .eq('attendance_date', date)
      .single();
  },

  async getSessionTeacherInfo(sessionId: string) {
    return await supabase
      .from('session')
      .select(`
        teacher_id,
        teacher:teacher_id (
          teacher_id,
          name,
          address
        )
      `)
      .eq('session_id', sessionId)
      .single();
  },

  async getStudentsWithAddresses() {
    return await supabase
      .from('student')
      .select('student_id, name, address')
      .not('address', 'is', null)
      .neq('address', '');
  },

  async getSessionDateHost(sessionId: string, date: string) {
    return await supabase
      .from('session_date_host')
      .select('host_id, host_type, host_address, host_latitude, host_longitude')
      .eq('session_id', sessionId)
      .eq('attendance_date', date)
      .maybeSingle();
  },

  async getHostCoordinates(hostId: string, isTeacher: boolean) {
    const table = isTeacher ? 'teacher' : 'student';
    const idField = isTeacher ? 'teacher_id' : 'student_id';
    return await supabase
      .from(table)
      .select('address_latitude, address_longitude')
      .eq(idField, hostId)
      .single();
  },

  async getEnrollmentId(sessionId: string, studentId: string) {
    return await supabase
      .from('enrollment')
      .select('enrollment_id')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .single();
  },

  async getExistingAttendanceByEnrollment(enrollmentId: string, sessionId: string, date: string) {
    return await supabase
      .from('attendance')
      .select('attendance_id, status')
      .eq('enrollment_id', enrollmentId)
      .eq('session_id', sessionId)
      .eq('attendance_date', date)
      .maybeSingle();
  },

  async upsertAttendance(data: Record<string, unknown>) {
    return await supabase
      .from('attendance')
      .upsert(data, {
        onConflict: 'enrollment_id,attendance_date',
        ignoreDuplicates: false,
      });
  },

  async validateLinkedPhotoToken(token: string) {
    return await supabase
      .from('photo_checkin_sessions')
      .select('token, session_id, attendance_date, expires_at, is_valid')
      .eq('token', token)
      .maybeSingle();
  },

  async createPhotoSession(data: {
    session_id: string;
    attendance_date: string;
    token: string;
    expires_at: string;
    is_valid: boolean;
  }) {
    return await supabase
      .from('photo_checkin_sessions')
      .insert(data);
  },

  async generateQrSession(params: {
    p_session_id: string;
    p_attendance_date: string;
    p_created_by: string;
    p_check_in_mode: string;
    p_linked_photo_token: string | null;
    p_expires_at: string | null;
  }) {
    return await supabase.rpc('generate_qr_session', params);
  },

  async getActiveEnrollmentCount(sessionId: string) {
    return await supabase
      .from('enrollment')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'active');
  },

  async getCheckInCount(sessionId: string, date: string) {
    return await supabase
      .from('attendance')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('attendance_date', date)
      .neq('status', 'absent');
  },

  async invalidatePhotoSession(token: string) {
    return await supabase
      .from('photo_checkin_sessions')
      .update({ is_valid: false })
      .eq('token', token);
  },

  async invalidateQrSession(token: string) {
    return await supabase.rpc('invalidate_qr_session', { p_token: token });
  },

  removeChannel(channel: ReturnType<typeof supabase.channel>) {
    return supabase.removeChannel(channel);
  },

  createChannel(name: string) {
    return supabase.channel(name);
  },
};
