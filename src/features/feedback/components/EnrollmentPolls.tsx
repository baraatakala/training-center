import { useMemo } from 'react';
import type { SessionFeedback, FeedbackQuestion } from '@/shared/types/database.types';

const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const PIE_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1'];

interface EnrollmentPollsProps {
  questions: FeedbackQuestion[];
  feedbacks: SessionFeedback[];
}

function aggregateQuestion(question: FeedbackQuestion, feedbacks: SessionFeedback[]) {
  const values: unknown[] = [];
  for (const fb of feedbacks) {
    const val = fb.responses?.[question.id];
    if (val !== undefined && val !== null && val !== '') values.push(val);
  }

  if (question.question_type === 'rating') {
    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const v of values) dist[Number(v)] = (dist[Number(v)] || 0) + 1;
    const nums = values.map(Number).filter(n => !isNaN(n));
    const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    return { type: 'rating' as const, distribution: dist, avg: Math.round(avg * 10) / 10, total: values.length };
  }
  if (question.question_type === 'emoji') {
    const dist: Record<string, number> = {};
    for (const v of values) dist[String(v)] = (dist[String(v)] || 0) + 1;
    return { type: 'emoji' as const, distribution: dist, total: values.length };
  }
  if (question.question_type === 'multiple_choice') {
    const dist: Record<string, number> = {};
    for (const v of values) dist[String(v)] = (dist[String(v)] || 0) + 1;
    return { type: 'multiple_choice' as const, distribution: dist, total: values.length };
  }
  return { type: 'text' as const, answers: values.map(String), total: values.length };
}

export function EnrollmentPolls({ questions, feedbacks }: EnrollmentPollsProps) {
  const analytics = useMemo(() =>
    questions.map(q => ({ question: q, data: aggregateQuestion(q, feedbacks) }))
      .filter(a => a.data.total > 0),
    [questions, feedbacks]
  );

  if (analytics.length === 0) return null;

  // Show top multiple choice polls and rating summary
  const mcPolls = analytics.filter(a => a.data.type === 'multiple_choice');
  const ratingPolls = analytics.filter(a => a.data.type === 'rating');

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6 space-y-6">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
        Enrollment & Session Polls
      </h3>

      {/* Multiple Choice Polls as Stacked Bars */}
      {mcPolls.map(({ question, data }) => {
        if (data.type !== 'multiple_choice') return null;
        const entries = Object.entries(data.distribution).sort(([, a], [, b]) => b - a);
        const total = data.total;

        return (
          <div key={question.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">"{question.question_text}"</p>
              <span className="text-xs text-gray-400">{Math.round((entries[0]?.[1] || 0) / total * 100)}% Positive</span>
            </div>
            <div className="flex h-6 rounded-lg overflow-hidden">
              {entries.map(([option, count], i) => {
                const pct = (count / total) * 100;
                return (
                  <div
                    key={option}
                    className="flex items-center justify-center transition-all hover:opacity-90"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                      minWidth: pct > 5 ? undefined : '20px',
                    }}
                    title={`${option}: ${count} (${Math.round(pct)}%)`}
                  >
                    {pct > 12 && (
                      <span className="text-[9px] font-bold text-white uppercase tracking-wider truncate px-1">
                        {option}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Rating Distribution Bar */}
      {ratingPolls.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Rating Distribution (1-5 Star Spread)</p>
          <div className="flex items-end gap-3 h-24 px-2">
            {[1, 2, 3, 4, 5].map(r => {
              const total = ratingPolls.reduce((sum, p) =>
                sum + ((p.data.type === 'rating' ? p.data.distribution[r] : 0) || 0), 0
              );
              const maxCount = Math.max(1, ...ratingPolls.flatMap(p =>
                p.data.type === 'rating' ? Object.values(p.data.distribution) : [0]
              ));
              const height = (total / maxCount) * 100;

              return (
                <div key={r} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full rounded-t-lg transition-all duration-500"
                    style={{
                      height: `${Math.max(4, height)}%`,
                      backgroundColor: RATING_COLORS[r - 1],
                      opacity: 0.85,
                    }}
                  />
                  <span className="text-[10px] font-semibold text-gray-400 mt-1.5">{r}★</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
