import { useMemo } from 'react';
import type { FeedbackQuestion, SessionFeedback } from '@/shared/types/database.types';

const MOOD_EMOJIS: Record<string, string> = {
  Tired: '😴', Confused: '🤔', Neutral: '😐', Happy: '😊', Energized: '🔥',
};

interface EmojiDistributionProps {
  questions: FeedbackQuestion[];
  feedbacks: SessionFeedback[];
}

export function EmojiDistribution({ questions, feedbacks }: EmojiDistributionProps) {
  const emojiData = useMemo(() => {
    const emojiQuestions = questions.filter(q => q.question_type === 'emoji');
    const dist: Record<string, number> = {};
    let total = 0;

    for (const q of emojiQuestions) {
      for (const fb of feedbacks) {
        const val = fb.responses?.[q.id];
        if (val) {
          const key = String(val);
          dist[key] = (dist[key] || 0) + 1;
          total++;
        }
      }
    }

    return { dist, total };
  }, [questions, feedbacks]);

  if (emojiData.total === 0) return null;

  const sorted = Object.entries(emojiData.dist).sort(([, a], [, b]) => b - a);
  const sentimentLabels: Record<string, string> = {
    Energized: 'Very Satisfied',
    Happy: 'Satisfied',
    Neutral: 'Neutral',
    Confused: 'Confused',
    Tired: 'Unsatisfied',
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Emoji Response Distribution</h3>
        <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
          Live Feed Aggregate
        </span>
      </div>
      <div className="flex items-center justify-around py-4">
        {sorted.map(([emoji, count]) => {
          const pct = emojiData.total > 0 ? Math.round((count / emojiData.total) * 100) : 0;
          const isTop = pct === Math.round((sorted[0][1] / emojiData.total) * 100);
          return (
            <div key={emoji} className="text-center group flex-1 max-w-[140px]">
              <div className={`text-4xl sm:text-5xl mb-3 transition-transform group-hover:scale-110 ${isTop ? 'drop-shadow-lg' : ''}`}>
                {MOOD_EMOJIS[emoji] || emoji}
              </div>
              <p className={`text-2xl sm:text-3xl font-black ${isTop ? 'text-violet-600 dark:text-violet-400' : 'text-gray-900 dark:text-white'}`}>{pct}%</p>
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1">
                {sentimentLabels[emoji] || emoji}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
