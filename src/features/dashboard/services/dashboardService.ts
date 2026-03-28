import { supabase } from '@/shared/lib/supabase';
import { Tables } from '@/shared/types/database.types';

export const dashboardService = {
  async getStats() {
    const today = new Date().toISOString().split('T')[0];
    const [studentsRes, enrollmentsRes, teachersRes, sessionsRes, todaySessionsRes, coursesRes] = await Promise.all([
      supabase.from(Tables.STUDENT).select('student_id', { count: 'exact', head: true }),
      supabase.from(Tables.ENROLLMENT).select('enrollment_id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from(Tables.TEACHER).select('teacher_id', { count: 'exact', head: true }),
      supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true }),
      supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true })
        .lte('start_date', today).gte('end_date', today),
      supabase.from(Tables.COURSE).select('course_id', { count: 'exact', head: true }),
    ]);

    let certsCount = 0;
    try {
      const certsRes = await supabase.from('issued_certificate').select('certificate_id', { count: 'exact', head: true }).eq('status', 'issued');
      certsCount = certsRes.count || 0;
    } catch { /* table may not exist */ }

    return {
      totalStudents: studentsRes.count || 0,
      totalTeachers: teachersRes.count || 0,
      activeEnrollments: enrollmentsRes.count || 0,
      totalSessions: sessionsRes.count || 0,
      todaySessions: todaySessionsRes.count || 0,
      totalCourses: coursesRes.count || 0,
      issuedCertificates: certsCount,
    };
  },

  async getAttendanceAlerts(options?: { startDate?: string; endDate?: string }) {
    let attendanceQuery = supabase
      .from('attendance')
      .select(`
        student_id,
        attendance_date,
        status,
        excuse_reason,
        host_address,
        session_id,
        student:student_id(name, email, phone),
        session:session_id(course_id, course:course_id(course_name))
      `)
      .limit(5000);

    if (options?.startDate) {
      attendanceQuery = attendanceQuery.gte('attendance_date', options.startDate);
    }
    if (options?.endDate) {
      attendanceQuery = attendanceQuery.lte('attendance_date', options.endDate);
    }

    const [attendanceResult, coursesResult] = await Promise.all([
      attendanceQuery.order('attendance_date', { ascending: false }),
      supabase.from('course').select('course_id, course_name').order('course_name'),
    ]);

    return { attendanceResult, coursesResult };
  },

  async getUserRole(email: string) {
    const [teacherRes, adminRes] = await Promise.all([
      supabase.from('teacher').select('teacher_id').ilike('email', email).maybeSingle(),
      supabase.from('admin').select('admin_id').ilike('email', email).maybeSingle(),
    ]);
    return {
      isTeacher: !!teacherRes.data,
      isAdmin: !!adminRes.data,
    };
  },

  async getHealthCheckData() {
    const [
      feedbackSessionsRes,
      feedbackQuestionsRes,
      attendanceRes,
      hostRes,
      qrRes,
      photoRes,
      feedbackRes,
    ] = await Promise.all([
      supabase.from('session').select('session_id').eq('feedback_enabled', true),
      supabase.from('feedback_question').select('session_id, attendance_date'),
      supabase.from('attendance').select('student_id, session_id, attendance_date, status, check_in_method, host_address, excuse_reason').limit(5000),
      supabase.from('session_date_host').select('session_id, attendance_date, host_address').limit(5000),
      supabase.from('qr_sessions').select('session_id, attendance_date, check_in_mode, linked_photo_token, is_valid, expires_at').limit(5000),
      supabase.from('photo_checkin_sessions').select('token, session_id, attendance_date, is_valid, expires_at').limit(5000),
      supabase.from('session_feedback').select('student_id, session_id, attendance_date, check_in_method').limit(5000),
    ]);

    return {
      feedbackSessions: feedbackSessionsRes.data || [],
      feedbackQuestions: feedbackQuestionsRes.data || [],
      attendance: attendanceRes.data || [],
      hostRows: hostRes.data || [],
      qrRows: qrRes.data || [],
      photoRows: photoRes.data || [],
      feedbackRows: feedbackRes.data || [],
    };
  },

  async getAdvancedHealthCheckData() {
    const [sessionsRes, enrollmentsRes, feedbackAllRes, scoringRes] = await Promise.all([
      supabase.from('session').select('session_id, start_date, end_date, feedback_enabled, feedback_anonymous_allowed, course_id, teacher_id').limit(5000),
      supabase.from('enrollment').select('enrollment_id, student_id, session_id, status').limit(10000),
      supabase.from('session_feedback').select('id, session_id, student_id, attendance_date').limit(10000),
      supabase.from('scoring_config').select('teacher_id').limit(1000),
    ]);

    return {
      allSessions: sessionsRes.data || [],
      allEnrollments: enrollmentsRes.data || [],
      allFeedback: feedbackAllRes.data || [],
      allScoring: scoringRes.data || [],
    };
  },

  async invalidateExpiredQrTokens(rows: Array<{ session_id: string; attendance_date: string }>) {
    for (const row of rows) {
      await supabase.from('qr_sessions').update({ is_valid: false })
        .eq('session_id', row.session_id).eq('attendance_date', row.attendance_date);
    }
  },

  async invalidateExpiredPhotoTokens(tokens: string[]) {
    for (const token of tokens) {
      await supabase.from('photo_checkin_sessions').update({ is_valid: false })
        .eq('token', token);
    }
  },
};
