import { useMemo } from 'react';
import type { FeedbackQuestion, SessionFeedback, FeedbackComparison } from '@/shared/types/database.types';

interface InstructorMatrixProps {
  dateComparison: FeedbackComparison | null;
  questions: FeedbackQuestion[];
  feedbacks: SessionFeedback[];
}

export function InstructorMatrix({ dateComparison }: InstructorMatrixProps) {
  const matrixData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return null;
    return dateComparison.dates.map(d => ({
      ...d,
      tier: d.averageRating >= 4.5 ? 'optimal' as const
        : d.averageRating >= 3.5 ? 'developing' as const
        : 'critical' as const,
      dateLabel: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));
  }, [dateComparison]);

  if (!matrixData || matrixData.length < 2) return null;

  const tierColor = (rating: number) => {
    if (rating >= 4.5) return 'bg-emerald-600 text-white';
    if (rating >= 3.5) return 'bg-amber-500 text-white';
    if (rating > 0) return 'bg-red-500 text-white';
    return 'bg-gray-200 dark:bg-gray-700 text-gray-400';
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
            Institutional Matrix
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Cross-referencing session dates against performance indices
          </p>
        </div>
        <div className="flex items-center gap-4">
          {([
            { tier: 'Critical', color: 'bg-red-500' },
            { tier: 'Developing', color: 'bg-amber-500' },
            { tier: 'Optimal', color: 'bg-emerald-600' },
          ]).map(l => (
            <div key={l.tier} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{l.tier}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-32">Session Date</th>
              <th className="text-center px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rating</th>
              <th className="text-center px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Responses</th>
              <th className="text-center px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Engagement</th>
              <th className="text-center px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {matrixData.map(d => (
              <tr key={d.date} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-gray-900 dark:text-white">{d.dateLabel}</span>
                  <span className="text-[10px] text-gray-400 ml-1.5">{d.date}</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-flex items-center justify-center w-12 h-8 rounded-lg text-sm font-black ${tierColor(d.averageRating)}`}>
                    {d.averageRating}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-700 dark:text-gray-300">{d.responses}</td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className="w-12 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${d.responseRate}%` }} />
                    </div>
                    <span className="text-gray-500 font-medium">{d.responseRate}%</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center text-gray-500">{d.commentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
