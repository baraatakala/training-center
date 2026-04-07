import { useMemo } from 'react';
import type { FeedbackQuestion, SessionFeedback, FeedbackComparison } from '@/shared/types/database.types';

const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];

interface InstructorMatrixProps {
  dateComparison: FeedbackComparison | null;
  questions: FeedbackQuestion[];
  feedbacks: SessionFeedback[];
}

export function InstructorMatrix({ dateComparison }: InstructorMatrixProps) {
  const matrixData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return null;

    // Group dates by performance tier
    const dates = dateComparison.dates.map(d => ({
      ...d,
      tier: d.averageRating >= 4.5 ? 'optimal' as const
        : d.averageRating >= 3.5 ? 'developing' as const
        : 'critical' as const,
    }));

    return dates;
  }, [dateComparison]);

  if (!matrixData || matrixData.length < 2) return null;

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
            Session Performance Matrix
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Cross-referencing session dates against performance indices.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(['critical', 'developing', 'optimal'] as const).map(tier => (
            <div key={tier} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${
                tier === 'critical' ? 'bg-red-500'
                : tier === 'developing' ? 'bg-amber-500'
                : 'bg-emerald-500'
              }`} />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {tier}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-[500px]">
          {matrixData.map(d => {
            const dateLabel = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const bgColor = d.tier === 'optimal' ? 'bg-emerald-500/90 dark:bg-emerald-600/80'
              : d.tier === 'developing' ? 'bg-amber-500/80 dark:bg-amber-600/70'
              : 'bg-red-500/80 dark:bg-red-600/70';

            return (
              <div key={d.date} className="flex-1 min-w-[80px]">
                <p className="text-[10px] font-semibold text-gray-500 text-center mb-1.5 uppercase tracking-wider">
                  {dateLabel}
                </p>
                <div className={`${bgColor} rounded-xl py-3 px-2 text-center transition-all hover:scale-105`}>
                  <p className="text-lg font-black text-white">{d.averageRating}</p>
                </div>
                <div className="flex justify-center gap-px mt-1.5">
                  {[1, 2, 3, 4, 5].map(r => {
                    const count = d.ratingDistribution[r] || 0;
                    const pct = d.responses > 0 ? (count / d.responses) * 100 : 0;
                    return (
                      <div
                        key={r}
                        className="w-2 rounded-sm"
                        style={{
                          height: `${Math.max(2, pct * 0.3)}px`,
                          backgroundColor: RATING_COLORS[r - 1],
                          minHeight: '2px',
                        }}
                        title={`${r}★: ${count} (${Math.round(pct)}%)`}
                      />
                    );
                  })}
                </div>
                <p className="text-[9px] text-gray-400 text-center mt-1">{d.responses} resp · {d.responseRate}%</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
