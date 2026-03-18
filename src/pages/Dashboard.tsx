import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { format } from 'date-fns';
import { analyzeAttendanceRisk } from '../utils/attendanceAnalytics';
import type { AbsentStudent } from '../utils/attendanceAnalytics';
import { excuseRequestService } from '../services/excuseRequestService';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { toast } from '../components/ui/toastUtils';

// Risk level styling — defined outside component to avoid recreation on every render
const RISK_STYLES = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    border: 'border-red-300 dark:border-red-700',
    hover: 'hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/50',
    badge: 'bg-red-600 text-white',
    icon: '🚨'
  },
  high: {
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    border: 'border-orange-300 dark:border-orange-700',
    hover: 'hover:bg-orange-100 hover:border-orange-400 dark:hover:bg-orange-900/50',
    badge: 'bg-orange-600 text-white',
    icon: '⚠️'
  },
  medium: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/30',
    border: 'border-yellow-300 dark:border-yellow-700',
    hover: 'hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/50',
    badge: 'bg-yellow-600 text-white',
    icon: '⚡'
  },
  watch: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-700',
    hover: 'hover:bg-blue-100 hover:border-blue-400 dark:hover:bg-blue-900/50',
    badge: 'bg-blue-600 text-white',
    icon: '👁️'
  }
} as const;

const TREND_ICONS = {
  improving: { icon: '📈', text: 'Improving', color: 'text-green-600 dark:text-green-400' },
  declining: { icon: '📉', text: 'Declining', color: 'text-red-600 dark:text-red-400' },
  stable: { icon: '→', text: 'Stable', color: 'text-gray-600 dark:text-gray-400' }
} as const;

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    todaySessions: 0,
    totalCourses: 0,
    liveFeedbackSessions: 0,
    feedbackResponses: 0,
    issuedCertificates: 0,
    loading: true,
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [pendingExcuses, setPendingExcuses] = useState(0);

  // Memoized filtered students and risk counts to avoid recalculation on every render
  const filteredStudents = useMemo(() => {
    return selectedCourse === 'all'
      ? absentStudents
      : absentStudents.filter(s => s.course_id === selectedCourse);
  }, [absentStudents, selectedCourse]);

  const riskCounts = useMemo(() => ({
    critical: filteredStudents.filter(s => s.riskLevel === 'critical').length,
    high: filteredStudents.filter(s => s.riskLevel === 'high').length,
    medium: filteredStudents.filter(s => s.riskLevel === 'medium').length,
    watch: filteredStudents.filter(s => s.riskLevel === 'watch').length,
  }), [filteredStudents]);

  const openStudentAttendanceRecords = useCallback((student: AbsentStudent) => {
    const params = new URLSearchParams({
      studentName: student.student_name,
      status: 'absent',
      course: student.course_id,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });

    navigate(`/attendance-records?${params.toString()}`);
  }, [endDate, navigate, startDate]);

  const loadStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      // Use count-only queries instead of fetching all rows (massive perf win)
      const [studentsRes, enrollmentsRes, teachersRes, sessionsRes, todaySessionsRes, coursesRes, liveFeedbackRes, feedbackResponsesRes] = await Promise.all([
        supabase.from(Tables.STUDENT).select('student_id', { count: 'exact', head: true }),
        supabase.from(Tables.ENROLLMENT).select('enrollment_id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from(Tables.TEACHER).select('teacher_id', { count: 'exact', head: true }),
        supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true }),
        supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true })
          .lte('start_date', today).gte('end_date', today),
        supabase.from(Tables.COURSE).select('course_id', { count: 'exact', head: true }),
        supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true }).eq('feedback_enabled', true),
        supabase.from('session_feedback').select('id', { count: 'exact', head: true }),
      ]);

      // Certificates table may not exist - query separately with error handling
      let certsCount = 0;
      try {
        const certsRes = await supabase.from('issued_certificate').select('certificate_id', { count: 'exact', head: true }).eq('status', 'issued');
        certsCount = certsRes.count || 0;
      } catch { /* table may not exist */ }

      setStats({
        totalStudents: studentsRes.count || 0,
        totalTeachers: teachersRes.count || 0,
        activeEnrollments: enrollmentsRes.count || 0,
        totalSessions: sessionsRes.count || 0,
        todaySessions: todaySessionsRes.count || 0,
        totalCourses: coursesRes.count || 0,
        liveFeedbackSessions: liveFeedbackRes.count || 0,
        feedbackResponses: feedbackResponsesRes.count || 0,
        issuedCertificates: certsCount,
        loading: false,
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error loading stats:', err);
      setError('Failed to load dashboard statistics. Please try again.');
      toast.error('Failed to load dashboard statistics');
      setStats(prev => ({ ...prev, loading: false }));
    }
  }, []);

  const loadAttendanceAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      // Get attendance records with session and course info, ordered by date descending
      // Limit to 5000 records max for performance
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
      
      // Apply date filters if set
      if (startDate) {
        attendanceQuery = attendanceQuery.gte('attendance_date', startDate);
      }
      if (endDate) {
        attendanceQuery = attendanceQuery.lte('attendance_date', endDate);
      }
      
      // Run attendance and courses queries in parallel
      const [attendanceResult, coursesResult] = await Promise.all([
        attendanceQuery.order('attendance_date', { ascending: false }),
        supabase.from('course').select('course_id, course_name').order('course_name'),
      ]);

      if (attendanceResult.error) {
        toast.error('Failed to load attendance data: ' + attendanceResult.error.message);
        setLoadingAlerts(false);
        return;
      }

      if (coursesResult.error) {
        console.error('Failed to load courses:', coursesResult.error);
      }

      const attendanceRecords = attendanceResult.data;
      const coursesData = coursesResult.data;

      if (coursesData) {
        setCourses(coursesData.map(c => ({ id: c.course_id, name: c.course_name })));
      }

      if (!attendanceRecords || attendanceRecords.length === 0) {
        setAbsentStudents([]);
        setLoadingAlerts(false);
        return;
      }

      // Run analytics engine (extracted to src/utils/attendanceAnalytics.ts)
      const alertStudents = analyzeAttendanceRisk(attendanceRecords);

      setAbsentStudents(alertStudents);
    } catch (error) {
      console.error('Error loading attendance alerts:', error);
      toast.error('Failed to load attendance analytics');
    }
    setLoadingAlerts(false);
  }, [startDate, endDate]);

  // Load pending excuses count — uses service layer
  const loadPendingExcuses = async () => {
    try {
      const { count } = await excuseRequestService.getPendingCount();
      setPendingExcuses(count || 0);
    } catch {
      // table might not exist yet
    }
  };

  // Combined refresh function for useRefreshOnFocus
  const refreshAll = useCallback(() => {
    loadStats();
    loadPendingExcuses();
    loadAttendanceAlerts();
  }, [loadStats, loadAttendanceAlerts]);

  useRefreshOnFocus(refreshAll);

  useEffect(() => {
    const init = async () => {
      // Check if current user is a teacher
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          // Check if teacher or admin
          const { data: teacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .ilike('email', user.email)
            .maybeSingle();
          if (teacher) {
            setIsTeacher(true);
          } else {
            // Fallback: check admin table (admin should be synced to teacher, but just in case)
            const { data: adminRecord } = await supabase
              .from('admin')
              .select('admin_id')
              .ilike('email', user.email)
              .maybeSingle();
            setIsTeacher(!!adminRecord);
          }
        } else {
          setIsTeacher(false);
        }
      } catch {
        setIsTeacher(false);
      }
    };
    init();
    loadStats();
    loadPendingExcuses();
  }, [loadStats]);

  // Reload alerts when date filters change (including when cleared)
  useEffect(() => {
    loadAttendanceAlerts();
  }, [loadAttendanceAlerts]);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header with last-refresh indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">Overview of your training center</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Last updated: {format(lastRefresh, 'HH:mm:ss')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refreshAll(); toast.success('Dashboard refreshed'); }}
            className="gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            <button 
              onClick={() => { setError(null); loadStats(); loadAttendanceAlerts(); }} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blue-100">Total Students</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalStudents}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700 rounded-2xl p-6 text-white shadow-lg shadow-emerald-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-100">Active Enrollments</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.activeEnrollments}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 rounded-2xl p-6 text-white shadow-lg shadow-purple-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-purple-100">Total Teachers</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalTeachers}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 rounded-2xl p-6 text-white shadow-lg shadow-amber-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-amber-100">Total Sessions</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalSessions}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        <Link to="/sessions" className="group">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Today's Sessions</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.loading ? '...' : stats.todaySessions}</p>
              </div>
            </div>
          </div>
        </Link>
        <Link to="/courses" className="group">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Courses</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.loading ? '...' : stats.totalCourses}</p>
              </div>
            </div>
          </div>
        </Link>
        <Link to="/certificates" className="group">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                🏆
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Certificates</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.loading ? '...' : stats.issuedCertificates}</p>
              </div>
            </div>
          </div>
        </Link>
        <Link to="/feedback-analytics" className="group">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center text-rose-600 dark:text-rose-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Feedback</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.loading ? '...' : stats.feedbackResponses}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{stats.loading ? 'Loading analytics' : `${stats.liveFeedbackSessions} live sessions`}</p>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link to="/students">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                Manage Students
              </Button>
            </Link>
            <Link to="/attendance-records">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                Attendance Records
              </Button>
            </Link>
            <Link to="/excuse-requests">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Excuse Requests
                {pendingExcuses > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                    {pendingExcuses}
                  </span>
                )}
              </Button>
            </Link>
            <Link to="/announcements">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                Announcements
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Attendance Alerts - Enhanced Analytics (Teachers Only) */}
      {isTeacher && (
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>🎯 Smart Attendance Analytics</CardTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">AI-powered risk assessment with trend analysis</p>
            </div>
            <Button 
              size="sm" 
              variant="outline"
              onClick={loadAttendanceAlerts}
              disabled={loadingAlerts}
            >
              {loadingAlerts ? 'Analyzing...' : 'Refresh'}
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              aria-label="Filter by course"
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-full md:w-auto dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <div className="flex gap-2 items-center flex-wrap">
              <label htmlFor="dashboard-start-date" className="text-sm text-gray-600 dark:text-gray-400">From:</label>
              <input
                id="dashboard-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              />
              <label htmlFor="dashboard-end-date" className="text-sm text-gray-600 dark:text-gray-400">To:</label>
              <input
                id="dashboard-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              />
              {(startDate || endDate) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    loadAttendanceAlerts();
                  }}
                >
                  Clear Dates
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAlerts ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
              <p className="text-gray-500 dark:text-gray-400">Analyzing attendance patterns...</p>
            </div>
          ) : (() => {
            const filtered = filteredStudents;
            const criticalCount = riskCounts.critical;
            const highCount = riskCounts.high;
            const mediumCount = riskCounts.medium;
            const watchCount = riskCounts.watch;
            
            return filtered.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-3">✓</div>
                <p className="text-green-600 dark:text-green-400 font-medium text-lg">Excellent! No attendance concerns</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">All students are maintaining healthy attendance patterns</p>
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">{criticalCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Critical</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{highCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">High Risk</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{mediumCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Medium</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{watchCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Watch</div>
                  </div>
                </div>

                <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  Open a student card to review the risk pattern, then jump straight into filtered attendance records for the exact course and dates shown here.
                </div>

                {/* Alert Cards */}
                <div className="space-y-3">
                  {filtered.map((student) => {
                    const style = RISK_STYLES[student.riskLevel];

                    // Trend icon
                    const trendInfo = TREND_ICONS[student.trend];

                    return (
                      <div
                        key={`${student.student_id}-${student.course_id}`}
                        className={`block p-4 rounded-lg border-2 ${style.bg} ${style.border} ${style.hover} transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500`}
                        onClick={() => openStudentAttendanceRecords(student)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            openStudentAttendanceRecords(student);
                          }
                        }}
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="flex-1 min-w-0">
                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-xl">{style.icon}</span>
                              <p className="font-semibold text-gray-900 dark:text-white">{student.student_name}</p>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style.badge}`}>
                                {student.riskLevel.toUpperCase()}
                              </span>
                              <Badge variant="default" className="text-xs">
                                {student.course_name}
                              </Badge>
                            </div>

                            {/* Key Metrics */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Attendance</div>
                                <div className={`font-bold ${student.attendanceRate < 50 ? 'text-red-600 dark:text-red-400' : student.attendanceRate < 75 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {student.attendanceRate}%
                                </div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Consecutive</div>
                                <div className="font-bold text-gray-900 dark:text-white">{student.consecutiveAbsences} days</div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Trend</div>
                                <div className={`font-bold ${trendInfo.color} text-xs flex items-center gap-1`}>
                                  <span>{trendInfo.icon}</span>
                                  <span>{trendInfo.text}</span>
                                </div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Engagement</div>
                                <div className="font-bold text-gray-900 dark:text-white">{student.engagementScore}/100</div>
                              </div>
                            </div>

                            {/* Patterns */}
                            {student.patterns.length > 0 && (
                              <div className="mb-2">
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">🔍 Detected Patterns:</div>
                                <div className="flex flex-wrap gap-1">
                                  {student.patterns.map((pattern, idx) => (
                                    <span key={idx} className="text-xs bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 dark:text-gray-300">
                                      {pattern}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Details */}
                            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                              {student.absentDates.length > 0 && (
                                <div>
                                  <span className="font-semibold">Recent Absences:</span> {student.absentDates.slice(0, 5).map(d => format(new Date(d), 'MMM dd')).join(', ')}
                                  {student.absentDates.length > 5 && ` +${student.absentDates.length - 5} more`}
                                </div>
                              )}
                              <div>
                                <span className="font-semibold">History:</span> {student.presentDays} present / {student.totalDays} total sessions
                                {student.lastAttendedDate && ` • Last attended: ${format(new Date(student.lastAttendedDate), 'MMM dd')}`}
                              </div>
                              <div>
                                <span className="font-semibold">Email:</span> {student.email}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[220px]">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                openStudentAttendanceRecords(student);
                              }}
                              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                              title="Open attendance records"
                            >
                              Open Attendance Record
                            </button>
                            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-slate-300">
                              <p>{student.phone ? 'Phone is available in the student record if follow-up is needed.' : 'No phone number is saved for this student yet.'}</p>
                              <p className="mt-1">Use the Attendance Records page for final review, excuses, replay links, and any same-day follow-up.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>
      )}

      {/* Student-facing: Enhanced personal dashboard */}
      {isTeacher === false && (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-8 text-center">
              <div className="text-4xl mb-3">📚</div>
              <p className="text-gray-700 dark:text-gray-200 font-medium text-lg">Welcome to the Training Center</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Navigate to your courses, sessions, and attendance records using the menu above.</p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/attendance-records">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">📋</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Attendance</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View your attendance records</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/excuse-requests">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">📝</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">Excuse Requests</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Submit or track excuse requests</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/certificates">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">🏆</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Certificates</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View and download certificates</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
