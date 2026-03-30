import { useMemo, useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ComposedChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  Line,
} from 'recharts';

// Types
interface StudentAnalytics {
  student_id: string;
  student_name: string;
  specialization?: string | null;
  attendanceRate: number;
  punctualityRate: number;
  weightedScore: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  totalLateMinutes: number;
  avgLateMinutes: number;
  consistencyIndex: number;
  trend: { classification: string; slope?: number; rSquared?: number };
  // Optional enriched fields (from full state in AttendanceRecords)
  maxLateMinutes?: number;
  weeklyChange?: number;
  avgRate?: number;
  minRate?: number;
  maxRate?: number;
}

interface DateAnalytics {
  date: string;
  presentCount: number;
  unexcusedAbsentCount: number;
  excusedAbsentCount: number;
  lateCount: number;
  attendanceRate: number;
  hostAddress: string | null;
  isSessionNotHeld: boolean;
  totalLateMinutes: number;
  avgLateMinutes: number;
  topSpecialization?: string | null;
}

export interface SpecializationAnalytics {
  specialization: string;
  studentCount: number;
  avgAttendanceRate: number;
  avgScore: number;
  avgPunctuality: number;
  avgConsistency: number;
  totalOnTime: number;    // on-time only (status = 'on time')
  totalPresent: number;   // total who attended = totalOnTime + totalLate
  totalLate: number;
  totalAbsent: number;
  totalExcused: number;
  bestStudent: string;
  bestStudentScore: number;
  worstStudent: string;
  worstStudentScore: number;
  // Enriched fields
  totalLateMinutes: number;
  avgLateMinutes: number;
  minAttendanceRate: number;
  maxAttendanceRate: number;
  stdDevRate: number;     // std deviation of attendance rates within spec
  minScore: number;
  maxScore: number;
  dominantTrend: string;
  avgWeeklyChange: number;
  studentNames: string;
  lateRatio: number;
  absentRatio: number;
}

interface Props {
  studentAnalytics: StudentAnalytics[];
  dateAnalytics: DateAnalytics[];
  arabicMode?: boolean;
  visibleTabs?: Set<ChartTab>; // which tabs to show in UI (mirrors includedTables behavior)
}

// Colors
const COLORS = {
  present: '#22c55e',
  late: '#f59e0b',
  absent: '#ef4444',
  excused: '#6366f1',
  primary: '#8b5cf6',
  secondary: '#06b6d4',
  accent: '#f43f5e',
  teal: '#14b8a6',
  orange: '#f97316',
};

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#6366f1', '#06b6d4', '#f97316', '#14b8a6', '#ec4899'];

// Custom Tooltip
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl backdrop-blur-sm">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{label}</p>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-600 dark:text-gray-400">{entry.name}:</span>
          <span className="font-bold text-gray-900 dark:text-white">{typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// Exported helper: compute specialization analytics from studentAnalytics
// Used by both the charts component and the export system in AttendanceRecords
export function computeSpecializationAnalytics(
  students: StudentAnalytics[],
  unspecifiedLabel = 'Unspecified'
): SpecializationAnalytics[] {
  const map = new Map<string, StudentAnalytics[]>();
  students.forEach(s => {
    const spec = s.specialization?.trim() || unspecifiedLabel;
    if (!map.has(spec)) map.set(spec, []);
    map.get(spec)!.push(s);
  });
  return Array.from(map.entries())
    .map(([spec, group]) => {
      const n = group.length;
      const avgRate = Math.round(group.reduce((a, x) => a + x.attendanceRate, 0) / n * 10) / 10;
      const avgScore = Math.round(group.reduce((a, x) => a + x.weightedScore, 0) / n * 10) / 10;
      const avgPunctuality = Math.round(group.reduce((a, x) => a + x.punctualityRate, 0) / n * 10) / 10;
      const avgConsistency = Math.round(group.reduce((a, x) => a + x.consistencyIndex, 0) / n * 10) / 10;
      const sorted = [...group].sort((a, b) => b.weightedScore - a.weightedScore);
      const totalOnTime = group.reduce((a, x) => a + x.presentCount, 0);
      const totalLate = group.reduce((a, x) => a + x.lateCount, 0);
      const totalPresent = totalOnTime + totalLate; // all who showed up
      const totalAbsent = group.reduce((a, x) => a + x.absentCount, 0);
      const totalExcused = group.reduce((a, x) => a + x.excusedCount, 0);
      // Late duration — use weighted average (total minutes / total late events), not mean-of-means
      const specTotalLateMin = group.reduce((a, x) => a + (x.totalLateMinutes || 0), 0);
      const specAvgLateMin = totalLate > 0 ? Math.round(specTotalLateMin / totalLate * 10) / 10 : 0;
      // Rate statistics (variance within specialization)
      const rates = group.map(x => x.attendanceRate);
      const scores = group.map(x => x.weightedScore);
      const rateMean = rates.reduce((a, b) => a + b, 0) / (rates.length || 1);
      const stdDevRate = rates.length > 1
        ? Math.round(Math.sqrt(rates.reduce((a, x) => a + Math.pow(x - rateMean, 2), 0) / rates.length) * 10) / 10
        : 0;
      // Trend analysis
      const trendCounts = new Map<string, number>();
      group.forEach(x => {
        const cls = x.trend?.classification || 'STABLE';
        trendCounts.set(cls, (trendCounts.get(cls) || 0) + 1);
      });
      const dominantTrend = [...trendCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'STABLE';
      const avgWeeklyChange = n > 0 ? Math.round(group.reduce((a, x) => a + (x.weeklyChange || 0), 0) / n * 10) / 10 : 0;
      // Ratios
      const totalAll = totalPresent + totalAbsent;
      return {
        specialization: spec,
        studentCount: n,
        avgAttendanceRate: avgRate,
        avgScore,
        avgPunctuality,
        avgConsistency,
        totalOnTime,
        totalPresent,
        totalLate,
        totalAbsent,
        totalExcused,
        bestStudent: sorted[0]?.student_name ?? '-',
        bestStudentScore: sorted[0]?.weightedScore ?? 0,
        worstStudent: sorted[sorted.length - 1]?.student_name ?? '-',
        worstStudentScore: sorted[sorted.length - 1]?.weightedScore ?? 0,
        totalLateMinutes: Math.round(specTotalLateMin),
        avgLateMinutes: specAvgLateMin,
        minAttendanceRate: rates.length > 0 ? Math.round(Math.min(...rates) * 10) / 10 : 0,
        maxAttendanceRate: rates.length > 0 ? Math.round(Math.max(...rates) * 10) / 10 : 0,
        stdDevRate,
        minScore: scores.length > 0 ? Math.round(Math.min(...scores) * 10) / 10 : 0,
        maxScore: scores.length > 0 ? Math.round(Math.max(...scores) * 10) / 10 : 0,
        dominantTrend,
        avgWeeklyChange,
        studentNames: group.map(x => x.student_name).join(', '),
        lateRatio: totalPresent > 0 ? Math.round(totalLate / totalPresent * 1000) / 10 : 0,
        absentRatio: totalAll > 0 ? Math.round(totalAbsent / totalAll * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.avgAttendanceRate - a.avgAttendanceRate);
}

// Exported helper: compute host × specialization affinity for export
export interface HostSpecAffinity {
  host: string;
  topSpec: string;
  topSpecCount: number;
  totalSessions: number;
  breakdown: string;
  allSpecs: string[];
}

export function computeHostSpecAffinity(
  dateAnalytics: Array<{ hostAddress: string | null; isSessionNotHeld: boolean; topSpecialization?: string | null }>
): HostSpecAffinity[] {
  const hostMap = new Map<string, Map<string, number>>();
  dateAnalytics.forEach(d => {
    if (!d.hostAddress || d.isSessionNotHeld || d.hostAddress === 'SESSION_NOT_HELD') return;
    if (!d.topSpecialization) return;
    if (!hostMap.has(d.hostAddress)) hostMap.set(d.hostAddress, new Map());
    const sm = hostMap.get(d.hostAddress)!;
    sm.set(d.topSpecialization, (sm.get(d.topSpecialization) || 0) + 1);
  });
  return Array.from(hostMap.entries()).map(([host, sm]) => {
    const sorted = [...sm.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const totalSessions = sorted.reduce((a, [, c]) => a + c, 0);
    return {
      host,
      topSpec: top?.[0] ?? '-',
      topSpecCount: top?.[1] ?? 0,
      totalSessions,
      breakdown: sorted.map(([s, c]) => `${s}(${c})`).join(', '),
      allSpecs: sorted.map(([s]) => s),
    };
  }).sort((a, b) => b.totalSessions - a.totalSessions);
}

// Chart tab type — exported for use in export chart selection
export type ChartTab = 'trend' | 'distribution' | 'performance' | 'radar' | 'lateness' | 'comparison' | 'specialization';

// Handle exposed by AttendanceCharts via forwardRef
export interface ChartCaptureHandle {
  captureCharts: (tabs: ChartTab[]) => Promise<Map<ChartTab, string>>;
}

// Main Component
const AttendanceCharts = forwardRef<ChartCaptureHandle, Props>(function AttendanceCharts({ studentAnalytics, dateAnalytics, arabicMode = false, visibleTabs }, ref) {
  const [activeTab, setActiveTab] = useState<ChartTab>('trend');

  // i18n
  const ar = arabicMode;
  const t = {
    trend:           ar ? '\u0645\u0633\u0627\u0631 \u0627\u0644\u062D\u0636\u0648\u0631' : 'Attendance Trend',
    distribution:    ar ? '\u062A\u0648\u0632\u064A\u0639 \u0627\u0644\u062D\u0627\u0644\u0627\u062A' : 'Status Distribution',
    performance:     ar ? '\u062F\u0631\u062C\u0627\u062A \u0627\u0644\u0637\u0644\u0627\u0628' : 'Student Scores',
    radar:           ar ? '\u0631\u0627\u062F\u0627\u0631 \u0627\u0644\u0641\u0635\u0644' : 'Class Radar',
    lateness:        ar ? '\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u062A\u0623\u062E\u0631' : 'Late Analysis',
    comparison:      ar ? '\u0627\u0644\u0645\u0639\u062F\u0644 \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u062F\u0631\u062C\u0629' : 'Rate vs Score',
    specialization:  ar ? '\u0627\u0644\u062A\u062E\u0635\u0635\u0627\u062A' : 'Specializations',
    present:         ar ? '\u062D\u0627\u0636\u0631' : 'Present',
    late:            ar ? '\u0645\u062A\u0623\u062E\u0631' : 'Late',
    absent:          ar ? '\u063A\u0627\u0626\u0628' : 'Absent',
    excused:         ar ? '\u0645\u0639\u0630\u0648\u0631' : 'Excused',
    onTime:          ar ? '\u0641\u064A \u0627\u0644\u0648\u0642\u062A' : 'On Time',
    attendancePct:   ar ? '\u0646\u0633\u0628\u0629 \u0627\u0644\u062D\u0636\u0648\u0631 %' : 'Attendance %',
    avg:             ar ? '\u0627\u0644\u0645\u062A\u0648\u0633\u0637' : 'Avg',
    score:           ar ? '\u0627\u0644\u062F\u0631\u062C\u0629' : 'Score',
    punctualityPct:  ar ? '\u0646\u0633\u0628\u0629 \u0627\u0644\u0627\u0646\u0636\u0628\u0627\u0637 %' : 'Punctuality %',
    lateCount:       ar ? '\u0639\u062F\u062F \u0627\u0644\u0645\u062A\u0623\u062E\u0631\u064A\u0646' : 'Late Count',
    avgLateMin:      ar ? '\u0645\u062A\u0648\u0633\u0637 \u062F\u0642\u0627\u0626\u0642 \u0627\u0644\u062A\u0623\u062E\u0631' : 'Avg Late Min',
    attendanceLabel: ar ? '\u0627\u0644\u062D\u0636\u0648\u0631 %' : 'Attendance %',
    weightedScore:   ar ? '\u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u0631\u062C\u062D\u0629' : 'Weighted Score',
    noData:          ar ? '\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0644\u0647\u0630\u0627 \u0627\u0644\u0631\u0633\u0645' : 'No data available for this chart',
    noPunctuality:   ar ? '\u0644\u0627 \u062A\u0623\u062E\u0631 \u0645\u0633\u062C\u0644 \u2014 \u0627\u0646\u0636\u0628\u0627\u0637 \u0645\u0645\u062A\u0627\u0632!' : 'No late arrivals recorded \u2014 perfect punctuality!',
    topStudents:     (n: number) => ar ? `\u0623\u0639\u0644\u0649 ${n} \u0637\u0644\u0627\u0628 \u0628\u062D\u0633\u0628 \u0627\u0644\u062F\u0631\u062C\u0629 \u0627\u0644\u0645\u0631\u062C\u062D\u0629` : `Top ${n} students by weighted score`,
    eachDot:         ar ? '\u0643\u0644 \u0646\u0642\u0637\u0629 \u062A\u0645\u062B\u0644 \u0637\u0627\u0644\u0628\u0627\u064B. \u0645\u0631\u0631 \u0627\u0644\u0641\u0623\u0631\u0629 \u0644\u0639\u0631\u0636 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644.' : 'Each dot is a student. Hover to see details.',
    classAvg:        ar ? '\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0641\u0635\u0644' : 'Class Average',
    specAttendance:  ar ? '\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062D\u0636\u0648\u0631 %' : 'Avg Attendance %',
    specScore:       ar ? '\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062F\u0631\u062C\u0629' : 'Avg Score',
    specStudents:    ar ? '\u0639\u062F\u062F \u0627\u0644\u0637\u0644\u0627\u0628' : 'Students',
    specHeader:      ar ? '\u0627\u0644\u062D\u0636\u0648\u0631 \u0648\u0627\u0644\u0623\u062F\u0627\u0621 \u062D\u0633\u0628 \u0627\u0644\u062A\u062E\u0635\u0635' : 'Attendance & Performance by Specialization',
    specDesc:        ar ? '\u0645\u0642\u0627\u0631\u0646\u0629 \u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062D\u0636\u0648\u0631 \u0648\u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0644\u0643\u0644 \u062A\u062E\u0635\u0635' : 'Compare average attendance rates and scores across specializations',
    attendance:      ar ? '\u0627\u0644\u062D\u0636\u0648\u0631' : 'Attendance',
    punctuality:     ar ? '\u0627\u0644\u0627\u0646\u0636\u0628\u0627\u0637' : 'Punctuality',
    consistency:     ar ? '\u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0645' : 'Consistency',
    hostLabel:       ar ? '\u0627\u0644\u0645\u0648\u0642\u0639' : 'Host',
    topSpec:         ar ? '\u0627\u0644\u062A\u062E\u0635\u0635 \u0627\u0644\u0623\u0643\u062B\u0631' : 'Top Specialization',
    sessions:        ar ? '\u062C\u0644\u0633\u0627\u062A' : 'Sessions',
    breakdown:       ar ? '\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644' : 'Breakdown',
    hostSpecTitle:   ar ? '\u0627\u0644\u062A\u062E\u0635\u0635 \u0627\u0644\u0633\u0627\u0626\u062F \u0644\u0643\u0644 \u0645\u0648\u0642\u0639 \u0627\u0633\u062A\u0636\u0627\u0641\u0629' : 'Dominant Specialization per Host Location',
  };

  const CHART_TABS: { id: ChartTab; label: string; icon: string }[] = [
    { id: 'trend',          label: t.trend,          icon: '📈' },
    { id: 'specialization', label: t.specialization, icon: '🎓' },
    { id: 'distribution',   label: t.distribution,   icon: '🍩' },
    { id: 'performance',    label: t.performance,    icon: '🏆' },
    { id: 'radar',          label: t.radar,          icon: '🎯' },
    { id: 'lateness',       label: t.lateness,       icon: '⏰' },
    { id: 'comparison',     label: t.comparison,     icon: '⚡' },
  ];

  // Only show tabs that are in visibleTabs prop (if provided); empty Set = treat as "all visible"
  const visibleChartTabs = visibleTabs && visibleTabs.size > 0
    ? CHART_TABS.filter(tab => visibleTabs.has(tab.id))
    : CHART_TABS;

  // Auto-switch active tab when the current one becomes hidden
  useEffect(() => {
    if (visibleChartTabs.length > 0 && !visibleChartTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(visibleChartTabs[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs]);

  const statusColors = [
    { label: t.onTime,  color: COLORS.present },
    { label: t.late,    color: COLORS.late },
    { label: t.absent,  color: COLORS.absent },
    { label: t.excused, color: COLORS.excused },
  ];

  // Memoized chart data
  const trendData = useMemo(() => {
    const held = dateAnalytics.filter(d => !d.isSessionNotHeld);
    return held.map((d, idx) => {
      const dt = new Date(d.date);
      return {
        name: `${dt.getMonth() + 1}/${dt.getDate()}`,
        [t.attendancePct]: Math.round(d.attendanceRate),
        [t.late]: d.lateCount,
        [t.absent]: d.unexcusedAbsentCount,
        [t.avg]: Math.round(held.slice(0, idx + 1).reduce((s, x) => s + x.attendanceRate, 0) / (idx + 1)),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateAnalytics, arabicMode]);

  const statusDistribution = useMemo(() => {
    const totals = studentAnalytics.reduce(
      (acc, s) => ({
        present: acc.present + s.presentCount,
        late: acc.late + s.lateCount,
        absent: acc.absent + s.absentCount,
        excused: acc.excused + s.excusedCount,
      }),
      { present: 0, late: 0, absent: 0, excused: 0 }
    );
    return [
      { name: t.onTime,  value: totals.present - totals.late, fill: COLORS.present },
      { name: t.late,    value: totals.late,                  fill: COLORS.late },
      { name: t.absent,  value: totals.absent,                fill: COLORS.absent },
      { name: t.excused, value: totals.excused,               fill: COLORS.excused },
    ].filter(d => d.value > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const performanceData = useMemo(() => {
    return [...studentAnalytics]
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 15)
      .map(s => ({
        name: s.student_name.length > 12 ? s.student_name.substring(0, 12) + '\u2026' : s.student_name,
        [t.score]: Math.round(s.weightedScore),
        [t.attendanceLabel]: Math.round(s.attendanceRate),
        [t.punctualityPct]: Math.round(s.punctualityRate),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const radarData = useMemo(() => {
    if (studentAnalytics.length === 0) return [];
    const avg = (field: keyof StudentAnalytics) => {
      const vals = studentAnalytics.map(s => { const v = s[field]; return typeof v === 'number' ? v : 0; });
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return [
      { metric: t.attendance,  value: avg('attendanceRate'),   fullMark: 100 },
      { metric: t.punctuality, value: avg('punctualityRate'),  fullMark: 100 },
      { metric: t.consistency, value: avg('consistencyIndex'), fullMark: 100 },
      { metric: t.score,       value: avg('weightedScore'),    fullMark: 100 },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const latenessData = useMemo(() => {
    return dateAnalytics.filter(d => !d.isSessionNotHeld && d.lateCount > 0).map(d => {
      const dt = new Date(d.date);
      return {
        name: `${dt.getMonth() + 1}/${dt.getDate()}`,
        [t.lateCount]: d.lateCount,
        [t.avgLateMin]: Math.round(d.avgLateMinutes),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateAnalytics, arabicMode]);

  const scatterData = useMemo(() =>
    studentAnalytics.map(s => ({
      name: s.student_name,
      [t.attendanceLabel]: Math.round(s.attendanceRate),
      [t.weightedScore]: Math.round(s.weightedScore),
      [t.punctualityPct]: Math.round(s.punctualityRate),
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [studentAnalytics, arabicMode]);

  // Specialization analytics
  const unspecLabel = ar ? '\u063A\u064A\u0631 \u0645\u062D\u062F\u062F' : 'Unspecified';
  const specData = useMemo(
    () => computeSpecializationAnalytics(studentAnalytics, unspecLabel),
    [studentAnalytics, unspecLabel]
  );

  // Host x Specialization affinity from dateAnalytics
  const hostSpecData = useMemo(() => {
    const hostMap = new Map<string, Map<string, number>>();
    dateAnalytics.forEach(d => {
      if (!d.hostAddress || d.isSessionNotHeld || d.hostAddress === 'SESSION_NOT_HELD') return;
      if (!d.topSpecialization) return;
      const host = d.hostAddress.length > 28 ? d.hostAddress.substring(0, 28) + '\u2026' : d.hostAddress;
      if (!hostMap.has(host)) hostMap.set(host, new Map());
      const sm = hostMap.get(host)!;
      sm.set(d.topSpecialization, (sm.get(d.topSpecialization) || 0) + 1);
    });
    return Array.from(hostMap.entries()).map(([host, sm]) => {
      const sorted = [...sm.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      return { host, topSpec: top?.[0] ?? '-', topSpecCount: top?.[1] ?? 0, breakdown: sorted.map(([s, c]) => `${s}(${c})`).join(', ') };
    }).sort((a, b) => b.topSpecCount - a.topSpecCount);
  }, [dateAnalytics]);

  // Chart container refs for image capture
  const chartRefs = useRef<Record<ChartTab, HTMLDivElement | null>>({
    trend: null, distribution: null, performance: null,
    radar: null, lateness: null, comparison: null, specialization: null,
  });

  // Capture charts as PNG images using html-to-image
  const captureCharts = useCallback(async (tabs: ChartTab[]): Promise<Map<ChartTab, string>> => {
    const { toPng } = await import('html-to-image');
    const result = new Map<ChartTab, string>();
    for (const tab of tabs) {
      const el = chartRefs.current[tab];
      if (!el) continue;
      try {
        const dataUrl = await toPng(el, {
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          style: { padding: '16px' },
        });
        result.set(tab, dataUrl);
      } catch { /* skip failed charts */ }
    }
    return result;
  }, []);

  useImperativeHandle(ref, () => ({ captureCharts }), [captureCharts]);

  if (studentAnalytics.length === 0 && dateAnalytics.length === 0) return null;

  // If all charts are deselected, show a placeholder
  if (visibleChartTabs.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 border border-gray-100 dark:border-gray-700 overflow-hidden p-8 text-center">
        <div className="text-3xl mb-3">📊</div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {arabicMode ? 'لم يتم تحديد أي رسوم بيانية — استخدم "تضمين الرسوم البيانية" أعلاه لتفعيلها' : 'No charts selected — use "Include Charts" above to enable them'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Tab Bar — only shows visible/selected chart tabs */}
      <div className="flex overflow-x-auto gap-1 px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700 scrollbar-hide">
        {visibleChartTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Chart Area */}
      <div className="p-4 sm:p-6 relative" dir={ar ? 'rtl' : 'ltr'}>

        {/* 1. Attendance Trend */}
        <div ref={el => { chartRefs.current.trend = el; }} style={activeTab !== 'trend' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
        {trendData.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              {statusColors.map(s => (
                <span key={s.label} className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={trendData}>
                <defs>
                  <linearGradient id="attendanceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey={t.attendancePct} stroke={COLORS.primary} fill="url(#attendanceGrad)" strokeWidth={2.5} dot={{ r: 3, fill: COLORS.primary }} activeDot={{ r: 6, strokeWidth: 2 }} />
                <Line type="monotone" dataKey={t.avg} stroke={COLORS.accent} strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Bar dataKey={t.late} fill={COLORS.late} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
                <Bar dataKey={t.absent} fill={COLORS.absent} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>

        {/* 2. Specialization */}
        <div ref={el => { chartRefs.current.specialization = el; }} style={activeTab !== 'specialization' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{'\uD83C\uDF93'} {t.specHeader}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.specDesc}</p>
            </div>

            {specData.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <span className="text-3xl block mb-2">{'\uD83C\uDF93'}</span>
                <p className="text-sm">{t.noData}</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {specData.map((spec, idx) => {
                    const rateColor = spec.avgAttendanceRate >= 80 ? 'text-green-600 dark:text-green-400'
                      : spec.avgAttendanceRate >= 60 ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400';
                    return (
                      <div key={spec.specialization} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 border border-gray-200 dark:border-gray-600">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[80%]">{spec.specialization}</span>
                          <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}>
                            {spec.studentCount}
                          </span>
                        </div>
                        <div className={`text-xl font-bold ${rateColor}`}>{spec.avgAttendanceRate}%</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t.specAttendance}</div>
                        <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${spec.avgAttendanceRate}%`, backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{t.score}: {spec.avgScore}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Bar chart */}
                <ResponsiveContainer width="100%" height={Math.max(220, specData.length * 44)}>
                  <BarChart data={specData} layout="vertical" margin={{ left: 10, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="specialization" tick={{ fontSize: 10 }} stroke="#9ca3af" width={100} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="avgAttendanceRate" name={t.specAttendance} radius={[0, 6, 6, 0]} barSize={18}>
                      {specData.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="avgScore" name={t.specScore} fill={COLORS.secondary} radius={[0, 6, 6, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Host x Specialization */}
                {hostSpecData.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {'\uD83C\uDFE0'} {t.hostSpecTitle}
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{t.hostLabel}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{t.topSpec}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{t.sessions}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{t.breakdown}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {hostSpecData.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium max-w-[180px] truncate" title={row.host}>{row.host}</td>
                              <td className="px-3 py-2">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}>
                                  {row.topSpec}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-mono">{row.topSpecCount}</td>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-500 max-w-[260px] truncate" title={row.breakdown}>{row.breakdown}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 3. Status Distribution */}
        <div ref={el => { chartRefs.current.distribution = el; }} style={activeTab !== 'distribution' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
        {statusDistribution.length > 0 && (
          <div className="flex flex-col md:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={3} dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}>
                  {statusDistribution.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-3 min-w-[200px]">
              {statusDistribution.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.fill }} />
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.name}</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        {/* 4. Student Performance */}
        <div ref={el => { chartRefs.current.performance = el; }} style={activeTab !== 'performance' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
        {performanceData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t.topStudents(performanceData.length)}</p>
            <ResponsiveContainer width="100%" height={Math.max(300, performanceData.length * 28)}>
              <BarChart data={performanceData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey={t.score} fill={COLORS.primary} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey={t.attendanceLabel} fill={COLORS.present} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey={t.punctualityPct} fill={COLORS.secondary} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>

        {/* 5. Class Radar */}
        <div ref={el => { chartRefs.current.radar = el; }} style={activeTab !== 'radar' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
        {radarData.length > 0 && (
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar name={t.classAvg} dataKey="value" stroke={COLORS.primary} fill={COLORS.primary} fillOpacity={0.3} strokeWidth={2} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 w-full max-w-lg">
              {radarData.map(d => (
                <div key={d.metric} className="text-center bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{d.metric}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{d.value}%</p>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        {/* 6. Lateness Analysis */}
        <div ref={el => { chartRefs.current.lateness = el; }} style={activeTab !== 'lateness' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
          <div>
            {latenessData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={latenessData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey={t.lateCount} fill={COLORS.late} radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey={t.avgLateMin} fill={COLORS.accent} radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <span className="text-4xl block mb-2">{'\uD83C\uDF89'}</span>
                <p className="text-sm">{t.noPunctuality}</p>
              </div>
            )}
          </div>
        </div>

        {/* 7. Rate vs Score */}
        <div ref={el => { chartRefs.current.comparison = el; }} style={activeTab !== 'comparison' ? { position: 'absolute', left: '-9999px', width: '800px' } : undefined}>
        {scatterData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t.eachDot}</p>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={scatterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} />
                <XAxis dataKey={t.attendanceLabel} type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name={t.attendanceLabel} />
                <YAxis dataKey={t.weightedScore} type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name={t.weightedScore} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Record<string, unknown>;
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">{String(d.name)}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{t.attendanceLabel}: {String(d[t.attendanceLabel])}%</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{t.score}: {String(d[t.weightedScore])}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{t.punctualityPct}: {String(d[t.punctualityPct])}%</p>
                    </div>
                  );
                }} />
                <Scatter dataKey={t.weightedScore} fill={COLORS.primary} r={6} fillOpacity={0.7} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>

        {/* Empty state */}
        {(
          (activeTab === 'trend' && trendData.length === 0) ||
          (activeTab === 'distribution' && statusDistribution.length === 0) ||
          (activeTab === 'performance' && performanceData.length === 0) ||
          (activeTab === 'radar' && radarData.length === 0) ||
          (activeTab === 'comparison' && scatterData.length === 0)
        ) && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <span className="text-4xl block mb-2">{'\uD83D\uDCED'}</span>
            <p className="text-sm">{t.noData}</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default AttendanceCharts;