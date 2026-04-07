import { useMemo } from 'react';
import type { FeedbackStats } from '@/shared/types/database.types';

interface FeedbackKPICardsProps {
  stats: FeedbackStats | null;
  filteredTotal: number;
  filteredStudents: number;
  filteredAvg: number;
  responseRate: number;
  questionsUsed: number;
  latestDate: string | null;
  datesCovered: number;
}

export function FeedbackKPICards({
  filteredTotal,
  filteredStudents,
  filteredAvg,
  responseRate,
  questionsUsed,
  latestDate: _latestDate,
  datesCovered,
}: FeedbackKPICardsProps) {
  const ratingTrend = useMemo(() => {
    if (filteredAvg >= 4.5) return { icon: '🔥', label: 'Excellent', color: 'text-emerald-600 dark:text-emerald-400' };
    if (filteredAvg >= 3.5) return { icon: '📈', label: 'Good', color: 'text-blue-600 dark:text-blue-400' };
    if (filteredAvg >= 2.5) return { icon: '➡️', label: 'Average', color: 'text-amber-600 dark:text-amber-400' };
    if (filteredAvg > 0) return { icon: '📉', label: 'Needs Attention', color: 'text-red-600 dark:text-red-400' };
    return { icon: '—', label: 'No data', color: 'text-gray-400' };
  }, [filteredAvg]);

  // Sentiment = % of ratings >= 4 out of total
  const sentimentPct = useMemo(() => {
    if (!filteredTotal || filteredAvg <= 0) return 0;
    // Approximate: if avg >= 4 → ~80-100%, avg 3 → ~50%, avg 2 → ~20%
    return Math.min(100, Math.round((filteredAvg / 5) * 100));
  }, [filteredTotal, filteredAvg]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Row 1: AVG RATING + SENTIMENT SCORE side by side */}
      <div className="flex flex-col sm:flex-row md:flex-col gap-4 md:col-span-2">
        <div className="flex gap-4 flex-1">
          {/* AVG RATING Card */}
          <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-28 h-28 bg-amber-500/5 rounded-full blur-2xl" />
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <span className="text-amber-600 text-sm">★</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-bold ${ratingTrend.color}`}>{ratingTrend.icon} {filteredAvg > 0 ? `${filteredAvg > (filteredAvg >= 3 ? 3 : 0) ? '+' : ''}` : ''}</span>
              </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Avg. Rating</p>
            <div className="flex items-end gap-1 mt-1">
              <span className="text-4xl font-black text-gray-900 dark:text-white leading-none">{filteredAvg || '—'}</span>
              <span className="text-base text-gray-400 mb-0.5 font-bold">/5</span>
            </div>
          </div>

          {/* SENTIMENT SCORE Card */}
          <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-28 h-28 bg-violet-500/5 rounded-full blur-2xl" />
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <span className="text-violet-600 text-sm">♥</span>
              </div>
              <span className={`text-[10px] font-bold ${sentimentPct >= 75 ? 'text-emerald-500' : sentimentPct >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                {sentimentPct >= 75 ? '↑' : sentimentPct >= 50 ? '→' : '↓'} {sentimentPct > 0 ? `${sentimentPct}%` : ''}
              </span>
            </div>
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Sentiment Score</p>
            <div className="flex items-end gap-1 mt-1">
              <span className="text-4xl font-black text-gray-900 dark:text-white leading-none">{sentimentPct || '—'}</span>
              <span className="text-base text-gray-400 mb-0.5 font-bold">%</span>
            </div>
          </div>
        </div>

        {/* Engagement + Coverage sub-row */}
        <div className="flex gap-4 flex-1">
          <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Engagement</p>
            <div className="flex items-end gap-1 mt-1">
              <span className="text-2xl font-black text-gray-900 dark:text-white">{responseRate}%</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700" style={{ width: `${Math.min(100, responseRate)}%` }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{filteredStudents} unique students</p>
          </div>
          <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Coverage</p>
            <div className="flex items-end gap-1 mt-1">
              <span className="text-2xl font-black text-gray-900 dark:text-white">{datesCovered}</span>
              <span className="text-xs text-gray-400 mb-0.5">dates</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{questionsUsed} questions active</p>
          </div>
        </div>
      </div>

      {/* HERO: Total Responses Tracked */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 dark:from-violet-700 dark:via-purple-700 dark:to-indigo-800 p-6 text-white flex flex-col justify-between min-h-[180px]">
        <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute right-4 top-4 w-16 h-16 bg-white/10 rounded-2xl rotate-12" />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-purple-200/80">Total Responses Tracked</p>
        </div>
        <div>
          <span className="text-5xl font-black leading-none tracking-tight">{filteredTotal.toLocaleString()}</span>
          <div className="flex items-center gap-3 mt-3">
            <div className="h-1.5 flex-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white/60 rounded-full transition-all" style={{ width: `${Math.min(100, responseRate)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
