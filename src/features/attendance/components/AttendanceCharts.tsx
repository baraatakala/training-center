import { useMemo, useState } from 'react';
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

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  trend: { classification: string };
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

interface Props {
  studentAnalytics: StudentAnalytics[];
  dateAnalytics: DateAnalytics[];
  arabicMode?: boolean;
}

// â”€â”€â”€ Colors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Custom Tooltip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl backdrop-blur-sm">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-600 dark:text-gray-400">{entry.name}:</span>
          <span className="font-bold text-gray-900 dark:text-white">{typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function AttendanceCharts({ studentAnalytics, dateAnalytics, arabicMode = false }: Props) {
  // Dynamic tab ids â€” must include specialization
  type ChartTab = 'trend' | 'distribution' | 'performance' | 'radar' | 'lateness' | 'comparison' | 'specialization';
  const [activeTab, setActiveTab] = useState<ChartTab>('trend');

  // i18n labels
  const i = arabicMode ? {
    trend: 'Ù…Ø³Ø§Ø± Ø§Ù„Ø­Ø¶ÙˆØ±',
    distribution: 'ØªÙˆØ²ÙŠØ¹ Ø§Ù„Ø­Ø§Ù„Ø§Øª',
    performance: 'Ø¯Ø±Ø¬Ø§Øª Ø§Ù„Ø·Ù„Ø§Ø¨',
    radar: 'Ø±Ø§Ø¯Ø§Ø± Ø§Ù„ÙØµÙ„',
    lateness: 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„ØªØ£Ø®Ø±',
    comparison: 'Ø§Ù„Ù…Ø¹Ø¯Ù„ Ù…Ù‚Ø§Ø¨Ù„ Ø§Ù„Ø¯Ø±Ø¬Ø©',
    specialization: 'Ø§Ù„ØªØ®ØµØµØ§Øª',
    present: 'Ø­Ø§Ø¶Ø±',
    late: 'Ù…ØªØ£Ø®Ø±',
    absent: 'ØºØ§Ø¦Ø¨',
    excused: 'Ù…Ø¹Ø°ÙˆØ±',
    onTime: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª',
    attendancePct: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø­Ø¶ÙˆØ± %',
    avg: 'Ø§Ù„Ù…ØªÙˆØ³Ø·',
    score: 'Ø§Ù„Ø¯Ø±Ø¬Ø©',
    punctualityPct: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ù†Ø¶Ø¨Ø§Ø· %',
    lateCount: 'Ø¹Ø¯Ø¯ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†',
    avgLateMin: 'Ù…ØªÙˆØ³Ø· Ø¯Ù‚Ø§Ø¦Ù‚ Ø§Ù„ØªØ£Ø®Ø±',
    attendancePctLabel: 'Ø§Ù„Ø­Ø¶ÙˆØ± %',
    weightedScore: 'Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…Ø±Ø¬Ø­Ø©',
    noData: 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ù„Ù‡Ø°Ø§ Ø§Ù„Ø±Ø³Ù…',
    noPunctuality: 'ðŸŽ‰ Ù„Ø§ ØªØ£Ø®Ø± Ù…Ø³Ø¬Ù„ â€” Ø§Ù†Ø¶Ø¨Ø§Ø· Ù…Ù…ØªØ§Ø²!',
    topStudents: (n: number) => `Ø£Ø¹Ù„Ù‰ ${n} Ø·Ù„Ø§Ø¨ Ø¨Ø­Ø³Ø¨ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…Ø±Ø¬Ø­Ø©`,
    eachDot: 'ÙƒÙ„ Ù†Ù‚Ø·Ø© ØªÙ…Ø«Ù„ Ø·Ø§Ù„Ø¨Ø§Ù‹. Ù…Ø±Ø± Ø§Ù„ÙØ£Ø±Ø© Ù„Ø¹Ø±Ø¶ Ø§Ù„ØªÙØ§ØµÙŠÙ„.',
    classAvg: 'Ù…ØªÙˆØ³Ø· Ø§Ù„ÙØµÙ„',
    specAttendance: 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ø­Ø¶ÙˆØ± %',
    specScore: 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ø¯Ø±Ø¬Ø©',
    specStudents: 'Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨',
    specHeader: 'ðŸŽ“ Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„Ø£Ø¯Ø§Ø¡ Ø­Ø³Ø¨ Ø§Ù„ØªØ®ØµØµ',
    specDesc: 'Ù…Ù‚Ø§Ø±Ù†Ø© Ù…ØªÙˆØ³Ø· Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„Ù†ØªØ§Ø¦Ø¬ Ù„ÙƒÙ„ ØªØ®ØµØµ',
    attendance: 'Ø§Ù„Ø­Ø¶ÙˆØ±',
    punctuality: 'Ø§Ù„Ø§Ù†Ø¶Ø¨Ø§Ø·',
    consistency: 'Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…',
  } : {
    trend: 'Attendance Trend',
    distribution: 'Status Distribution',
    performance: 'Student Scores',
    radar: 'Class Radar',
    lateness: 'Late Analysis',
    comparison: 'Rate vs Score',
    specialization: 'Specializations',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    excused: 'Excused',
    onTime: 'On Time',
    attendancePct: 'Attendance %',
    avg: 'Avg',
    score: 'Score',
    punctualityPct: 'Punctuality %',
    lateCount: 'Late Count',
    avgLateMin: 'Avg Late Min',
    attendancePctLabel: 'Attendance %',
    weightedScore: 'Weighted Score',
    noData: 'No data available for this chart',
    noPunctuality: 'ðŸŽ‰ No late arrivals recorded â€” perfect punctuality!',
    topStudents: (n: number) => `Top ${n} students by weighted score`,
    eachDot: 'Each dot is a student. Hover to see details.',
    classAvg: 'Class Average',
    specAttendance: 'Avg Attendance %',
    specScore: 'Avg Score',
    specStudents: 'Students',
    specHeader: 'ðŸŽ“ Attendance & Performance by Specialization',
    specDesc: 'Compare average attendance rates and scores across specializations',
    attendance: 'Attendance',
    punctuality: 'Punctuality',
    consistency: 'Consistency',
  };

  const CHART_TABS: { id: ChartTab; label: string; icon: string }[] = [
    { id: 'trend',           label: i.trend,           icon: 'ðŸ“ˆ' },
    { id: 'specialization',  label: i.specialization,  icon: 'ðŸŽ“' },
    { id: 'distribution',   label: i.distribution,    icon: 'ðŸ©' },
    { id: 'performance',    label: i.performance,     icon: 'ðŸ†' },
    { id: 'radar',          label: i.radar,           icon: 'ðŸŽ¯' },
    { id: 'lateness',       label: i.lateness,        icon: 'â°' },
    { id: 'comparison',     label: i.comparison,      icon: 'âš¡' },
  ];

  const statusColors = [
    { label: i.onTime,   color: COLORS.present },
    { label: i.late,     color: COLORS.late },
    { label: i.absent,   color: COLORS.absent },
    { label: i.excused,  color: COLORS.excused },
  ];

  // â”€â”€ Memoized Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const trendData = useMemo(() => {
    const heldDates = dateAnalytics.filter(d => !d.isSessionNotHeld);
    return heldDates.map((d, idx) => {
      const dateObj = new Date(d.date);
      return {
        name: `${dateObj.getMonth() + 1}/${dateObj.getDate()}`,
        [i.attendancePct]: Math.round(d.attendanceRate),
        [i.late]: d.lateCount,
        [i.absent]: d.unexcusedAbsentCount,
        [i.avg]: Math.round(heldDates.slice(0, idx + 1).reduce((s, x) => s + x.attendanceRate, 0) / (idx + 1)),
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
      { name: i.onTime,   value: totals.present - totals.late, fill: COLORS.present },
      { name: i.late,     value: totals.late,                  fill: COLORS.late },
      { name: i.absent,   value: totals.absent,                fill: COLORS.absent },
      { name: i.excused,  value: totals.excused,               fill: COLORS.excused },
    ].filter(d => d.value > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const performanceData = useMemo(() => {
    return [...studentAnalytics]
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 15)
      .map(s => ({
        name: s.student_name.length > 12 ? s.student_name.substring(0, 12) + 'â€¦' : s.student_name,
        [i.score]: Math.round(s.weightedScore),
        [i.attendancePctLabel]: Math.round(s.attendanceRate),
        [i.punctualityPct]: Math.round(s.punctualityRate),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const radarData = useMemo(() => {
    if (studentAnalytics.length === 0) return [];
    const avg = (field: keyof StudentAnalytics) => {
      const vals = studentAnalytics.map(s => {
        const v = s[field];
        return typeof v === 'number' ? v : 0;
      });
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return [
      { metric: i.attendance,   value: avg('attendanceRate'),   fullMark: 100 },
      { metric: i.punctuality,  value: avg('punctualityRate'),  fullMark: 100 },
      { metric: i.consistency,  value: avg('consistencyIndex'), fullMark: 100 },
      { metric: i.score,        value: avg('weightedScore'),    fullMark: 100 },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  const latenessData = useMemo(() => {
    return dateAnalytics.filter(d => !d.isSessionNotHeld && d.lateCount > 0).map(d => {
      const dateObj = new Date(d.date);
      return {
        name: `${dateObj.getMonth() + 1}/${dateObj.getDate()}`,
        [i.lateCount]: d.lateCount,
        [i.avgLateMin]: Math.round(d.avgLateMinutes),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateAnalytics, arabicMode]);

  const scatterData = useMemo(() => {
    return studentAnalytics.map(s => ({
      name: s.student_name,
      [i.attendancePctLabel]: Math.round(s.attendanceRate),
      [i.weightedScore]: Math.round(s.weightedScore),
      [i.punctualityPct]: Math.round(s.punctualityRate),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAnalytics, arabicMode]);

  // â”€â”€ Specialization Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Derived entirely from studentAnalytics â€” no extra data needed
  const specializationData = useMemo(() => {
    const map = new Map<string, { students: StudentAnalytics[] }>();
    studentAnalytics.forEach(s => {
      const spec = s.specialization?.trim() || (arabicMode ? 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯' : 'Unspecified');
      if (!map.has(spec)) map.set(spec, { students: [] });
      map.get(spec)!.students.push(s);
    });
    return Array.from(map.entries())
      .map(([spec, { students }]) => {
        const n = students.length;
        const avgRate = Math.round(students.reduce((s, x) => s + x.attendanceRate, 0) / n * 10) / 10;
        const avgScore = Math.round(students.reduce((s, x) => s + x.weightedScore, 0) / n * 10) / 10;
        const totalPresent = students.reduce((s, x) => s + x.presentCount, 0);
        const totalLate = students.reduce((s, x) => s + x.lateCount, 0);
        const totalAbsent = students.reduce((s, x) => s + x.absentCount, 0);
        return {
          specialization: spec,
          studentCount: n,
          avgAttendanceRate: avgRate,
          avgScore,
          totalPresent,
          totalLate,
          totalAbsent,
        };
      })
      .sort((a, b) => b.avgAttendanceRate - a.avgAttendanceRate);
  }, [studentAnalytics, arabicMode]);

  // â”€â”€ Host Ã— Specialization affinity (from dateAnalytics topSpecialization) â”€â”€
  const hostSpecData = useMemo(() => {
    const hostMap = new Map<string, Map<string, number>>();
    dateAnalytics.forEach(d => {
      if (!d.hostAddress || d.isSessionNotHeld || d.hostAddress === 'SESSION_NOT_HELD') return;
      if (!d.topSpecialization) return;
      const host = d.hostAddress.length > 28 ? d.hostAddress.substring(0, 28) + 'â€¦' : d.hostAddress;
      if (!hostMap.has(host)) hostMap.set(host, new Map());
      const specMap = hostMap.get(host)!;
      specMap.set(d.topSpecialization, (specMap.get(d.topSpecialization) || 0) + 1);
    });
    return Array.from(hostMap.entries()).map(([host, specMap]) => {
      const sorted = [...specMap.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      return {
        host,
        topSpec: top?.[0] ?? '-',
        topSpecCount: top?.[1] ?? 0,
        breakdown: sorted.map(([s, c]) => `${s}(${c})`).join(', '),
      };
    }).sort((a, b) => b.topSpecCount - a.topSpecCount);
  }, [dateAnalytics]);

  if (studentAnalytics.length === 0 && dateAnalytics.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Tab Bar â€” no redundant inner header; the parent section already labels this */}
      <div className="flex overflow-x-auto gap-1 px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700 scrollbar-hide">
        {CHART_TABS.map(tab => (
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
      <div className="p-4 sm:p-6" dir={arabicMode ? 'rtl' : 'ltr'}>

        {/* 1. Attendance Trend */}
        {activeTab === 'trend' && trendData.length > 0 && (
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
                <Area type="monotone" dataKey={i.attendancePct} stroke={COLORS.primary} fill="url(#attendanceGrad)" strokeWidth={2.5} dot={{ r: 3, fill: COLORS.primary }} activeDot={{ r: 6, strokeWidth: 2 }} />
                <Line type="monotone" dataKey={i.avg} stroke={COLORS.accent} strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Bar dataKey={i.late} fill={COLORS.late} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
                <Bar dataKey={i.absent} fill={COLORS.absent} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 2. Specialization Tab â€” two panels */}
        {activeTab === 'specialization' && (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{i.specHeader}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{i.specDesc}</p>
            </div>

            {specializationData.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <span className="text-3xl block mb-2">ðŸŽ“</span>
                <p className="text-sm">{i.noData}</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {specializationData.map((spec, idx) => {
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
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{i.specAttendance}</div>
                        <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${spec.avgAttendanceRate}%`, backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{i.score}: {spec.avgScore}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Bar chart: avg attendance rate per specialization */}
                <ResponsiveContainer width="100%" height={Math.max(220, specializationData.length * 44)}>
                  <BarChart data={specializationData} layout="vertical" margin={{ left: 10, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="specialization" tick={{ fontSize: 10 }} stroke="#9ca3af" width={100} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="avgAttendanceRate" name={i.specAttendance} radius={[0, 6, 6, 0]} barSize={18}>
                      {specializationData.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="avgScore" name={i.specScore} fill={COLORS.secondary} radius={[0, 6, 6, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Host Ã— Specialization affinity table */}
                {hostSpecData.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {arabicMode ? 'ðŸ  Ø§Ù„ØªØ®ØµØµ Ø§Ù„Ø³Ø§Ø¦Ø¯ Ù„ÙƒÙ„ Ù…ÙˆÙ‚Ø¹ Ø§Ø³ØªØ¶Ø§ÙØ©' : 'ðŸ  Dominant Specialization per Host Location'}
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{arabicMode ? 'Ø§Ù„Ù…ÙˆÙ‚Ø¹' : 'Host'}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{arabicMode ? 'Ø§Ù„ØªØ®ØµØµ Ø§Ù„Ø£ÙƒØ«Ø±' : 'Top Specialization'}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{arabicMode ? 'Ø¬Ù„Ø³Ø§Øª' : 'Sessions'}</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{arabicMode ? 'Ø§Ù„ØªÙØ§ØµÙŠÙ„' : 'Breakdown'}</th>
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
        )}

        {/* 3. Status Distribution */}
        {activeTab === 'distribution' && statusDistribution.length > 0 && (
          <div className="flex flex-col md:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
                >
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

        {/* 4. Student Performance */}
        {activeTab === 'performance' && performanceData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{i.topStudents(performanceData.length)}</p>
            <ResponsiveContainer width="100%" height={Math.max(300, performanceData.length * 28)}>
              <BarChart data={performanceData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey={i.score} fill={COLORS.primary} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey={i.attendancePctLabel} fill={COLORS.present} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey={i.punctualityPct} fill={COLORS.secondary} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 5. Class Radar */}
        {activeTab === 'radar' && radarData.length > 0 && (
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar
                  name={i.classAvg}
                  dataKey="value"
                  stroke={COLORS.primary}
                  fill={COLORS.primary}
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
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

        {/* 6. Lateness Analysis */}
        {activeTab === 'lateness' && (
          <div>
            {latenessData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={latenessData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey={i.lateCount} fill={COLORS.late} radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey={i.avgLateMin} fill={COLORS.accent} radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <span className="text-4xl block mb-2">ðŸŽ‰</span>
                <p className="text-sm">{i.noPunctuality}</p>
              </div>
            )}
          </div>
        )}

        {/* 7. Rate vs Score (Scatter) */}
        {activeTab === 'comparison' && scatterData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{i.eachDot}</p>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={scatterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} />
                <XAxis dataKey={i.attendancePctLabel} type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name={i.attendancePctLabel} />
                <YAxis dataKey={i.weightedScore} type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name={i.weightedScore} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">{d.name}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{i.attendancePctLabel}: {d[i.attendancePctLabel]}%</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{i.score}: {d[i.weightedScore]}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{i.punctualityPct}: {d[i.punctualityPct]}%</p>
                    </div>
                  );
                }} />
                <Scatter dataKey={i.weightedScore} fill={COLORS.primary} r={6} fillOpacity={0.7} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Empty state */}
        {(
          (activeTab === 'trend' && trendData.length === 0) ||
          (activeTab === 'distribution' && statusDistribution.length === 0) ||
          (activeTab === 'performance' && performanceData.length === 0) ||
          (activeTab === 'radar' && radarData.length === 0) ||
          (activeTab === 'comparison' && scatterData.length === 0)
        ) && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <span className="text-4xl block mb-2">ðŸ“­</span>
            <p className="text-sm">{i.noData}</p>
          </div>
        )}
      </div>
    </div>
  );
}

