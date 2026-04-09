import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { attendanceService } from '@/features/attendance/services/attendanceService';
import { studentService } from '@/features/students/services/studentService';
import { certificateService } from '@/features/certificates/services/certificateService';
import type { IssuedCertificate } from '@/features/certificates/services/certificateService';
import { CertificatePreview } from '@/features/certificates/components/CertificatePreview';
import { DEFAULT_SCORING_CONFIG, calcWeightedScore, calcCoverageFactor, calcLateScore } from '@/features/scoring/services/scoringConfigService';
import { getSignedPhotoUrl } from '@/shared/utils/photoUtils';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/components/ui/toastUtils';
import type { Student } from '@/shared/types/database.types';

interface StudentDetailModalProps {
  student: Student;
  onClose: () => void;
}

interface AttendanceRecord {
  attendance_date: string;
  status: string;
  check_in_method?: string | null;
  check_in_time?: string | null;
  late_minutes?: number | null;
  session?: {
    session_id?: string;
    course?: { course_name?: string } | Array<{ course_name?: string }>;
  } | Array<{
    session_id?: string;
    course?: { course_name?: string } | Array<{ course_name?: string }>;
  }> | null;
}

interface EnrollmentRecord {
  enrollment_id: string;
  status: string;
  session?: {
    session_id?: string;
    start_date?: string;
    end_date?: string;
    course?: { course_name?: string } | Array<{ course_name?: string }>;
    teacher?: { name?: string } | Array<{ name?: string }>;
  } | Array<{
    session_id?: string;
    start_date?: string;
    end_date?: string;
    course?: { course_name?: string } | Array<{ course_name?: string }>;
    teacher?: { name?: string } | Array<{ name?: string }>;
  }> | null;
}

function unwrap<T>(val: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(val)) return val[0];
  return val ?? undefined;
}

export function StudentDetailModal({ student, onClose }: StudentDetailModalProps) {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'enrollments' | 'certificates'>('overview');
  const [photoSignedUrl, setPhotoSignedUrl] = useState<string | null>(null);
  const [attSortCol, setAttSortCol] = useState<'date' | 'course' | 'status' | 'method'>('date');
  const [attSortDir, setAttSortDir] = useState<'asc' | 'desc'>('desc');
  const [previewCert, setPreviewCert] = useState<IssuedCertificate | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<IssuedCertificate | null>(null);
  const { isTeacher } = useIsTeacher();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [attRes, enrRes, certRes] = await Promise.all([
        attendanceService.getByStudent(student.student_id),
        studentService.getEnrollments(student.student_id),
        certificateService.getIssuedCertificates({ student_id: student.student_id }),
      ]);
      if (cancelled) return;
      setAttendance((attRes.data as AttendanceRecord[]) || []);
      setEnrollments((enrRes.data as EnrollmentRecord[]) || []);
      setCertificates((certRes.data || []) as IssuedCertificate[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [student.student_id]);

  // Load signed photo URL
  useEffect(() => {
    let cancelled = false;
    if (!student.photo_url) { setPhotoSignedUrl(null); return; }
    getSignedPhotoUrl(student.photo_url).then(url => {
      if (!cancelled) setPhotoSignedUrl(url);
    });
    return () => { cancelled = true; };
  }, [student.photo_url]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ─── Full Analytics Engine (mirrors AttendanceRecords calculateAnalytics) ──
  const analytics = useMemo(() => {
    if (attendance.length === 0) return null;

    const config = DEFAULT_SCORING_CONFIG;
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // 1. Filter: exclude future dates and "session not held"
    const filtered = attendance.filter(a => {
      if (!a.attendance_date) return false;
      if (new Date(a.attendance_date) > today) return false;
      if ((a as { excuse_reason?: string }).excuse_reason === 'session not held') return false;
      if ((a as { host_address?: string }).host_address === 'SESSION_NOT_HELD') return false;
      return true;
    });

    if (filtered.length === 0) return null;

    // 2. Dedupe by date — keep highest-priority status per date
    const priority = (status: string) => {
      if (status === 'absent') return 5;
      if (status === 'late') return 4;
      if (status === 'on time') return 3;
      if (status === 'excused') return 2;
      if (status === 'not enrolled') return 1;
      return 0;
    };
    const byDate = new Map<string, AttendanceRecord>();
    for (const r of filtered) {
      const existing = byDate.get(r.attendance_date);
      if (!existing || priority(r.status) > priority(existing.status)) {
        byDate.set(r.attendance_date, r);
      }
    }
    const unique = [...byDate.values()];
    const accountableRecords = unique.filter(r => r.status !== 'excused' && r.status !== 'not enrolled');
    const accountable = accountableRecords.length;
    if (accountable === 0) return null;

    const onTime = unique.filter(r => r.status === 'on time').length;
    const late = unique.filter(r => r.status === 'late').length;
    const absent = unique.filter(r => r.status === 'absent').length;
    const excused = unique.filter(r => r.status === 'excused').length;
    const present = onTime + late;
    const total = unique.length;
    const attendanceRate = Math.round((present / accountable) * 1000) / 10;

    // 3. Quality rate — exponential decay for late arrivals
    let qualitySum = 0;
    const lateScores: number[] = [];
    for (const r of unique) {
      if (r.status === 'on time') { qualitySum += 1; }
      else if (r.status === 'late') {
        const score = calcLateScore(r.late_minutes, config);
        qualitySum += score;
        lateScores.push(score);
      }
    }
    const qualityRate = Math.round((qualitySum / accountable) * 1000) / 10;
    const lateScoreAvg = lateScores.length > 0 ? Math.round(lateScores.reduce((s, v) => s + v, 0) / lateScores.length * 100) / 100 : 0;

    // 4. Punctuality (on-time / present, not accountable)
    const punctuality = present > 0 ? Math.round((onTime / present) * 1000) / 10 : 0;

    // 5. Coverage factor & weighted score
    const coverageFactor = calcCoverageFactor(accountable, accountable, config);
    const { rawScore, finalScore } = calcWeightedScore(
      qualityRate, attendanceRate, punctuality,
      accountable, accountable, config
    );
    const weightedScore = Math.round(Math.min(100, Math.max(0, finalScore)) * 10) / 10;

    // 6. Trend — linear regression on cumulative attendance rate
    const sorted = [...accountableRecords].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
    const cumulativeRates: number[] = [];
    let cumPresent = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].status === 'on time' || sorted[i].status === 'late') cumPresent++;
      cumulativeRates.push((cumPresent / (i + 1)) * 100);
    }
    const recent = cumulativeRates.slice(-5);
    let trendSlope = 0;
    let trendR2 = 0;
    let trendClassification: 'IMPROVING' | 'DECLINING' | 'STABLE' | 'VOLATILE' = 'STABLE';
    if (recent.length >= 3) {
      const n = recent.length;
      const xMean = (n - 1) / 2;
      const yMean = recent.reduce((s, v) => s + v, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (recent[i] - yMean);
        den += (i - xMean) ** 2;
      }
      trendSlope = den > 0 ? num / den : 0;
      let ssTot = 0, ssRes = 0;
      for (let i = 0; i < n; i++) {
        const predicted = yMean + trendSlope * (i - xMean);
        ssRes += (recent[i] - predicted) ** 2;
        ssTot += (recent[i] - yMean) ** 2;
      }
      trendR2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
      if (trendR2 < 0.3) trendClassification = 'VOLATILE';
      else if (trendSlope > 2) trendClassification = 'IMPROVING';
      else if (trendSlope < -2) trendClassification = 'DECLINING';
      else trendClassification = 'STABLE';
    }

    // 7. Weekly change
    const recent5 = cumulativeRates.slice(-5);
    const prev5 = cumulativeRates.slice(-10, -5);
    const weeklyChange = (recent5.length > 0 && prev5.length > 0)
      ? Math.round((recent5[recent5.length - 1] - prev5[prev5.length - 1]) * 10) / 10
      : 0;

    // 8. Consecutive absences (from most recent)
    const sortedDesc = [...accountableRecords].sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
    let consecutive = 0;
    for (const r of sortedDesc) {
      if (r.status === 'absent') consecutive++;
      else break;
    }

    // 9. Max consecutive attendance streak (in weeks)
    const sortedDates = sorted.map(r => new Date(r.attendance_date + 'T00:00:00').getTime());
    let maxStreak = 0, currentStreak = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].status === 'on time' || sorted[i].status === 'late') {
        if (i === 0 || (sortedDates[i] - sortedDates[i - 1]) <= 8 * 86400000) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    // 10. First half vs second half comparison
    const midpoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midpoint);
    const secondHalf = sorted.slice(midpoint);
    const halfRate = (arr: typeof sorted) => {
      const p = arr.filter(r => r.status === 'on time' || r.status === 'late').length;
      return arr.length > 0 ? Math.round((p / arr.length) * 1000) / 10 : 0;
    };
    const firstHalfRate = halfRate(firstHalf);
    const secondHalfRate = halfRate(secondHalf);

    // 11. Consistency Index — measures clustering of absences
    let consistencyIndex = 1;
    if (absent > 0 && accountable > 1) {
      const pattern = sorted.map(r => (r.status === 'on time' || r.status === 'late') ? 1 : 0);
      // Count absence streaks
      const streaks: number[] = [];
      let streak = 0;
      for (const v of pattern) {
        if (v === 0) { streak++; }
        else { if (streak > 0) streaks.push(streak); streak = 0; }
      }
      if (streak > 0) streaks.push(streak);

      if (streaks.length > 0 && absent > 1) {
        const scatterRatio = streaks.length / absent;
        const longestStreak = Math.max(...streaks);
        const streakPenalty = 1 - (longestStreak - 1) / (absent - 1 || 1);
        const rawConsistency = 0.5 * scatterRatio + 0.5 * streakPenalty;
        const dampening = Math.min(absent / 5, 1);
        consistencyIndex = Math.round((rawConsistency * dampening + (1 - dampening)) * 100) / 100;
      } else {
        consistencyIndex = absent === 1 ? 0.95 : 1;
      }
    }

    // 12. Late minutes stats
    const lateRecords = unique.filter(a => a.status === 'late' && a.late_minutes);
    const totalLateMinutes = lateRecords.reduce((s, a) => s + (a.late_minutes || 0), 0);
    const avgLateMinutes = lateRecords.length > 0 ? Math.round(totalLateMinutes / lateRecords.length) : 0;
    const maxLateMinutes = lateRecords.length > 0 ? Math.max(...lateRecords.map(a => a.late_minutes || 0)) : 0;

    // 13. AI-generated insights
    const insights: { text: string; type: 'positive' | 'warning' | 'danger' | 'info' }[] = [];

    if (weightedScore >= 90) insights.push({ text: 'Outstanding overall performance — top-tier student', type: 'positive' });
    else if (weightedScore >= 80) insights.push({ text: 'Strong weighted score with room for improvement', type: 'positive' });
    else if (weightedScore < 60) insights.push({ text: 'Weighted score below passing threshold — needs intervention', type: 'danger' });

    if (secondHalfRate > firstHalfRate + 10) insights.push({ text: `Performance improved ${Math.round(secondHalfRate - firstHalfRate)}% in second half of enrollment`, type: 'positive' });
    else if (firstHalfRate > secondHalfRate + 10) insights.push({ text: `Performance dropped ${Math.round(firstHalfRate - secondHalfRate)}% — declining engagement`, type: 'warning' });

    if (punctuality < 50 && present > 0) insights.push({ text: `Only ${punctuality}% of attended sessions were on time — chronic lateness`, type: 'warning' });
    if (punctuality >= 90 && present >= 5) insights.push({ text: 'Excellent punctuality — consistently arrives on time', type: 'positive' });

    if (consistencyIndex < 0.5) insights.push({ text: 'Absences are clustered in streaks — possible disengagement periods', type: 'danger' });
    else if (consistencyIndex >= 0.9 && absent > 0) insights.push({ text: 'Absences are spread out — no disengagement pattern', type: 'info' });

    if (maxStreak >= 5) insights.push({ text: `Best attendance streak: ${maxStreak} consecutive sessions`, type: 'positive' });

    if (avgLateMinutes > 20) insights.push({ text: `Average ${avgLateMinutes}min late — significantly impacts quality score`, type: 'warning' });
    if (maxLateMinutes > 45) insights.push({ text: `Worst late: ${maxLateMinutes}min — near-zero quality credit for that session`, type: 'warning' });

    if (consecutive >= 3) insights.push({ text: `Currently on a ${consecutive}-session absence streak`, type: 'danger' });

    if (qualityRate < attendanceRate - 15) insights.push({ text: `Quality score ${Math.round(attendanceRate - qualityRate)}% below attendance — lateness heavily penalizes`, type: 'warning' });

    // Day pattern detection
    const dayAbsences: Record<string, number> = {};
    for (const r of accountableRecords.filter(a => a.status === 'absent')) {
      const day = new Date(`${r.attendance_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
      dayAbsences[day] = (dayAbsences[day] || 0) + 1;
    }
    for (const [day, count] of Object.entries(dayAbsences)) {
      if (count >= 3) insights.push({ text: `Frequently absent on ${day}s (${count} times)`, type: 'warning' });
    }

    return {
      total, onTime, late, absent, excused, present, accountable,
      attendanceRate, qualityRate, weightedScore, punctuality,
      trendClassification, trendSlope: Math.round(trendSlope * 100) / 100, trendR2: Math.round(trendR2 * 100) / 100,
      weeklyChange, consecutive, maxStreak,
      firstHalfRate, secondHalfRate, consistencyIndex,
      avgLateMinutes, maxLateMinutes, totalLateMinutes, lateScoreAvg,
      coverageFactor: Math.round(coverageFactor * 100) / 100,
      rawScore: Math.round(rawScore * 10) / 10,
      insights,
    };
  }, [attendance]);

  const riskLevel = useMemo(() => {
    if (!analytics) return 'unknown';
    if (analytics.attendanceRate < 50 || analytics.consecutive >= 5) return 'critical';
    if (analytics.attendanceRate < 65 || analytics.consecutive >= 3) return 'high';
    if (analytics.attendanceRate < 80) return 'medium';
    return 'good';
  }, [analytics]);

  const riskStyles: Record<string, { bg: string; text: string; icon: string }> = {
    critical: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', icon: '🔴' },
    high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', icon: '🟠' },
    medium: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', icon: '🟡' },
    good: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', icon: '🟢' },
    unknown: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500', icon: '⚪' },
  };

  const activeEnrollments = useMemo(() =>
    enrollments.filter(e => e.status === 'active'),
    [enrollments]);

  const initials = student.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Handle certificate revoke
  const handleRevoke = useCallback(async () => {
    if (!revokeConfirm) return;
    const { error } = await certificateService.revokeCertificate(revokeConfirm.certificate_id, 'Revoked by admin');
    if (error) { toast.error('Failed to revoke certificate'); }
    else {
      toast.success('Certificate revoked');
      setCertificates(prev => prev.map(c => c.certificate_id === revokeConfirm.certificate_id ? { ...c, status: 'revoked' as const } : c));
    }
    setRevokeConfirm(null);
  }, [revokeConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={handleBackdropClick}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>

        {/* ─── Header ───────────────────────────────────── */}
        <div className="relative px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 rounded-full overflow-hidden shadow-lg shrink-0 group">
              {photoSignedUrl ? (
                <>
                  <img src={photoSignedUrl} alt={student.name} className="w-full h-full object-cover" />
                  <a
                    href={photoSignedUrl}
                    download={`${student.name.replace(/\s+/g, '-')}-photo`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Download photo"
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  </a>
                </>
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white text-lg font-bold">
                  {initials}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">{student.name}</h2>
              <div className="flex flex-wrap gap-2 mt-1">
                {student.email && <span className="text-xs text-gray-500 dark:text-gray-400">{student.email}</span>}
                {student.phone && <span className="text-xs text-gray-400">· {student.phone}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {student.specialization && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-semibold">{student.specialization}</span>
                )}
                {student.nationality && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{student.nationality}</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${riskStyles[riskLevel].bg} ${riskStyles[riskLevel].text}`}>
                  {riskStyles[riskLevel].icon} {riskLevel === 'good' ? 'Good standing' : `${riskLevel} risk`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Tabs ─────────────────────────────────────── */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 px-6">
          {([
            { key: 'overview' as const, label: 'Overview' },
            { key: 'attendance' as const, label: 'Attendance', count: attendance.length },
            { key: 'enrollments' as const, label: 'Enrollments', count: activeEnrollments.length },
            { key: 'certificates' as const, label: 'Certificates', count: certificates.filter(c => c.status === 'issued').length },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                activeTab === t.key
                  ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
              {t.count != null && <span className="ml-1 text-[10px] text-gray-400">({t.count})</span>}
            </button>
          ))}
        </div>

        {/* ─── Content ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent" />
            </div>
          ) : activeTab === 'overview' ? (
            <div className="space-y-3">
              {analytics ? (
                <>
                  {/* ── Hero: Weighted Score Ring ────────────── */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-gray-50 to-white dark:from-gray-800/50 dark:to-gray-900/50 border border-gray-100 dark:border-gray-700">
                    <div className="relative w-16 h-16 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none"
                          className={analytics.weightedScore >= 80 ? 'text-emerald-500' : analytics.weightedScore >= 60 ? 'text-amber-500' : 'text-red-500'}
                          stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                          strokeDasharray={`${analytics.weightedScore} ${100 - analytics.weightedScore}`} />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center text-sm font-black ${analytics.weightedScore >= 80 ? 'text-emerald-600' : analytics.weightedScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analytics.weightedScore}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">Weighted Score</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Q{analytics.qualityRate}% × {DEFAULT_SCORING_CONFIG.weight_quality}% + A{analytics.attendanceRate}% × {DEFAULT_SCORING_CONFIG.weight_attendance}% + P{analytics.punctuality}% × {DEFAULT_SCORING_CONFIG.weight_punctuality}%
                      </p>
                      <div className="flex gap-3 mt-1.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${analytics.trendClassification === 'IMPROVING' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : analytics.trendClassification === 'DECLINING' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : analytics.trendClassification === 'VOLATILE' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {analytics.trendClassification === 'IMPROVING' ? '📈' : analytics.trendClassification === 'DECLINING' ? '📉' : analytics.trendClassification === 'VOLATILE' ? '🔀' : '➡️'} {analytics.trendClassification}
                        </span>
                        {analytics.weeklyChange !== 0 && (
                          <span className={`text-[10px] font-medium ${analytics.weeklyChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {analytics.weeklyChange > 0 ? '+' : ''}{analytics.weeklyChange}% week
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Key Metrics Grid ────────────────────── */}
                  <div className="grid grid-cols-4 gap-2">
                    {([
                      { label: 'Attendance', value: `${analytics.attendanceRate}%`, color: analytics.attendanceRate >= 80 ? 'text-emerald-600' : analytics.attendanceRate >= 60 ? 'text-amber-600' : 'text-red-600' },
                      { label: 'Quality', value: `${analytics.qualityRate}%`, color: analytics.qualityRate >= 80 ? 'text-emerald-600' : analytics.qualityRate >= 60 ? 'text-amber-600' : 'text-red-600' },
                      { label: 'Punctuality', value: `${analytics.punctuality}%`, color: analytics.punctuality >= 80 ? 'text-emerald-600' : analytics.punctuality >= 60 ? 'text-amber-600' : 'text-red-600' },
                      { label: 'Consistency', value: `${Math.round(analytics.consistencyIndex * 100)}%`, color: analytics.consistencyIndex >= 0.8 ? 'text-emerald-600' : analytics.consistencyIndex >= 0.5 ? 'text-amber-600' : 'text-red-600' },
                    ]).map(m => (
                      <div key={m.label} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2 text-center">
                        <p className="text-[9px] text-gray-400 uppercase tracking-wider">{m.label}</p>
                        <p className={`text-base font-black ${m.color}`}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ── Performance DNA ─────────────────────── */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 space-y-2">
                    <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Performance DNA</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Sessions Tracked</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{analytics.accountable}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Best Streak</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{analytics.maxStreak} consecutive</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">First Half</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{analytics.firstHalfRate}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Second Half</span>
                        <span className={`font-semibold ${analytics.secondHalfRate > analytics.firstHalfRate ? 'text-emerald-600' : analytics.secondHalfRate < analytics.firstHalfRate ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>
                          {analytics.secondHalfRate}% {analytics.secondHalfRate > analytics.firstHalfRate + 5 ? '↑' : analytics.firstHalfRate > analytics.secondHalfRate + 5 ? '↓' : ''}
                        </span>
                      </div>
                      {analytics.late > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Avg Late</span>
                            <span className="font-semibold text-amber-600">{analytics.avgLateMinutes}min</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Late Credit</span>
                            <span className="font-semibold text-gray-800 dark:text-gray-200">{Math.round(analytics.lateScoreAvg * 100)}%</span>
                          </div>
                        </>
                      )}
                      {analytics.consecutive > 0 && (
                        <div className="flex justify-between col-span-2">
                          <span className="text-gray-500">Current Absence Streak</span>
                          <span className={`font-semibold ${analytics.consecutive >= 3 ? 'text-red-600' : 'text-amber-600'}`}>{analytics.consecutive} sessions</span>
                        </div>
                      )}
                    </div>
                    {/* Mini status bar */}
                    <div className="flex h-2 rounded-full overflow-hidden mt-1">
                      <div className="bg-emerald-500" style={{ width: `${(analytics.onTime / analytics.accountable) * 100}%` }} title={`On Time: ${analytics.onTime}`} />
                      <div className="bg-amber-500" style={{ width: `${(analytics.late / analytics.accountable) * 100}%` }} title={`Late: ${analytics.late}`} />
                      <div className="bg-red-500" style={{ width: `${(analytics.absent / analytics.accountable) * 100}%` }} title={`Absent: ${analytics.absent}`} />
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-400">
                      <span>✓ {analytics.onTime}</span>
                      <span>⏰ {analytics.late}{analytics.avgLateMinutes > 0 ? ` (avg ${analytics.avgLateMinutes}m)` : ''}</span>
                      <span>✗ {analytics.absent}</span>
                      {analytics.excused > 0 && <span>🔵 {analytics.excused} excused</span>}
                    </div>
                  </div>

                  {/* ── AI Insights ─────────────────────────── */}
                  {analytics.insights.length > 0 && (
                    <div className="rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-900/10 p-3">
                      <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide mb-2">🧠 AI Insights</p>
                      <div className="space-y-1">
                        {analytics.insights.map((ins, i) => (
                          <div key={i} className={`flex items-start gap-1.5 text-[11px] ${
                            ins.type === 'positive' ? 'text-emerald-700 dark:text-emerald-300' :
                            ins.type === 'danger' ? 'text-red-700 dark:text-red-300' :
                            ins.type === 'warning' ? 'text-amber-700 dark:text-amber-300' :
                            'text-blue-700 dark:text-blue-300'
                          }`}>
                            <span className="shrink-0 mt-px">{ins.type === 'positive' ? '✅' : ins.type === 'danger' ? '🚨' : ins.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                            <span>{ins.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Enrollments summary ─────────────────── */}
                  {activeEnrollments.length > 0 && (
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5">Active Enrollments <span className="text-purple-500">({activeEnrollments.length})</span></p>
                      <div className="space-y-1">
                        {activeEnrollments.slice(0, 3).map(e => {
                          const session = unwrap(e.session);
                          const course = unwrap(session?.course);
                          const teacher = unwrap(session?.teacher);
                          return (
                            <div key={e.enrollment_id} className="flex items-center justify-between text-[11px] py-0.5">
                              <span className="text-gray-700 dark:text-gray-300 font-medium">{course?.course_name || 'Unknown'}</span>
                              <span className="text-gray-400">{teacher?.name || ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <span className="text-4xl block mb-2">📊</span>
                  <p className="text-sm text-gray-500">No attendance data yet</p>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  to={`/attendance-records?studentName=${encodeURIComponent(student.name)}`}
                  onClick={onClose}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors font-semibold"
                >
                  📋 Full Records
                </Link>
                {student.email && (
                  <a href={`mailto:${student.email}`} className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold text-gray-700 dark:text-gray-300">📧 Email</a>
                )}
                {student.phone && (
                  <a href={`https://wa.me/${student.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold text-gray-700 dark:text-gray-300">📱 WhatsApp</a>
                )}
              </div>
            </div>

          ) : activeTab === 'attendance' ? (
            <div className="space-y-2">
              {attendance.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No attendance records</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        {([
                          { key: 'date' as const, label: 'Date' },
                          { key: 'course' as const, label: 'Course' },
                          { key: 'status' as const, label: 'Status' },
                          { key: 'method' as const, label: 'Method' },
                        ]).map(col => (
                          <th
                            key={col.key}
                            className="text-left py-2 px-2 text-gray-400 font-semibold cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            onClick={() => {
                              if (attSortCol === col.key) setAttSortDir(d => d === 'asc' ? 'desc' : 'asc');
                              else { setAttSortCol(col.key); setAttSortDir('asc'); }
                            }}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {attSortCol === col.key ? (
                                <svg className={`w-3 h-3 transition-transform ${attSortDir === 'desc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                              ) : (
                                <svg className="w-3 h-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {(() => {
                        const statusOrder: Record<string, number> = { 'on time': 1, 'late': 2, 'absent': 3, 'excused': 4, 'not enrolled': 5 };
                        const sorted = [...attendance].sort((a, b) => {
                          let cmp = 0;
                          if (attSortCol === 'date') cmp = a.attendance_date.localeCompare(b.attendance_date);
                          else if (attSortCol === 'course') {
                            const ca = unwrap(unwrap(a.session)?.course)?.course_name || '';
                            const cb = unwrap(unwrap(b.session)?.course)?.course_name || '';
                            cmp = ca.localeCompare(cb);
                          } else if (attSortCol === 'status') cmp = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
                          else if (attSortCol === 'method') cmp = (a.check_in_method || '').localeCompare(b.check_in_method || '');
                          return attSortDir === 'asc' ? cmp : -cmp;
                        });
                        return sorted.slice(0, 50).map((a, i) => {
                          const session = unwrap(a.session);
                          const course = unwrap(session?.course);
                          const statusColors: Record<string, string> = {
                            'on time': 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
                            'late': 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
                            'absent': 'text-red-600 bg-red-50 dark:bg-red-900/20',
                            'excused': 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
                            'not enrolled': 'text-gray-400 bg-gray-50 dark:bg-gray-800',
                          };
                          return (
                            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                              <td className="py-1.5 px-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{a.attendance_date}</td>
                              <td className="py-1.5 px-2 text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{course?.course_name || '—'}</td>
                              <td className="py-1.5 px-2">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColors[a.status] || 'text-gray-500'}`}>
                                  {a.status}
                                  {a.status === 'late' && a.late_minutes ? ` (${a.late_minutes}m)` : ''}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-gray-400">{a.check_in_method || '—'}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                  {attendance.length > 50 && (
                    <p className="text-[11px] text-gray-400 text-center py-2">Showing 50 of {attendance.length} records</p>
                  )}
                </div>
              )}
            </div>

          ) : activeTab === 'enrollments' ? (
            <div className="space-y-2">
              {enrollments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No enrollments</p>
              ) : (
                <div className="space-y-2">
                  {enrollments.map(e => {
                    const session = unwrap(e.session);
                    const course = unwrap(session?.course);
                    const teacher = unwrap(session?.teacher);
                    return (
                      <div key={e.enrollment_id} className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{course?.course_name || 'Unknown'}</p>
                          <p className="text-[11px] text-gray-400">{teacher?.name || ''} · {session?.start_date} → {session?.end_date}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          e.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                          e.status === 'completed' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' :
                          'bg-gray-100 dark:bg-gray-800 text-gray-500'
                        }`}>{e.status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : activeTab === 'certificates' ? (
            <div className="space-y-2">
              {certificates.length === 0 ? (
                <div className="text-center py-8">
                  <span className="text-4xl block mb-2">🏆</span>
                  <p className="text-sm text-gray-500">No certificates issued yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {certificates.map(cert => {
                    const courseName = cert.course?.course_name
                      || cert.session?.course?.course_name
                      || 'Unknown Course';
                    return (
                      <div key={cert.certificate_id} className={`rounded-xl border p-3 transition-colors ${cert.status === 'revoked' ? 'border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-900/5' : 'border-gray-100 dark:border-gray-700'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{courseName}</p>
                              <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                                cert.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                                cert.status === 'draft' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' :
                                'bg-red-100 dark:bg-red-900/30 text-red-500'
                              }`}>{cert.status === 'issued' ? '✅' : cert.status === 'revoked' ? '🚫' : '📑'} {cert.status}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{cert.certificate_number}</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                              {cert.issued_at && <span className="text-gray-400">📅 {new Date(cert.issued_at).toLocaleDateString()}</span>}
                              {cert.final_score != null && <span className="text-gray-500">Score: <span className="font-semibold">{cert.final_score}%</span></span>}
                              {cert.attendance_rate != null && <span className="text-gray-500">Attendance: <span className="font-semibold">{cert.attendance_rate}%</span></span>}
                              {cert.verification_code && <span className="text-blue-500 font-mono">{cert.verification_code}</span>}
                            </div>
                          </div>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                          <button
                            onClick={() => setPreviewCert(cert)}
                            className="text-[10px] px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 font-semibold transition-colors"
                          >
                            👁 Preview
                          </button>
                          {isTeacher && cert.status === 'issued' && (
                            <button
                              onClick={() => setRevokeConfirm(cert)}
                              className="text-[10px] px-2 py-1 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 font-semibold transition-colors"
                            >
                              🚫 Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ─── Certificate Preview Modal ─────────────── */}
        {previewCert && (
          <CertificatePreview certificate={previewCert} onClose={() => setPreviewCert(null)} />
        )}

        {/* ─── Revoke Confirm Dialog ─────────────────── */}
        {revokeConfirm && (
          <ConfirmDialog
            isOpen={true}
            title="Revoke Certificate"
            message={`Revoke certificate ${revokeConfirm.certificate_number}?`}
            confirmText="Revoke"
            type="danger"
            onConfirm={handleRevoke}
            onCancel={() => setRevokeConfirm(null)}
          />
        )}
      </div>
    </div>
  );
}
