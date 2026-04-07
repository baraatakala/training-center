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
      .limit(50000);

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
      supabase.from('attendance').select('student_id, session_id, attendance_date, status, check_in_method, host_address, excuse_reason').limit(50000),
      supabase.from('session_date_host').select('session_id, attendance_date, host_address').limit(50000),
      supabase.from('qr_sessions').select('session_id, attendance_date, check_in_mode, linked_photo_token, is_valid, expires_at').limit(50000),
      supabase.from('photo_checkin_sessions').select('token, session_id, attendance_date, is_valid, expires_at').limit(50000),
      supabase.from('session_feedback').select('student_id, session_id, attendance_date, check_in_method').limit(50000),
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
      supabase.from('session').select('session_id, start_date, end_date, feedback_enabled, feedback_anonymous_allowed, course_id, teacher_id').limit(50000),
      supabase.from('enrollment').select('enrollment_id, student_id, session_id, status').limit(50000),
      supabase.from('session_feedback').select('id, session_id, student_id, attendance_date').limit(50000),
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

  async getOperationalPulse() {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const [upcomingRes, todayAttendanceRes, recentExcusesRes] = await Promise.all([
      supabase.from('session')
        .select('session_id, start_date, end_date, feedback_enabled, session_days, course:course_id(course_name), teacher:teacher_id(name)')
        .lte('start_date', nextWeek)
        .gte('end_date', today)
        .order('start_date')
        .limit(20),
      supabase.from('attendance')
        .select('status', { count: 'exact' })
        .eq('attendance_date', today),
      supabase.from('excuse_request')
        .select('id, status', { count: 'exact' })
        .eq('status', 'pending'),
    ]);

    // Count today's attendance by status
    const todayRecords = todayAttendanceRes.data || [];
    const todayStats = {
      total: todayRecords.length,
      onTime: todayRecords.filter(r => r.status === 'on time').length,
      late: todayRecords.filter(r => r.status === 'late').length,
      absent: todayRecords.filter(r => r.status === 'absent').length,
    };

    return {
      upcomingSessions: (upcomingRes.data || []).map((s: Record<string, unknown>) => {
        const course = s.course as Record<string, string> | Record<string, string>[] | null;
        const teacher = s.teacher as Record<string, string> | Record<string, string>[] | null;
        return {
          session_id: s.session_id as string,
          course_name: (Array.isArray(course) ? course[0]?.course_name : course?.course_name) ?? 'Unknown',
          teacher_name: (Array.isArray(teacher) ? teacher[0]?.name : teacher?.name) ?? 'Unknown',
          start_date: String(s.start_date || ''),
          end_date: String(s.end_date || ''),
          session_days: s.session_days as string || '',
          feedback_enabled: Boolean(s.feedback_enabled),
          isToday: String(s.start_date || '') <= today && String(s.end_date || '') >= today,
        };
      }),
      todayStats,
      pendingExcuses: recentExcusesRes.count || 0,
    };
  },
};
