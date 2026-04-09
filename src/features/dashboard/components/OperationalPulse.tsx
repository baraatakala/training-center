import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { dashboardService } from '@/features/dashboard/services/dashboardService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';

interface UpcomingSession {
  session_id: string;
  course_name: string;
  teacher_name: string;
  start_date: string;
  end_date: string;
  session_days: string;
  time: string;
  feedback_enabled: boolean;
  isToday: boolean;
}

interface PulseData {
  upcomingSessions: UpcomingSession[];
  todayStats: { total: number; onTime: number; late: number; absent: number };
  pendingExcuses: number;
}

export function OperationalPulse() {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await dashboardService.getOperationalPulse();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load);

  if (loading) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="grid grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const todaySessions = data.upcomingSessions.filter(s => s.isToday);
  const upcomingSessions = data.upcomingSessions.filter(s => !s.isToday);
  const today = new Date();
  const dayName = today.toLocaleDateString(undefined, { weekday: 'long' });
  const dateStr = today.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-5">
      {/* Section Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-sm">
            <span className="text-white text-sm">⚡</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Operational Pulse</h2>
            <p className="text-[11px] text-gray-400">{dayName}, {dateStr}</p>
          </div>
        </div>
      </div>

      {/* Today's Live Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
          <div className="absolute -right-3 -top-3 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Live Today</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{todaySessions.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">active sessions</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Check-Ins</p>
          <p className="text-2xl font-black text-gray-900 dark:text-white">{data.todayStats.total}</p>
          <div className="flex gap-1.5 mt-1">
            {data.todayStats.onTime > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full">{data.todayStats.onTime} on time</span>}
            {data.todayStats.late > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full">{data.todayStats.late} late</span>}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pending Excuses</p>
          <p className={`text-2xl font-black ${data.pendingExcuses > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>{data.pendingExcuses}</p>
          {data.pendingExcuses > 0 && (
            <Link to="/excuse-requests" className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold hover:underline mt-0.5 inline-block">
              Review →
            </Link>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Upcoming</p>
          <p className="text-2xl font-black text-purple-600 dark:text-purple-400">{upcomingSessions.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">this week</p>
        </div>
      </div>

      {/* Today's Sessions */}
      {todaySessions.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Today&apos;s Sessions</p>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {todaySessions.map(s => (
              <Link
                key={s.session_id}
                to={`/attendance?session=${s.session_id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.course_name}</p>
                  <p className="text-[11px] text-gray-400">{s.teacher_name}{s.time ? ` · ${s.time}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {s.feedback_enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 rounded-full">Feedback</span>
                  )}
                  <span className="text-xs text-gray-400">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Sessions (next 7 days) */}
      {upcomingSessions.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Upcoming This Week</p>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {upcomingSessions.slice(0, 5).map(s => (
              <div key={s.session_id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{s.course_name}</p>
                  <p className="text-[11px] text-gray-400">{s.teacher_name} · Starts {s.start_date}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full">{s.session_days}</span>
                </div>
              </div>
            ))}
            {upcomingSessions.length > 5 && (
              <div className="px-5 py-2 text-center">
                <Link to="/sessions" className="text-xs text-purple-600 dark:text-purple-400 font-semibold hover:underline">
                  View all {upcomingSessions.length} sessions →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {todaySessions.length === 0 && upcomingSessions.length === 0 && (
        <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-8 text-center">
          <span className="text-4xl block mb-3">📭</span>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">No Active Sessions</p>
          <p className="text-xs text-gray-400 mt-1">No sessions are scheduled for this week.</p>
        </div>
      )}
    </div>
  );
}
