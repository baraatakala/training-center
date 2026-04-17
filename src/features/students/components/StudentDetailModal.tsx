import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { attendanceService } from '@/features/attendance/services/attendanceService';
import { studentService } from '@/features/students/services/studentService';
import { certificateService } from '@/features/certificates/services/certificateService';
import type { IssuedCertificate } from '@/features/certificates/services/certificateService';
import { CertificatePreview } from '@/features/certificates/components/CertificatePreview';
import { loadConfigSync, calcWeightedScore, calcCoverageFactor, calcLateScore } from '@/features/scoring/services/scoringConfigService';
import { getSignedPhotoUrl } from '@/shared/utils/photoUtils';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { exportStudentOverviewPDF } from '@/features/students/services/studentOverviewExport';
import type { ExportSection } from '@/features/students/services/studentOverviewExport';
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
  session_id?: string;
  check_in_method?: string | null;
  check_in_time?: string | null;
  late_minutes?: number | null;
  host_address?: string | null;
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
  const [arabicMode, setArabicMode] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSections, setExportSections] = useState<ExportSection[]>(['overview', 'attendance', 'certificates']);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [hostStats, setHostStats] = useState<{ hostCount: number; avgAttendance: number; hostDates?: { date: string; sessionId: string; present: number; accountable: number }[] } | null>(null);
  const { isTeacher } = useIsTeacher();

  // ─── Session group map (1:1 — parent_session_id removed in migration 033) ────────
  const sessionGroupMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    enrollments.forEach(e => {
      const s = unwrap(e.session);
      if (s?.session_id) map[s.session_id] = [s.session_id];
    });
    attendance.forEach(a => {
      const s = unwrap(a.session);
      if (s?.session_id && !map[s.session_id]) map[s.session_id] = [s.session_id];
    });
    return map;
  }, [enrollments, attendance]);

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

      // Load host stats from session_date_host table
      if (student.address) {
        const hostRes = await attendanceService.getHostAttendanceStats(student.student_id, student.address);
        if (!cancelled && hostRes.data) setHostStats(hostRes.data);
      }

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [student.student_id, student.address]);

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
  // Filter attendance by selected session (includes clones of selected root)
  const filteredAttendance = useMemo(() => {
    let result = attendance;
    if (selectedSessionId) {
      const groupIds = sessionGroupMap[selectedSessionId] ?? [selectedSessionId];
      result = result.filter(a => {
        const sid = unwrap(a.session)?.session_id;
        return sid ? groupIds.includes(sid) : false;
      });
    }
    if (filterStatus) {
      result = result.filter(a => a.status === filterStatus);
    }
    if (filterDateFrom) {
      result = result.filter(a => a.attendance_date >= filterDateFrom);
    }
    if (filterDateTo) {
      result = result.filter(a => a.attendance_date <= filterDateTo);
    }
    return result;
  }, [attendance, selectedSessionId, sessionGroupMap, filterStatus, filterDateFrom, filterDateTo]);

  // Compute host stats filtered by active date/session filters
  const filteredHostStats = useMemo(() => {
    if (!hostStats || !hostStats.hostDates || hostStats.hostDates.length === 0) return hostStats;
    const hasFilter = selectedSessionId || filterDateFrom || filterDateTo;
    if (!hasFilter) return hostStats;

    let dates = hostStats.hostDates;
    if (selectedSessionId) {
      const groupIds = sessionGroupMap[selectedSessionId] ?? [selectedSessionId];
      dates = dates.filter(d => groupIds.includes(d.sessionId));
    }
    if (filterDateFrom) {
      dates = dates.filter(d => d.date >= filterDateFrom);
    }
    if (filterDateTo) {
      dates = dates.filter(d => d.date <= filterDateTo);
    }
    if (dates.length === 0) return { hostCount: 0, avgAttendance: 0 };
    const totalPresent = dates.reduce((s, d) => s + d.present, 0);
    const totalAccountable = dates.reduce((s, d) => s + d.accountable, 0);
    return {
      hostCount: dates.length,
      avgAttendance: totalAccountable > 0 ? Math.round((totalPresent / totalAccountable) * 100) : 0,
    };
  }, [hostStats, selectedSessionId, sessionGroupMap, filterDateFrom, filterDateTo]);

  const analytics = useMemo(() => {
    if (filteredAttendance.length === 0) return null;

    const config = loadConfigSync();
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // 1. Filter: exclude future dates and "session not held"
    // Capture session-not-held dates BEFORE filtering (needed for insight Q: session-not-held impact)
    const sessionNotHeldTimestamps = new Set<number>();
    for (const a of filteredAttendance) {
      if (!a.attendance_date) continue;
      if ((a as { excuse_reason?: string }).excuse_reason === 'session not held' ||
          (a as { host_address?: string }).host_address === 'SESSION_NOT_HELD') {
        sessionNotHeldTimestamps.add(new Date(a.attendance_date + 'T00:00:00').getTime());
      }
    }

    const filtered = filteredAttendance.filter(a => {
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
    // total = all unique dates (including excused) = student's "daysCovered"
    // accountable = effective days (on_time + late + absent) = student's "effectiveBase"
    // Coverage ratio uses total as denominator (matches AttendanceRecords' globalTotalSessionDays concept)
    const coverageFactor = calcCoverageFactor(accountable, total, config);
    const { rawScore, finalScore } = calcWeightedScore(
      qualityRate, attendanceRate, punctuality,
      accountable, total, config
    );

    // Apply bonuses & penalties (mirrors AttendanceRecords exactly)
    let adjustedScore = finalScore;

    // Perfect attendance bonus
    if (attendanceRate >= 100 && config.perfect_attendance_bonus > 0) {
      adjustedScore += config.perfect_attendance_bonus;
    }

    // Absence penalty multiplier
    if (config.absence_penalty_multiplier > 1.0 && absent > 0) {
      const baseDeduction = (absent / accountable) * 100;
      const extraPenalty = baseDeduction * (config.absence_penalty_multiplier - 1);
      adjustedScore = Math.max(0, adjustedScore - extraPenalty);
    }

    const weightedScore = Math.round(Math.min(100, Math.max(0, adjustedScore)) * 10) / 10;

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

    // 9. Max consecutive attendance streak + current active streak (PER SESSION)
    // Group by session_id so cross-session absences don't break unrelated streaks.
    const bySession = new Map<string, AttendanceRecord[]>();
    for (const r of filtered) {
      const sid = unwrap(r.session)?.session_id || '_none_';
      const arr = bySession.get(sid);
      if (arr) arr.push(r);
      else bySession.set(sid, [r]);
    }
    let maxStreak = 0, activeStreak = 0;
    let maxPerfectStreak = 0;
    for (const [, recs] of bySession) {
      const sortedRecs = [...recs].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
      let cs = 0, ms = 0, cps = 0, mps = 0;
      for (const r of sortedRecs) {
        if (r.status === 'absent') {
          cs = 0;
          cps = 0;
        } else if (r.status === 'on time') {
          cs++; ms = Math.max(ms, cs);
          cps++; mps = Math.max(mps, cps);
        } else if (r.status === 'late') {
          cs++; ms = Math.max(ms, cs);
          cps = 0;
        }
      }
      maxStreak = Math.max(maxStreak, ms);
      activeStreak = Math.max(activeStreak, cs);
      maxPerfectStreak = Math.max(maxPerfectStreak, mps);
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

    // 13. AI-generated insights — advanced multi-dimensional analysis (bilingual)
    const insights: { text: string; textAr: string; type: 'positive' | 'warning' | 'danger' | 'info'; priority: number }[] = [];

    // ── A. Performance Classification (weighted score thresholds) ──
    if (weightedScore >= 95) insights.push({ text: `Elite performance (${weightedScore}) — top-tier across all metrics`, textAr: `أداء متميّز (${weightedScore}) — من الطراز الأول في جميع المعايير`, type: 'positive', priority: 100 });
    else if (weightedScore >= 90) insights.push({ text: `Outstanding performance (${weightedScore}) — exceeds expectations in all areas`, textAr: `أداء ممتاز (${weightedScore}) — يتجاوز التوقعات في جميع المجالات`, type: 'positive', priority: 95 });
    else if (weightedScore >= 80) insights.push({ text: `Strong performance (${weightedScore}) — solid results with minor improvement areas`, textAr: `أداء قوي (${weightedScore}) — نتائج جيدة مع مجالات تحسين بسيطة`, type: 'positive', priority: 80 });
    else if (weightedScore >= 70) insights.push({ text: `Adequate performance (${weightedScore}) — meets minimum but significant room for growth`, textAr: `أداء مقبول (${weightedScore}) — يلبي الحد الأدنى لكن هناك مجال كبير للتحسين`, type: 'info', priority: 70 });
    else if (weightedScore >= 60) insights.push({ text: `Below target (${weightedScore}) — approaching risk threshold, needs focused improvement`, textAr: `أقل من المستهدف (${weightedScore}) — يقترب من حد الخطر، يحتاج تحسين مركّز`, type: 'warning', priority: 65 });
    else if (weightedScore >= 40) insights.push({ text: `Critical performance (${weightedScore}) — immediate intervention required`, textAr: `أداء حرج (${weightedScore}) — يتطلب تدخل فوري`, type: 'danger', priority: 50 });
    else insights.push({ text: `Severe underperformance (${weightedScore}) — emergency academic support needed`, textAr: `أداء ضعيف جداً (${weightedScore}) — يحتاج دعم أكاديمي طارئ`, type: 'danger', priority: 30 });

    // ── B. Engagement Trajectory (first/second half + trend) ──
    const halfDelta = secondHalfRate - firstHalfRate;
    if (halfDelta > 15 && trendClassification === 'IMPROVING') {
      insights.push({ text: `Strong recovery: ${Math.round(halfDelta)}% improvement in 2nd half, confirmed by upward trend (R²=${trendR2})`, textAr: `تعافٍ قوي: تحسّن ${Math.round(halfDelta)}% في النصف الثاني، مؤكّد بالاتجاه الصاعد (R²=${trendR2})`, type: 'positive', priority: 88 });
    } else if (halfDelta > 10) {
      insights.push({ text: `Performance improved ${Math.round(halfDelta)}% in second half (${firstHalfRate}% → ${secondHalfRate}%)`, textAr: `تحسّن الأداء ${Math.round(halfDelta)}% في النصف الثاني (${firstHalfRate}% ← ${secondHalfRate}%)`, type: 'positive', priority: 82 });
    } else if (halfDelta < -15 && trendClassification === 'DECLINING') {
      insights.push({ text: `Accelerating decline: ${Math.round(-halfDelta)}% drop in 2nd half, trend confirms disengagement (slope=${trendSlope})`, textAr: `تراجع متسارع: انخفاض ${Math.round(-halfDelta)}% في النصف الثاني، الاتجاه يؤكد الانسحاب (ميل=${trendSlope})`, type: 'danger', priority: 92 });
    } else if (halfDelta < -10) {
      insights.push({ text: `Declining engagement: ${Math.round(-halfDelta)}% drop (${firstHalfRate}% → ${secondHalfRate}%)`, textAr: `تراجع في الالتزام: انخفاض ${Math.round(-halfDelta)}% (${firstHalfRate}% ← ${secondHalfRate}%)`, type: 'warning', priority: 78 });
    }

    // ── C. Punctuality Deep Analysis ──
    if (present > 0) {
      const lateRatio = late / present;
      if (punctuality >= 95 && present >= 5) {
        insights.push({ text: `Exceptional punctuality: ${onTime}/${present} sessions on time (${punctuality}%)`, textAr: `انضباط استثنائي: ${onTime}/${present} جلسات في الوقت (${punctuality}%)`, type: 'positive', priority: 85 });
      } else if (punctuality < 40) {
        insights.push({ text: `Chronic lateness: only ${punctuality}% on-time rate — ${late} of ${present} attended sessions were late`, textAr: `تأخر مزمن: ${punctuality}% فقط في الوقت — ${late} من ${present} جلسات بتأخير`, type: 'danger', priority: 87 });
      } else if (punctuality < 60) {
        insights.push({ text: `Frequent lateness: ${punctuality}% punctuality — more than ${Math.round(lateRatio * 100)}% of attendances are late`, textAr: `تأخر متكرر: ${punctuality}% انضباط — أكثر من ${Math.round(lateRatio * 100)}% من الحضور بتأخير`, type: 'warning', priority: 75 });
      }
    }

    // ── D. Late Duration Impact Analysis ──
    if (late > 0 && avgLateMinutes > 0) {
      const qualityLoss = Math.round(attendanceRate - qualityRate);
      if (qualityLoss > 20) {
        insights.push({ text: `Severe tardy impact: lateness reduces quality rate by ${qualityLoss}% (${attendanceRate}% attendance → ${qualityRate}% quality). Avg ${avgLateMinutes}min late`, textAr: `تأثير تأخر حاد: يخفّض الجودة بنسبة ${qualityLoss}% (حضور ${attendanceRate}% ← جودة ${qualityRate}%). متوسط التأخر ${avgLateMinutes} دقيقة`, type: 'danger', priority: 86 });
      } else if (qualityLoss > 10) {
        insights.push({ text: `Significant tardy penalty: ${qualityLoss}% quality gap from avg ${avgLateMinutes}min tardiness (max ${maxLateMinutes}min)`, textAr: `عقوبة تأخر كبيرة: فجوة جودة ${qualityLoss}% من متوسط تأخر ${avgLateMinutes} دقيقة (أقصى ${maxLateMinutes} دقيقة)`, type: 'warning', priority: 74 });
      } else if (qualityLoss > 0 && avgLateMinutes <= 5) {
        insights.push({ text: `Minor tardy impact: avg only ${avgLateMinutes}min late — quality loss minimal (${qualityLoss}%)`, textAr: `تأثير تأخر بسيط: متوسط ${avgLateMinutes} دقيقة فقط — خسارة جودة طفيفة (${qualityLoss}%)`, type: 'info', priority: 50 });
      }
      if (maxLateMinutes >= 45) {
        const creditAtMax = Math.round(Math.exp(-maxLateMinutes / config.late_decay_constant) * 100);
        insights.push({ text: `Worst tardiness: ${maxLateMinutes}min late — earned only ${creditAtMax}% quality credit for that session`, textAr: `أسوأ تأخر: ${maxLateMinutes} دقيقة — حصل على ${creditAtMax}% فقط من رصيد الجودة لتلك الجلسة`, type: 'warning', priority: 68 });
      }
    }

    // ── E. Consistency & Absence Pattern Analysis ──
    if (absent > 0) {
      if (consistencyIndex < 0.3 && absent >= 3) {
        insights.push({ text: `Severe clustering: absences form consecutive blocks — indicates disengagement episodes, not random misses`, textAr: `تجمّع حاد: الغياب يشكّل كتل متتالية — يدل على فترات انسحاب وليس غياب عشوائي`, type: 'danger', priority: 90 });
      } else if (consistencyIndex < 0.5) {
        insights.push({ text: `Clustered absences (consistency ${Math.round(consistencyIndex * 100)}%) — suggests periodic disengagement rather than isolated events`, textAr: `غياب متجمّع (اتساق ${Math.round(consistencyIndex * 100)}%) — يشير إلى انسحاب دوري وليس أحداث منفردة`, type: 'warning', priority: 76 });
      } else if (consistencyIndex >= 0.9) {
        insights.push({ text: `Scattered absence pattern (${Math.round(consistencyIndex * 100)}% consistency) — absences appear random/circumstantial, not behavioral`, textAr: `نمط غياب متفرّق (اتساق ${Math.round(consistencyIndex * 100)}%) — الغياب يبدو عشوائي/ظرفي وليس سلوكي`, type: 'info', priority: 55 });
      }
    }

    // ── F. Current Absence Streak (urgency detection) ──
    if (consecutive >= 5) {
      insights.push({ text: `URGENT: ${consecutive} consecutive absences — at risk of course failure. Immediate outreach required`, textAr: `عاجل: ${consecutive} غيابات متتالية — خطر الرسوب. يتطلب تواصل فوري`, type: 'danger', priority: 99 });
    } else if (consecutive >= 3) {
      insights.push({ text: `Active absence streak: ${consecutive} sessions — developing disengagement pattern. Intervention recommended`, textAr: `سلسلة غياب نشطة: ${consecutive} جلسات — نمط انسحاب يتطور. يُنصح بالتدخل`, type: 'danger', priority: 91 });
    } else if (consecutive === 2) {
      insights.push({ text: `Two consecutive absences detected — monitor for emerging pattern`, textAr: `رُصد غيابان متتاليان — يجب مراقبة تطوّر النمط`, type: 'warning', priority: 60 });
    }

    // ── G. Attendance Streak Achievement ──
    if (maxStreak >= 15) {
      insights.push({ text: `Outstanding commitment: ${maxStreak} consecutive sessions without absence — exceptional dedication${activeStreak === maxStreak ? ' (still active!)' : ''}`, textAr: `التزام مبهر: ${maxStreak} جلسة متتالية بدون غياب — إخلاص استثنائي${activeStreak === maxStreak ? ' (لا تزال نشطة!)' : ''}`, type: 'positive', priority: 86 });
    } else if (maxStreak >= 10) {
      insights.push({ text: `Impressive commitment: ${maxStreak} consecutive sessions attended — demonstrates strong dedication${activeStreak === maxStreak ? ' (still active!)' : ''}`, textAr: `التزام رائع: ${maxStreak} جلسة متتالية — يظهر إخلاصاً قوياً${activeStreak === maxStreak ? ' (لا تزال نشطة!)' : ''}`, type: 'positive', priority: 84 });
    } else if (maxStreak >= 7) {
      insights.push({ text: `Best streak: ${maxStreak} consecutive sessions — shows capacity for consistent engagement${activeStreak === maxStreak ? ' (active)' : ''}`, textAr: `أفضل سلسلة: ${maxStreak} جلسات متتالية — يُظهر قدرة على الالتزام المستمر${activeStreak === maxStreak ? ' (نشطة)' : ''}`, type: 'positive', priority: 72 });
    } else if (maxStreak <= 2 && accountable >= 6) {
      insights.push({ text: `No sustained attendance streaks beyond ${maxStreak} sessions — lacks stable engagement period`, textAr: `لا توجد سلسلة حضور مستدامة تتجاوز ${maxStreak} جلسات — يفتقر لفترة التزام مستقرة`, type: 'warning', priority: 64 });
    }
    // Active streak vs best comparisons
    if (activeStreak > 0 && activeStreak < maxStreak && maxStreak >= 5) {
      insights.push({ text: `Current streak: ${activeStreak} sessions — rebuilding toward best of ${maxStreak}`, textAr: `السلسلة الحالية: ${activeStreak} جلسات — يعيد البناء نحو أفضل سلسلة ${maxStreak}`, type: 'info', priority: 54 });
    }

    // ── H. Coverage Factor Impact ──
    if (coverageFactor < 0.5) {
      const coveragePenalty = Math.round((1 - coverageFactor) * rawScore);
      insights.push({ text: `Low coverage (${Math.round(coverageFactor * 100)}%): score reduced by ~${coveragePenalty} points. Only ${accountable} of ${total} sessions are accountable`, textAr: `تغطية منخفضة (${Math.round(coverageFactor * 100)}%): الدرجة تنخفض ~${coveragePenalty} نقطة. فقط ${accountable} من ${total} جلسات محاسبة`, type: 'warning', priority: 73 });
    } else if (coverageFactor < 0.7) {
      insights.push({ text: `Moderate coverage (${Math.round(coverageFactor * 100)}%): high excused count (${excused}) limits score ceiling`, textAr: `تغطية متوسطة (${Math.round(coverageFactor * 100)}%): عدد الأعذار المرتفع (${excused}) يحد من سقف الدرجة`, type: 'info', priority: 58 });
    }

    // ── I. Day-of-Week Absence Pattern Detection ──
    const dayNameAr: Record<string, string> = { Sunday: 'الأحد', Monday: 'الإثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' };
    const dayAbsences: Record<string, number> = {};
    const dayTotal: Record<string, number> = {};
    for (const r of accountableRecords) {
      const day = new Date(`${r.attendance_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
      dayTotal[day] = (dayTotal[day] || 0) + 1;
      if (r.status === 'absent') dayAbsences[day] = (dayAbsences[day] || 0) + 1;
    }
    for (const [day, count] of Object.entries(dayAbsences)) {
      const sessions = dayTotal[day] || 1;
      const dayAbsenceRate = Math.round((count / sessions) * 100);
      const dayAr = dayNameAr[day] || day;
      if (count >= 3 && dayAbsenceRate >= 50) {
        insights.push({ text: `Pattern: absent ${count}/${sessions} ${day}s (${dayAbsenceRate}%) — systematic avoidance detected`, textAr: `نمط: غياب ${count}/${sessions} أيام ${dayAr} (${dayAbsenceRate}%) — تجنّب منهجي مكتشف`, type: 'danger', priority: 83 });
      } else if (count >= 2 && dayAbsenceRate >= 40) {
        insights.push({ text: `Concentration: ${count} of ${sessions} absences fall on ${day}s (${dayAbsenceRate}%)`, textAr: `تركّز: ${count} من ${sessions} غيابات تقع يوم ${dayAr} (${dayAbsenceRate}%)`, type: 'warning', priority: 62 });
      }
    }

    // ── J. Day-of-Week Lateness Pattern ──
    const dayLate: Record<string, number> = {};
    for (const r of unique.filter(a => a.status === 'late')) {
      const day = new Date(`${r.attendance_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
      dayLate[day] = (dayLate[day] || 0) + 1;
    }
    for (const [day, count] of Object.entries(dayLate)) {
      const dayAr = dayNameAr[day] || day;
      if (count >= 3) {
        insights.push({ text: `Consistently late on ${day}s (${count} times) — possible scheduling conflict`, textAr: `تأخر مستمر يوم ${dayAr} (${count} مرات) — قد يكون هناك تعارض في الجدول`, type: 'info', priority: 56 });
      }
    }

    // ── K. Excused Ratio Analysis ──
    if (excused > 0) {
      const excusedRatio = excused / total;
      if (excusedRatio > 0.5) {
        insights.push({ text: `High excuse rate: ${excused}/${total} sessions (${Math.round(excusedRatio * 100)}%) excused — limited effective evaluation data`, textAr: `معدل أعذار مرتفع: ${excused}/${total} جلسات (${Math.round(excusedRatio * 100)}%) معذورة — بيانات تقييم فعّالة محدودة`, type: 'warning', priority: 71 });
      } else if (excusedRatio > 0.3) {
        insights.push({ text: `Notable excuse frequency: ${excused} of ${total} sessions (${Math.round(excusedRatio * 100)}%) excused`, textAr: `تكرار ملحوظ للأعذار: ${excused} من ${total} جلسات (${Math.round(excusedRatio * 100)}%) معذورة`, type: 'info', priority: 52 });
      }
    }

    // ── L. Trend Reliability ──
    if (accountable >= 5) {
      if (trendClassification === 'VOLATILE') {
        insights.push({ text: `Volatile pattern (R²=${trendR2}): attendance fluctuates unpredictably — no clear trajectory`, textAr: `نمط متذبذب (R²=${trendR2}): الحضور يتقلب بشكل غير متوقع — لا مسار واضح`, type: 'warning', priority: 66 });
      } else if (trendClassification === 'IMPROVING' && trendR2 >= 0.7) {
        insights.push({ text: `Confirmed upward trend (slope +${trendSlope}, R²=${trendR2}) — statistically significant improvement`, textAr: `اتجاه صاعد مؤكد (ميل +${trendSlope}، R²=${trendR2}) — تحسّن ذو دلالة إحصائية`, type: 'positive', priority: 79 });
      } else if (trendClassification === 'DECLINING' && trendR2 >= 0.7) {
        insights.push({ text: `Confirmed downward trend (slope ${trendSlope}, R²=${trendR2}) — statistically significant decline`, textAr: `اتجاه هابط مؤكد (ميل ${trendSlope}، R²=${trendR2}) — تراجع ذو دلالة إحصائية`, type: 'danger', priority: 89 });
      }
    }

    // ── M. Cross-Metric Correlation Insights ──
    if (attendanceRate >= 90 && punctuality < 60) {
      insights.push({ text: `Paradox: ${attendanceRate}% attendance but only ${punctuality}% punctuality — shows up but consistently late`, textAr: `مفارقة: حضور ${attendanceRate}% لكن انضباط ${punctuality}% فقط — يحضر لكن يتأخر باستمرار`, type: 'info', priority: 69 });
    }
    if (attendanceRate < 70 && punctuality >= 90 && present >= 3) {
      insights.push({ text: `When present, ${punctuality}% punctual — commitment exists but attendance barriers present`, textAr: `عند الحضور، ${punctuality}% منضبط — الالتزام موجود لكن هناك عوائق حضور`, type: 'info', priority: 63 });
    }
    if (present > 0 && absent === 0 && weightedScore < 80) {
      insights.push({ text: `100% attendance but score only ${weightedScore} — lateness significantly drags quality component`, textAr: `حضور 100% لكن الدرجة ${weightedScore} فقط — التأخر يسحب مكوّن الجودة بشكل كبير`, type: 'warning', priority: 77 });
    }

    // ── N. Data Confidence Assessment ──
    if (accountable < 4) {
      insights.push({ text: `Limited data: only ${accountable} accountable sessions — metrics may not reflect true patterns`, textAr: `بيانات محدودة: ${accountable} جلسات محاسبة فقط — المؤشرات قد لا تعكس الأنماط الحقيقية`, type: 'info', priority: 45 });
    }

    // ── O. Check-in Method × Lateness Correlation ──
    const methodStats: Record<string, { count: number; lateCount: number; totalLateMin: number }> = {};
    for (const r of unique.filter(a => a.status === 'on time' || a.status === 'late')) {
      const m = r.check_in_method || 'unknown';
      if (!methodStats[m]) methodStats[m] = { count: 0, lateCount: 0, totalLateMin: 0 };
      methodStats[m].count++;
      if (r.status === 'late') {
        methodStats[m].lateCount++;
        methodStats[m].totalLateMin += (r.late_minutes || 0);
      }
    }
    const methodKeys = Object.keys(methodStats).filter(k => methodStats[k].count >= 3);
    if (methodKeys.length >= 2) {
      // Find method with highest avg lateness
      let worstMethod = methodKeys[0], bestMethod = methodKeys[0];
      for (const k of methodKeys) {
        const avgLate = methodStats[k].lateCount > 0 ? methodStats[k].totalLateMin / methodStats[k].lateCount : 0;
        const bestAvg = methodStats[bestMethod].lateCount > 0 ? methodStats[bestMethod].totalLateMin / methodStats[bestMethod].lateCount : 0;
        const worstAvg = methodStats[worstMethod].lateCount > 0 ? methodStats[worstMethod].totalLateMin / methodStats[worstMethod].lateCount : 0;
        if (avgLate > worstAvg) worstMethod = k;
        if (avgLate < bestAvg) bestMethod = k;
      }
      const worstAvgLate = methodStats[worstMethod].lateCount > 0 ? Math.round(methodStats[worstMethod].totalLateMin / methodStats[worstMethod].lateCount) : 0;
      const bestAvgLate = methodStats[bestMethod].lateCount > 0 ? Math.round(methodStats[bestMethod].totalLateMin / methodStats[bestMethod].lateCount) : 0;
      if (worstAvgLate > bestAvgLate + 10 && worstMethod !== bestMethod) {
        insights.push({ text: `Check-in method disparity: "${worstMethod.replace('_', ' ')}" sessions avg ${worstAvgLate}min late vs "${bestMethod.replace('_', ' ')}" at ${bestAvgLate}min — possible process delay`, textAr: `تفاوت طريقة التسجيل: جلسات "${worstMethod.replace('_', ' ')}" بمتوسط ${worstAvgLate} دقيقة تأخر مقابل "${bestMethod.replace('_', ' ')}" بـ ${bestAvgLate} دقيقة — قد يكون تأخر إجرائي`, type: 'warning', priority: 72 });
      }
    } else if (methodKeys.length === 1 && methodStats[methodKeys[0]].lateCount >= 3) {
      const m = methodKeys[0];
      const avgLate = Math.round(methodStats[m].totalLateMin / methodStats[m].lateCount);
      const lateRate = Math.round((methodStats[m].lateCount / methodStats[m].count) * 100);
      if (avgLate >= 15) {
        insights.push({ text: `All check-ins via "${m.replace('_', ' ')}" — ${lateRate}% late rate with avg ${avgLate}min tardiness`, textAr: `كل التسجيلات عبر "${m.replace('_', ' ')}" — ${lateRate}% نسبة تأخر بمتوسط ${avgLate} دقيقة`, type: 'info', priority: 48 });
      }
    }

    // ── P. Late Duration Trend (worsening vs improving tardiness) ──
    if (late >= 4) {
      const lateRecordsSorted = [...lateRecords].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
      const firstHalfLate = lateRecordsSorted.slice(0, Math.floor(lateRecordsSorted.length / 2));
      const secondHalfLate = lateRecordsSorted.slice(Math.floor(lateRecordsSorted.length / 2));
      const avgFirst = firstHalfLate.reduce((s, r) => s + (r.late_minutes || 0), 0) / firstHalfLate.length;
      const avgSecond = secondHalfLate.reduce((s, r) => s + (r.late_minutes || 0), 0) / secondHalfLate.length;
      if (avgSecond > avgFirst * 2 && avgSecond >= 10) {
        insights.push({ text: `Tardiness worsening: avg late duration doubled from ${Math.round(avgFirst)}min to ${Math.round(avgSecond)}min in recent sessions`, textAr: `التأخر يتفاقم: متوسط مدة التأخر تضاعف من ${Math.round(avgFirst)} دقيقة إلى ${Math.round(avgSecond)} دقيقة في الجلسات الأخيرة`, type: 'danger', priority: 81 });
      } else if (avgSecond < avgFirst * 0.5 && avgFirst >= 10) {
        insights.push({ text: `Tardiness improving: avg late duration dropped from ${Math.round(avgFirst)}min to ${Math.round(avgSecond)}min`, textAr: `التأخر يتحسن: متوسط مدة التأخر انخفض من ${Math.round(avgFirst)} دقيقة إلى ${Math.round(avgSecond)} دقيقة`, type: 'positive', priority: 70 });
      }
    }

    // ── Q. Session-Not-Held Impact ──
    const sessionNotHeldCount = unique.filter(r => (r as { excuse_reason?: string }).excuse_reason === 'session not held' || (r as { host_address?: string }).host_address === 'SESSION_NOT_HELD').length;
    // Include original filtered-out session-not-held records too
    const totalNotHeld = sessionNotHeldCount + sessionNotHeldTimestamps.size;
    if (totalNotHeld >= 3) {
      const notHeldPct = Math.round((totalNotHeld / (total + totalNotHeld)) * 100);
      if (notHeldPct >= 20) {
        insights.push({ text: `${totalNotHeld} sessions not held (${notHeldPct}% of schedule) — reduced practice time may affect skill development`, textAr: `${totalNotHeld} جلسات لم تُعقد (${notHeldPct}% من الجدول) — قلة وقت التدريب قد تؤثر على تطوير المهارات`, type: 'info', priority: 57 });
      }
    }

    // ── R. Recent Performance Window (last 5 sessions) ──
    const recentAccountable = [...accountableRecords].sort((a, b) => b.attendance_date.localeCompare(a.attendance_date)).slice(0, 5);
    if (recentAccountable.length >= 4) {
      const recentPresent = recentAccountable.filter(r => r.status === 'on time' || r.status === 'late').length;
      const recentRate = Math.round((recentPresent / recentAccountable.length) * 100);
      if (recentRate <= 40 && attendanceRate >= 70) {
        insights.push({ text: `Warning: recent attendance dropped to ${recentRate}% (last ${recentAccountable.length} sessions) vs ${attendanceRate}% overall — possible disengagement starting`, textAr: `تنبيه: الحضور الأخير انخفض إلى ${recentRate}% (آخر ${recentAccountable.length} جلسات) مقارنة بـ ${attendanceRate}% إجمالي — قد يكون بداية انسحاب`, type: 'danger', priority: 93 });
      } else if (recentRate >= 100 && attendanceRate < 80) {
        insights.push({ text: `Positive momentum: 100% attendance in last ${recentAccountable.length} sessions despite ${attendanceRate}% overall — encouraging recent trend`, textAr: `زخم إيجابي: حضور 100% في آخر ${recentAccountable.length} جلسات رغم ${attendanceRate}% إجمالي — اتجاه مشجع مؤخراً`, type: 'positive', priority: 88 });
      }
    }

    // ── S. Post-Absence Recovery + Cascade Rate ──
    if (absent >= 1 && present >= 3) {
      const sortedAccountable = [...accountableRecords].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
      let recoveries = 0, totalRecoveryOps = 0;
      let cascades = 0, cascadeOps = 0;
      let lateAfterAbsence = 0, presentAfterAbsence = 0;
      for (let i = 0; i < sortedAccountable.length; i++) {
        if (sortedAccountable[i].status === 'absent') {
          // Cascade detection: does the next session also result in absence?
          if (i + 1 < sortedAccountable.length) {
            cascadeOps++;
            if (sortedAccountable[i + 1].status === 'absent') cascades++;
            else if (sortedAccountable[i + 1].status === 'late') lateAfterAbsence++;
            else if (sortedAccountable[i + 1].status === 'on time') presentAfterAbsence++;
          }
          // Full recovery: next 3 sessions all present?
          const next3 = sortedAccountable.slice(i + 1, i + 4);
          if (next3.length >= 2) {
            totalRecoveryOps++;
            const presentAfter = next3.filter(r => r.status === 'on time' || r.status === 'late').length;
            if (presentAfter === next3.length) recoveries++;
          }
        }
      }
      // Cascade rate insight
      if (cascadeOps >= 2) {
        const cascadeRate = Math.round((cascades / cascadeOps) * 100);
        if (cascadeRate >= 60) {
          insights.push({ text: `Absence cascade pattern: ${cascadeRate}% of absences lead to another absence (${cascades}/${cascadeOps}) — single absences rarely stay isolated`, textAr: `نمط تسلسل الغياب: ${cascadeRate}% من الغيابات تؤدي لغياب آخر (${cascades}/${cascadeOps}) — الغيابات المفردة نادراً ما تبقى معزولة`, type: 'danger', priority: 88 });
        } else if (cascadeRate >= 40) {
          insights.push({ text: `Moderate cascade risk: ${cascadeRate}% of absences lead to another (${cascades}/${cascadeOps}) — partial recovery ability`, textAr: `خطر تسلسل متوسط: ${cascadeRate}% من الغيابات تؤدي لغياب آخر (${cascades}/${cascadeOps}) — قدرة تعافٍ جزئية`, type: 'warning', priority: 76 });
        } else if (cascadeRate <= 15 && cascadeOps >= 3) {
          insights.push({ text: `Strong resilience: only ${cascadeRate}% cascade rate — bounces back after absences consistently`, textAr: `مرونة قوية: ${cascadeRate}% فقط نسبة التسلسل — يعود بعد الغياب باستمرار`, type: 'positive', priority: 74 });
        }
      }
      // Post-absence lateness signal
      if (lateAfterAbsence + presentAfterAbsence >= 3) {
        const lateReentryRate = Math.round((lateAfterAbsence / (lateAfterAbsence + presentAfterAbsence)) * 100);
        if (lateReentryRate >= 60) {
          insights.push({ text: `Late re-entry pattern: ${lateReentryRate}% of returns after absence are late (${lateAfterAbsence}/${lateAfterAbsence + presentAfterAbsence}) — gradual re-engagement signal`, textAr: `نمط عودة متأخرة: ${lateReentryRate}% من العودات بعد الغياب متأخرة (${lateAfterAbsence}/${lateAfterAbsence + presentAfterAbsence}) — إشارة إعادة انخراط تدريجية`, type: 'warning', priority: 71 });
        }
      }
      // Full recovery pattern
      if (totalRecoveryOps > 0) {
        if (recoveries === totalRecoveryOps) {
          insights.push({ text: `Full recovery pattern: maintained attendance after every absence (${recoveries}/${totalRecoveryOps})`, textAr: `نمط تعافٍ كامل: حافظ على الحضور بعد كل غياب (${recoveries}/${totalRecoveryOps})`, type: 'positive', priority: 73 });
        } else if (recoveries === 0 && totalRecoveryOps >= 2) {
          insights.push({ text: `No recovery: failed to sustain 3+ sessions after any absence (0/${totalRecoveryOps}) — absences trigger prolonged disengagement`, textAr: `لا تعافٍ: لم يستطع الاستمرار 3+ جلسات بعد أي غياب (0/${totalRecoveryOps}) — الغياب يسبب انقطاع مطوّل`, type: 'danger', priority: 82 });
        }
      }
    }

    // ── T. Perfect Punctuality Streak Detection ──
    if (maxPerfectStreak >= 5 && punctuality < 80) {
      insights.push({ text: `Hidden potential: achieved ${maxPerfectStreak} consecutive on-time sessions — capable of punctuality when focused`, textAr: `إمكانية مخفية: حقّق ${maxPerfectStreak} جلسات متتالية في الوقت — قادر على الانضباط عند التركيز`, type: 'info', priority: 60 });
    } else if (maxPerfectStreak >= 8) {
      insights.push({ text: `Punctuality excellence: ${maxPerfectStreak} consecutive on-time arrivals — outstanding time management`, textAr: `تميّز في الانضباط: ${maxPerfectStreak} وصول متتالي في الوقت — إدارة وقت ممتازة`, type: 'positive', priority: 73 });
    }

    // ── U. Monthly Attendance Trend (detect specific declining months) ──
    if (accountable >= 8) {
      const monthBuckets: Record<string, { present: number; total: number }> = {};
      const monthNameAr: Record<string, string> = { Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو', Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر' };
      for (const r of accountableRecords) {
        const d = new Date(`${r.attendance_date}T00:00:00`);
        const key = `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getFullYear()}`;
        if (!monthBuckets[key]) monthBuckets[key] = { present: 0, total: 0 };
        monthBuckets[key].total++;
        if (r.status === 'on time' || r.status === 'late') monthBuckets[key].present++;
      }
      const monthEntries = Object.entries(monthBuckets).filter(([, v]) => v.total >= 2);
      const worstMonth = monthEntries.reduce((worst, curr) =>
        (curr[1].present / curr[1].total) < (worst[1].present / worst[1].total) ? curr : worst, monthEntries[0]);
      if (worstMonth) {
        const worstRate = Math.round((worstMonth[1].present / worstMonth[1].total) * 100);
        if (worstRate < 60 && worstRate < attendanceRate - 20) {
          const [monthShort] = worstMonth[0].split(' ');
          const monthAr = monthNameAr[monthShort] || monthShort;
          insights.push({ text: `Weakest period: ${worstMonth[0]} at ${worstRate}% (${worstMonth[1].present}/${worstMonth[1].total}) — significant drop from overall ${attendanceRate}%`, textAr: `أضعف فترة: ${monthAr} بنسبة ${worstRate}% (${worstMonth[1].present}/${worstMonth[1].total}) — انخفاض ملحوظ عن الإجمالي ${attendanceRate}%`, type: 'warning', priority: 67 });
        }
      }
    }

    // ── V. Score Potential Analysis (what-if absent sessions were present) ──
    if (absent >= 2 && absent <= 5) {
      const potentialRate = Math.round(((present + absent) / accountable) * 1000) / 10;
      const potentialScore = Math.round(potentialRate * 0.85 * 10) / 10; // rough estimate
      if (potentialScore > weightedScore + 5) {
        insights.push({ text: `Potential unlocked: eliminating ${absent} absences would raise attendance to ${potentialRate}% — estimated ~${Math.round(potentialScore - weightedScore)}pt score gain`, textAr: `إمكانية مفتوحة: إزالة ${absent} غيابات سترفع الحضور إلى ${potentialRate}% — تقدير ~${Math.round(potentialScore - weightedScore)} نقطة إضافية`, type: 'info', priority: 59 });
      }
    }

    // ── W. Attendance Momentum (exponentially weighted recent sessions) ──
    if (accountable >= 8) {
      // Weight recent sessions more heavily: weight = 2^(i/n) for position i in sorted list
      const sorted = [...accountableRecords].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
      let weightedSum = 0, totalWeight = 0;
      for (let i = 0; i < sorted.length; i++) {
        const w = Math.pow(2, i / sorted.length);
        totalWeight += w;
        if (sorted[i].status === 'on time') weightedSum += w;
        else if (sorted[i].status === 'late') weightedSum += w * 0.7;
      }
      const momentum = Math.round((weightedSum / totalWeight) * 100);
      const diff = momentum - attendanceRate;
      if (diff >= 15) {
        insights.push({ text: `Positive momentum: recent trajectory (${momentum}%) significantly outpaces overall ${attendanceRate}% — upswing confirmed`, textAr: `زخم إيجابي: المسار الأخير (${momentum}%) يتفوق بشكل ملحوظ على الإجمالي ${attendanceRate}% — صعود مؤكد`, type: 'positive', priority: 85 });
      } else if (diff <= -15) {
        insights.push({ text: `Negative momentum: recent trajectory (${momentum}%) falling behind overall ${attendanceRate}% — early warning of decline`, textAr: `زخم سلبي: المسار الأخير (${momentum}%) يتراجع عن الإجمالي ${attendanceRate}% — تحذير مبكر بالتراجع`, type: 'danger', priority: 87 });
      }
    }

    // ── X. Seasonal/Holiday Dip Detection ──
    if (accountable >= 10) {
      const monthRates: { month: string; monthAr: string; rate: number; total: number }[] = [];
      const mNameAr: Record<number, string> = { 0: 'يناير', 1: 'فبراير', 2: 'مارس', 3: 'أبريل', 4: 'مايو', 5: 'يونيو', 6: 'يوليو', 7: 'أغسطس', 8: 'سبتمبر', 9: 'أكتوبر', 10: 'نوفمبر', 11: 'ديسمبر' };
      const mBuckets: Record<string, { present: number; total: number; monthIdx: number; year: number }> = {};
      for (const r of accountableRecords) {
        const d = new Date(`${r.attendance_date}T00:00:00`);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!mBuckets[key]) mBuckets[key] = { present: 0, total: 0, monthIdx: d.getMonth(), year: d.getFullYear() };
        mBuckets[key].total++;
        if (r.status === 'on time' || r.status === 'late') mBuckets[key].present++;
      }
      for (const [, v] of Object.entries(mBuckets)) {
        if (v.total >= 3) {
          const rate = Math.round((v.present / v.total) * 100);
          const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          monthRates.push({ month: `${mNames[v.monthIdx]} ${v.year}`, monthAr: `${mNameAr[v.monthIdx]} ${v.year}`, rate, total: v.total });
        }
      }
      // Detect holiday dip: month with rate < 40% when overall is > 60%
      const holidayDip = monthRates.find(m => m.rate < 40 && attendanceRate > 60);
      if (holidayDip) {
        insights.push({ text: `Holiday/seasonal dip detected: ${holidayDip.month} at ${holidayDip.rate}% (${holidayDip.total} sessions) — likely external factor, not behavioral`, textAr: `انخفاض موسمي/إجازة مكتشف بتاريخ ${holidayDip.monthAr}: ${holidayDip.rate}% (${holidayDip.total} جلسات) — عامل خارجي وليس سلوكي`, type: 'info', priority: 65 });
      }
    }

    // Sort by priority (highest first), drop low-value items, and cap at 6
    insights.sort((a, b) => b.priority - a.priority);
    const topInsights = insights.filter(i => i.priority >= 50).slice(0, 6);
    // If we got fewer than 3, add back highest-priority remaining ones
    if (topInsights.length < 3) {
      const remaining = insights.filter(i => !topInsights.includes(i));
      topInsights.push(...remaining.slice(0, 3 - topInsights.length));
    }

    // Apply streak bonus (computed after maxStreak is known, mirrors AttendanceRecords)
    const maxConsecutiveWeeks = Math.floor(maxStreak / 1); // streak is already in sessions
    const streakBonusApplied = maxConsecutiveWeeks * config.streak_bonus_per_week;
    const finalWeightedScore = Math.round(Math.min(100, Math.max(0, weightedScore + streakBonusApplied)) * 10) / 10;

    return {
      total, onTime, late, absent, excused, present, accountable,
      attendanceRate, qualityRate, weightedScore: finalWeightedScore, punctuality,
      trendClassification, trendSlope: Math.round(trendSlope * 100) / 100, trendR2: Math.round(trendR2 * 100) / 100,
      weeklyChange, consecutive, maxStreak, activeStreak, maxPerfectStreak,
      firstHalfRate, secondHalfRate, consistencyIndex,
      avgLateMinutes, maxLateMinutes, totalLateMinutes, lateScoreAvg,
      coverageFactor: Math.round(coverageFactor * 100) / 100,
      rawScore: Math.round(rawScore * 10) / 10,
      insights: topInsights,
      configWeights: { q: config.weight_quality, a: config.weight_attendance, p: config.weight_punctuality },
    };
  }, [filteredAttendance]);

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

  // Arabic translations
  const t = useMemo(() => {
    const ar: Record<string, string> = {
      'Weighted Score': 'الدرجة المرجحة',
      'Overview': 'نظرة عامة',
      'Attendance': 'الحضور',
      'Enrollments': 'التسجيلات',
      'Certificates': 'الشهادات',
      'Punctuality': 'الالتزام بالوقت',
      'Best Streak': 'أفضل سلسلة',
      'Current Streak': 'السلسلة الحالية',
      'Session Distribution': 'توزيع الجلسات',
      'On Time': 'في الوقت',
      'Late': 'متأخر',
      'Absent': 'غائب',
      'Excused': 'معذور',
      'Performance DNA': 'تحليل الأداء',
      'Sessions Tracked': 'الجلسات المسجلة',
      'First Half': 'النصف الأول',
      'Second Half': 'النصف الثاني',
      'Avg Late': 'متوسط التأخر',
      'Late Credit': 'رصيد التأخر',
      'Coverage Factor': 'عامل التغطية',
      'Current Absence Streak': 'سلسلة الغياب الحالية',
      'consecutive': 'متتالي',
      'sessions': 'جلسات',
      'total': 'المجموع',
      'AI Insights': 'رؤى ذكية',
      'Active Enrollments': 'التسجيلات النشطة',
      'No attendance data': 'لا توجد بيانات حضور',
      'Export PDF': 'تصدير PDF',
      'Total Present': 'إجمالي الحضور',
      'Total Absent': 'إجمالي الغياب',
      'Email': 'بريد إلكتروني',
      'WhatsApp': 'واتساب',
      'Good standing': 'أداء جيد',
      'critical risk': 'خطر حرج',
      'high risk': 'خطر عالي',
      'medium risk': 'خطر متوسط',
      'good risk': 'أداء جيد',
      'IMPROVING': 'تحسّن',
      'DECLINING': 'تراجع',
      'STABLE': 'مستقر',
      'VOLATILE': 'متذبذب',
      'Date': 'التاريخ',
      'Course': 'الدورة',
      'Status': 'الحالة',
      'Method': 'الطريقة',
      'No attendance records': 'لا توجد سجلات حضور',
      'on time': 'في الوقت',
      'late': 'متأخر',
      'absent': 'غائب',
      'excused': 'معذور',
      'not enrolled': 'غير مسجل',
      'Host Activity': 'نشاط الاستضافة',
      'Times Hosted': 'مرات الاستضافة',
      'Avg Attendance': 'متوسط الحضور',
    };
    return (key: string) => arabicMode ? (ar[key] || key) : key;
  }, [arabicMode]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((_e: React.MouseEvent) => {
    // Only close via the X button — not by clicking outside
  }, []);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby="student-detail-title">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col" dir={arabicMode ? 'rtl' : 'ltr'} onClick={e => e.stopPropagation()}>

        {/* ─── Header ───────────────────────────────────── */}
        <div className="relative px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="absolute top-4 right-4 flex items-center gap-1">
            <button onClick={() => setArabicMode(v => !v)} className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${arabicMode ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400'}`} title={arabicMode ? 'Switch to English' : 'التبديل للعربية'}>
              {arabicMode ? 'EN' : 'ع'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

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
              <h2 id="student-detail-title" className="text-xl font-bold text-gray-900 dark:text-white truncate">{student.name}</h2>
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
        <div className="overflow-x-auto px-4 sm:px-6 -mb-px scrollbar-thin">
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {([
            { key: 'overview' as const, label: t('Overview'), icon: '📊' },
            { key: 'attendance' as const, label: t('Attendance'), count: attendance.length, icon: '📋' },
            { key: 'enrollments' as const, label: t('Enrollments'), count: activeEnrollments.length, icon: '📚' },
            { key: 'certificates' as const, label: t('Certificates'), count: certificates.filter(c => c.status === 'issued').length, icon: '🏆' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap min-w-[80px] justify-center ${
                activeTab === tab.key
                  ? 'border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/10'
                  : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium">{tab.count}</span>}
            </button>
          ))}
          </div>
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
                      <span className={`absolute inset-0 flex items-center justify-center text-sm font-black ${analytics.weightedScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : analytics.weightedScore >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                        {analytics.weightedScore}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{t('Weighted Score')}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
                        Q{analytics.qualityRate}×{analytics.configWeights.q}% + A{analytics.attendanceRate}×{analytics.configWeights.a}% + P{analytics.punctuality}×{analytics.configWeights.p}%
                        {analytics.coverageFactor < 1 && <span className="text-purple-400"> × CF{analytics.coverageFactor}</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${analytics.trendClassification === 'IMPROVING' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : analytics.trendClassification === 'DECLINING' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : analytics.trendClassification === 'VOLATILE' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {analytics.trendClassification === 'IMPROVING' ? '📈' : analytics.trendClassification === 'DECLINING' ? '📉' : analytics.trendClassification === 'VOLATILE' ? '🔀' : '➡️'} {t(analytics.trendClassification)}
                        </span>
                        {analytics.weeklyChange !== 0 && (
                          <span className={`text-[10px] font-medium ${analytics.weeklyChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {analytics.weeklyChange > 0 ? '+' : ''}{analytics.weeklyChange}% week
                          </span>
                        )}
                        {analytics.coverageFactor < 0.85 && (
                          <span className="text-[9px] text-orange-500 dark:text-orange-400 font-medium">⚠ low coverage</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Key Metrics Grid ────────────────────── */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {([
                      { label: t('Attendance'), value: `${analytics.attendanceRate}%`, threshold: analytics.attendanceRate },
                      { label: t('Total Present'), value: `${analytics.present}`, threshold: analytics.attendanceRate },
                      { label: t('Punctuality'), value: `${analytics.punctuality}%`, threshold: analytics.punctuality },
                      { label: t('Absent'), value: `${analytics.absent}`, threshold: analytics.absent === 0 ? 90 : analytics.absent <= 2 ? 70 : 40 },
                      { label: t('Total Absent'), value: `${analytics.absent + analytics.excused}`, threshold: (analytics.absent + analytics.excused) === 0 ? 90 : (analytics.absent + analytics.excused) <= 3 ? 70 : 40 },
                    ]).map(m => (
                      <div key={m.label} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2 text-center">
                        <p className="text-[8px] sm:text-[9px] text-gray-400 uppercase tracking-wider leading-tight">{m.label}</p>
                        <p className={`text-sm sm:text-base font-black ${m.threshold >= 80 ? 'text-emerald-600 dark:text-emerald-400' : m.threshold >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ── Distribution Bar (with excused blur) ── */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
                    <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('Session Distribution')}</p>
                    <div className="flex h-3 rounded-full overflow-hidden shadow-inner bg-gray-100 dark:bg-gray-800">
                      <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${(analytics.onTime / analytics.total) * 100}%` }} />
                      <div className="bg-amber-500 transition-all duration-500" style={{ width: `${(analytics.late / analytics.total) * 100}%` }} />
                      <div className="bg-red-500 transition-all duration-500" style={{ width: `${(analytics.absent / analytics.total) * 100}%` }} />
                      {analytics.excused > 0 && (
                        <div className="bg-purple-400/60 backdrop-blur-sm transition-all duration-500" style={{ width: `${(analytics.excused / analytics.total) * 100}%` }} />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {t('On Time')} {analytics.onTime} ({Math.round((analytics.onTime / analytics.total) * 100)}%)</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {t('Late')} {analytics.late} ({Math.round((analytics.late / analytics.total) * 100)}%)</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> {t('Absent')} {analytics.absent} ({Math.round((analytics.absent / analytics.total) * 100)}%)</span>
                      {analytics.excused > 0 && (
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400/60 inline-block ring-1 ring-purple-300/50" /> {t('Excused')} {analytics.excused} ({Math.round((analytics.excused / analytics.total) * 100)}%)</span>
                      )}
                    </div>
                  </div>

                  {/* ── Performance DNA ─────────────────────── */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 space-y-2">
                    <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('Performance DNA')}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('Sessions Tracked')}</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{analytics.accountable} <span className="text-[9px] text-gray-400">/ {analytics.total} {t('total')}</span></span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('Best Streak')}</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {analytics.maxStreak} {t('consecutive')}
                          {analytics.activeStreak === analytics.maxStreak && analytics.activeStreak > 0 && <span className="ml-1 text-[9px]">🔥</span>}
                        </span>
                      </div>
                      {analytics.activeStreak > 0 && analytics.activeStreak !== analytics.maxStreak && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">{t('Current Streak')}</span>
                          <span className="font-semibold text-blue-600 dark:text-blue-400">{analytics.activeStreak} {t('consecutive')}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('First Half')}</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{analytics.firstHalfRate}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('Second Half')}</span>
                        <span className={`font-semibold ${analytics.secondHalfRate > analytics.firstHalfRate ? 'text-emerald-600 dark:text-emerald-400' : analytics.secondHalfRate < analytics.firstHalfRate ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                          {analytics.secondHalfRate}% {analytics.secondHalfRate > analytics.firstHalfRate + 5 ? '↑' : analytics.firstHalfRate > analytics.secondHalfRate + 5 ? '↓' : ''}
                        </span>
                      </div>
                      {analytics.late > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-500">{t('Avg Late')}</span>
                            <span className="font-semibold text-amber-600">{analytics.avgLateMinutes}min</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">{t('Late Credit')}</span>
                            <span className="font-semibold text-gray-800 dark:text-gray-200">{Math.round(analytics.lateScoreAvg * 100)}%</span>
                          </div>
                        </>
                      )}
                      {analytics.coverageFactor < 1 && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">{t('Coverage Factor')}</span>
                          <span className={`font-semibold ${analytics.coverageFactor >= 0.8 ? 'text-gray-800 dark:text-gray-200' : 'text-orange-600'}`}>{analytics.coverageFactor}</span>
                        </div>
                      )}
                      {analytics.consecutive > 0 && (
                        <div className="flex justify-between col-span-2">
                          <span className="text-gray-500">{t('Current Absence Streak')}</span>
                          <span className={`font-semibold ${analytics.consecutive >= 3 ? 'text-red-600 animate-pulse' : 'text-amber-600'}`}>{analytics.consecutive} {t('sessions')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Host Activity ──────────────────────── */}
                  {filteredHostStats && filteredHostStats.hostCount > 0 && (
                    <div className="rounded-xl border border-cyan-200 dark:border-cyan-800/50 bg-gradient-to-br from-cyan-50/50 to-sky-50/30 dark:from-cyan-900/10 dark:to-sky-900/5 p-3 space-y-2">
                      <p className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">🏠 {t('Host Activity')}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-cyan-100 dark:border-cyan-800/30 bg-white/60 dark:bg-gray-800/30 p-2 text-center">
                          <p className="text-[9px] text-gray-400 uppercase tracking-wider">{t('Times Hosted')}</p>
                          <p className="text-lg font-black text-cyan-700 dark:text-cyan-300">{filteredHostStats.hostCount}</p>
                        </div>
                        <div className="rounded-lg border border-cyan-100 dark:border-cyan-800/30 bg-white/60 dark:bg-gray-800/30 p-2 text-center">
                          <p className="text-[9px] text-gray-400 uppercase tracking-wider">{t('Avg Attendance')}</p>
                          <p className={`text-lg font-black ${filteredHostStats.avgAttendance >= 80 ? 'text-emerald-600 dark:text-emerald-400' : filteredHostStats.avgAttendance >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{filteredHostStats.avgAttendance}%</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── AI Insights ─────────────────────────── */}
                  {analytics.insights.length > 0 && (
                    <div className="rounded-xl border border-purple-200 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-violet-50/30 dark:from-purple-900/10 dark:to-violet-900/5 p-3">
                      <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide mb-2">🧠 {t('AI Insights')}</p>
                      <div className="space-y-1.5">
                        {analytics.insights.map((ins, i) => (
                          <div key={i} className={`flex items-start gap-2 text-[11px] px-2 py-1 rounded-lg ${
                            ins.type === 'positive' ? 'bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300' :
                            ins.type === 'danger' ? 'bg-red-50/50 dark:bg-red-900/10 text-red-700 dark:text-red-300' :
                            ins.type === 'warning' ? 'bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300' :
                            'bg-blue-50/50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300'
                          }`}>
                            <span className="shrink-0 mt-px">{ins.type === 'positive' ? '✅' : ins.type === 'danger' ? '🚨' : ins.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                            <span>{arabicMode ? ins.textAr : ins.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Enrollments summary ─────────────────── */}
                  {activeEnrollments.length > 0 && (
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5">{t('Active Enrollments')} <span className="text-purple-500">({activeEnrollments.length})</span></p>
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
                  <p className="text-sm text-gray-500">{t('No attendance data')}</p>
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
                {analytics && (
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowExportMenu(prev => !prev); }}
                      className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors font-semibold"
                    >
                      📄 {t('Export PDF')}
                    </button>
                    {showExportMenu && (
                      <>
                        <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setShowExportMenu(false)} />
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 w-56" style={{ zIndex: 9999 }}>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Select sections</p>
                        {([
                          { key: 'overview' as ExportSection, label: 'Overview', icon: '📊' },
                          { key: 'attendance' as ExportSection, label: 'Attendance Records', icon: '📋' },
                          { key: 'certificates' as ExportSection, label: 'Certificates', icon: '📜' },
                        ] as const).map(opt => (
                          <label key={opt.key} className="flex items-center gap-2 py-1.5 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={exportSections.includes(opt.key)}
                              onChange={() => setExportSections(prev =>
                                prev.includes(opt.key) ? prev.filter(s => s !== opt.key) : [...prev, opt.key]
                              )}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs text-gray-700 dark:text-gray-300 group-hover:text-blue-600 transition-colors">{opt.icon} {opt.label}</span>
                          </label>
                        ))}
                        <button
                          disabled={exportSections.length === 0}
                          onClick={() => {
                            setShowExportMenu(false);
                            const enrMapped = activeEnrollments.map(e => {
                              const s = unwrap(e.session);
                              return { courseName: unwrap(s?.course)?.course_name || 'Unknown', teacherName: unwrap(s?.teacher)?.name || '', status: e.status };
                            });
                            // Sort attendance same as current UI sort
                            const statusOrder: Record<string, number> = { 'on time': 1, 'late': 2, 'absent': 3, 'excused': 4, 'not enrolled': 5 };
                            const sortedAtt = [...filteredAttendance].sort((a, b) => {
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
                            const attExport = sortedAtt.map(a => ({
                              attendance_date: a.attendance_date,
                              status: a.status,
                              check_in_method: a.check_in_method,
                              late_minutes: a.late_minutes,
                              courseName: unwrap(unwrap(a.session)?.course)?.course_name || '—',
                            }));
                            const certExport = certificates.map(c => ({
                              certificate_number: c.certificate_number,
                              courseName: c.course?.course_name || c.session?.course?.course_name || 'Unknown Course',
                              status: c.status,
                              final_score: c.final_score,
                              attendance_rate: c.attendance_rate,
                              issued_at: c.issued_at,
                              signature_name: c.signature_name,
                              signature_title: c.signature_title,
                            }));
                            exportStudentOverviewPDF({
                              student, analytics, enrollments: enrMapped, riskLevel, photoDataUrl: photoSignedUrl,
                              sections: exportSections,
                              attendanceRecords: attExport,
                              certificates: certExport,
                              hostStats: filteredHostStats,
                              arabicMode,
                            });
                          }}
                          className="mt-2 w-full text-[11px] px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold"
                        >
                          Download PDF
                        </button>
                      </div>
                      </>
                    )}
                  </div>
                )}
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
              {/* ── Filters: Status, Date Range ────────────── */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {/* Status filter */}
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-white"
                >
                  <option value="">{arabicMode ? 'كل الحالات' : 'All Status'}</option>
                  <option value="on time">{arabicMode ? 'في الوقت' : 'On Time'}</option>
                  <option value="late">{arabicMode ? 'متأخر' : 'Late'}</option>
                  <option value="absent">{arabicMode ? 'غائب' : 'Absent'}</option>
                  <option value="excused">{arabicMode ? 'معذور' : 'Excused'}</option>
                </select>

                {/* Date from */}
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={e => setFilterDateFrom(e.target.value)}
                  className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-white"
                  placeholder="From"
                />
                <span className="text-[10px] text-gray-400">→</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={e => setFilterDateTo(e.target.value)}
                  className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-white"
                  placeholder="To"
                />

                {/* Session filter (show only if multiple sessions) */}
                {Object.keys(sessionGroupMap).length > 1 && (
                  <select
                    value={selectedSessionId}
                    onChange={e => setSelectedSessionId(e.target.value)}
                    className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-white"
                  >
                    <option value="">{arabicMode ? 'كل الجلسات' : 'All Sessions'}</option>
                    {enrollments.filter(enr => {
                      const s = unwrap(enr.session);
                      return !!s?.session_id;
                    }).map(enr => {
                      const s = unwrap(enr.session);
                      if (!s?.session_id) return null;
                      const course = unwrap(s.course);
                      return (
                        <option key={s.session_id} value={s.session_id}>
                          {course?.course_name || '—'}
                        </option>
                      );
                    })}
                  </select>
                )}

                {/* Clear all */}
                {(filterStatus || filterDateFrom || filterDateTo || selectedSessionId) && (
                  <button
                    onClick={() => { setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo(''); setSelectedSessionId(''); }}
                    className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                  >✕ {arabicMode ? 'مسح' : 'Clear'}</button>
                )}
              </div>

              {/* Filter result count */}
              {(filterStatus || filterDateFrom || filterDateTo) && (
                <p className="text-[10px] text-gray-400">{filteredAttendance.length} of {attendance.length} records</p>
              )}
              {filteredAttendance.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">{t('No attendance records')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        {([
                          { key: 'date' as const, label: t('Date') },
                          { key: 'course' as const, label: t('Course') },
                          { key: 'status' as const, label: t('Status') },
                          { key: 'method' as const, label: t('Method') },
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
                        const sorted = [...filteredAttendance].sort((a, b) => {
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
                                  {t(a.status)}
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
                  {filteredAttendance.length > 50 && (
                    <p className="text-[11px] text-gray-400 text-center py-2">Showing 50 of {filteredAttendance.length} records</p>
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
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-amber-100 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/10 flex items-center justify-center mb-3">
                    <span className="text-3xl">🏆</span>
                  </div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No certificates yet</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Certificates appear here once issued by a teacher</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {certificates.map(cert => {
                    const courseName = cert.course?.course_name
                      || cert.session?.course?.course_name
                      || 'Unknown Course';
                    const isRevoked = cert.status === 'revoked';
                    return (
                      <div key={cert.certificate_id} className={`rounded-xl border p-3.5 transition-all ${isRevoked ? 'border-red-200 dark:border-red-800/40 bg-red-50/20 dark:bg-red-950/10 opacity-75' : 'border-gray-100 dark:border-gray-700 bg-gradient-to-r from-white to-gray-50/50 dark:from-gray-800/40 dark:to-gray-900/20 hover:shadow-sm'}`}>
                        <div className="flex items-start gap-3">
                          {/* Certificate icon */}
                          <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg ${isRevoked ? 'bg-red-100 dark:bg-red-900/20' : cert.status === 'issued' ? 'bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/10' : 'bg-amber-100 dark:bg-amber-900/20'}`}>
                            {isRevoked ? '🚫' : cert.status === 'issued' ? '📜' : '📑'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-semibold truncate ${isRevoked ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>{courseName}</p>
                              <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${
                                cert.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                                cert.status === 'draft' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                                'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                              }`}>{cert.status}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono tracking-wider">{cert.certificate_number}</p>
                            {/* Score badges */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {cert.issued_at && (
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">📅 {new Date(cert.issued_at).toLocaleDateString()}</span>
                              )}
                              {cert.final_score != null && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cert.final_score >= 80 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : cert.final_score >= 60 ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                                  Score {cert.final_score}%
                                </span>
                              )}
                              {cert.attendance_rate != null && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cert.attendance_rate >= 80 ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                                  Attendance {cert.attendance_rate}%
                                </span>
                              )}
                              {cert.verification_code && (
                                <span className="text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/15 px-1.5 py-0.5 rounded font-mono">🔗 {cert.verification_code}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1.5 mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-800">
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
