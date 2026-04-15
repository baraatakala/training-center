import { useMemo, useState } from 'react';
import type { SessionFeedback, FeedbackQuestion } from '@/shared/types/database.types';

const MOOD_EMOJIS: Record<string, string> = {
  Tired: '😴', Confused: '🤔', Neutral: '😐', Happy: '😊', Energized: '🔥',
};

interface ResponseRepositoryProps {
  feedbacks: SessionFeedback[];
  questions: FeedbackQuestion[];
  search: string;
  onSearchChange: (v: string) => void;
}

type PaceFilter = 'all' | 'slow' | 'just_right' | 'fast';
type RatingFilter = 'all' | '5' | '4' | '3_or_less';

export function ResponseRepository({ feedbacks, questions, search, onSearchChange }: ResponseRepositoryProps) {
  const [paceFilter, setPaceFilter] = useState<PaceFilter>('all');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Find pace/mood questions dynamically
  const paceQuestion = useMemo(() => questions.find(q =>
    q.question_text.toLowerCase().includes('pace') && q.question_type === 'multiple_choice'
  ), [questions]);

  const moodQuestion = useMemo(() => questions.find(q =>
    q.question_text.toLowerCase().includes('mood')
  ), [questions]);

  const filteredFeedbacks = useMemo(() => {
    let result = feedbacks;

    if (ratingFilter !== 'all') {
      if (ratingFilter === '5') result = result.filter(f => f.overall_rating === 5);
      else if (ratingFilter === '4') result = result.filter(f => f.overall_rating === 4);
      else result = result.filter(f => f.overall_rating != null && f.overall_rating <= 3);
    }

    if (paceFilter !== 'all' && paceQuestion) {
      result = result.filter(f => {
        const val = String(f.responses?.[paceQuestion.id] || '').toLowerCase();
        if (paceFilter === 'slow') return val.includes('slow');
        if (paceFilter === 'fast') return val.includes('fast');
        if (paceFilter === 'just_right') return val.includes('right') || val.includes('ideal') || val.includes('good');
        return true;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(f => {
        const haystack = [f.student_name, f.comment, ...Object.values(f.responses || {}).map(String)]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    return result;
  }, [feedbacks, ratingFilter, paceFilter, paceQuestion, search]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredFeedbacks.slice(start, start + pageSize);
  }, [filteredFeedbacks, page]);

  const totalPages = Math.ceil(filteredFeedbacks.length / pageSize);

  const getStatusBadge = (method: string | null) => {
    if (!method) return null;
    if (method === 'qr_code' || method === 'photo') {
      return (
        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          Present
        </span>
      );
    }
    return (
      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        {method === 'manual' ? 'Manual' : method === 'bulk' ? 'Bulk' : 'Unknown'}
      </span>
    );
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Filter Bar */}
      <div className="p-4 sm:p-5 bg-gray-50/80 dark:bg-gray-800/40 flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="relative w-full md:w-96">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => { onSearchChange(e.target.value); setPage(1); }}
            placeholder="Filter by name or feedback keywords..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-gray-900 dark:text-white placeholder:text-gray-400"
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <select
            value={paceFilter}
            onChange={e => { setPaceFilter(e.target.value as PaceFilter); setPage(1); }}
            className="text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="all">All Pace</option>
            <option value="just_right">Just Right</option>
            <option value="fast">Too Fast</option>
            <option value="slow">Too Slow</option>
          </select>
          <select
            value={ratingFilter}
            onChange={e => { setRatingFilter(e.target.value as RatingFilter); setPage(1); }}
            className="text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="all">All Ratings</option>
            <option value="5">5 Stars</option>
            <option value="4">4 Stars</option>
            <option value="3_or_less">3 Stars or less</option>
          </select>
        </div>
      </div>

      {/* Response Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold">Student Name</th>
              <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold text-center">Attendance</th>
              {moodQuestion && (
                <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold text-center">Mood</th>
              )}
              <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold">Rating</th>
              {paceQuestion && (
                <th className="px-4 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold">Pace</th>
              )}
              <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest text-gray-400 font-bold">Full Comment</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((fb, i) => {
              const mood = moodQuestion ? String(fb.responses?.[moodQuestion.id] || '') : '';
              const pace = paceQuestion ? String(fb.responses?.[paceQuestion.id] || '') : '';
              const initials = (fb.student_name || 'AN')
                .split(' ')
                .map(w => w[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);

              return (
                <tr key={fb.id || i} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors group border-b border-gray-50 dark:border-gray-800">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {fb.is_anonymous ? '🕵️' : initials}
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {getStatusBadge(fb.check_in_method)}
                  </td>
                  {moodQuestion && (
                    <td className="px-4 py-4 text-center text-xl">
                      {MOOD_EMOJIS[mood] || mood || '—'}
                    </td>
                  )}
                  <td className="px-4 py-4">
                    <div className="flex text-amber-400">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className={`text-sm ${s <= (fb.overall_rating || 0) ? 'text-amber-400' : 'text-gray-200 dark:text-gray-600'}`}>★</span>
                      ))}
                    </div>
                  </td>
                  {paceQuestion && (
                    <td className="px-4 py-4">
                      {pace && (
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                          {pace}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 group-hover:line-clamp-none transition-all duration-300 max-w-md">
                      {fb.comment || <span className="text-gray-300 dark:text-gray-600 italic">No comment</span>}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredFeedbacks.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">No responses match the current filters.</div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-gray-50 dark:border-gray-700 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredFeedbacks.length)} of {filteredFeedbacks.length} Responses
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-purple-600 disabled:opacity-30 transition-colors"
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page - 2 + i;
              if (p > totalPages || p < 1) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded transition-colors ${
                    p === page
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-purple-600 disabled:opacity-30 transition-colors"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
