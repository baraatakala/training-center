import { useMemo } from 'react';
import type { SessionFeedback, FeedbackQuestion } from '@/shared/types/database.types';

interface IntelligenceFeedProps {
  feedbacks: SessionFeedback[];
  questions: FeedbackQuestion[];
}

interface FeedEntry {
  studentName: string;
  initials: string;
  context: string;
  comment: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  tag: string;
  timeAgo: string;
}

export function IntelligenceFeed({ feedbacks, questions }: IntelligenceFeedProps) {
  const feedEntries = useMemo((): FeedEntry[] => {
    // Get the latest feedbacks with comments
    const withComments = feedbacks
      .filter(f => f.comment && f.comment.trim().length > 10)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    return withComments.map(fb => {
      const name = fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown');
      const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

      // Detect sentiment from overall rating
      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (fb.overall_rating && fb.overall_rating >= 4) sentiment = 'positive';
      if (fb.overall_rating && fb.overall_rating <= 2) sentiment = 'negative';

      // Generate tag based on content analysis
      const comment = (fb.comment || '').toLowerCase();
      let tag = 'General';
      if (comment.includes('instructor') || comment.includes('teacher') || comment.includes('prof')) tag = 'Instructor Style';
      else if (comment.includes('material') || comment.includes('resource') || comment.includes('handout') || comment.includes('template')) tag = 'Resources';
      else if (comment.includes('lab') || comment.includes('equipment') || comment.includes('vm') || comment.includes('infra')) tag = 'Lab Equipment';
      else if (comment.includes('pace') || comment.includes('fast') || comment.includes('slow') || comment.includes('speed')) tag = 'Pacing';
      else if (comment.includes('content') || comment.includes('topic') || comment.includes('subject')) tag = 'Content Quality';
      else if (comment.includes('q&a') || comment.includes('question') || comment.includes('discussion')) tag = 'Interaction';

      // Time ago - use date string instead of Date.now() for render purity
      const timeAgo = fb.attendance_date || 'Recent';

      return {
        studentName: name,
        initials: fb.is_anonymous ? '🕵️' : initials,
        context: fb.attendance_date,
        comment: fb.comment || '',
        sentiment,
        tag,
        timeAgo,
      };
    });
  }, [feedbacks, questions]);

  if (feedEntries.length === 0) return null;

  const sentimentConfig = {
    positive: { label: 'POSITIVE', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' },
    negative: { label: 'NEGATIVE', color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' },
    neutral: { label: 'NEUTRAL', color: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700' },
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Intelligence Feed</h3>
          <p className="text-xs text-gray-400 mt-0.5">NLP-tagged qualitative responses.</p>
        </div>
      </div>

      <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1">
        {feedEntries.slice(0, 8).map((entry, i) => {
          const config = sentimentConfig[entry.sentiment];
          return (
            <div key={i} className="group">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {entry.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{entry.studentName}</p>
                      <span className="text-[10px] text-gray-400">{entry.context}</span>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full shrink-0 ${config.color}`}>
                      {config.label}: {entry.tag}
                    </span>
                  </div>
                  <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed mt-2 border-l-2 border-violet-200 dark:border-violet-700 pl-3 italic">
                    "{entry.comment}"
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {feedEntries.length > 8 && (
        <p className="text-xs text-center text-gray-400 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          View All {feedEntries.length.toLocaleString()} Feed Entries
        </p>
      )}
    </div>
  );
}
