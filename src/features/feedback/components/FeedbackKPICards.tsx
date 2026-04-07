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

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Average Rating - Hero Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-violet-700 dark:from-purple-700 dark:to-violet-800 p-5 text-white col-span-2 lg:col-span-1">
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-200">Avg. Rating</p>
        <div className="flex items-end gap-2 mt-2">
          <span className="text-4xl font-black leading-none">{filteredAvg || '—'}</span>
          <span className="text-lg text-purple-200 mb-0.5">/5</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-sm">{ratingTrend.icon}</span>
          <span className="text-[11px] font-medium text-purple-200">{ratingTrend.label}</span>
        </div>
      </div>

      {/* Sentiment Score */}
      <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 relative overflow-hidden">
        <div className="absolute -right-3 -top-3 w-20 h-20 bg-purple-500/5 dark:bg-purple-500/10 rounded-full blur-xl" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Responses</p>
        <p className="text-3xl font-black text-gray-900 dark:text-white mt-2 leading-none">{filteredTotal.toLocaleString()}</p>
        <p className="text-xs text-gray-400 mt-1.5">{filteredStudents} unique students</p>
      </div>

      {/* Response Rate */}
      <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 relative overflow-hidden">
        <div className="absolute -right-3 -top-3 w-20 h-20 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-xl" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Engagement</p>
        <p className="text-3xl font-black text-gray-900 dark:text-white mt-2 leading-none">{responseRate}%</p>
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700"
            style={{ width: `${Math.min(100, responseRate)}%` }}
          />
        </div>
      </div>

      {/* Coverage */}
      <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 relative overflow-hidden">
        <div className="absolute -right-3 -top-3 w-20 h-20 bg-amber-500/5 dark:bg-amber-500/10 rounded-full blur-xl" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Coverage</p>
        <p className="text-3xl font-black text-gray-900 dark:text-white mt-2 leading-none">{datesCovered}</p>
        <p className="text-xs text-gray-400 mt-1.5">{questionsUsed} questions active</p>
      </div>
    </div>
  );
}
