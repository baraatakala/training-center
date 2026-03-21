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

// Message template types for the composer
type MessageTemplate = 'attendance_alert' | 'encouragement' | 'reminder' | 'custom';
type MessageChannel = 'email' | 'sms' | 'whatsapp';

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
    pendingFeedback: 0,
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

  // Message Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStudent, setComposerStudent] = useState<AbsentStudent | null>(null);
  const [composerChannel, setComposerChannel] = useState<MessageChannel>('email');
  const [composerTemplate, setComposerTemplate] = useState<MessageTemplate>('attendance_alert');
  const [composerSubject, setComposerSubject] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [pendingExcuses, setPendingExcuses] = useState(0);

  // Workflow readiness state
  type HealthCheck = {
    label: string;
    status: 'ok' | 'warn' | 'error';
    count: number;
    detail: string;
    icon: string;
    actionLabel?: string;
    actionPath?: string;
  };
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthLoaded, setHealthLoaded] = useState(false);

  const loadHealthChecks = useCallback(async () => {
    setHealthLoading(true);
    try {
      const checks: HealthCheck[] = [];

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
        supabase.from('attendance').select('student_id, session_id, attendance_date, check_in_method, host_address').limit(5000),
        supabase.from('session_date_host').select('session_id, attendance_date, host_address').limit(5000),
        supabase.from('qr_sessions').select('session_id, attendance_date, check_in_mode, linked_photo_token').limit(5000),
        supabase.from('photo_checkin_sessions').select('token, session_id, attendance_date, is_valid').limit(5000),
        supabase.from('session_feedback').select('student_id, session_id, attendance_date, check_in_method').limit(5000),
      ]);

      const feedbackSessions = feedbackSessionsRes.data || [];
      const feedbackQuestions = feedbackQuestionsRes.data || [];
      const attendance = attendanceRes.data || [];
      const hostRows = hostRes.data || [];
      const qrRows = qrRes.data || [];
      const photoRows = photoRes.data || [];
      const feedbackRows = feedbackRes.data || [];

      const questionSessionIds = new Set(feedbackQuestions.map((question) => question.session_id));
      const feedbackWithoutQuestions = feedbackSessions.filter((session) => !questionSessionIds.has(session.session_id));
      const feedbackWithoutQuestionsSample = feedbackWithoutQuestions[0];
      checks.push({
        label: 'Feedback enabled without questions',
        status: feedbackWithoutQuestions.length > 0 ? 'warn' : 'ok',
        count: feedbackWithoutQuestions.length,
        detail: feedbackWithoutQuestions.length > 0
          ? `${feedbackWithoutQuestions.length} session(s) can show feedback but still have no configured question set.`
          : 'Every feedback-enabled session already has a question set ready for students.',
        icon: feedbackWithoutQuestions.length > 0 ? '⚠️' : '✅',
        actionLabel: feedbackWithoutQuestions.length > 0 ? 'Open Attendance Setup' : undefined,
        actionPath: feedbackWithoutQuestionsSample ? `/attendance/${feedbackWithoutQuestionsSample.session_id}` : undefined,
      });

      const hostMap = new Map(hostRows.map((row) => [`${row.session_id}|${row.attendance_date}`, row]));
      const attendanceDates = new Set(attendance.map((row) => `${row.session_id}|${row.attendance_date}`));
      let hostMissingCount = 0;
      let hostMissingSample: { session_id: string; attendance_date: string } | null = null;
      for (const key of attendanceDates) {
        const host = hostMap.get(key);
        if (!host || !host.host_address || !String(host.host_address).trim()) {
          hostMissingCount++;
          if (!hostMissingSample) {
            const [sampleSessionId, sampleDate] = key.split('|');
            hostMissingSample = { session_id: sampleSessionId, attendance_date: sampleDate };
          }
        }
      }
      checks.push({
        label: 'Attendance activity without host setup',
        status: hostMissingCount > 0 ? 'error' : 'ok',
        count: hostMissingCount,
        detail: hostMissingCount > 0
          ? `${hostMissingCount} session date(s) already have attendance rows but no canonical host location in session_date_host.`
          : 'Every scanned attendance date has a canonical host location.',
        icon: hostMissingCount > 0 ? '🚨' : '✅',
        actionLabel: hostMissingCount > 0 ? 'Open Exact Date' : undefined,
        actionPath: hostMissingSample ? `/attendance/${hostMissingSample.session_id}?date=${hostMissingSample.attendance_date}` : undefined,
      });

      const photoTokenSet = new Set(photoRows.map((row) => row.token));
      const brokenPhotoQrRows = qrRows.filter((row) => row.check_in_mode === 'photo' && (!row.linked_photo_token || !photoTokenSet.has(row.linked_photo_token)));
      const brokenPhotoQrCount = brokenPhotoQrRows.length;
      const brokenPhotoQrSample = brokenPhotoQrRows[0];
      checks.push({
        label: 'Face QR routing is broken',
        status: brokenPhotoQrCount > 0 ? 'error' : 'ok',
        count: brokenPhotoQrCount,
        detail: brokenPhotoQrCount > 0
          ? `${brokenPhotoQrCount} QR session(s) point to face check-in without a valid linked photo token.`
          : 'All face-mode QR sessions point to a valid photo check-in token.',
        icon: brokenPhotoQrCount > 0 ? '🚨' : '✅',
        actionLabel: brokenPhotoQrSample ? 'Open Broken Date' : undefined,
        actionPath: brokenPhotoQrSample ? `/attendance/${brokenPhotoQrSample.session_id}?date=${brokenPhotoQrSample.attendance_date}` : undefined,
      });

      const attendanceMethodMap = new Map(
        attendance.map((row) => [`${row.student_id}|${row.session_id}|${row.attendance_date}`, row.check_in_method || null])
      );
      const feedbackMethodMismatchRows = feedbackRows.filter((row) => {
        const key = `${row.student_id}|${row.session_id}|${row.attendance_date}`;
        const attendanceMethod = attendanceMethodMap.get(key);
        return row.student_id && attendanceMethod && row.check_in_method && attendanceMethod !== row.check_in_method;
      });
      const feedbackMethodMismatchCount = feedbackMethodMismatchRows.length;
      const feedbackMethodMismatchSample = feedbackMethodMismatchRows[0];
      checks.push({
        label: 'Attendance and feedback method disagree',
        status: feedbackMethodMismatchCount > 0 ? 'warn' : 'ok',
        count: feedbackMethodMismatchCount,
        detail: feedbackMethodMismatchCount > 0
          ? `${feedbackMethodMismatchCount} feedback record(s) disagree with attendance.check_in_method for the same student/date.`
          : 'Feedback method tracking matches attendance check-in records.',
        icon: feedbackMethodMismatchCount > 0 ? '⚠️' : '✅',
        actionLabel: feedbackMethodMismatchSample ? 'Open Exact Feedback Slice' : undefined,
        actionPath: feedbackMethodMismatchSample ? `/feedback-analytics?session=${feedbackMethodMismatchSample.session_id}&date=${feedbackMethodMismatchSample.attendance_date}` : undefined,
      });

      let hostAddressDriftCount = 0;
      let hostAddressDriftSample: { session_id: string; attendance_date: string } | null = null;
      for (const row of attendance) {
        if (!row.host_address) continue;
        const host = hostMap.get(`${row.session_id}|${row.attendance_date}`);
        if (host?.host_address && String(host.host_address).trim() !== String(row.host_address).trim()) {
          hostAddressDriftCount++;
          if (!hostAddressDriftSample) {
            hostAddressDriftSample = { session_id: row.session_id, attendance_date: row.attendance_date };
          }
        }
      }
      checks.push({
        label: 'Attendance host address drift',
        status: hostAddressDriftCount > 0 ? 'warn' : 'ok',
        count: hostAddressDriftCount,
        detail: hostAddressDriftCount > 0
          ? `${hostAddressDriftCount} attendance row(s) still store a host address different from the canonical session_date_host row.`
          : 'Attendance host addresses match the canonical session_date_host rows.',
        icon: hostAddressDriftCount > 0 ? '⚠️' : '✅',
        actionLabel: hostAddressDriftSample ? 'Open Drifted Date' : undefined,
        actionPath: hostAddressDriftSample ? `/attendance/${hostAddressDriftSample.session_id}?date=${hostAddressDriftSample.attendance_date}` : undefined,
      });

      const hostDupes = new Set<string>();
      const hostSeen = new Set<string>();
      for (const row of hostRows) {
        const key = `${row.session_id}|${row.attendance_date}`;
        if (hostSeen.has(key)) hostDupes.add(key);
        hostSeen.add(key);
      }
      checks.push({
        label: 'Duplicate host rows per session date',
        status: hostDupes.size > 0 ? 'error' : 'ok',
        count: hostDupes.size,
        detail: hostDupes.size > 0
          ? `${hostDupes.size} session date(s) have multiple host rows and can confuse attendance, GPS, and check-in logic.`
          : 'No duplicate session_date_host rows were found in the scanned data.',
        icon: hostDupes.size > 0 ? '🚨' : '✅',
        actionLabel: hostDupes.size > 0 ? 'Open Sample Duplicate' : undefined,
        actionPath: hostDupes.size > 0 ? (() => {
          const firstDuplicate = Array.from(hostDupes)[0];
          if (!firstDuplicate) return undefined;
          const [sampleSessionId, sampleDate] = firstDuplicate.split('|');
          return `/attendance/${sampleSessionId}?date=${sampleDate}`;
        })() : undefined,
      });

      try {
        const { count } = await excuseRequestService.getPendingCount();
        checks.push({
          label: 'Pending excuse reviews',
          status: (count || 0) > 0 ? 'warn' : 'ok',
          count: count || 0,
          detail: (count || 0) > 0
            ? `${count} excuse request(s) are still waiting and may block final attendance cleanup.`
            : 'No pending excuse requests.',
          icon: (count || 0) > 0 ? '⚠️' : '✅',
          actionLabel: (count || 0) > 0 ? 'Review Excuses' : undefined,
          actionPath: (count || 0) > 0 ? '/excuse-requests' : undefined,
        });
      } catch {
        checks.push({
          label: 'Pending excuse reviews',
          status: 'warn',
          count: 0,
          detail: 'Could not load excuse request counts for this scan.',
          icon: '⚠️',
          actionLabel: 'Open Excuses',
          actionPath: '/excuse-requests',
        });
      }

      setHealthChecks(checks);
      setHealthLoaded(true);
    } catch (err) {
      console.error('Health check error:', err);
      toast.error('Failed to run health checks');
    }
    setHealthLoading(false);
  }, []);

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

  const loadStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      // Use count-only queries instead of fetching all rows (massive perf win)
      const [studentsRes, enrollmentsRes, teachersRes, sessionsRes, todaySessionsRes, coursesRes] = await Promise.all([
        supabase.from(Tables.STUDENT).select('student_id', { count: 'exact', head: true }),
        supabase.from(Tables.ENROLLMENT).select('enrollment_id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from(Tables.TEACHER).select('teacher_id', { count: 'exact', head: true }),
        supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true }),
        supabase.from(Tables.SESSION).select('session_id', { count: 'exact', head: true })
          .lte('start_date', today).gte('end_date', today),
        supabase.from(Tables.COURSE).select('course_id', { count: 'exact', head: true }),
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
        pendingFeedback: 0,
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

  const generateEmailLink = (student: AbsentStudent): string => {
    const riskLevelText = student.riskLevel.toUpperCase();
    const subject = `[${riskLevelText} PRIORITY] Attendance Concern - ${student.student_name} | إشعار حضور - ${student.student_name}`;
    
    const trendText = {
      improving: 'showing improvement ✅',
      declining: 'declining ⬇️',
      stable: 'stable but concerning ⚠️'
    }[student.trend];

    const trendTextAr = {
      improving: 'في تحسّن ✅',
      declining: 'في تراجع ⬇️',
      stable: 'مستقر لكنه مقلق ⚠️'
    }[student.trend];

    const patternsText = student.patterns.length > 0 
      ? `\n\n🔍 Detected Patterns:\n${student.patterns.map(p => `  • ${p}`).join('\n')}`
      : '';

    // Calculate absence severity metrics
    const absencePercentage = student.totalDays > 0 ? Math.round(((student.totalDays - student.presentDays) / student.totalDays) * 100) : 0;
    const daysToReach75 = student.totalDays > 0 
      ? Math.max(0, Math.ceil((0.75 * student.totalDays - student.presentDays) / (1 - 0.75)))
      : 0;
    const projectedEndRate = student.trend === 'declining' 
      ? Math.max(0, student.attendanceRate - 5) 
      : student.trend === 'improving' 
        ? Math.min(100, student.attendanceRate + 5) 
        : student.attendanceRate;

    // Risk-specific recommendation
    const recommendation = {
      critical: `🚨 URGENT ACTION REQUIRED:\nYour attendance has dropped to a critical level (${student.attendanceRate}%). This may result in:\n  • Academic probation or course failure\n  • Loss of enrollment eligibility\n  • Impact on certification/completion\n\nPlease schedule an immediate meeting with the administration within 48 hours.\n\n🚨 إجراء عاجل مطلوب:\nلقد انخفض حضورك إلى مستوى حرج (${student.attendanceRate}%). قد يؤدي هذا إلى:\n  • الإنذار الأكاديمي أو الإخفاق\n  • فقدان أهلية التسجيل\n  • التأثير على الشهادة/الإتمام\n\nيرجى تحديد موعد اجتماع فوري مع الإدارة خلال 48 ساعة.`,
      high: `⚠️ HIGH PRIORITY:\nYour attendance pattern (${student.attendanceRate}%) shows significant risk. We recommend:\n  • Meeting with your instructor this week\n  • Setting up an attendance improvement plan\n  • Contacting us about any difficulties\n\n⚠️ أولوية عالية:\nنمط حضورك (${student.attendanceRate}%) يُظهر خطراً كبيراً. ننصحك بـ:\n  • الاجتماع مع معلمك هذا الأسبوع\n  • وضع خطة لتحسين الحضور\n  • التواصل معنا بشأن أي صعوبات`,
      medium: `⚡ ATTENTION NEEDED:\nYour attendance (${student.attendanceRate}%) is below our recommended minimum of 75%. To get back on track:\n  • Attend all upcoming sessions without exception\n  • ${daysToReach75 > 0 ? `You need ${daysToReach75} consecutive sessions to reach 75%` : 'Keep maintaining current attendance'}\n  • Reach out if you need schedule accommodation\n\n⚡ يحتاج انتباهك:\nحضورك (${student.attendanceRate}%) أقل من الحد الأدنى الموصى به 75%. للعودة إلى المسار:\n  • احضر جميع الجلسات القادمة بدون استثناء\n  • ${daysToReach75 > 0 ? `تحتاج ${daysToReach75} جلسات متتالية للوصول إلى 75%` : 'حافظ على حضورك الحالي'}\n  • تواصل معنا إذا احتجت ترتيباً خاصاً`,
      watch: `👁️ EARLY NOTICE:\nWe've noticed some attendance patterns that may affect your progress. Current rate: ${student.attendanceRate}%.\nThis is an early intervention — maintaining regular attendance ensures you get the most from the course.\n\n👁️ إشعار مبكر:\nلاحظنا بعض أنماط الحضور التي قد تؤثر على تقدمك. المعدل الحالي: ${student.attendanceRate}%.\nهذا تدخل مبكر — الحفاظ على الحضور المنتظم يضمن لك أقصى استفادة من الدورة.`
    }[student.riskLevel];

    // Formatted absence list with day names
    const absencesList = student.absentDates.slice(0, 15).map(d => {
      const dateObj = new Date(d);
      return `  • ${format(dateObj, 'EEEE, MMMM dd, yyyy')}`;
    }).join('\n');
    const moreAbsences = student.absentDates.length > 15 
      ? `\n  ... and ${student.absentDates.length - 15} additional absences` 
      : '';

    const body = `Dear ${student.student_name},
عزيزي/عزيزتي ${student.student_name}،

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ATTENDANCE REPORT / تقرير الحضور
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Priority Level / مستوى الأولوية: ${riskLevelText}
Course / الدورة: ${student.course_name}
Report Date / تاريخ التقرير: ${format(new Date(), 'EEEE, MMMM dd, yyyy')}

📈 DETAILED STATISTICS / إحصائيات مفصلة:
  • Attendance Rate / معدل الحضور: ${student.attendanceRate}%
  • Absence Rate / معدل الغياب: ${absencePercentage}%
  • Sessions Attended / الجلسات المحضورة: ${student.presentDays} / ${student.totalDays}
  • Sessions Missed / الجلسات الفائتة: ${student.totalDays - student.presentDays}
  • Consecutive Absences / غياب متتالي: ${student.consecutiveAbsences} sessions
  • Engagement Score / درجة المشاركة: ${student.engagementScore}/100
  • Current Trend / الاتجاه الحالي: ${trendText} / ${trendTextAr}
  • Projected Rate / المعدل المتوقع: ~${projectedEndRate}% (if trend continues)${student.lastAttendedDate ? `\n  • Last Attended / آخر حضور: ${format(new Date(student.lastAttendedDate), 'EEEE, MMMM dd, yyyy')}` : ''}
${patternsText}

📅 ABSENCE RECORD / سجل الغياب:
${absencesList}${moreAbsences}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 NEXT STEPS / الخطوات التالية:
  1. Please respond to this email within 3 business days / يرجى الرد خلال 3 أيام عمل
  2. Schedule a meeting if needed / حدد موعد اجتماع إذا لزم الأمر
  3. Provide documentation for any excused absences / قدّم وثائق لأي غياب بعذر
  4. Contact us at any time for support / تواصل معنا في أي وقت للدعم

Best regards / مع أطيب التحيات,
Training Center Management / إدارة مركز التدريب

---
This is an automated attendance report generated by the Training Center Management System.
هذا تقرير حضور آلي تم إنشاؤه بواسطة نظام إدارة مركز التدريب.`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const generateSMSLink = (student: AbsentStudent): string => {
    const riskEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      watch: '👁️'
    }[student.riskLevel];

    const riskTextAr = {
      critical: 'حرج',
      high: 'عالي',
      medium: 'متوسط',
      watch: 'مراقبة'
    }[student.riskLevel];

    const urgencyNote = {
      critical: 'IMMEDIATE response required / مطلوب رد فوري',
      high: 'Please respond within 24 hours / يرجى الرد خلال 24 ساعة',
      medium: 'Please respond within 3 days / يرجى الرد خلال 3 أيام',
      watch: 'For your information / للعلم'
    }[student.riskLevel];

    // Recent absences for SMS (compact)
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');
    const moreDates = student.absentDates.length > 3 ? ` +${student.absentDates.length - 3} more` : '';

    const message = `${riskEmoji} ATTENDANCE ALERT / إشعار حضور
${student.student_name}

Course/الدورة: ${student.course_name}
Rate/المعدل: ${student.attendanceRate}%
Attended/حضر: ${student.presentDays}/${student.totalDays} sessions
Consecutive Absences/غياب متتالي: ${student.consecutiveAbsences}
Trend/الاتجاه: ${student.trend}
Risk/المستوى: ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `Recent Absences/غياب حديث: ${recentDates}${moreDates}` : ''}

${urgencyNote}

Contact training center / تواصل مع مركز التدريب`;

    // SMS link format - works on most devices
    return `sms:${student.phone || ''}?body=${encodeURIComponent(message)}`;
  };

  const generateWhatsAppLink = (student: AbsentStudent): string => {
    const riskEmoji = { critical: '🚨', high: '⚠️', medium: '⚡', watch: '👁️' }[student.riskLevel];
    const riskTextAr = { critical: 'حرج', high: 'عالي', medium: 'متوسط', watch: 'مراقبة' }[student.riskLevel];
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');

    const message = `${riskEmoji} *ATTENDANCE ALERT / إشعار حضور*

*Student/الطالب:* ${student.student_name}
*Course/الدورة:* ${student.course_name}
*Rate/المعدل:* ${student.attendanceRate}%
*Attended/حضر:* ${student.presentDays}/${student.totalDays} sessions
*Consecutive Absences/غياب متتالي:* ${student.consecutiveAbsences}
*Risk Level/المستوى:* ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `*Recent/حديث:* ${recentDates}` : ''}

Please contact the training center.
يرجى التواصل مع مركز التدريب.`;

    const phone = (student.phone || '').replace(/[^0-9]/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  // Generate template body based on type
  const generateTemplateBody = useCallback((template: MessageTemplate, student: AbsentStudent, channel: MessageChannel): { subject: string; body: string } => {
    const isEmail = channel === 'email';
    
    switch (template) {
      case 'encouragement': {
        const subject = `Great Progress! Keep Going - ${student.student_name} | أحسنت! واصل التقدم`;
        const body = isEmail
          ? `Dear ${student.student_name},\nعزيزي/عزيزتي ${student.student_name}،\n\n` +
            `We want to acknowledge your efforts in "${student.course_name}".\n` +
            `نود أن نقدر جهودك في "${student.course_name}".\n\n` +
            `📊 Your Stats / إحصائياتك:\n` +
            `  • Attendance Rate / معدل الحضور: ${student.attendanceRate}%\n` +
            `  • Sessions Attended / الجلسات المحضورة: ${student.presentDays}/${student.totalDays}\n` +
            `  • Engagement / المشاركة: ${student.engagementScore}/100\n` +
            `  • Trend / الاتجاه: ${student.trend}\n\n` +
            (student.trend === 'improving' 
              ? `🌟 Your attendance trend is improving — keep up the great work!\nاتجاه حضورك في تحسّن — استمر في العمل الرائع!\n\n`
              : `💪 We believe in your ability to succeed. Every session counts!\nنحن نؤمن بقدرتك على النجاح. كل جلسة مهمة!\n\n`) +
            `Best regards / مع أطيب التحيات,\nTraining Center Management / إدارة مركز التدريب`
          : `🌟 ${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}% | ${student.presentDays}/${student.totalDays}\n` +
            `Keep up the great work! واصل التقدم!`;
        return { subject, body };
      }
      case 'reminder': {
        const subject = `Session Reminder - ${student.course_name} | تذكير بالجلسة - ${student.course_name}`;
        const body = isEmail
          ? `Dear ${student.student_name},\nعزيزي/عزيزتي ${student.student_name}،\n\n` +
            `This is a friendly reminder about your upcoming session.\nهذا تذكير ودي بجلستك القادمة.\n\n` +
            `📅 Course / الدورة: ${student.course_name}\n` +
            `📊 Current Attendance / الحضور الحالي: ${student.attendanceRate}%\n` +
            `📈 Sessions Completed / الجلسات المكتملة: ${student.presentDays}/${student.totalDays}\n\n` +
            (student.attendanceRate < 75 
              ? `⚠️ Your attendance is below 75%. Please make every effort to attend.\nحضورك أقل من 75%. يرجى بذل كل جهد للحضور.\n\n`
              : '') +
            `We look forward to seeing you!\nنتطلع لرؤيتك!\n\n` +
            `Training Center Management / إدارة مركز التدريب`
          : `📅 REMINDER / تذكير\n${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}%\n` +
            `Don't miss your next session! لا تفوت جلستك القادمة!`;
        return { subject, body };
      }
      case 'custom':
        return { subject: `Re: ${student.student_name} - ${student.course_name}`, body: '' };
      case 'attendance_alert':
      default: {
        // Use existing generator logic but return as editable text
        if (isEmail) {
          const link = generateEmailLink(student);
          const params = new URL(link.replace('mailto:', 'https://x.com?to='));
          const subject = decodeURIComponent(params.searchParams.get('subject') || '');
          const body = decodeURIComponent(params.searchParams.get('body') || '');
          return { subject, body };
        } else {
          const smsLink = generateSMSLink(student);
          const body = decodeURIComponent(smsLink.split('body=')[1] || '');
          return { subject: '', body };
        }
      }
    }
  }, []);

  // Open composer for a single student
  const openComposer = useCallback((student: AbsentStudent, channel: MessageChannel = 'email') => {
    setComposerStudent(student);
    setComposerChannel(channel);
    setComposerTemplate('attendance_alert');
    setBulkMode(false);
    const { subject, body } = generateTemplateBody('attendance_alert', student, channel);
    setComposerSubject(subject);
    setComposerBody(body);
    setComposerOpen(true);
  }, [generateTemplateBody]);

  // Open bulk composer
  const openBulkComposer = useCallback((channel: MessageChannel = 'email') => {
    const first = filteredStudents[0];
    if (!first) return;
    setComposerStudent(first);
    setComposerChannel(channel);
    setComposerTemplate('attendance_alert');
    setBulkMode(true);
    setComposerSubject('[BULK] Attendance Alert / إشعار حضور');
    setComposerBody('Each student will receive a personalized message based on their attendance data.\nسيتلقى كل طالب رسالة مخصصة بناءً على بيانات حضوره.');
    setComposerOpen(true);
  }, [filteredStudents]);

  // Send message from composer
  const sendComposerMessage = useCallback(() => {
    if (bulkMode) {
      // Open all links for filtered students
      filteredStudents.forEach((student, index) => {
        setTimeout(() => {
          const { subject, body } = generateTemplateBody(composerTemplate, student, composerChannel);
          if (composerChannel === 'email') {
            window.open(`mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
          } else if (composerChannel === 'sms') {
            window.open(`sms:${student.phone || ''}?body=${encodeURIComponent(body)}`, '_blank');
          } else {
            const phone = (student.phone || '').replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
          }
        }, index * 500); // Stagger to avoid popup blocking
      });
    } else if (composerStudent) {
      if (composerChannel === 'email') {
        window.open(`mailto:${composerStudent.email}?subject=${encodeURIComponent(composerSubject)}&body=${encodeURIComponent(composerBody)}`, '_blank');
      } else if (composerChannel === 'sms') {
        window.open(`sms:${composerStudent.phone || ''}?body=${encodeURIComponent(composerBody)}`, '_blank');
      } else {
        const phone = (composerStudent.phone || '').replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(composerBody)}`, '_blank');
      }
    }
    setComposerOpen(false);
  }, [bulkMode, filteredStudents, composerStudent, composerChannel, composerTemplate, composerSubject, composerBody, generateTemplateBody]);

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
                <p className="text-xl font-bold text-gray-900 dark:text-white">Analytics →</p>
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

      {/* Data Integrity Health Panel (Teachers/Admins Only) */}
      {isTeacher && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🩺</span>
              Session Readiness Radar
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadHealthChecks} disabled={healthLoading}>
              {healthLoading ? 'Scanning...' : healthLoaded ? '🔄 Re-scan' : '▶️ Run Checks'}
            </Button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Checks the teacher workflow for blockers before attendance, check-in, feedback collection, and cleanup break.</p>
        </CardHeader>
        <CardContent>
          {!healthLoaded && !healthLoading && (
            <div className="text-center py-6 text-gray-400">
              <span className="text-3xl block mb-2">🔍</span>
              <p className="text-sm">Click <strong>Run Checks</strong> to scan for blockers before the next attendance and feedback cycle.</p>
            </div>
          )}
          {healthLoading && (
            <div className="text-center py-6 text-gray-400 animate-pulse">
              <span className="text-3xl block mb-2">⏳</span>
              <p className="text-sm">Scanning workflow blockers...</p>
            </div>
          )}
          {healthLoaded && !healthLoading && (
            <div className="space-y-2">
              {/* Summary bar */}
              <div className="flex gap-3 mb-3 text-xs font-medium">
                <span className="text-emerald-600 dark:text-emerald-400">✅ {healthChecks.filter(c => c.status === 'ok').length} Ready</span>
                <span className="text-amber-600 dark:text-amber-400">⚠️ {healthChecks.filter(c => c.status === 'warn').length} Attention</span>
                <span className="text-red-600 dark:text-red-400">🚨 {healthChecks.filter(c => c.status === 'error').length} Blocking</span>
              </div>
              {healthChecks.some(c => c.status !== 'ok') && (
                <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 px-3 py-2.5 text-xs text-purple-800 dark:text-purple-200">
                  Prioritize red blockers first, then warnings that cause stale analytics or broken feedback comparisons later.
                </div>
              )}
              {healthChecks.map((check, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  check.status === 'error' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                    : check.status === 'warn' ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30'
                }`}>
                  <span className="text-lg shrink-0 mt-0.5">{check.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{check.label}</p>
                      {check.count > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          check.status === 'error' ? 'bg-red-600 text-white'
                            : check.status === 'warn' ? 'bg-amber-600 text-white'
                            : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                        }`}>{check.count}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{check.detail}</p>
                    {check.actionPath && check.actionLabel && (
                      <button
                        type="button"
                        onClick={() => navigate(check.actionPath!)}
                        className="mt-2 text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {check.actionLabel} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

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

                {/* Bulk Messaging Toolbar */}
                <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">📨 Bulk Message ({filtered.length} students):</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openBulkComposer('email')}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      📧 Email All
                    </button>
                    <button
                      onClick={() => openBulkComposer('sms')}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      💬 SMS All
                    </button>
                    <button
                      onClick={() => openBulkComposer('whatsapp')}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      📱 WhatsApp All
                    </button>
                  </div>
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
                        onClick={() => {
                          const params = new URLSearchParams({
                            studentName: student.student_name,
                            status: 'absent',
                            course: student.course_id,
                            ...(startDate ? { startDate } : {}),
                            ...(endDate ? { endDate } : {})
                          });
                          navigate(`/attendance-records?${params.toString()}`);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            const params = new URLSearchParams({
                              studentName: student.student_name,
                              status: 'absent',
                              course: student.course_id,
                              ...(startDate ? { startDate } : {}),
                              ...(endDate ? { endDate } : {})
                            });
                            navigate(`/attendance-records?${params.toString()}`);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-4">
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
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={e => { e.stopPropagation(); openComposer(student, 'email'); }}
                              className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                              title="Compose Email"
                            >
                              📧 Email
                            </button>
                            {student.phone && (
                              <>
                                <button
                                  onClick={e => { e.stopPropagation(); openComposer(student, 'sms'); }}
                                  className="flex-shrink-0 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                  title="Compose SMS"
                                >
                                  💬 SMS
                                </button>
                                <a
                                  href={generateWhatsAppLink(student)}
                                  onClick={e => e.stopPropagation()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                  title="Send WhatsApp"
                                  tabIndex={-1}
                                >
                                  📱 WhatsApp
                                </a>
                              </>
                            )}
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

      {/* Message Composer Modal */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {bulkMode ? `📨 Bulk Message (${filteredStudents.length} students)` : '✉️ Message Composer'}
                </h3>
                {composerStudent && !bulkMode && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    To: {composerStudent.student_name} — {composerStudent.course_name}
                  </p>
                )}
              </div>
              <button
                onClick={() => setComposerOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Channel selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Channel</label>
                <div className="flex gap-2">
                  {(['email', 'sms', 'whatsapp'] as MessageChannel[]).map(ch => (
                    <button
                      key={ch}
                      onClick={() => {
                        setComposerChannel(ch);
                        if (composerStudent) {
                          const { subject, body } = generateTemplateBody(composerTemplate, composerStudent, ch);
                          setComposerSubject(subject);
                          setComposerBody(body);
                        }
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        composerChannel === ch
                          ? ch === 'email' ? 'bg-blue-600 text-white' : ch === 'sms' ? 'bg-green-600 text-white' : 'bg-emerald-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {ch === 'email' ? '📧 Email' : ch === 'sms' ? '💬 SMS' : '📱 WhatsApp'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { key: 'attendance_alert' as MessageTemplate, label: '🚨 Attendance Alert', desc: 'Risk-based warning' },
                    { key: 'encouragement' as MessageTemplate, label: '🌟 Encouragement', desc: 'Positive reinforcement' },
                    { key: 'reminder' as MessageTemplate, label: '📅 Session Reminder', desc: 'Upcoming session' },
                    { key: 'custom' as MessageTemplate, label: '✏️ Custom', desc: 'Write your own' },
                  ]).map(t => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setComposerTemplate(t.key);
                        if (composerStudent) {
                          const { subject, body } = generateTemplateBody(t.key, composerStudent, composerChannel);
                          setComposerSubject(subject);
                          setComposerBody(body);
                        }
                      }}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        composerTemplate === t.key
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{t.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject (email only) */}
              {composerChannel === 'email' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                  <input
                    type="text"
                    value={composerSubject}
                    onChange={e => setComposerSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Email subject..."
                  />
                </div>
              )}

              {/* Message body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Message Body</label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {composerBody.length} characters
                    {composerChannel === 'sms' && composerBody.length > 160 && (
                      <span className="text-amber-600 dark:text-amber-400 ml-1">
                        ({Math.ceil(composerBody.length / 160)} SMS parts)
                      </span>
                    )}
                  </span>
                </div>
                <textarea
                  value={composerBody}
                  onChange={e => setComposerBody(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  placeholder="Compose your message..."
                />
              </div>

              {/* Student preview card (non-bulk) */}
              {composerStudent && !bulkMode && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Recipient Details</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-gray-500 dark:text-gray-400">Name:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.student_name}</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Rate:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.attendanceRate}%</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Risk:</span> <span className={`font-medium ${composerStudent.riskLevel === 'critical' ? 'text-red-600' : composerStudent.riskLevel === 'high' ? 'text-orange-600' : composerStudent.riskLevel === 'medium' ? 'text-yellow-600' : 'text-blue-600'}`}>{composerStudent.riskLevel.toUpperCase()}</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Trend:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.trend}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setComposerOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                {!bulkMode && composerStudent && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {composerChannel === 'email' ? composerStudent.email : composerStudent.phone || 'No phone'}
                  </span>
                )}
                <button
                  onClick={sendComposerMessage}
                  className={`px-6 py-2 rounded-lg text-white text-sm font-medium transition-colors ${
                    composerChannel === 'email' ? 'bg-blue-600 hover:bg-blue-700' :
                    composerChannel === 'sms' ? 'bg-green-600 hover:bg-green-700' :
                    'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {bulkMode ? `Send to ${filteredStudents.length} Students` : 'Send Message'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
