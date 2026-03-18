import { useState, useEffect, useCallback } from 'react';
import { feedbackService, type FeedbackQuestion } from '../services/feedbackService';
import { Button } from './ui';

// ─── Emoji Rating Faces ─────────────────────────────────────
const EMOJI_OPTIONS = [
  { emoji: '😢', label: 'Very Bad', value: 1 },
  { emoji: '😕', label: 'Bad', value: 2 },
  { emoji: '😐', label: 'Okay', value: 3 },
  { emoji: '😊', label: 'Good', value: 4 },
  { emoji: '🤩', label: 'Excellent', value: 5 },
];

const MOOD_EMOJIS = [
  { emoji: '😴', label: 'Tired' },
  { emoji: '🤔', label: 'Confused' },
  { emoji: '😐', label: 'Neutral' },
  { emoji: '😊', label: 'Happy' },
  { emoji: '🔥', label: 'Energized' },
];

interface Props {
  sessionId: string;
  studentId: string;
  attendanceDate: string;
  checkInMethod: 'qr_code' | 'photo';
  onComplete: () => void;
  onSkip: () => void;
}

export default function SessionFeedbackForm({
  sessionId,
  studentId,
  attendanceDate,
  checkInMethod,
  onComplete,
  onSkip,
}: Props) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [anonymousAllowed, setAnonymousAllowed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [customQuestions, setCustomQuestions] = useState<FeedbackQuestion[]>([]);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load feedback config and questions
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [configResult, questionsResult, hasSubmittedResult] = await Promise.all([
        feedbackService.isEnabled(sessionId),
        feedbackService.getQuestions(sessionId, attendanceDate),
        feedbackService.hasSubmitted(sessionId, studentId, attendanceDate),
      ]);

      if (cancelled) return;

      const configError = configResult.error as { message?: string } | null;
      const questionError = questionsResult.error as { message?: string } | null;
      const submittedError = hasSubmittedResult.error as { message?: string } | null;

      setFeedbackEnabled(configResult.enabled);
      setAnonymousAllowed(configResult.anonymousAllowed);
      setAlreadySubmitted(hasSubmittedResult.alreadySubmitted);
      setLoadError(
        configError?.message ||
        questionError?.message ||
        submittedError?.message ||
        null
      );
      if (questionsResult.data) {
        setCustomQuestions(questionsResult.data);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [attendanceDate, sessionId, studentId]);

  const handleSetResponse = useCallback((questionId: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = async () => {
    if (rating === 0) return;

    const missingRequiredQuestions = customQuestions.filter((question) => {
      if (!question.is_required) return false;
      const answer = responses[question.id];
      if (answer === undefined || answer === null) return true;
      if (typeof answer === 'string') return answer.trim().length === 0;
      return false;
    });

    if (missingRequiredQuestions.length > 0) {
      const preview = missingRequiredQuestions
        .slice(0, 2)
        .map((question) => question.question_text)
        .join(' / ');
      setSubmissionError(
        `Please answer all required questions before submitting.${preview ? ` Missing: ${preview}` : ''}`
      );
      return;
    }

    setSubmissionError(null);
    setSubmitting(true);
    const { error } = await feedbackService.submit({
      session_id: sessionId,
      attendance_date: attendanceDate,
      student_id: studentId,
      is_anonymous: isAnonymous,
      overall_rating: rating,
      comment: comment.trim() || undefined,
      responses,
      check_in_method: checkInMethod,
    });

    if (error) {
      console.error('Feedback submission error:', error);
      setSubmissionError(error.message || 'Unable to save feedback right now.');
      setSubmitting(false);
      return;
    }
    setSubmitted(true);
    setSubmitting(false);
    setTimeout(onComplete, 1500);
  };

  if (loading) {
    return (
      <div className="animate-fade-in mt-6 p-4">
        <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500" />
          <span className="text-sm">Loading feedback form...</span>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="animate-scale-in mt-6 text-center p-6 bg-purple-50 dark:bg-purple-900/30 rounded-2xl border border-purple-200 dark:border-purple-700">
        <span className="text-5xl block mb-3">💜</span>
        <p className="text-lg font-semibold text-purple-700 dark:text-purple-300">
          Thank you for your feedback!
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Your response helps improve future sessions.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="animate-fade-in mt-6 rounded-2xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 text-center">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">Unable to load the feedback form right now.</p>
        <p className="mt-1 text-xs leading-relaxed break-words text-red-700/80 dark:text-red-300/80">{loadError}</p>
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 text-sm text-red-600 dark:text-red-400 hover:underline"
        >
          Continue without feedback
        </button>
      </div>
    );
  }

  if (!feedbackEnabled) {
    return (
      <div className="animate-fade-in mt-6 rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-center">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Feedback is not available for this session right now.</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/80">The session setting was turned off before the form finished loading.</p>
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 text-sm text-amber-600 dark:text-amber-400 hover:underline"
        >
          Continue
        </button>
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="animate-fade-in mt-6 p-4 rounded-2xl border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-center">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Feedback already submitted for this session date.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">You can continue without submitting again.</p>
        <button
          type="button"
          onClick={onSkip}
          className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Continue →
        </button>
      </div>
    );
  }

  const activeRating = hoveredRating || rating;

  return (
    <div className="animate-fade-in mt-6">
      {/* Divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Quick Feedback
        </span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-2xl p-5 border border-purple-100 dark:border-purple-800/50">
        {submissionError && (
          <div className="mb-4 rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <span className="break-words leading-relaxed">{submissionError}</span>
          </div>
        )}

        {customQuestions.some((question) => question.is_required) && (
          <div className="mb-4 rounded-xl border border-purple-200 dark:border-purple-700 bg-white/70 dark:bg-gray-800/70 px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
            Questions marked with * are required before submitting feedback.
          </div>
        )}

        {/* Star/Emoji Rating */}
        <div className="text-center mb-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            How was today's session?
          </p>
          <div className="flex justify-center gap-2">
            {EMOJI_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRating(opt.value)}
                onMouseEnter={() => setHoveredRating(opt.value)}
                onMouseLeave={() => setHoveredRating(0)}
                className={`relative group transition-all duration-200 rounded-xl p-2 ${
                  activeRating >= opt.value
                    ? 'scale-110 bg-purple-100 dark:bg-purple-800/50'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 opacity-50 grayscale'
                }`}
              >
                <span className="text-3xl block transition-transform group-hover:scale-125">
                  {opt.emoji}
                </span>
                <span className={`text-[10px] block mt-1 font-medium transition-colors ${
                  activeRating >= opt.value
                    ? 'text-purple-600 dark:text-purple-300'
                    : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-xs text-purple-600 dark:text-purple-300 mt-2 font-medium animate-fade-in">
              {EMOJI_OPTIONS[rating - 1].label}!
            </p>
          )}
        </div>

        {/* Custom Questions */}
        {customQuestions.map((q) => (
          <div key={q.id} className="mb-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {q.question_text}
              {q.is_required && <span className="text-red-500 ml-1">*</span>}
            </p>
            {q.question_type === 'rating' && (
              <div className="flex gap-1 justify-center">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleSetResponse(q.id, v)}
                    className={`w-10 h-10 rounded-lg text-lg transition-all ${
                      (responses[q.id] as number) >= v
                        ? 'bg-yellow-400 text-white scale-105'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            )}
            {q.question_type === 'emoji' && (
              <div className="flex gap-2 justify-center">
                {MOOD_EMOJIS.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => handleSetResponse(q.id, m.label)}
                    className={`p-2 rounded-xl transition-all ${
                      responses[q.id] === m.label
                        ? 'bg-purple-100 dark:bg-purple-800/50 scale-110'
                        : 'opacity-50 hover:opacity-75'
                    }`}
                  >
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-[10px] block">{m.label}</span>
                  </button>
                ))}
              </div>
            )}
            {q.question_type === 'text' && (
              <textarea
                value={(responses[q.id] as string) || ''}
                onChange={(e) => handleSetResponse(q.id, e.target.value)}
                placeholder="Type your answer..."
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              />
            )}
            {q.question_type === 'multiple_choice' && q.options.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSetResponse(q.id, opt)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      responses[q.id] === opt
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-purple-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Optional Comment */}
        <div className="mb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Any thoughts? (optional)"
            rows={2}
            maxLength={1000}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white/80 dark:bg-gray-800/80 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Anonymous Toggle */}
        {anonymousAllowed && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <div
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                isAnonymous ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  isAnonymous ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              🕵️ Submit anonymously
            </span>
          </label>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Skip for now →
          </button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || rating === 0}
            className="flex-1"
            size="sm"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                Sending...
              </span>
            ) : (
              <span>💜 Submit Feedback</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
