import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { attendanceService } from '@/features/attendance/services/attendanceService';
import { studentService } from '@/features/students/services/studentService';
import { certificateService } from '@/features/certificates/services/certificateService';
import type { IssuedCertificate } from '@/features/certificates/services/certificateService';
import { DEFAULT_SCORING_CONFIG, calcWeightedScore } from '@/features/scoring/services/scoringConfigService';
import { getSignedPhotoUrl } from '@/shared/utils/photoUtils';
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

  // ─── Analytics (mirrors summarizeAttendanceRecords from attendanceService) ──
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
    const accountable = unique.filter(r => r.status !== 'excused' && r.status !== 'not enrolled').length;
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
    for (const r of unique) {
      if (r.status === 'on time') qualitySum += 1;
      else if (r.status === 'late') {
        qualitySum += Math.max(
          config.late_minimum_credit,
          Math.exp(-((r.late_minutes || 0) / config.late_decay_constant))
        );
      }
    }
    const qualityRate = Math.round((qualitySum / accountable) * 1000) / 10;

    // 4. Punctuality
    const punctuality = accountable > 0 ? Math.round((onTime / accountable) * 1000) / 10 : 0;

    // 5. Weighted score
    const { finalScore } = calcWeightedScore(
      qualityRate, attendanceRate, punctuality,
      accountable, accountable, config
    );
    const weightedScore = Math.round(finalScore * 10) / 10;

    // 6. Trend (last 5 vs previous 5 unique dates)
    const sorted = [...unique].sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
    const recent5 = sorted.slice(0, Math.min(5, sorted.length));
    const prev5 = sorted.slice(5, Math.min(10, sorted.length));
    const recentRate = recent5.length > 0 ? recent5.filter(r => r.status === 'on time' || r.status === 'late').length / recent5.length : 0;
    const prevRate = prev5.length > 0 ? prev5.filter(r => r.status === 'on time' || r.status === 'late').length / prev5.length : 0;
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (prev5.length >= 3) {
      if (recentRate - prevRate > 0.1) trend = 'improving';
      else if (prevRate - recentRate > 0.1) trend = 'declining';
    }

    // 7. Consecutive absences (from most recent)
    let consecutive = 0;
    for (const r of sorted) {
      if (r.status === 'absent') consecutive++;
      else break;
    }

    // 8. Pattern detection (based on accountable records only)
    const patterns: string[] = [];
    const accountableRecords = unique.filter(r => r.status !== 'excused' && r.status !== 'not enrolled');
    const dayAbsences: Record<string, number> = {};
    for (const r of accountableRecords.filter(a => a.status === 'absent')) {
      const day = new Date(`${r.attendance_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
      dayAbsences[day] = (dayAbsences[day] || 0) + 1;
    }
    for (const [day, count] of Object.entries(dayAbsences)) {
      if (count >= 3) patterns.push(`Frequently absent on ${day}s`);
    }
    if (consecutive >= 3) patterns.push(`${consecutive} consecutive absences`);
    if (attendanceRate < 50) patterns.push('Below 50% attendance');
    if (qualityRate < attendanceRate - 10) patterns.push('Late arrivals reducing quality score');

    // 9. Late stats
    const avgLateMinutes = late > 0
      ? Math.round(unique.filter(a => a.status === 'late' && a.late_minutes).reduce((s, a) => s + (a.late_minutes || 0), 0) / late)
      : 0;

    return {
      total, onTime, late, absent, excused, present, accountable,
      attendanceRate, qualityRate, weightedScore, punctuality,
      trend, consecutive, patterns, avgLateMinutes,
      lastDate: sorted[0]?.attendance_date || null,
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
            <div className="space-y-4">
              {/* KPI Row */}
              {analytics ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-3 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Attendance</p>
                      <p className={`text-xl font-black ${analytics.attendanceRate >= 80 ? 'text-emerald-600' : analytics.attendanceRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analytics.attendanceRate}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-3 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Quality</p>
                      <p className={`text-xl font-black ${analytics.qualityRate >= 80 ? 'text-emerald-600' : analytics.qualityRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analytics.qualityRate}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-3 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Weighted Score</p>
                      <p className={`text-xl font-black ${analytics.weightedScore >= 80 ? 'text-emerald-600' : analytics.weightedScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analytics.weightedScore}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-3 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Trend</p>
                      <p className={`text-sm font-bold ${analytics.trend === 'improving' ? 'text-emerald-600' : analytics.trend === 'declining' ? 'text-red-600' : 'text-gray-500'}`}>
                        {analytics.trend === 'improving' ? '📈 Improving' : analytics.trend === 'declining' ? '📉 Declining' : '➡️ Stable'}
                      </p>
                    </div>
                  </div>

                  {/* Secondary Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2.5 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Sessions</p>
                      <p className="text-lg font-black text-gray-900 dark:text-white">{analytics.accountable}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2.5 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Punctuality</p>
                      <p className={`text-lg font-black ${analytics.punctuality >= 80 ? 'text-emerald-600' : analytics.punctuality >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analytics.punctuality}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2.5 text-center">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Streak</p>
                      <p className={`text-lg font-black ${analytics.consecutive >= 3 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                        {analytics.consecutive > 0 ? `${analytics.consecutive} absent` : '✓'}
                      </p>
                    </div>
                  </div>

                  {/* Status Breakdown */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-2">
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Status Breakdown</p>
                    {([
                      { label: 'On Time', count: analytics.onTime, color: 'bg-emerald-500', pct: analytics.accountable > 0 ? (analytics.onTime / analytics.accountable) * 100 : 0 },
                      { label: 'Late', count: analytics.late, color: 'bg-amber-500', pct: analytics.accountable > 0 ? (analytics.late / analytics.accountable) * 100 : 0, sub: analytics.avgLateMinutes > 0 ? `avg ${analytics.avgLateMinutes}min` : undefined },
                      { label: 'Absent', count: analytics.absent, color: 'bg-red-500', pct: analytics.accountable > 0 ? (analytics.absent / analytics.accountable) * 100 : 0 },
                      { label: 'Excused', count: analytics.excused, color: 'bg-blue-500', pct: analytics.total > 0 ? (analytics.excused / analytics.total) * 100 : 0 },
                    ]).map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-600 dark:text-gray-300 w-16 shrink-0">{s.label}</span>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                          <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-500 w-12 text-right">{s.count} ({Math.round(s.pct)}%)</span>
                        {s.sub && <span className="text-[10px] text-gray-400">{s.sub}</span>}
                      </div>
                    ))}
                  </div>

                  {/* Patterns */}
                  {analytics.patterns.length > 0 && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4">
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-2">🔍 Detected Patterns</p>
                      <div className="flex flex-wrap gap-1.5">
                        {analytics.patterns.map((p, i) => (
                          <span key={i} className="text-[11px] px-2 py-1 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 rounded-lg text-amber-700 dark:text-amber-300">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Enrollments summary */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Active Enrollments</p>
                      <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">{activeEnrollments.length}</span>
                    </div>
                    {activeEnrollments.length === 0 ? (
                      <p className="text-xs text-gray-400">No active enrollments</p>
                    ) : (
                      <div className="space-y-1.5">
                        {activeEnrollments.slice(0, 3).map(e => {
                          const session = unwrap(e.session);
                          const course = unwrap(session?.course);
                          const teacher = unwrap(session?.teacher);
                          return (
                            <div key={e.enrollment_id} className="flex items-center justify-between text-xs py-1">
                              <span className="text-gray-700 dark:text-gray-300 font-medium">{course?.course_name || 'Unknown'}</span>
                              <span className="text-gray-400">{teacher?.name || ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <span className="text-4xl block mb-2">📊</span>
                  <p className="text-sm text-gray-500">No attendance data yet</p>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Link
                  to={`/attendance-records?studentName=${encodeURIComponent(student.name)}`}
                  onClick={onClose}
                  className="text-xs px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors font-semibold"
                >
                  📋 Full Attendance Records
                </Link>
                {student.email && (
                  <a href={`mailto:${student.email}`} className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold text-gray-700 dark:text-gray-300">
                    📧 Email
                  </a>
                )}
                {student.phone && (
                  <a href={`https://wa.me/${student.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold text-gray-700 dark:text-gray-300">
                    📱 WhatsApp
                  </a>
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
                <p className="text-sm text-gray-400 text-center py-8">No certificates issued yet</p>
              ) : (
                <div className="space-y-2">
                  {certificates.map(cert => {
                    const courseName = cert.course?.course_name
                      || cert.session?.course?.course_name
                      || 'Unknown Course';
                    return (
                      <div key={cert.certificate_id} className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{courseName}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">#{cert.certificate_number}</p>
                            {cert.issued_at && (
                              <p className="text-[11px] text-gray-400">
                                Issued: {new Date(cert.issued_at).toLocaleDateString()}
                              </p>
                            )}
                            {cert.final_score != null && (
                              <p className="text-[11px] text-gray-500">Score: {cert.final_score}%</p>
                            )}
                            {cert.attendance_rate != null && (
                              <p className="text-[11px] text-gray-500">Attendance: {cert.attendance_rate}%</p>
                            )}
                          </div>
                          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            cert.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                            cert.status === 'draft' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' :
                            'bg-red-100 dark:bg-red-900/30 text-red-500'
                          }`}>{cert.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
