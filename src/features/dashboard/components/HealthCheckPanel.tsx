import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { supabase } from '@/shared/lib/supabase';
import { excuseRequestService } from '@/features/excuses/services/excuseRequestService';
import { toast } from '@/shared/components/ui/toastUtils';
import type { HealthCheck } from '../constants/dashboardConstants';

export function HealthCheckPanel() {
  const navigate = useNavigate();
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


  return (
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
  );
}

