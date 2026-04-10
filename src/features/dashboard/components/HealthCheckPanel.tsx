import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { excuseRequestService } from '@/features/excuses/services/excuseRequestService';
import { dashboardService } from '@/features/dashboard/services/dashboardService';
import { toast } from '@/shared/components/ui/toastUtils';
import type { HealthCheck, HealthCheckCategory } from '../constants/dashboardConstants';
import { HEALTH_CATEGORY_LABELS } from '../constants/dashboardConstants';

export function HealthCheckPanel() {
  const navigate = useNavigate();
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const loadHealthChecks = useCallback(async () => {
    setHealthLoading(true);
    try {
      const checks: HealthCheck[] = [];
      const now = Date.now();
      const normalizeAddress = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

      const {
        feedbackSessions,
        feedbackQuestions,
        attendance,
        hostRows,
        qrRows,
        photoRows,
        feedbackRows,
      } = await dashboardService.getHealthCheckData();
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

      // Only include dates with active check-in tokens or actual attendance —
      // session_date_host alone doesn't let students reach feedback.
      for (const row of activeQrRows) {
        if (!feedbackEnabledSessionIds.has(row.session_id)) continue;
        liveFeedbackDateKeys.set(`${row.session_id}|${row.attendance_date}`, {
          session_id: row.session_id,
          attendance_date: row.attendance_date,
        });
      }

      for (const row of activePhotoRows) {
        if (!feedbackEnabledSessionIds.has((row as Record<string, unknown>).session_id as string)) continue;
        liveFeedbackDateKeys.set(`${(row as Record<string, unknown>).session_id}|${(row as Record<string, unknown>).attendance_date}`, {
          session_id: (row as Record<string, unknown>).session_id as string,
          attendance_date: (row as Record<string, unknown>).attendance_date as string,
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
        icon: feedbackWithoutQuestions.length > 0 ? '⚠️' : '✅',
        actionLabel: feedbackWithoutQuestions.length > 0 ? 'Open Attendance Setup' : undefined,
        actionPath: feedbackWithoutQuestionsSample ? `/attendance/${feedbackWithoutQuestionsSample.session_id}?date=${feedbackWithoutQuestionsSample.attendance_date}` : undefined,
        category: 'feedback',
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
        // Skip session-not-held dates — they have deliberate sentinel data, not missing host setup
        if (sessionNotHeldDates.has(key)) continue;
        const host = hostMap.get(key);
        if (!host || !host.host_address || !String(host.host_address).trim()) {
          // Fallback: check if attendance records themselves have host_address set
          // (this happens when host was resolved from teacher/student profile instead of session_date_host)
          const dateRows = activeAttendance.filter(a => `${a.session_id}|${a.attendance_date}` === key);
          const hasHostInAttendance = dateRows.some(a => a.host_address && String(a.host_address).trim() && a.host_address !== 'SESSION_NOT_HELD');
          if (hasHostInAttendance) continue;
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
        category: 'data-integrity',
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
        icon: brokenPhotoQrCount > 0 ? '🚨' : '✅',
        actionLabel: brokenPhotoQrSample ? 'Open Broken Date' : undefined,
        actionPath: brokenPhotoQrSample ? `/attendance/${brokenPhotoQrSample.session_id}?date=${brokenPhotoQrSample.attendance_date}` : undefined,
        category: 'tokens',
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
        icon: feedbackMethodMismatchCount > 0 ? '⚠️' : '✅',
        actionLabel: feedbackMethodMismatchSample ? 'Open Exact Feedback Slice' : undefined,
        actionPath: feedbackMethodMismatchSample ? `/feedback-analytics?session=${feedbackMethodMismatchSample.session_id}&date=${feedbackMethodMismatchSample.attendance_date}` : undefined,
        category: 'feedback',
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
        icon: hostAddressDriftCount > 0 ? '⚠️' : '✅',
        actionLabel: hostAddressDriftSample ? 'Open Drifted Date' : undefined,
        actionPath: hostAddressDriftSample ? `/attendance/${hostAddressDriftSample.session_id}?date=${hostAddressDriftSample.attendance_date}` : undefined,
        category: 'data-integrity',
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
        category: 'data-integrity',
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
          category: 'workflow',
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
          category: 'workflow',
        });
      }

      // ─── ADVANCED DIAGNOSTIC CHECKS ─────────────────────────
      // Fetch additional data for deep checks
      const { allSessions, allEnrollments, allFeedback, allScoring } = await dashboardService.getAdvancedHealthCheckData();
      const today = new Date().toISOString().split('T')[0];

      // ── Check 8: Duplicate feedback submissions ──
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
        icon: duplicateFeedbackCount > 0 ? '🚨' : '✅',
        actionLabel: duplicateFeedbackCount > 0 ? 'Open Feedback Analytics' : undefined,
        actionPath: duplicateFeedbackCount > 0 ? '/feedback-analytics' : undefined,
        category: 'feedback',
      });

      // ── Check 9: Feedback on disabled sessions ──
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
        icon: uniqueDisabledSessions.size > 0 ? '⚠️' : '✅',
        actionLabel: uniqueDisabledSessions.size > 0 ? 'Review in Analytics' : undefined,
        actionPath: uniqueDisabledSessions.size > 0 ? `/feedback-analytics?session=${Array.from(uniqueDisabledSessions)[0]}` : undefined,
        category: 'feedback',
      });

      // ── Check 10: Attendance without active enrollment ──
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
        icon: attendanceNoEnrollment.length > 0 ? '🚨' : '✅',
        actionLabel: attendanceNoEnrollment.length > 0 ? 'Check Enrollments' : undefined,
        actionPath: attendanceNoEnrollment.length > 0 ? '/enrollments' : undefined,
        category: 'data-integrity',
      });

      // ── Check 11: Active sessions with zero enrollments ──
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
        icon: emptyActiveSessions.length > 0 ? '⚠️' : '✅',
        actionLabel: emptyActiveSessions.length > 0 ? 'Manage Sessions' : undefined,
        actionPath: emptyActiveSessions.length > 0 ? '/sessions' : undefined,
        category: 'config',
      });

      // ── Check 12: Expired QR sessions still marked valid → auto-fix ──
      const expiredButValidQr = qrRows.filter(row => row.is_valid && new Date(row.expires_at).getTime() <= now);
      if (expiredButValidQr.length > 0) {
        const expiredQrIds = expiredButValidQr.map(row => `${row.session_id}|${row.attendance_date}`);
        await dashboardService.invalidateExpiredQrTokens(expiredButValidQr);
        checks.push({
          label: 'Expired QR tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: `Auto-fixed ${expiredQrIds.length} expired QR token(s) — set is_valid=false.`,
          icon: '✅',
          category: 'tokens',
        });
      } else {
        checks.push({
          label: 'Expired QR tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: 'All expired QR sessions are properly invalidated.',
          icon: '✅',
          category: 'tokens',
        });
      }

      // ── Check 13: Expired photo check-in sessions still valid → auto-fix ──
      const expiredButValidPhoto = photoRows.filter(row => row.is_valid && new Date(row.expires_at).getTime() <= now);
      if (expiredButValidPhoto.length > 0) {
        await dashboardService.invalidateExpiredPhotoTokens(expiredButValidPhoto.map((row) => row.token));
        checks.push({
          label: 'Expired photo tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: `Auto-fixed ${expiredButValidPhoto.length} expired photo token(s) — set is_valid=false.`,
          icon: '✅',
          category: 'tokens',
        });
      } else {
        checks.push({
          label: 'Expired photo tokens still marked valid',
          status: 'ok',
          count: 0,
          detail: 'All expired photo sessions are properly invalidated.',
          icon: '✅',
          category: 'tokens',
        });
      }

      // ── Check 14: Sessions ended long ago still show up ──
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
        icon: staleWithActivity.length > 0 ? '⚠️' : '✅',
        actionLabel: staleWithActivity.length > 0 ? 'View Sessions' : undefined,
        actionPath: staleWithActivity.length > 0 ? '/sessions' : undefined,
        category: 'config',
      });

      // ── Check 15: Feedback without matching attendance ──
      const attendanceKeys = new Set(
        attendance.filter(a => a.status === 'on time' || a.status === 'late')
          .map(a => `${a.student_id}|${a.session_id}|${a.attendance_date}`)
      );
      // Also build set of session+date combos that are "session not held" — feedback here is expected orphan
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
        icon: feedbackNoAttendance.length > 0 ? '🚨' : '✅',
        actionLabel: feedbackNoAttendance.length > 0 ? 'Analytics' : undefined,
        actionPath: feedbackNoAttendance.length > 0 ? '/feedback-analytics' : undefined,
        category: 'feedback',
      });

      // ── Check 16: Teachers without scoring configuration ──
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
        icon: scoringGap > 0 ? '⚠️' : '✅',
        actionLabel: scoringGap > 0 ? 'Scoring Setup' : undefined,
        actionPath: scoringGap > 0 ? '/scoring-config' : undefined,
        category: 'config',
      });

      // ── Check 17: Enrollment-Session FK integrity ──
      const sessionIdSet = new Set(allSessions.map(s => s.session_id));
      const orphanedEnrollments = allEnrollments.filter(e => !sessionIdSet.has(e.session_id));
      checks.push({
        label: 'Orphaned enrollments (missing session)',
        status: orphanedEnrollments.length > 0 ? 'error' : 'ok',
        count: orphanedEnrollments.length,
        detail: orphanedEnrollments.length > 0
          ? `${orphanedEnrollments.length} enrollment(s) reference a session_id that doesn't exist. These are invisible data fragments.`
          : 'All enrollments reference valid sessions.',
        icon: orphanedEnrollments.length > 0 ? '🚨' : '✅',
        actionLabel: orphanedEnrollments.length > 0 ? 'Manage Enrollments' : undefined,
        actionPath: orphanedEnrollments.length > 0 ? '/enrollments' : undefined,
        category: 'data-integrity',
      });

      // ── Check 18: Feedback anonymous mode mismatch ──
      const anonymousBlockedSessions = allSessions.filter(s => s.feedback_enabled && !s.feedback_anonymous_allowed);
      const anonBlockedIds = new Set(anonymousBlockedSessions.map(s => s.session_id));
      // This is informational — just flag if there are sessions that block anonymous but have anonymous feedback
      const anonFeedbackOnBlocked = allFeedback.filter(fb => anonBlockedIds.has(fb.session_id) && !fb.student_id);
      checks.push({
        label: 'Anonymous feedback on non-anonymous sessions',
        status: anonFeedbackOnBlocked.length > 0 ? 'warn' : 'ok',
        count: anonFeedbackOnBlocked.length,
        detail: anonFeedbackOnBlocked.length > 0
          ? `${anonFeedbackOnBlocked.length} anonymous feedback row(s) exist on sessions that now block anonymous mode. These were submitted before the setting changed.`
          : 'No anonymous feedback on sessions that block anonymous submissions.',
        icon: anonFeedbackOnBlocked.length > 0 ? '⚠️' : '✅',
        category: 'feedback',
      });

      // ── Check 19: Duplicate attendance records (same student + session + date) ──
      const attDupKeys = new Map<string, number>();
      for (const a of attendance) {
        const key = `${a.student_id}|${a.session_id}|${a.attendance_date}`;
        attDupKeys.set(key, (attDupKeys.get(key) || 0) + 1);
      }
      const duplicateAttendanceCount = Array.from(attDupKeys.values()).filter(c => c > 1).length;
      checks.push({
        label: 'Duplicate attendance records',
        status: duplicateAttendanceCount > 0 ? 'error' : 'ok',
        count: duplicateAttendanceCount,
        detail: duplicateAttendanceCount > 0
          ? `${duplicateAttendanceCount} student-session-date combo(s) have more than one attendance row. This corrupts scoring and analytics.`
          : 'Every student has at most one attendance record per session date.',
        icon: duplicateAttendanceCount > 0 ? '🚨' : '✅',
        actionLabel: duplicateAttendanceCount > 0 ? 'Check Attendance' : undefined,
        actionPath: duplicateAttendanceCount > 0 ? '/sessions' : undefined,
        category: 'data-integrity',
      });

      // ── Check 20: Sessions ending within 7 days with incomplete host setup ──
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endingSoonSessions = activeSessions.filter(s => s.end_date >= today && s.end_date <= sevenDaysFromNow);
      const hostSessionIds = new Set(hostRows.map(r => r.session_id));
      const endingSoonNoHost = endingSoonSessions.filter(s => !hostSessionIds.has(s.session_id));
      checks.push({
        label: 'Sessions ending soon without host setup',
        status: endingSoonNoHost.length > 0 ? 'warn' : 'ok',
        count: endingSoonNoHost.length,
        detail: endingSoonNoHost.length > 0
          ? `${endingSoonNoHost.length} session(s) end within 7 days but have no host assignment rows at all.`
          : 'All sessions ending soon have host assignments configured.',
        icon: endingSoonNoHost.length > 0 ? '⚠️' : '✅',
        actionLabel: endingSoonNoHost.length > 0 ? 'Manage Sessions' : undefined,
        actionPath: endingSoonNoHost.length > 0 ? '/sessions' : undefined,
        category: 'workflow',
      });

      setHealthChecks(checks);
      setHealthLoaded(true);
    } catch (err) {
      console.error('Health check error:', err);
      toast.error('Failed to run health checks');
    }
    setHealthLoading(false);
  }, []);


  return (
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
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deep diagnostic scan: data integrity, feedback pipeline, check-in tokens, enrollment health, scoring config, and workflow blockers.</p>
        </CardHeader>
        <CardContent>
          {!healthLoaded && !healthLoading && (
            <div className="text-center py-6 text-gray-400">
              <span className="text-3xl block mb-2">🔍</span>
              <p className="text-sm">Click <strong>Run Checks</strong> to run a deep diagnostic scan across attendance, feedback, enrollments, scoring, and tokens.</p>
            </div>
          )}
          {healthLoading && (
            <div className="text-center py-6 text-gray-400 animate-pulse">
              <span className="text-3xl block mb-2">⏳</span>
              <p className="text-sm">Running deep diagnostic scan...</p>
            </div>
          )}
          {healthLoaded && !healthLoading && (() => {
            const errorCount = healthChecks.filter(c => c.status === 'error').length;
            const warnCount = healthChecks.filter(c => c.status === 'warn').length;
            const okCount = healthChecks.filter(c => c.status === 'ok').length;
            const totalChecks = healthChecks.length;
            // Weighted score: errors penalize 3x, warnings 1x
            const maxPoints = totalChecks * 3;
            const lostPoints = (errorCount * 3) + (warnCount * 1);
            const healthScore = maxPoints > 0 ? Math.round(((maxPoints - lostPoints) / maxPoints) * 100) : 100;
            const scoreColor = healthScore >= 90 ? 'text-emerald-600 dark:text-emerald-400' : healthScore >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
            const scoreBg = healthScore >= 90 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : healthScore >= 70 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';

            // Group checks by category
            const categoryOrder: HealthCheckCategory[] = ['data-integrity', 'feedback', 'tokens', 'config', 'workflow'];
            const grouped = new Map<HealthCheckCategory, HealthCheck[]>();
            for (const cat of categoryOrder) grouped.set(cat, []);
            for (const check of healthChecks) {
              const cat = check.category || 'config';
              if (!grouped.has(cat)) grouped.set(cat, []);
              grouped.get(cat)!.push(check);
            }
            // Sort within each group: errors first, then warnings, then ok
            const statusOrder = { error: 0, warn: 1, ok: 2 };
            for (const [, checks] of grouped) {
              checks.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
            }

            return (
            <div className="space-y-3">
              {/* Health Score + Summary */}
              <div className={`rounded-xl border p-3 mb-1 ${scoreBg}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${scoreColor}`}>{healthScore}%</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">System Health</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{totalChecks} checks · {okCount} passed · {warnCount} warnings · {errorCount} blockers</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs font-medium">
                    <span className="text-emerald-600 dark:text-emerald-400">✅ {okCount}</span>
                    <span className="text-amber-600 dark:text-amber-400">⚠️ {warnCount}</span>
                    <span className="text-red-600 dark:text-red-400">🚨 {errorCount}</span>
                  </div>
                </div>
              </div>
              {errorCount > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-800 dark:text-red-200">
                  <strong>{errorCount} blocking issue{errorCount > 1 ? 's' : ''}</strong> found. These indicate data integrity problems that need immediate attention.
                </div>
              )}
              {/* Category-grouped checks */}
              {categoryOrder.map(cat => {
                const catChecks = grouped.get(cat) || [];
                if (catChecks.length === 0) return null;
                const catMeta = HEALTH_CATEGORY_LABELS[cat];
                const catErrors = catChecks.filter(c => c.status === 'error').length;
                const catWarns = catChecks.filter(c => c.status === 'warn').length;
                const isCollapsed = collapsedCategories.has(cat);
                const allOk = catErrors === 0 && catWarns === 0;
                return (
                  <div key={cat}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between py-1.5 px-1 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>{catMeta.icon}</span>
                        <span>{catMeta.label}</span>
                        <span className="text-[10px] font-normal text-gray-400">({catChecks.length})</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {catErrors > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white">{catErrors}</span>}
                        {catWarns > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-600 text-white">{catWarns}</span>}
                        {allOk && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">All clear</span>}
                        <span className="text-gray-400 text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="space-y-1.5 mb-2">
                        {catChecks.map((check, i) => (
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
                  </div>
                );
              })}
            </div>
            );
          })()}
        </CardContent>
      </Card>
  );
}

