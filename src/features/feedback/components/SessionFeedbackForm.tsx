import { useState, useEffect, useCallback, useRef } from 'react';
import { feedbackService, type FeedbackQuestion } from '@/features/feedback/services/feedbackService';
import { gradeAnswer, type GradingResult } from '@/features/feedback/utils/grading';
import { Button } from '@/shared/components/ui';

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
  const [maxTabSwitches, setMaxTabSwitches] = useState(3);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gradedResults, setGradedResults] = useState<Array<{ question: FeedbackQuestion; result: GradingResult; userAnswer: string }>>([]);
  const primaryRatingQuestion = customQuestions.find((question) => question.question_type === 'rating') || null;
  const hasConfiguredQuestions = customQuestions.length > 0;

  // ─── Anti-cheat state ──────────────────────────────────────
  const isTestMode = customQuestions.some(q => q.correct_answer);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const [wasAutoSubmitted, setWasAutoSubmitted] = useState(false);

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
      setMaxTabSwitches(configResult.maxTabSwitches ?? 3);
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

  // ─── Anti-cheat: tab switch detection (test mode only) ─────
  useEffect(() => {
    if (!isTestMode || submitted || loading) return;
    let triggered = false;

    function handleVisibilityChange() {
      if (document.hidden) {
        setTabSwitchCount(prev => {
          const next = prev + 1;
          if (next >= maxTabSwitches && !triggered) {
            triggered = true;
            setWasAutoSubmitted(true);
            // Trigger auto-submit on next tick so state is updated
            setTimeout(() => {
              const autoBtn = document.getElementById('feedback-auto-submit');
              autoBtn?.click();
            }, 0);
          }
          return next;
        });
        setShowViolationWarning(true);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isTestMode, submitted, loading, maxTabSwitches]);

  // ─── Anti-cheat: disable copy/paste/context menu in test mode ──
  useEffect(() => {
    if (!isTestMode || submitted || loading) return;

    function block(e: Event) { e.preventDefault(); }
    document.addEventListener('copy', block);
    document.addEventListener('paste', block);
    document.addEventListener('contextmenu', block);
    return () => {
      document.removeEventListener('copy', block);
      document.removeEventListener('paste', block);
      document.removeEventListener('contextmenu', block);
    };
  }, [isTestMode, submitted, loading]);

  const handleSetResponse = useCallback((questionId: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = async (isAutoSubmit = false) => {
    const derivedOverallRating = primaryRatingQuestion
      ? Number(responses[primaryRatingQuestion.id] || 0)
      : null;

    // Skip validation for auto-submit (anti-cheat forced submission)
    if (!isAutoSubmit) {
      if (!hasConfiguredQuestions) {
        setSubmissionError('No feedback questions are configured for this session date.');
        return;
      }

      if (primaryRatingQuestion && (!derivedOverallRating || Number.isNaN(derivedOverallRating))) {
        setSubmissionError('Please answer the overall rating before submitting feedback.');
        return;
      }

      const missingRequiredQuestions = customQuestions.filter((question) => {
        if (!question.is_required) return false;
        const answer = responses[question.id];
        if (answer === undefined || answer === null) return true;
        if (typeof answer === 'string') return answer.trim().length === 0;
        if (Array.isArray(answer)) return answer.length === 0;
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
    }

    setSubmissionError(null);
    setSubmitting(true);
    const { error } = await feedbackService.submit({
      session_id: sessionId,
      attendance_date: attendanceDate,
      student_id: studentId,
      is_anonymous: isAnonymous,
      overall_rating: derivedOverallRating,
      comment: comment.trim() || undefined,
      responses,
      check_in_method: checkInMethod,
      tab_switch_count: tabSwitchCount,
      is_auto_submitted: isAutoSubmit,
    });

    if (error) {
      console.error('Feedback submission error:', error);
      setSubmissionError(error.message || 'Unable to save feedback right now.');
      setSubmitting(false);
      return;
    }
    // Compute graded results for test questions
    const graded = customQuestions
      .filter(q => q.correct_answer)
      .map(q => {
        const raw = responses[q.id];
        const result = gradeAnswer(q, raw);
        const userAnswer = Array.isArray(raw) ? (raw as string[]).join(', ') : String(raw ?? '').trim();
        return { question: q, result, userAnswer };
      });
    setGradedResults(graded);
    setSubmitted(true);
    setSubmitting(false);
    // Delay auto-close only when there are no graded test questions to review
    if (graded.length === 0) {
      setTimeout(onComplete, 1500);
    }
  };

  // Auto-redirect countdown for auto-submitted tests (gives student time to review results)
  const [autoRedirectSeconds, setAutoRedirectSeconds] = useState(12);
  const autoRedirectRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!submitted || !wasAutoSubmitted || gradedResults.length === 0) return;
    autoRedirectRef.current = setInterval(() => {
      setAutoRedirectSeconds(prev => {
        if (prev <= 1) {
          if (autoRedirectRef.current) clearInterval(autoRedirectRef.current);
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (autoRedirectRef.current) clearInterval(autoRedirectRef.current); };
  }, [submitted, wasAutoSubmitted, gradedResults.length, onComplete]);

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
    const correctCount = gradedResults.filter(r => r.result.isCorrect).length;
    const totalTest = gradedResults.length;
    const hasScoredQuestions = totalTest > 0;
    const allCorrect = hasScoredQuestions && correctCount === totalTest;

    return (
      <div className="animate-scale-in mt-6 space-y-4">
        {/* Auto-submit warning */}
        {wasAutoSubmitted && (
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/30 rounded-2xl border border-red-200 dark:border-red-700">
            <span className="text-3xl block mb-1">⚠️</span>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Auto-submitted due to tab switching</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
              You switched tabs {tabSwitchCount} time{tabSwitchCount !== 1 ? 's' : ''} during the test. Your answers were submitted automatically.
            </p>
          </div>
        )}

        {/* Thank-you banner */}
        <div className="text-center p-5 bg-purple-50 dark:bg-purple-900/30 rounded-2xl border border-purple-200 dark:border-purple-700">
          <span className="text-4xl block mb-2">💜</span>
          <p className="text-base font-semibold text-purple-700 dark:text-purple-300">Thank you for your feedback!</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your response helps improve future sessions.</p>
        </div>

        {/* Test question results */}
        {hasScoredQuestions && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20 overflow-hidden">
            {/* Score header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-200 dark:border-amber-700">
              <div className="flex items-center gap-2">
                <span className="text-lg">{allCorrect ? '🏆' : '🎯'}</span>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Knowledge Check Results</p>
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${
                correctCount === totalTest
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                  : correctCount === 0
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
              }`}>
                {correctCount}/{totalTest} correct
              </div>
            </div>

            {/* Per-question breakdown */}
            <div className="divide-y divide-amber-100 dark:divide-amber-800/40">
              {gradedResults.map(({ question, result, userAnswer }) => {
                const isPartial = result.score !== null && result.score > 0 && result.score < 1;
                return (
                <div key={question.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-base shrink-0">{result.isCorrect ? '?' : isPartial ? '??' : '?'}</span>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{question.question_text}</p>
                    {result.detail && question.allow_multiple && (
                      <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                        result.isCorrect ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                        : isPartial ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                        : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                      }`}>
                        {result.detail}
                      </span>
                    )}
                  </div>
                  <div className="ml-7 space-y-0.5">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Your answer:{' '}
                      <span className={`font-semibold ${
                        result.isCorrect
                          ? 'text-green-600 dark:text-green-400'
                          : isPartial
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {userAnswer || '�'}
                      </span>
                    </p>
                    {!result.isCorrect && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Correct answer:{' '}
                        <span className="font-semibold text-green-600 dark:text-green-400">{question.correct_answer}</span>
                      </p>
                    )}
                    {isPartial && question.grading_mode === 'partial' && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        Partial credit: {Math.round((result.score ?? 0) * 100)}%
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Continue button when there are graded results */}
        {hasScoredQuestions && (
          <button
            type="button"
            onClick={onComplete}
            className="w-full py-3 text-sm font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            {wasAutoSubmitted ? `Return Home (${autoRedirectSeconds}s)` : 'Continue →'}
          </button>
        )}
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

  if (!hasConfiguredQuestions) {
    return (
      <div className="animate-fade-in mt-6 rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-center">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">No feedback questions are saved for this attendance date yet.</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/80">Students should only see configured questions from the database. Ask staff to add the question set for this exact date.</p>
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

  return (
    <div className="animate-fade-in mt-6">
      {/* Violation warning overlay */}
      {showViolationWarning && isTestMode && !submitted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-sm w-full bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-2xl border-2 border-red-400 dark:border-red-600 text-center space-y-3 animate-scale-in">
            <span className="text-5xl block">🚨</span>
            <h3 className="text-lg font-bold text-red-700 dark:text-red-300">Tab Switch Detected!</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Leaving this page during a test is not allowed. Violation {tabSwitchCount} of {maxTabSwitches}.
            </p>
            {tabSwitchCount >= maxTabSwitches ? (
              <p className="text-xs text-red-700 dark:text-red-300 font-bold">
                Maximum violations reached. Auto-submitting your answers now...
              </p>
            ) : (
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                After {maxTabSwitches} violations your answers will be auto-submitted.
              </p>
            )}
            {tabSwitchCount < maxTabSwitches && (
              <button
                onClick={() => setShowViolationWarning(false)}
                className="mt-2 w-full py-2.5 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Return to Test
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hidden auto-submit trigger */}
      <button
        id="feedback-auto-submit"
        type="button"
        className="hidden"
        onClick={() => handleSubmit(true)}
      />

      {/* Divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {isTestMode ? 'Knowledge Check' : 'Quick Feedback'}
        </span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Test mode banner */}
      {isTestMode && (
        <div className="mb-4 rounded-xl border border-red-200 dark:border-red-700 bg-red-50/80 dark:bg-red-900/20 px-4 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base">🔒</span>
            <p className="text-sm font-bold text-red-700 dark:text-red-300">Exam Mode Active</p>
          </div>
          <ul className="text-xs text-red-600/80 dark:text-red-400/80 space-y-0.5 ml-6 list-disc">
            <li>Do not switch tabs or leave this page</li>
            <li>Copy, paste, and right-click are disabled</li>
            <li>After {maxTabSwitches} tab switches your answers will be auto-submitted</li>
          </ul>
          {tabSwitchCount > 0 && (
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 mt-1 ml-6">
              ⚠️ Violations: {tabSwitchCount}/{maxTabSwitches}
            </p>
          )}
        </div>
      )}

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
            {q.question_type === 'multiple_choice' && q.options.length > 0 && (() => {
              const isMulti = q.allow_multiple;
              const currentValue = responses[q.id];
              const selectedArr = Array.isArray(currentValue) ? currentValue as string[] : [];
              return (
                <div className="flex flex-wrap gap-2 justify-center">
                  {q.options.map((opt) => {
                    const isSelected = isMulti ? selectedArr.includes(opt) : currentValue === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          if (isMulti) {
                            const next = selectedArr.includes(opt)
                              ? selectedArr.filter(v => v !== opt)
                              : [...selectedArr, opt];
                            handleSetResponse(q.id, next);
                          } else {
                            handleSetResponse(q.id, opt);
                          }
                        }}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                          isSelected
                            ? 'bg-purple-500 text-white border-purple-500'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-purple-400'
                        }`}
                      >
                        {isMulti && (
                          <span className="mr-1">{isSelected ? '?' : '?'}</span>
                        )}
                        {opt}
                      </button>
                    );
                  })}
                  {isMulti && selectedArr.length > 0 && (
                    <span className="text-xs text-purple-500 self-center ml-1">{selectedArr.length} selected</span>
                  )}
                </div>
              );
            })()}
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

        {/* Anonymous Toggle — disabled in test mode */}
        {anonymousAllowed && !isTestMode && (
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
          {!isTestMode && (
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Skip for now →
            </button>
          )}
          <Button
            onClick={() => handleSubmit(false)}
            disabled={submitting || !hasConfiguredQuestions}
            className={isTestMode ? 'w-full' : 'flex-1'}
            size="sm"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                Sending...
              </span>
            ) : (
              <span>{isTestMode ? '🔒 Submit Test' : '💜 Submit Feedback'}</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}