import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { supabase } from '@/shared/lib/supabase';
import { Tables } from '@/shared/types/database.types';
import { format } from 'date-fns';
import { analyzeAttendanceRisk } from '@/shared/utils/attendanceAnalytics';
import type { AbsentStudent } from '@/shared/utils/attendanceAnalytics';
import { excuseRequestService } from '@/features/excuses/services/excuseRequestService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { toast } from '@/shared/components/ui/toastUtils';

// Message template types for the composer
type MessageTemplate = 'attendance_alert' | 'encouragement' | 'reminder' | 'custom';
type MessageChannel = 'email' | 'sms' | 'whatsapp';

// Risk level styling Ã¢â‚¬â€ defined outside component to avoid recreation on every render
const RISK_STYLES = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    border: 'border-red-300 dark:border-red-700',
    hover: 'hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/50',
    badge: 'bg-red-600 text-white',
    icon: 'Ã°Å¸Å¡Â¨'
  },
  high: {
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    border: 'border-orange-300 dark:border-orange-700',
    hover: 'hover:bg-orange-100 hover:border-orange-400 dark:hover:bg-orange-900/50',
    badge: 'bg-orange-600 text-white',
    icon: 'Ã¢Å¡Â Ã¯Â¸Â'
  },
  medium: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/30',
    border: 'border-yellow-300 dark:border-yellow-700',
    hover: 'hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/50',
    badge: 'bg-yellow-600 text-white',
    icon: 'Ã¢Å¡Â¡'
  },
  watch: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-700',
    hover: 'hover:bg-blue-100 hover:border-blue-400 dark:hover:bg-blue-900/50',
    badge: 'bg-blue-600 text-white',
    icon: 'Ã°Å¸â€˜ÂÃ¯Â¸Â'
  }
} as const;

const TREND_ICONS = {
  improving: { icon: 'Ã°Å¸â€œË†', text: 'Improving', color: 'text-green-600 dark:text-green-400' },
  declining: { icon: 'Ã°Å¸â€œâ€°', text: 'Declining', color: 'text-red-600 dark:text-red-400' },
  stable: { icon: 'Ã¢â€ â€™', text: 'Stable', color: 'text-gray-600 dark:text-gray-400' }
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
      const now = Date.now();
      const normalizeAddress = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

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

      const feedbackSessions = feedbackSessionsRes.data || [];
      const feedbackQuestions = feedbackQuestionsRes.data || [];
      const attendance = attendanceRes.data || [];
      const hostRows = hostRes.data || [];
      const qrRows = qrRes.data || [];
      const photoRows = photoRes.data || [];
      const feedbackRows = feedbackRes.data || [];
      const activeAttendance = attendance.filter((row) => row.status !== 'absent');
      const activeQrRows = qrRows.filter((row) => row.is_valid && new Date(row.expires_at).getTime() > now);
      const activePhotoRows = photoRows.filter((row) => row.is_valid && new Date(row.expires_at).getTime() > now);

      const feedbackEnabledSessionIds = new Set(feedbackSessions.map((session) => session.session_id));
      // Sessions that have at least one global question (attendance_date IS NULL) cover ALL dates
      const sessionsWithGlobalQuestions = new Set(
        feedbackQuestions
          .filter((question) => !question.attendance_date)
          .map((question) => question.session_id)
      );
      const questionDateKeys = new Set(
        feedbackQuestions
          .filter((question) => Boolean(question.attendance_date))
          .map((question) => `${question.session_id}|${question.attendance_date}`)
      );
      const liveFeedbackDateKeys = new Map<string, { session_id: string; attendance_date: string }>();

      for (const row of hostRows) {
        if (!feedbackEnabledSessionIds.has(row.session_id)) continue;
        liveFeedbackDateKeys.set(`${row.session_id}|${row.attendance_date}`, {
          session_id: row.session_id,
          attendance_date: row.attendance_date,
        });
      }

      for (const row of activeQrRows) {
        if (!feedbackEnabledSessionIds.has(row.session_id)) continue;
        liveFeedbackDateKeys.set(`${row.session_id}|${row.attendance_date}`, {
          session_id: row.session_id,
          attendance_date: row.attendance_date,
        });
      }

      for (const row of activeAttendance) {
        if (!feedbackEnabledSessionIds.has(row.session_id)) continue;
        liveFeedbackDateKeys.set(`${row.session_id}|${row.attendance_date}`, {
          session_id: row.session_id,
          attendance_date: row.attendance_date,
        });
      }

      const feedbackWithoutQuestions = Array.from(liveFeedbackDateKeys.entries())
        .filter(([key, value]) => !sessionsWithGlobalQuestions.has(value.session_id) && !questionDateKeys.has(key))
        .map(([, value]) => value);
      const feedbackWithoutQuestionsSample = feedbackWithoutQuestions[0];
      checks.push({
        label: 'Feedback enabled without questions',
        status: feedbackWithoutQuestions.length > 0 ? 'warn' : 'ok',
        count: feedbackWithoutQuestions.length,
        detail: feedbackWithoutQuestions.length > 0
          ? `${feedbackWithoutQuestions.length} live session date(s) can reach feedback but still have no saved question set for that exact date.`
          : 'Every live feedback-enabled session date already has a saved question set ready for students.',
        icon: feedbackWithoutQuestions.length > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: feedbackWithoutQuestions.length > 0 ? 'Open Attendance Setup' : undefined,
        actionPath: feedbackWithoutQuestionsSample ? `/attendance/${feedbackWithoutQuestionsSample.session_id}?date=${feedbackWithoutQuestionsSample.attendance_date}` : undefined,
      });

      const hostMap = new Map(hostRows.map((row) => [`${row.session_id}|${row.attendance_date}`, row]));
      const attendanceDates = new Set(activeAttendance.map((row) => `${row.session_id}|${row.attendance_date}`));
      // Build a set of session+date combos where ALL attendance is "session not held"
      const sessionNotHeldDates = new Set<string>();
      for (const key of attendanceDates) {
        const matchingRows = activeAttendance.filter(a => `${a.session_id}|${a.attendance_date}` === key);
        if (matchingRows.length > 0 && matchingRows.every(a => a.host_address === 'SESSION_NOT_HELD' || a.excuse_reason === 'session not held')) {
          sessionNotHeldDates.add(key);
        }
      }
      let hostMissingCount = 0;
      let hostMissingSample: { session_id: string; attendance_date: string } | null = null;
      for (const key of attendanceDates) {
        // Skip session-not-held dates Ã¢â‚¬â€ they have deliberate sentinel data, not missing host setup
        if (sessionNotHeldDates.has(key)) continue;
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
        icon: hostMissingCount > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: hostMissingCount > 0 ? 'Open Exact Date' : undefined,
        actionPath: hostMissingSample ? `/attendance/${hostMissingSample.session_id}?date=${hostMissingSample.attendance_date}` : undefined,
      });

      const photoTokenSet = new Set(activePhotoRows.map((row) => row.token));
      const brokenPhotoQrRows = activeQrRows.filter((row) => row.check_in_mode === 'photo' && (!row.linked_photo_token || !photoTokenSet.has(row.linked_photo_token)));
      const brokenPhotoQrCount = brokenPhotoQrRows.length;
      const brokenPhotoQrSample = brokenPhotoQrRows[0];
      checks.push({
        label: 'Face QR routing is broken',
        status: brokenPhotoQrCount > 0 ? 'error' : 'ok',
        count: brokenPhotoQrCount,
        detail: brokenPhotoQrCount > 0
          ? `${brokenPhotoQrCount} QR session(s) point to face check-in without a valid linked photo token.`
          : 'All face-mode QR sessions point to a valid photo check-in token.',
        icon: brokenPhotoQrCount > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: brokenPhotoQrSample ? 'Open Broken Date' : undefined,
        actionPath: brokenPhotoQrSample ? `/attendance/${brokenPhotoQrSample.session_id}?date=${brokenPhotoQrSample.attendance_date}` : undefined,
      });

      const attendanceMethodMap = new Map(
        activeAttendance.map((row) => [`${row.student_id}|${row.session_id}|${row.attendance_date}`, (row.check_in_method || '').trim().toLowerCase() || null])
      );
      const feedbackMethodMismatchRows = feedbackRows.filter((row) => {
        const key = `${row.student_id}|${row.session_id}|${row.attendance_date}`;
        const attendanceMethod = attendanceMethodMap.get(key);
        const feedbackMethod = (row.check_in_method || '').trim().toLowerCase();
        return row.student_id && attendanceMethod && feedbackMethod && attendanceMethod !== feedbackMethod;
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
        icon: feedbackMethodMismatchCount > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: feedbackMethodMismatchSample ? 'Open Exact Feedback Slice' : undefined,
        actionPath: feedbackMethodMismatchSample ? `/feedback-analytics?session=${feedbackMethodMismatchSample.session_id}&date=${feedbackMethodMismatchSample.attendance_date}` : undefined,
      });

      let hostAddressDriftCount = 0;
      let hostAddressDriftSample: { session_id: string; attendance_date: string } | null = null;
      for (const row of activeAttendance) {
        if (!row.host_address) continue;
        const host = hostMap.get(`${row.session_id}|${row.attendance_date}`);
        if (host?.host_address && normalizeAddress(host.host_address) !== normalizeAddress(row.host_address)) {
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
        icon: hostAddressDriftCount > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
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
        icon: hostDupes.size > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
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
          icon: (count || 0) > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
          actionLabel: (count || 0) > 0 ? 'Review Excuses' : undefined,
          actionPath: (count || 0) > 0 ? '/excuse-requests' : undefined,
        });
      } catch {
        checks.push({
          label: 'Pending excuse reviews',
          status: 'warn',
          count: 0,
          detail: 'Could not load excuse request counts for this scan.',
          icon: 'Ã¢Å¡Â Ã¯Â¸Â',
          actionLabel: 'Open Excuses',
          actionPath: '/excuse-requests',
        });
      }

      // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ADVANCED DIAGNOSTIC CHECKS Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
      // Fetch additional data for deep checks
      const [
        sessionsRes,
        enrollmentsRes,
        feedbackAllRes,
        scoringRes,
      ] = await Promise.all([
        supabase.from('session').select('session_id, start_date, end_date, feedback_enabled, feedback_anonymous_allowed, course_id, teacher_id').limit(5000),
        supabase.from('enrollment').select('enrollment_id, student_id, session_id, status').limit(10000),
        supabase.from('session_feedback').select('id, session_id, student_id, attendance_date').limit(10000),
        supabase.from('scoring_config').select('teacher_id').limit(1000),
      ]);

      const allSessions = sessionsRes.data || [];
      const allEnrollments = enrollmentsRes.data || [];
      const allFeedback = feedbackAllRes.data || [];
      const allScoring = scoringRes.data || [];
      const today = new Date().toISOString().split('T')[0];

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 8: Duplicate feedback submissions Ã¢â€â‚¬Ã¢â€â‚¬
      const feedbackKeys = new Map<string, number>();
      for (const fb of allFeedback) {
        const key = `${fb.student_id}|${fb.session_id}|${fb.attendance_date}`;
        feedbackKeys.set(key, (feedbackKeys.get(key) || 0) + 1);
      }
      const duplicateFeedbackCount = Array.from(feedbackKeys.values()).filter(c => c > 1).length;
      checks.push({
        label: 'Duplicate feedback submissions',
        status: duplicateFeedbackCount > 0 ? 'error' : 'ok',
        count: duplicateFeedbackCount,
        detail: duplicateFeedbackCount > 0
          ? `${duplicateFeedbackCount} student-session-date combo(s) have more than one feedback row. This means duplicate prevention failed somewhere.`
          : 'Every student has at most one feedback per session date.',
        icon: duplicateFeedbackCount > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: duplicateFeedbackCount > 0 ? 'Open Feedback Analytics' : undefined,
        actionPath: duplicateFeedbackCount > 0 ? '/feedback-analytics' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 9: Feedback on disabled sessions Ã¢â€â‚¬Ã¢â€â‚¬
      const disabledSessionIds = new Set(allSessions.filter(s => !s.feedback_enabled).map(s => s.session_id));
      const feedbackOnDisabled = allFeedback.filter(fb => disabledSessionIds.has(fb.session_id));
      const uniqueDisabledSessions = new Set(feedbackOnDisabled.map(fb => fb.session_id));
      checks.push({
        label: 'Feedback data on disabled sessions',
        status: uniqueDisabledSessions.size > 0 ? 'warn' : 'ok',
        count: feedbackOnDisabled.length,
        detail: uniqueDisabledSessions.size > 0
          ? `${feedbackOnDisabled.length} feedback row(s) across ${uniqueDisabledSessions.size} session(s) have feedback_enabled=false. Old data is still visible in analytics.`
          : 'All feedback rows belong to sessions with feedback enabled.',
        icon: uniqueDisabledSessions.size > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: uniqueDisabledSessions.size > 0 ? 'Review in Analytics' : undefined,
        actionPath: uniqueDisabledSessions.size > 0 ? `/feedback-analytics?session=${Array.from(uniqueDisabledSessions)[0]}` : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 10: Attendance without active enrollment Ã¢â€â‚¬Ã¢â€â‚¬
      const enrollmentKeys = new Set(
        allEnrollments.filter(e => e.status === 'active').map(e => `${e.student_id}|${e.session_id}`)
      );
      const attendanceNoEnrollment = activeAttendance.filter(
        a => !enrollmentKeys.has(`${a.student_id}|${a.session_id}`)
      );
      checks.push({
        label: 'Attendance without active enrollment',
        status: attendanceNoEnrollment.length > 0 ? 'error' : 'ok',
        count: attendanceNoEnrollment.length,
        detail: attendanceNoEnrollment.length > 0
          ? `${attendanceNoEnrollment.length} attendance row(s) belong to students not actively enrolled. These orphan rows break scoring and analytics.`
          : 'All attendance rows match an active enrollment.',
        icon: attendanceNoEnrollment.length > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: attendanceNoEnrollment.length > 0 ? 'Check Enrollments' : undefined,
        actionPath: attendanceNoEnrollment.length > 0 ? '/enrollments' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 11: Active sessions with zero enrollments Ã¢â€â‚¬Ã¢â€â‚¬
      const sessionsWithEnrollments = new Set(allEnrollments.filter(e => e.status === 'active').map(e => e.session_id));
      const activeSessions = allSessions.filter(s => s.end_date >= today);
      const emptyActiveSessions = activeSessions.filter(s => !sessionsWithEnrollments.has(s.session_id));
      checks.push({
        label: 'Active sessions with no students',
        status: emptyActiveSessions.length > 0 ? 'warn' : 'ok',
        count: emptyActiveSessions.length,
        detail: emptyActiveSessions.length > 0
          ? `${emptyActiveSessions.length} session(s) haven't ended yet but have zero active enrollments.`
          : 'All active sessions have at least one enrolled student.',
        icon: emptyActiveSessions.length > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: emptyActiveSessions.length > 0 ? 'Manage Sessions' : undefined,
        actionPath: emptyActiveSessions.length > 0 ? '/sessions' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 12: Expired QR sessions still marked valid Ã¢â€ â€™ auto-fix Ã¢â€â‚¬Ã¢â€â‚¬
      const expiredButValidQr = qrRows.filter(row => row.is_valid && new Date(row.expires_at).getTime() <= now);
      if (expiredButValidQr.length > 0) {
        const expiredQrIds = expiredButValidQr.map(row => `${row.session_id}|${row.attendance_date}`);
        // Auto-invalidate expired QR tokens
        for (const row of expiredButValidQr) {
          await supabase.from('qr_sessions').update({ is_valid: false })
            .eq('session_id', row.session_id).eq('attendance_date', row.attendance_date);
        }
        checks.push({
          label: 'Expired QR tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: `Auto-fixed ${expiredQrIds.length} expired QR token(s) Ã¢â‚¬â€ set is_valid=false.`,
          icon: 'Ã¢Å“â€¦',
        });
      } else {
        checks.push({
          label: 'Expired QR tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: 'All expired QR sessions are properly invalidated.',
          icon: 'Ã¢Å“â€¦',
        });
      }

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 13: Expired photo check-in sessions still valid Ã¢â€ â€™ auto-fix Ã¢â€â‚¬Ã¢â€â‚¬
      const expiredButValidPhoto = photoRows.filter(row => row.is_valid && new Date(row.expires_at).getTime() <= now);
      if (expiredButValidPhoto.length > 0) {
        for (const row of expiredButValidPhoto) {
          await supabase.from('photo_checkin_sessions').update({ is_valid: false })
            .eq('token', row.token);
        }
        checks.push({
          label: 'Expired photo tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: `Auto-fixed ${expiredButValidPhoto.length} expired photo token(s) Ã¢â‚¬â€ set is_valid=false.`,
          icon: 'Ã¢Å“â€¦',
        });
      } else {
        checks.push({
          label: 'Expired photo tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: 'All expired photo sessions are properly invalidated.',
          icon: 'Ã¢Å“â€¦',
        });
      }

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 14: Sessions ended long ago still show up Ã¢â€â‚¬Ã¢â€â‚¬
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const staleEndedSessions = allSessions.filter(s => s.end_date < thirtyDaysAgo);
      const staleWithActivity = staleEndedSessions.filter(s => {
        return activeAttendance.some(a => a.session_id === s.session_id) || allFeedback.some(f => f.session_id === s.session_id);
      });
      checks.push({
        label: 'Old sessions with recent data',
        status: staleWithActivity.length > 0 ? 'warn' : 'ok',
        count: staleWithActivity.length,
        detail: staleWithActivity.length > 0
          ? `${staleWithActivity.length} session(s) ended 30+ days ago but still have attendance or feedback data linked. Consider archiving.`
          : 'No stale sessions detected with lingering data.',
        icon: staleWithActivity.length > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: staleWithActivity.length > 0 ? 'View Sessions' : undefined,
        actionPath: staleWithActivity.length > 0 ? '/sessions' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 15: Feedback without matching attendance Ã¢â€â‚¬Ã¢â€â‚¬
      const attendanceKeys = new Set(
        attendance.filter(a => a.status === 'on time' || a.status === 'late')
          .map(a => `${a.student_id}|${a.session_id}|${a.attendance_date}`)
      );
      // Also build set of session+date combos that are "session not held" Ã¢â‚¬â€ feedback here is expected orphan
      const notHeldDateKeys = new Set(
        attendance.filter(a => a.host_address === 'SESSION_NOT_HELD' || a.excuse_reason === 'session not held')
          .map(a => `${a.session_id}|${a.attendance_date}`)
      );
      const feedbackNoAttendance = allFeedback.filter(
        fb => fb.student_id
          && !attendanceKeys.has(`${fb.student_id}|${fb.session_id}|${fb.attendance_date}`)
          && !notHeldDateKeys.has(`${fb.session_id}|${fb.attendance_date}`)
      );
      checks.push({
        label: 'Feedback without valid attendance',
        status: feedbackNoAttendance.length > 0 ? 'error' : 'ok',
        count: feedbackNoAttendance.length,
        detail: feedbackNoAttendance.length > 0
          ? `${feedbackNoAttendance.length} feedback row(s) exist but the student has no on-time/late attendance for that date. RLS should have blocked these.`
          : 'All feedback rows have a matching valid attendance record.',
        icon: feedbackNoAttendance.length > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: feedbackNoAttendance.length > 0 ? 'Analytics' : undefined,
        actionPath: feedbackNoAttendance.length > 0 ? '/feedback-analytics' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 16: Teachers without scoring configuration Ã¢â€â‚¬Ã¢â€â‚¬
      // scoring_config.teacher_id references auth.users(id), not teacher(teacher_id).
      // We can't directly map teacher records to auth UIDs from the client,
      // so compare counts: unique active-session teachers vs unique scoring configs.
      const uniqueScoringTeacherIds = new Set(allScoring.map(s => s.teacher_id));
      const activeTeacherIds = new Set(activeSessions.map(s => s.teacher_id));
      const scoringGap = activeTeacherIds.size - uniqueScoringTeacherIds.size;
      checks.push({
        label: 'Active teachers without scoring config',
        status: scoringGap > 0 ? 'warn' : 'ok',
        count: Math.max(scoringGap, 0),
        detail: scoringGap > 0
          ? `${scoringGap} active-session teacher(s) may lack a scoring configuration. Student scores will default to base values.`
          : 'Scoring configurations cover all active-session teachers.',
        icon: scoringGap > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
        actionLabel: scoringGap > 0 ? 'Scoring Setup' : undefined,
        actionPath: scoringGap > 0 ? '/scoring-configuration' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 17: Enrollment-Session FK integrity Ã¢â€â‚¬Ã¢â€â‚¬
      const sessionIdSet = new Set(allSessions.map(s => s.session_id));
      const orphanedEnrollments = allEnrollments.filter(e => !sessionIdSet.has(e.session_id));
      checks.push({
        label: 'Orphaned enrollments (missing session)',
        status: orphanedEnrollments.length > 0 ? 'error' : 'ok',
        count: orphanedEnrollments.length,
        detail: orphanedEnrollments.length > 0
          ? `${orphanedEnrollments.length} enrollment(s) reference a session_id that doesn't exist. These are invisible data fragments.`
          : 'All enrollments reference valid sessions.',
        icon: orphanedEnrollments.length > 0 ? 'Ã°Å¸Å¡Â¨' : 'Ã¢Å“â€¦',
        actionLabel: orphanedEnrollments.length > 0 ? 'Manage Enrollments' : undefined,
        actionPath: orphanedEnrollments.length > 0 ? '/enrollments' : undefined,
      });

      // Ã¢â€â‚¬Ã¢â€â‚¬ Check 18: Feedback anonymous mode mismatch Ã¢â€â‚¬Ã¢â€â‚¬
      const anonymousBlockedSessions = allSessions.filter(s => s.feedback_enabled && !s.feedback_anonymous_allowed);
      const anonBlockedIds = new Set(anonymousBlockedSessions.map(s => s.session_id));
      // This is informational Ã¢â‚¬â€ just flag if there are sessions that block anonymous but have anonymous feedback
      const anonFeedbackOnBlocked = allFeedback.filter(fb => anonBlockedIds.has(fb.session_id) && !fb.student_id);
      checks.push({
        label: 'Anonymous feedback on non-anonymous sessions',
        status: anonFeedbackOnBlocked.length > 0 ? 'warn' : 'ok',
        count: anonFeedbackOnBlocked.length,
        detail: anonFeedbackOnBlocked.length > 0
          ? `${anonFeedbackOnBlocked.length} anonymous feedback row(s) exist on sessions that now block anonymous mode. These were submitted before the setting changed.`
          : 'No anonymous feedback on sessions that block anonymous submissions.',
        icon: anonFeedbackOnBlocked.length > 0 ? 'Ã¢Å¡Â Ã¯Â¸Â' : 'Ã¢Å“â€¦',
      });

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
    const subject = `[${riskLevelText} PRIORITY] Attendance Concern - ${student.student_name} | Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± - ${student.student_name}`;
    
    const trendText = {
      improving: 'showing improvement Ã¢Å“â€¦',
      declining: 'declining Ã¢Â¬â€¡Ã¯Â¸Â',
      stable: 'stable but concerning Ã¢Å¡Â Ã¯Â¸Â'
    }[student.trend];

    const trendTextAr = {
      improving: 'Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â­Ã˜Â³Ã™â€˜Ã™â€  Ã¢Å“â€¦',
      declining: 'Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹ Ã¢Â¬â€¡Ã¯Â¸Â',
      stable: 'Ã™â€¦Ã˜Â³Ã˜ÂªÃ™â€šÃ˜Â± Ã™â€žÃ™Æ’Ã™â€ Ã™â€¡ Ã™â€¦Ã™â€šÃ™â€žÃ™â€š Ã¢Å¡Â Ã¯Â¸Â'
    }[student.trend];

    const patternsText = student.patterns.length > 0 
      ? `\n\nÃ°Å¸â€Â Detected Patterns:\n${student.patterns.map(p => `  Ã¢â‚¬Â¢ ${p}`).join('\n')}`
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
      critical: `Ã°Å¸Å¡Â¨ URGENT ACTION REQUIRED:\nYour attendance has dropped to a critical level (${student.attendanceRate}%). This may result in:\n  Ã¢â‚¬Â¢ Academic probation or course failure\n  Ã¢â‚¬Â¢ Loss of enrollment eligibility\n  Ã¢â‚¬Â¢ Impact on certification/completion\n\nPlease schedule an immediate meeting with the administration within 48 hours.\n\nÃ°Å¸Å¡Â¨ Ã˜Â¥Ã˜Â¬Ã˜Â±Ã˜Â§Ã˜Â¡ Ã˜Â¹Ã˜Â§Ã˜Â¬Ã™â€ž Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨:\nÃ™â€žÃ™â€šÃ˜Â¯ Ã˜Â§Ã™â€ Ã˜Â®Ã™ÂÃ˜Â¶ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â¥Ã™â€žÃ™â€° Ã™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€° Ã˜Â­Ã˜Â±Ã˜Â¬ (${student.attendanceRate}%). Ã™â€šÃ˜Â¯ Ã™Å Ã˜Â¤Ã˜Â¯Ã™Å  Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜Â¥Ã™â€žÃ™â€°:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€ Ã˜Â°Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â£Ã™Æ’Ã˜Â§Ã˜Â¯Ã™Å Ã™â€¦Ã™Å  Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â®Ã™ÂÃ˜Â§Ã™â€š\n  Ã¢â‚¬Â¢ Ã™ÂÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€  Ã˜Â£Ã™â€¡Ã™â€žÃ™Å Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â³Ã˜Â¬Ã™Å Ã™â€ž\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â«Ã™Å Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â´Ã™â€¡Ã˜Â§Ã˜Â¯Ã˜Â©/Ã˜Â§Ã™â€žÃ˜Â¥Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€¦\n\nÃ™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã™ÂÃ™Ë†Ã˜Â±Ã™Å  Ã™â€¦Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 48 Ã˜Â³Ã˜Â§Ã˜Â¹Ã˜Â©.`,
      high: `Ã¢Å¡Â Ã¯Â¸Â HIGH PRIORITY:\nYour attendance pattern (${student.attendanceRate}%) shows significant risk. We recommend:\n  Ã¢â‚¬Â¢ Meeting with your instructor this week\n  Ã¢â‚¬Â¢ Setting up an attendance improvement plan\n  Ã¢â‚¬Â¢ Contacting us about any difficulties\n\nÃ¢Å¡Â Ã¯Â¸Â Ã˜Â£Ã™Ë†Ã™â€žÃ™Ë†Ã™Å Ã˜Â© Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å Ã˜Â©:\nÃ™â€ Ã™â€¦Ã˜Â· Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ (${student.attendanceRate}%) Ã™Å Ã™ÂÃ˜Â¸Ã™â€¡Ã˜Â± Ã˜Â®Ã˜Â·Ã˜Â±Ã˜Â§Ã™â€¹ Ã™Æ’Ã˜Â¨Ã™Å Ã˜Â±Ã˜Â§Ã™â€¹. Ã™â€ Ã™â€ Ã˜ÂµÃ˜Â­Ã™Æ’ Ã˜Â¨Ã™â‚¬:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â¹Ã™â€žÃ™â€¦Ã™Æ’ Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â¨Ã™Ë†Ã˜Â¹\n  Ã¢â‚¬Â¢ Ã™Ë†Ã˜Â¶Ã˜Â¹ Ã˜Â®Ã˜Â·Ã˜Â© Ã™â€žÃ˜ÂªÃ˜Â­Ã˜Â³Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã˜Â¨Ã˜Â´Ã˜Â£Ã™â€  Ã˜Â£Ã™Å  Ã˜ÂµÃ˜Â¹Ã™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª`,
      medium: `Ã¢Å¡Â¡ ATTENTION NEEDED:\nYour attendance (${student.attendanceRate}%) is below our recommended minimum of 75%. To get back on track:\n  Ã¢â‚¬Â¢ Attend all upcoming sessions without exception\n  Ã¢â‚¬Â¢ ${daysToReach75 > 0 ? `You need ${daysToReach75} consecutive sessions to reach 75%` : 'Keep maintaining current attendance'}\n  Ã¢â‚¬Â¢ Reach out if you need schedule accommodation\n\nÃ¢Å¡Â¡ Ã™Å Ã˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ Ã˜Â§Ã™â€ Ã˜ÂªÃ˜Â¨Ã˜Â§Ã™â€¡Ã™Æ’:\nÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ (${student.attendanceRate}%) Ã˜Â£Ã™â€šÃ™â€ž Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜ÂµÃ™â€° Ã˜Â¨Ã™â€¡ 75%. Ã™â€žÃ™â€žÃ˜Â¹Ã™Ë†Ã˜Â¯Ã˜Â© Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜Â§Ã˜Â±:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã˜Â­Ã˜Â¶Ã˜Â± Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â© Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â«Ã™â€ Ã˜Â§Ã˜Â¡\n  Ã¢â‚¬Â¢ ${daysToReach75 > 0 ? `Ã˜ÂªÃ˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ ${daysToReach75} Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€žÃ™Ë†Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â¥Ã™â€žÃ™â€° 75%` : 'Ã˜Â­Ã˜Â§Ã™ÂÃ˜Â¸ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å '}\n  Ã¢â‚¬Â¢ Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã˜Â¥Ã˜Â°Ã˜Â§ Ã˜Â§Ã˜Â­Ã˜ÂªÃ˜Â¬Ã˜Âª Ã˜ÂªÃ˜Â±Ã˜ÂªÃ™Å Ã˜Â¨Ã˜Â§Ã™â€¹ Ã˜Â®Ã˜Â§Ã˜ÂµÃ˜Â§Ã™â€¹`,
      watch: `Ã°Å¸â€˜ÂÃ¯Â¸Â EARLY NOTICE:\nWe've noticed some attendance patterns that may affect your progress. Current rate: ${student.attendanceRate}%.\nThis is an early intervention Ã¢â‚¬â€ maintaining regular attendance ensures you get the most from the course.\n\nÃ°Å¸â€˜ÂÃ¯Â¸Â Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã™â€¦Ã˜Â¨Ã™Æ’Ã˜Â±:\nÃ™â€žÃ˜Â§Ã˜Â­Ã˜Â¸Ã™â€ Ã˜Â§ Ã˜Â¨Ã˜Â¹Ã˜Â¶ Ã˜Â£Ã™â€ Ã™â€¦Ã˜Â§Ã˜Â· Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂªÃ™Å  Ã™â€šÃ˜Â¯ Ã˜ÂªÃ˜Â¤Ã˜Â«Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦Ã™Æ’. Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${student.attendanceRate}%.\nÃ™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜Â¯Ã˜Â®Ã™â€ž Ã™â€¦Ã˜Â¨Ã™Æ’Ã˜Â± Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â§Ã˜Â¸ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜ÂªÃ˜Â¸Ã™â€¦ Ã™Å Ã˜Â¶Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’ Ã˜Â£Ã™â€šÃ˜ÂµÃ™â€° Ã˜Â§Ã˜Â³Ã˜ÂªÃ™ÂÃ˜Â§Ã˜Â¯Ã˜Â© Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©.`
    }[student.riskLevel];

    // Formatted absence list with day names
    const absencesList = student.absentDates.slice(0, 15).map(d => {
      const dateObj = new Date(d);
      return `  Ã¢â‚¬Â¢ ${format(dateObj, 'EEEE, MMMM dd, yyyy')}`;
    }).join('\n');
    const moreAbsences = student.absentDates.length > 15 
      ? `\n  ... and ${student.absentDates.length - 15} additional absences` 
      : '';

    const body = `Dear ${student.student_name},
Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’

Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
Ã°Å¸â€œÅ  ATTENDANCE REPORT / Ã˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±
Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
Priority Level / Ã™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€žÃ™Ë†Ã™Å Ã˜Â©: ${riskLevelText}
Course / Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}
Report Date / Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â±: ${format(new Date(), 'EEEE, MMMM dd, yyyy')}

Ã°Å¸â€œË† DETAILED STATISTICS / Ã˜Â¥Ã˜Â­Ã˜ÂµÃ˜Â§Ã˜Â¦Ã™Å Ã˜Â§Ã˜Âª Ã™â€¦Ã™ÂÃ˜ÂµÃ™â€žÃ˜Â©:
  Ã¢â‚¬Â¢ Attendance Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${student.attendanceRate}%
  Ã¢â‚¬Â¢ Absence Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨: ${absencePercentage}%
  Ã¢â‚¬Â¢ Sessions Attended / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã˜Â©: ${student.presentDays} / ${student.totalDays}
  Ã¢â‚¬Â¢ Sessions Missed / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™ÂÃ˜Â§Ã˜Â¦Ã˜ÂªÃ˜Â©: ${student.totalDays - student.presentDays}
  Ã¢â‚¬Â¢ Consecutive Absences / Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å : ${student.consecutiveAbsences} sessions
  Ã¢â‚¬Â¢ Engagement Score / Ã˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â§Ã˜Â±Ã™Æ’Ã˜Â©: ${student.engagementScore}/100
  Ã¢â‚¬Â¢ Current Trend / Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${trendText} / ${trendTextAr}
  Ã¢â‚¬Â¢ Projected Rate / Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ™Ë†Ã™â€šÃ˜Â¹: ~${projectedEndRate}% (if trend continues)${student.lastAttendedDate ? `\n  Ã¢â‚¬Â¢ Last Attended / Ã˜Â¢Ã˜Â®Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${format(new Date(student.lastAttendedDate), 'EEEE, MMMM dd, yyyy')}` : ''}
${patternsText}

Ã°Å¸â€œâ€¦ ABSENCE RECORD / Ã˜Â³Ã˜Â¬Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨:
${absencesList}${moreAbsences}

Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
${recommendation}
Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â

Ã°Å¸â€œÅ¾ NEXT STEPS / Ã˜Â§Ã™â€žÃ˜Â®Ã˜Â·Ã™Ë†Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å Ã˜Â©:
  1. Please respond to this email within 3 business days / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 3 Ã˜Â£Ã™Å Ã˜Â§Ã™â€¦ Ã˜Â¹Ã™â€¦Ã™â€ž
  2. Schedule a meeting if needed / Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã˜Â¥Ã˜Â°Ã˜Â§ Ã™â€žÃ˜Â²Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â£Ã™â€¦Ã˜Â±
  3. Provide documentation for any excused absences / Ã™â€šÃ˜Â¯Ã™â€˜Ã™â€¦ Ã™Ë†Ã˜Â«Ã˜Â§Ã˜Â¦Ã™â€š Ã™â€žÃ˜Â£Ã™Å  Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â¹Ã˜Â°Ã˜Â±
  4. Contact us at any time for support / Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã™ÂÃ™Å  Ã˜Â£Ã™Å  Ã™Ë†Ã™â€šÃ˜Âª Ã™â€žÃ™â€žÃ˜Â¯Ã˜Â¹Ã™â€¦

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª,
Training Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨

---
This is an automated attendance report generated by the Training Center Management System.
Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â¢Ã™â€žÃ™Å  Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¤Ã™â€¡ Ã˜Â¨Ã™Ë†Ã˜Â§Ã˜Â³Ã˜Â·Ã˜Â© Ã™â€ Ã˜Â¸Ã˜Â§Ã™â€¦ Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨.`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const generateSMSLink = (student: AbsentStudent): string => {
    const riskEmoji = {
      critical: 'Ã°Å¸Å¡Â¨',
      high: 'Ã¢Å¡Â Ã¯Â¸Â',
      medium: 'Ã¢Å¡Â¡',
      watch: 'Ã°Å¸â€˜ÂÃ¯Â¸Â'
    }[student.riskLevel];

    const riskTextAr = {
      critical: 'Ã˜Â­Ã˜Â±Ã˜Â¬',
      high: 'Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å ',
      medium: 'Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â·',
      watch: 'Ã™â€¦Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨Ã˜Â©'
    }[student.riskLevel];

    const urgencyNote = {
      critical: 'IMMEDIATE response required / Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨ Ã˜Â±Ã˜Â¯ Ã™ÂÃ™Ë†Ã˜Â±Ã™Å ',
      high: 'Please respond within 24 hours / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 24 Ã˜Â³Ã˜Â§Ã˜Â¹Ã˜Â©',
      medium: 'Please respond within 3 days / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 3 Ã˜Â£Ã™Å Ã˜Â§Ã™â€¦',
      watch: 'For your information / Ã™â€žÃ™â€žÃ˜Â¹Ã™â€žÃ™â€¦'
    }[student.riskLevel];

    // Recent absences for SMS (compact)
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');
    const moreDates = student.absentDates.length > 3 ? ` +${student.absentDates.length - 3} more` : '';

    const message = `${riskEmoji} ATTENDANCE ALERT / Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±
${student.student_name}

Course/Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}
Rate/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž: ${student.attendanceRate}%
Attended/Ã˜Â­Ã˜Â¶Ã˜Â±: ${student.presentDays}/${student.totalDays} sessions
Consecutive Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å : ${student.consecutiveAbsences}
Trend/Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡: ${student.trend}
Risk/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€°: ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `Recent Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â­Ã˜Â¯Ã™Å Ã˜Â«: ${recentDates}${moreDates}` : ''}

${urgencyNote}

Contact training center / Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`;

    // SMS link format - works on most devices
    return `sms:${student.phone || ''}?body=${encodeURIComponent(message)}`;
  };

  const generateWhatsAppLink = (student: AbsentStudent): string => {
    const riskEmoji = { critical: 'Ã°Å¸Å¡Â¨', high: 'Ã¢Å¡Â Ã¯Â¸Â', medium: 'Ã¢Å¡Â¡', watch: 'Ã°Å¸â€˜ÂÃ¯Â¸Â' }[student.riskLevel];
    const riskTextAr = { critical: 'Ã˜Â­Ã˜Â±Ã˜Â¬', high: 'Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å ', medium: 'Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â·', watch: 'Ã™â€¦Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨Ã˜Â©' }[student.riskLevel];
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');

    const message = `${riskEmoji} *ATTENDANCE ALERT / Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±*

*Student/Ã˜Â§Ã™â€žÃ˜Â·Ã˜Â§Ã™â€žÃ˜Â¨:* ${student.student_name}
*Course/Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©:* ${student.course_name}
*Rate/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž:* ${student.attendanceRate}%
*Attended/Ã˜Â­Ã˜Â¶Ã˜Â±:* ${student.presentDays}/${student.totalDays} sessions
*Consecutive Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å :* ${student.consecutiveAbsences}
*Risk Level/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€°:* ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `*Recent/Ã˜Â­Ã˜Â¯Ã™Å Ã˜Â«:* ${recentDates}` : ''}

Please contact the training center.
Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨.`;

    const phone = (student.phone || '').replace(/[^0-9]/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  // Generate template body based on type
  const generateTemplateBody = useCallback((template: MessageTemplate, student: AbsentStudent, channel: MessageChannel): { subject: string; body: string } => {
    const isEmail = channel === 'email';
    
    switch (template) {
      case 'encouragement': {
        const subject = `Great Progress! Keep Going - ${student.student_name} | Ã˜Â£Ã˜Â­Ã˜Â³Ã™â€ Ã˜Âª! Ã™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦`;
        const body = isEmail
          ? `Dear ${student.student_name},\nÃ˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’\n\n` +
            `We want to acknowledge your efforts in "${student.course_name}".\n` +
            `Ã™â€ Ã™Ë†Ã˜Â¯ Ã˜Â£Ã™â€  Ã™â€ Ã™â€šÃ˜Â¯Ã˜Â± Ã˜Â¬Ã™â€¡Ã™Ë†Ã˜Â¯Ã™Æ’ Ã™ÂÃ™Å  "${student.course_name}".\n\n` +
            `Ã°Å¸â€œÅ  Your Stats / Ã˜Â¥Ã˜Â­Ã˜ÂµÃ˜Â§Ã˜Â¦Ã™Å Ã˜Â§Ã˜ÂªÃ™Æ’:\n` +
            `  Ã¢â‚¬Â¢ Attendance Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${student.attendanceRate}%\n` +
            `  Ã¢â‚¬Â¢ Sessions Attended / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã˜Â©: ${student.presentDays}/${student.totalDays}\n` +
            `  Ã¢â‚¬Â¢ Engagement / Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â§Ã˜Â±Ã™Æ’Ã˜Â©: ${student.engagementScore}/100\n` +
            `  Ã¢â‚¬Â¢ Trend / Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡: ${student.trend}\n\n` +
            (student.trend === 'improving' 
              ? `Ã°Å¸Å’Å¸ Your attendance trend is improving Ã¢â‚¬â€ keep up the great work!\nÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â­Ã˜Â³Ã™â€˜Ã™â€  Ã¢â‚¬â€ Ã˜Â§Ã˜Â³Ã˜ÂªÃ™â€¦Ã˜Â± Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â§Ã˜Â¦Ã˜Â¹!\n\n`
              : `Ã°Å¸â€™Âª We believe in your ability to succeed. Every session counts!\nÃ™â€ Ã˜Â­Ã™â€  Ã™â€ Ã˜Â¤Ã™â€¦Ã™â€  Ã˜Â¨Ã™â€šÃ˜Â¯Ã˜Â±Ã˜ÂªÃ™Æ’ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ™â€ Ã˜Â¬Ã˜Â§Ã˜Â­. Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© Ã™â€¦Ã™â€¡Ã™â€¦Ã˜Â©!\n\n`) +
            `Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª,\nTraining Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`
          : `Ã°Å¸Å’Å¸ ${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}% | ${student.presentDays}/${student.totalDays}\n` +
            `Keep up the great work! Ã™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦!`;
        return { subject, body };
      }
      case 'reminder': {
        const subject = `Session Reminder - ${student.course_name} | Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â± Ã˜Â¨Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â© - ${student.course_name}`;
        const body = isEmail
          ? `Dear ${student.student_name},\nÃ˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’\n\n` +
            `This is a friendly reminder about your upcoming session.\nÃ™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â± Ã™Ë†Ã˜Â¯Ã™Å  Ã˜Â¨Ã˜Â¬Ã™â€žÃ˜Â³Ã˜ÂªÃ™Æ’ Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â©.\n\n` +
            `Ã°Å¸â€œâ€¦ Course / Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}\n` +
            `Ã°Å¸â€œÅ  Current Attendance / Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${student.attendanceRate}%\n` +
            `Ã°Å¸â€œË† Sessions Completed / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜ÂªÃ™â€¦Ã™â€žÃ˜Â©: ${student.presentDays}/${student.totalDays}\n\n` +
            (student.attendanceRate < 75 
              ? `Ã¢Å¡Â Ã¯Â¸Â Your attendance is below 75%. Please make every effort to attend.\nÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â£Ã™â€šÃ™â€ž Ã™â€¦Ã™â€  75%. Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â¨Ã˜Â°Ã™â€ž Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€¡Ã˜Â¯ Ã™â€žÃ™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±.\n\n`
              : '') +
            `We look forward to seeing you!\nÃ™â€ Ã˜ÂªÃ˜Â·Ã™â€žÃ˜Â¹ Ã™â€žÃ˜Â±Ã˜Â¤Ã™Å Ã˜ÂªÃ™Æ’!\n\n` +
            `Training Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`
          : `Ã°Å¸â€œâ€¦ REMINDER / Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â±\n${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}%\n` +
            `Don't miss your next session! Ã™â€žÃ˜Â§ Ã˜ÂªÃ™ÂÃ™Ë†Ã˜Âª Ã˜Â¬Ã™â€žÃ˜Â³Ã˜ÂªÃ™Æ’ Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â©!`;
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
    setComposerSubject('[BULK] Attendance Alert / Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±');
    setComposerBody('Each student will receive a personalized message based on their attendance data.\nÃ˜Â³Ã™Å Ã˜ÂªÃ™â€žÃ™â€šÃ™â€° Ã™Æ’Ã™â€ž Ã˜Â·Ã˜Â§Ã™â€žÃ˜Â¨ Ã˜Â±Ã˜Â³Ã˜Â§Ã™â€žÃ˜Â© Ã™â€¦Ã˜Â®Ã˜ÂµÃ˜ÂµÃ˜Â© Ã˜Â¨Ã™â€ Ã˜Â§Ã˜Â¡Ã™â€¹ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™â€¡.');
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

  // Load pending excuses count Ã¢â‚¬â€ uses service layer
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
                Ã°Å¸Ââ€ 
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
                <p className="text-xl font-bold text-gray-900 dark:text-white">Analytics Ã¢â€ â€™</p>
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
              <span className="text-lg">Ã°Å¸Â©Âº</span>
              Session Readiness Radar
            </CardTitle>
            <Button size="sm" variant="outline" onClick={loadHealthChecks} disabled={healthLoading}>
              {healthLoading ? 'Scanning...' : healthLoaded ? 'Ã°Å¸â€â€ž Re-scan' : 'Ã¢â€“Â¶Ã¯Â¸Â Run Checks'}
            </Button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deep diagnostic scan: data integrity, feedback pipeline, check-in tokens, enrollment health, scoring config, and workflow blockers.</p>
        </CardHeader>
        <CardContent>
          {!healthLoaded && !healthLoading && (
            <div className="text-center py-6 text-gray-400">
              <span className="text-3xl block mb-2">Ã°Å¸â€Â</span>
              <p className="text-sm">Click <strong>Run Checks</strong> to run a deep diagnostic scan across attendance, feedback, enrollments, scoring, and tokens.</p>
            </div>
          )}
          {healthLoading && (
            <div className="text-center py-6 text-gray-400 animate-pulse">
              <span className="text-3xl block mb-2">Ã¢ÂÂ³</span>
              <p className="text-sm">Running deep diagnostic scan...</p>
            </div>
          )}
          {healthLoaded && !healthLoading && (() => {
            const errorCount = healthChecks.filter(c => c.status === 'error').length;
            const warnCount = healthChecks.filter(c => c.status === 'warn').length;
            const okCount = healthChecks.filter(c => c.status === 'ok').length;
            const totalChecks = healthChecks.length;
            const healthScore = totalChecks > 0 ? Math.round((okCount / totalChecks) * 100) : 100;
            const scoreColor = healthScore >= 90 ? 'text-emerald-600 dark:text-emerald-400' : healthScore >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
            const scoreBg = healthScore >= 90 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : healthScore >= 70 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
            // Sort: errors first, then warnings, then ok
            const sorted = [...healthChecks].sort((a, b) => {
              const order = { error: 0, warn: 1, ok: 2 };
              return order[a.status] - order[b.status];
            });
            return (
            <div className="space-y-2">
              {/* Health Score + Summary */}
              <div className={`rounded-xl border p-3 mb-3 ${scoreBg}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${scoreColor}`}>{healthScore}%</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">System Health</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{totalChecks} checks Ã‚Â· {okCount} passed Ã‚Â· {warnCount} warnings Ã‚Â· {errorCount} blockers</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs font-medium">
                    <span className="text-emerald-600 dark:text-emerald-400">Ã¢Å“â€¦ {okCount}</span>
                    <span className="text-amber-600 dark:text-amber-400">Ã¢Å¡Â Ã¯Â¸Â {warnCount}</span>
                    <span className="text-red-600 dark:text-red-400">Ã°Å¸Å¡Â¨ {errorCount}</span>
                  </div>
                </div>
              </div>
              {errorCount > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-800 dark:text-red-200">
                  <strong>{errorCount} blocking issue{errorCount > 1 ? 's' : ''}</strong> found. These indicate data integrity problems that need immediate attention.
                </div>
              )}
              {sorted.map((check, i) => (
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
                        {check.actionLabel} Ã¢â€ â€™
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            );
          })()}
        </CardContent>
      </Card>
      )}

      {/* Attendance Alerts - Enhanced Analytics (Teachers Only) */}
      {isTeacher && (
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Ã°Å¸Å½Â¯ Smart Attendance Analytics</CardTitle>
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
                <div className="text-5xl mb-3">Ã¢Å“â€œ</div>
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
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Ã°Å¸â€œÂ¨ Bulk Message ({filtered.length} students):</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openBulkComposer('email')}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      Ã°Å¸â€œÂ§ Email All
                    </button>
                    <button
                      onClick={() => openBulkComposer('sms')}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      Ã°Å¸â€™Â¬ SMS All
                    </button>
                    <button
                      onClick={() => openBulkComposer('whatsapp')}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      Ã°Å¸â€œÂ± WhatsApp All
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
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Ã°Å¸â€Â Detected Patterns:</div>
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
                                {student.lastAttendedDate && ` Ã¢â‚¬Â¢ Last attended: ${format(new Date(student.lastAttendedDate), 'MMM dd')}`}
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
                              Ã°Å¸â€œÂ§ Email
                            </button>
                            {student.phone && (
                              <>
                                <button
                                  onClick={e => { e.stopPropagation(); openComposer(student, 'sms'); }}
                                  className="flex-shrink-0 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                  title="Compose SMS"
                                >
                                  Ã°Å¸â€™Â¬ SMS
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
                                  Ã°Å¸â€œÂ± WhatsApp
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
              <div className="text-4xl mb-3">Ã°Å¸â€œÅ¡</div>
              <p className="text-gray-700 dark:text-gray-200 font-medium text-lg">Welcome to the Training Center</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Navigate to your courses, sessions, and attendance records using the menu above.</p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/attendance-records">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">Ã°Å¸â€œâ€¹</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Attendance</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View your attendance records</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/excuse-requests">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">Ã°Å¸â€œÂ</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">Excuse Requests</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Submit or track excuse requests</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/certificates">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">Ã°Å¸Ââ€ </div>
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
                  {bulkMode ? `Ã°Å¸â€œÂ¨ Bulk Message (${filteredStudents.length} students)` : 'Ã¢Å“â€°Ã¯Â¸Â Message Composer'}
                </h3>
                {composerStudent && !bulkMode && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    To: {composerStudent.student_name} Ã¢â‚¬â€ {composerStudent.course_name}
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
                      {ch === 'email' ? 'Ã°Å¸â€œÂ§ Email' : ch === 'sms' ? 'Ã°Å¸â€™Â¬ SMS' : 'Ã°Å¸â€œÂ± WhatsApp'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { key: 'attendance_alert' as MessageTemplate, label: 'Ã°Å¸Å¡Â¨ Attendance Alert', desc: 'Risk-based warning' },
                    { key: 'encouragement' as MessageTemplate, label: 'Ã°Å¸Å’Å¸ Encouragement', desc: 'Positive reinforcement' },
                    { key: 'reminder' as MessageTemplate, label: 'Ã°Å¸â€œâ€¦ Session Reminder', desc: 'Upcoming session' },
                    { key: 'custom' as MessageTemplate, label: 'Ã¢Å“ÂÃ¯Â¸Â Custom', desc: 'Write your own' },
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
