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
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Emoji Response Distribution</h3>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
          Live Feed Aggregate
        </span>
      </div>
      <div className="flex items-end justify-center gap-6 sm:gap-10 py-4">
        {sorted.map(([emoji, count]) => {
          const pct = emojiData.total > 0 ? Math.round((count / emojiData.total) * 100) : 0;
          return (
            <div key={emoji} className="text-center group">
              <div className="text-3xl sm:text-4xl mb-2 transition-transform group-hover:scale-125">
                {MOOD_EMOJIS[emoji] || emoji}
              </div>
              <p className="text-2xl font-black text-gray-900 dark:text-white">{pct}%</p>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
                {sentimentLabels[emoji] || emoji}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
