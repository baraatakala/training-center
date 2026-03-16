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

// ─── Types ───────────────────────────────────────────────────
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
}

// ─── Colors ──────────────────────────────────────────────────
const COLORS = {
  present: '#22c55e',
  late: '#f59e0b',
  absent: '#ef4444',
  excused: '#6366f1',
  primary: '#8b5cf6',
  secondary: '#06b6d4',
  accent: '#f43f5e',
  gradient1: '#818cf8',
  gradient2: '#c084fc',
};

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#6366f1', '#06b6d4'];

const STATUS_COLORS = [
  { label: 'Present', color: COLORS.present },
  { label: 'Late', color: COLORS.late },
  { label: 'Absent', color: COLORS.absent },
  { label: 'Excused', color: COLORS.excused },
];

// ─── Chart Tabs ──────────────────────────────────────────────
const CHART_TABS = [
  { id: 'trend', label: 'Attendance Trend', icon: '📈' },
  { id: 'distribution', label: 'Status Distribution', icon: '🍩' },
  { id: 'performance', label: 'Student Scores', icon: '🏆' },
  { id: 'radar', label: 'Class Radar', icon: '🎯' },
  { id: 'lateness', label: 'Late Analysis', icon: '⏰' },
  { id: 'comparison', label: 'Rate vs Score', icon: '⚡' },
] as const;

type ChartTab = typeof CHART_TABS[number]['id'];

// ─── Custom Tooltip ──────────────────────────────────────────
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

// ─── Main Component ──────────────────────────────────────────
export default function AttendanceCharts({ studentAnalytics, dateAnalytics }: Props) {
  const [activeTab, setActiveTab] = useState<ChartTab>('trend');

  // ── Memoized Data ──────────────────────────────────────────
  const trendData = useMemo(() => {
    const heldDates = dateAnalytics.filter(d => !d.isSessionNotHeld);
    return heldDates.map((d, i) => {
      const dateObj = new Date(d.date);
      return {
        name: `${dateObj.getMonth() + 1}/${dateObj.getDate()}`,
        fullDate: d.date,
        'Attendance %': Math.round(d.attendanceRate),
        'Present': d.presentCount,
        'Late': d.lateCount,
        'Absent': d.unexcusedAbsentCount,
        'Excused': d.excusedAbsentCount,
        // Running average
        'Avg': Math.round(
          heldDates.slice(0, i + 1).reduce((s, x) => s + x.attendanceRate, 0) / (i + 1)
        ),
      };
    });
  }, [dateAnalytics]);

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
      { name: 'On Time', value: totals.present - totals.late, fill: COLORS.present },
      { name: 'Late', value: totals.late, fill: COLORS.late },
      { name: 'Absent', value: totals.absent, fill: COLORS.absent },
      { name: 'Excused', value: totals.excused, fill: COLORS.excused },
    ].filter(d => d.value > 0);
  }, [studentAnalytics]);

  const performanceData = useMemo(() => {
    return [...studentAnalytics]
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 15)
      .map(s => ({
        name: s.student_name.length > 12 ? s.student_name.substring(0, 12) + '…' : s.student_name,
        'Score': Math.round(s.weightedScore),
        'Attendance %': Math.round(s.attendanceRate),
        'Punctuality %': Math.round(s.punctualityRate),
      }));
  }, [studentAnalytics]);

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
      { metric: 'Attendance', value: avg('attendanceRate'), fullMark: 100 },
      { metric: 'Punctuality', value: avg('punctualityRate'), fullMark: 100 },
      { metric: 'Consistency', value: avg('consistencyIndex'), fullMark: 100 },
      { metric: 'Score', value: avg('weightedScore'), fullMark: 100 },
    ];
  }, [studentAnalytics]);

  const latenessData = useMemo(() => {
    const heldDates = dateAnalytics.filter(d => !d.isSessionNotHeld && d.lateCount > 0);
    return heldDates.map(d => {
      const dateObj = new Date(d.date);
      return {
        name: `${dateObj.getMonth() + 1}/${dateObj.getDate()}`,
        'Late Count': d.lateCount,
        'Avg Late Min': Math.round(d.avgLateMinutes),
        'Total Late Min': Math.round(d.totalLateMinutes),
      };
    });
  }, [dateAnalytics]);

  const scatterData = useMemo(() => {
    return studentAnalytics.map(s => ({
      name: s.student_name,
      'Attendance %': Math.round(s.attendanceRate),
      'Weighted Score': Math.round(s.weightedScore),
      'Punctuality %': Math.round(s.punctualityRate),
    }));
  }, [studentAnalytics]);

  if (studentAnalytics.length === 0 && dateAnalytics.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <span>📊</span> Interactive Analytics Charts
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Visual breakdown of attendance patterns and student performance
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex overflow-x-auto gap-1 px-4 pt-3 pb-1 border-b border-gray-100 dark:border-gray-700 scrollbar-hide">
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
      <div className="p-4 sm:p-6">
        {/* 1. Attendance Trend (Area + Line) */}
        {activeTab === 'trend' && trendData.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              {STATUS_COLORS.map(s => (
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
                <Area type="monotone" dataKey="Attendance %" stroke={COLORS.primary} fill="url(#attendanceGrad)" strokeWidth={2.5} dot={{ r: 3, fill: COLORS.primary }} activeDot={{ r: 6, strokeWidth: 2 }} />
                <Line type="monotone" dataKey="Avg" stroke={COLORS.accent} strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Bar dataKey="Late" fill={COLORS.late} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Absent" fill={COLORS.absent} opacity={0.6} barSize={8} radius={[2, 2, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 2. Status Distribution (Pie) */}
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
              {statusDistribution.map((item, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }} />
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.name}</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Student Performance (Bar) */}
        {activeTab === 'performance' && performanceData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Top {performanceData.length} students by weighted score
            </p>
            <ResponsiveContainer width="100%" height={Math.max(300, performanceData.length * 28)}>
              <BarChart data={performanceData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Score" fill={COLORS.primary} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey="Attendance %" fill={COLORS.present} radius={[0, 4, 4, 0]} barSize={14} />
                <Bar dataKey="Punctuality %" fill={COLORS.secondary} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 4. Class Radar */}
        {activeTab === 'radar' && radarData.length > 0 && (
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar
                  name="Class Average"
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

        {/* 5. Lateness Analysis */}
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
                  <Bar dataKey="Late Count" fill={COLORS.late} radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey="Avg Late Min" fill={COLORS.accent} radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <span className="text-4xl block mb-2">🎉</span>
                <p className="text-sm">No late arrivals recorded — perfect punctuality!</p>
              </div>
            )}
          </div>
        )}

        {/* 6. Attendance Rate vs Weighted Score (Scatter/Composed) */}
        {activeTab === 'comparison' && scatterData.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Each dot is a student. Hover to see details.
            </p>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={scatterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} />
                <XAxis dataKey="Attendance %" type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name="Attendance %" label={{ value: 'Attendance %', position: 'bottom', offset: -5, style: { fontSize: 11, fill: '#9ca3af' } }} />
                <YAxis dataKey="Weighted Score" type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" name="Weighted Score" label={{ value: 'Score', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9ca3af' } }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-3 shadow-xl">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">{d.name}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Attendance: {d['Attendance %']}%</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Score: {d['Weighted Score']}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Punctuality: {d['Punctuality %']}%</p>
                    </div>
                  );
                }} />
                <Scatter dataKey="Weighted Score" fill={COLORS.primary} r={6} fillOpacity={0.7} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Empty state */}
        {((activeTab === 'trend' && trendData.length === 0) ||
          (activeTab === 'distribution' && statusDistribution.length === 0) ||
          (activeTab === 'performance' && performanceData.length === 0) ||
          (activeTab === 'radar' && radarData.length === 0) ||
          (activeTab === 'comparison' && scatterData.length === 0)) && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <span className="text-4xl block mb-2">📭</span>
            <p className="text-sm">No data available for this chart</p>
          </div>
        )}
      </div>
    </div>
  );
}
