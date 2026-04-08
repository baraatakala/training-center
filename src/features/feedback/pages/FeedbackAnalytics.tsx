import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select } from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { Breadcrumb } from '@/shared/components/ui/Breadcrumb';
import { feedbackService } from '@/features/feedback/services/feedbackService';
import type { SessionFeedback, FeedbackStats, FeedbackQuestion, FeedbackComparison } from '@/shared/types/database.types';
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, Line, Legend,
} from 'recharts';

// ─── Constants ─────────────────────────────────────────────
const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];

type ActiveView = 'records' | 'analytics';
type QuestionTypeFilter = 'all' | 'rating' | 'text' | 'multiple_choice';

interface SessionOption {
  session_id: string;
  course_name: string;
  teacher_name: string;
  start_date: string;
  end_date: string;
  feedback_enabled: boolean;
  feedback_anonymous_allowed: boolean;
}

// ─── Flattened record (one row per question-answer) ────────
interface FlattenedRecord {
  feedbackId: string;
  studentName: string;
  isAnonymous: boolean;
  attendanceDate: string;
  questionType: string;
  questionText: string;
  answer: string;
  comment: string | null;
}

// ─── Response-centric analytics ────────────────────────────
interface ResponseAnalyticsItem {
  questionId: string;
  questionText: string;
  questionType: 'rating' | 'text' | 'multiple_choice';
  attendanceDate: string | null;
  data:
    | { type: 'rating'; distribution: Record<number, number>; avg: number; total: number }
    | { type: 'multiple_choice'; distribution: Record<string, number>; total: number }
    | { type: 'text'; answers: string[]; total: number };
}

/**
 * Build analytics from actual response data (not from question definitions).
 * This handles the case where template re-apply creates new question IDs
 * while old responses still reference the previous IDs.
 */
function buildResponseAnalytics(feedbacks: SessionFeedback[], questions: FeedbackQuestion[]): ResponseAnalyticsItem[] {
  const qMap = new Map(questions.map(q => [q.id, q]));

  // Group all response values by question_id
  const byQuestion = new Map<string, { question: FeedbackQuestion | null; values: unknown[] }>();
  for (const fb of feedbacks) {
    for (const [qId, val] of Object.entries(fb.responses || {})) {
      if (val === undefined || val === null || val === '') continue;
      if (!byQuestion.has(qId)) byQuestion.set(qId, { question: qMap.get(qId) || null, values: [] });
      byQuestion.get(qId)!.values.push(val);
    }
  }

  const results: ResponseAnalyticsItem[] = [];

  for (const [qId, { question, values }] of byQuestion) {
    let type: 'rating' | 'multiple_choice' | 'text';
    if (question) {
      type = (question.question_type === 'rating' || question.question_type === 'multiple_choice')
        ? question.question_type : 'text';
    } else {
      // Infer type from values when question was deleted (template re-apply)
      const allRating = values.every(v => {
        const n = Number(v);
        return !isNaN(n) && n >= 1 && n <= 5 && Number.isInteger(n);
      });
      type = allRating ? 'rating' : 'text';
    }

    if (type === 'rating') {
      const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const nums = values.map(Number).filter(n => !isNaN(n));
      for (const n of nums) dist[n] = (dist[n] || 0) + 1;
      const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      results.push({
        questionId: qId, questionText: question?.question_text || 'Unknown Question',
        questionType: type, attendanceDate: question?.attendance_date || null,
        data: { type: 'rating', distribution: dist, avg: Math.round(avg * 10) / 10, total: values.length },
      });
    } else if (type === 'multiple_choice') {
      const dist: Record<string, number> = {};
      for (const v of values) dist[String(v)] = (dist[String(v)] || 0) + 1;
      results.push({
        questionId: qId, questionText: question?.question_text || 'Unknown Question',
        questionType: type, attendanceDate: question?.attendance_date || null,
        data: { type: 'multiple_choice', distribution: dist, total: values.length },
      });
    } else {
      results.push({
        questionId: qId, questionText: question?.question_text || 'Unknown Question',
        questionType: type, attendanceDate: question?.attendance_date || null,
        data: { type: 'text', answers: values.map(String), total: values.length },
      });
    }
  }

  return results.sort((a, b) => b.data.total - a.data.total);
}

// ─── CSV export (one row per question-answer) ───────────────
function exportFeedbackCSV(records: FlattenedRecord[], courseName: string, selectedDate?: string) {
  const headers = ['Student', 'Date', 'Question Type', 'Question', 'Answer', 'Comment'];
  const rows = records.map(r => [
    r.studentName, r.attendanceDate, r.questionType,
    r.questionText, r.answer, r.comment || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-${courseName.replace(/\s+/g, '-')}-${selectedDate || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export function FeedbackAnalytics() {
  const [searchParams] = useSearchParams();
  const sessionParam = searchParams.get('session');
  const dateParam = searchParams.get('date');
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedbacks, setFeedbacks] = useState<SessionFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('records');
  const [updatingFeedbackEnabled, setUpdatingFeedbackEnabled] = useState(false);
  const [updatingAnonymousAllowed, setUpdatingAnonymousAllowed] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Date Comparison
  const [dateComparison, setDateComparison] = useState<FeedbackComparison | null>(null);
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [recordsPage, setRecordsPage] = useState(0);
  const RECORDS_PER_PAGE = 15;

  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);

  // ─── Load sessions ────────────────────────────────────────
  useEffect(() => {
    async function loadSessions() {
      const { data, error } = await feedbackService.getSessionsForAnalytics();
      if (error) { setPageError(error.message || 'Unable to load feedback sessions.'); return; }
      if (data) {
        const mapped = data.map((s: Record<string, unknown>) => {
          const course = s.course as Record<string, string> | Record<string, string>[] | null;
          const teacher = s.teacher as Record<string, string> | Record<string, string>[] | null;
          return {
            session_id: s.session_id as string,
            course_name: (Array.isArray(course) ? course[0]?.course_name : course?.course_name) ?? 'Unknown Course',
            teacher_name: (Array.isArray(teacher) ? teacher[0]?.name : teacher?.name) ?? 'Unknown Teacher',
            start_date: String(s.start_date || ''),
            end_date: String(s.end_date || ''),
            feedback_enabled: Boolean(s.feedback_enabled),
            feedback_anonymous_allowed: Boolean(s.feedback_anonymous_allowed ?? true),
          };
        });
        setSessions(mapped);
        setPageError(null);
        if (sessionParam && mapped.some(s => s.session_id === sessionParam)) setSelectedSessionId(sessionParam);
        else if (selectedSessionId && mapped.some(s => s.session_id === selectedSessionId)) { /* keep */ }
        else if (mapped.length > 0) setSelectedSessionId(mapped[0].session_id);
      }
    }
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam]);

  // ─── Load data for selected session ────────────────────────
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [fbResult, statsResult, questionsResult] = await Promise.all([
        feedbackService.getBySession(selectedSessionId),
        feedbackService.getStats(selectedSessionId),
        feedbackService.getQuestions(selectedSessionId),
      ]);
      if (cancelled) return;
      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setQuestions(questionsResult.data || []);
      const combinedError = (fbResult.error as { message?: string } | null)?.message
        || (statsResult.error as { message?: string } | null)?.message
        || (questionsResult.error as { message?: string } | null)?.message || null;
      setPageError(combinedError);
      if (combinedError) toast.error(combinedError, 7000);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  useEffect(() => { if (dateParam) setSelectedAnalyticsDate(dateParam); }, [dateParam]);

  const refreshFeedbackData = useCallback(() => {
    if (selectedSessionId) {
      feedbackService.getBySession(selectedSessionId).then(r => { if (r.data) setFeedbacks(r.data); });
      feedbackService.getStats(selectedSessionId).then(r => { if (r.data) setStats(r.data); });
      feedbackService.getDateComparison(selectedSessionId).then(r => { if (r.data) setDateComparison(r.data); });
    }
  }, [selectedSessionId]);
  useRefreshOnFocus(refreshFeedbackData);

  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    feedbackService.getDateComparison(selectedSessionId).then(r => {
      if (!cancelled && r.data) setDateComparison(r.data);
    });
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // ─── Derived data ──────────────────────────────────────────
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter(fb => {
      if (selectedAnalyticsDate && fb.attendance_date !== selectedAnalyticsDate) return false;
      if (feedbackSearch.trim()) {
        const haystack = [fb.student_name, fb.comment, ...Object.values(fb.responses || {}).map(String)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(feedbackSearch.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [feedbacks, selectedAnalyticsDate, feedbackSearch]);

  const filteredStats = useMemo(() => {
    const rated = filteredFeedbacks.filter(fb => fb.overall_rating != null);
    return {
      totalResponses: filteredFeedbacks.length,
      engagedStudents: new Set(filteredFeedbacks.map(fb => fb.student_id).filter(Boolean)).size,
      averageRating: rated.length > 0
        ? Math.round((rated.reduce((sum, fb) => sum + Number(fb.overall_rating || 0), 0) / rated.length) * 10) / 10 : 0,
      datesCovered: new Set(filteredFeedbacks.map(fb => fb.attendance_date)).size,
      latestResponseDate: filteredFeedbacks[0]?.attendance_date || null,
    };
  }, [filteredFeedbacks]);

  const filteredResponseRate = useMemo(() => {
    if (!stats || stats.responseRate === 0) return stats?.responseRate ?? 0;
    if (filteredStats.engagedStudents === stats.engagedStudents) return stats.responseRate;
    if (stats.responseRate > 0) {
      const enrolled = Math.round(stats.engagedStudents * 100 / stats.responseRate);
      return enrolled > 0 ? Math.min(100, Math.round((filteredStats.engagedStudents / enrolled) * 100)) : 0;
    }
    return 0;
  }, [filteredStats.engagedStudents, stats]);

  const uniqueDates = useMemo(() =>
    [...new Set(feedbacks.map(f => f.attendance_date))].sort().reverse(),
    [feedbacks]);

  // ─── Flatten feedbacks into one row per question-answer ────
  const flattenedRecords = useMemo(() => {
    const qMap = new Map(questions.map(q => [q.id, q]));
    const rows: FlattenedRecord[] = [];
    for (const fb of filteredFeedbacks) {
      const entries = Object.entries(fb.responses || {});
      const studentName = fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown');

      if (entries.length === 0 && (fb.overall_rating != null || fb.comment)) {
        rows.push({
          feedbackId: fb.id, studentName, isAnonymous: fb.is_anonymous,
          attendanceDate: fb.attendance_date, questionType: 'rating',
          questionText: 'Overall Rating',
          answer: fb.overall_rating != null ? String(fb.overall_rating) : '—',
          comment: fb.comment,
        });
      } else {
        for (const [qId, val] of entries) {
          const q = qMap.get(qId);
          rows.push({
            feedbackId: fb.id, studentName, isAnonymous: fb.is_anonymous,
            attendanceDate: fb.attendance_date,
            questionType: q?.question_type?.replace('_', ' ') || '—',
            questionText: q?.question_text || '—',
            answer: val != null ? String(val) : '—',
            comment: fb.comment,
          });
        }
      }
    }
    return rows;
  }, [filteredFeedbacks, questions]);

  // ─── Response-centric analytics ────────────────────────────
  const allResponseAnalytics = useMemo(() =>
    buildResponseAnalytics(filteredFeedbacks, questions),
    [filteredFeedbacks, questions]);

  const responseAnalytics = useMemo(() => {
    if (questionTypeFilter === 'all') return allResponseAnalytics;
    return allResponseAnalytics.filter(a => a.questionType === questionTypeFilter);
  }, [allResponseAnalytics, questionTypeFilter]);

  const trendData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return [];
    return dateComparison.dates.map(d => ({
      date: `${new Date(`${d.date}T00:00:00`).getMonth() + 1}/${new Date(`${d.date}T00:00:00`).getDate()}`,
      rating: d.averageRating, responses: d.responses, engagement: d.responseRate,
    }));
  }, [dateComparison]);

  const paginatedRecords = useMemo(() => {
    const start = recordsPage * RECORDS_PER_PAGE;
    return flattenedRecords.slice(start, start + RECORDS_PER_PAGE);
  }, [flattenedRecords, recordsPage]);

  const totalPages = Math.ceil(flattenedRecords.length / RECORDS_PER_PAGE);

  // ─── Toggle handlers ──────────────────────────────────────
  const handleToggleFeedbackEnabled = async () => {
    if (!selectedSession) return;
    const nextValue = !selectedSession.feedback_enabled;
    setUpdatingFeedbackEnabled(true);
    const { error } = await feedbackService.toggleFeedback(selectedSession.session_id, nextValue);
    setUpdatingFeedbackEnabled(false);
    if (error) { toast.error(error.message || 'Unable to update feedback availability.', 7000); return; }
    setSessions(c => c.map(s => s.session_id === selectedSession.session_id ? { ...s, feedback_enabled: nextValue } : s));
    toast.success(nextValue ? 'Feedback is now live.' : 'Feedback is now hidden.');
  };

  const handleToggleAnonymousAllowed = async () => {
    if (!selectedSession) return;
    const nextValue = !selectedSession.feedback_anonymous_allowed;
    setUpdatingAnonymousAllowed(true);
    const { error } = await feedbackService.setAnonymousAllowed(selectedSession.session_id, nextValue);
    setUpdatingAnonymousAllowed(false);
    if (error) { toast.error(error.message || 'Unable to update anonymous feedback setting.', 7000); return; }
    setSessions(c => c.map(s => s.session_id === selectedSession.session_id ? { ...s, feedback_anonymous_allowed: nextValue } : s));
    toast.success(nextValue ? 'Anonymous feedback allowed.' : 'Feedback now records identity.');
  };

  // ─── AI Insights computation ───────────────────────────────
  const aiInsights = useMemo(() => {
    if (feedbacks.length < 3) return [];
    const insights: { type: 'positive' | 'warning' | 'info'; message: string }[] = [];

    // Trend
    if (dateComparison?.trendDirection === 'declining')
      insights.push({ type: 'warning', message: 'Ratings are declining over time — consider reviewing session content or pace.' });
    if (dateComparison?.trendDirection === 'improving')
      insights.push({ type: 'positive', message: 'Ratings are improving across sessions — students are responding well.' });

    // Low engagement dates
    if (dateComparison) {
      const lowEng = dateComparison.dates.filter(d => d.responseRate < 30 && d.responseRate > 0);
      if (lowEng.length > 0)
        insights.push({ type: 'warning', message: `Low engagement (<30%) on ${lowEng.length} date(s): ${lowEng.map(d => d.date).join(', ')}` });
    }

    // Check-in method correlation
    const rateBy = (method: string) => {
      const sub = feedbacks.filter(f => f.check_in_method === method && f.overall_rating != null);
      return sub.length > 2 ? sub.reduce((s, f) => s + Number(f.overall_rating), 0) / sub.length : null;
    };
    const qrAvg = rateBy('qr'); const faceAvg = rateBy('face'); const manualAvg = rateBy('manual');
    if (qrAvg && faceAvg && Math.abs(qrAvg - faceAvg) > 0.6)
      insights.push({ type: 'info', message: `QR check-in avg rating: ${qrAvg.toFixed(1)} vs Face: ${faceAvg.toFixed(1)} — noticeable difference in satisfaction by check-in method.` });
    if (qrAvg && manualAvg && Math.abs(qrAvg - manualAvg) > 0.6)
      insights.push({ type: 'info', message: `QR check-in avg rating: ${qrAvg.toFixed(1)} vs Manual: ${manualAvg.toFixed(1)}` });

    // Anonymous vs named
    const anonSub = feedbacks.filter(f => f.is_anonymous && f.overall_rating != null);
    const namedSub = feedbacks.filter(f => !f.is_anonymous && f.overall_rating != null);
    if (anonSub.length > 2 && namedSub.length > 2) {
      const anonAvg = anonSub.reduce((s, f) => s + Number(f.overall_rating), 0) / anonSub.length;
      const namedAvg = namedSub.reduce((s, f) => s + Number(f.overall_rating), 0) / namedSub.length;
      if (Math.abs(anonAvg - namedAvg) > 0.7)
        insights.push({ type: 'info', message: `Anonymous ratings (${anonAvg.toFixed(1)}) differ from named (${namedAvg.toFixed(1)}) — students may feel more comfortable rating honestly when anonymous.` });
    }

    // Text sentiment analysis
    const textQs = questions.filter(q => q.question_type === 'text');
    if (textQs.length > 0) {
      const allText = feedbacks.flatMap(f => textQs.map(q => String(f.responses?.[q.id] || '')).filter(Boolean));
      const positive = ['good', 'great', 'excellent', 'helpful', 'clear', 'interesting', 'enjoyed', 'best', 'amazing', 'wonderful', 'fantastic'];
      const negative = ['bad', 'boring', 'confusing', 'difficult', 'slow', 'unclear', 'hard', 'worse', 'complicated', 'unhelpful', 'poor'];
      const posCount = allText.reduce((s, t) => s + positive.filter(w => t.toLowerCase().includes(w)).length, 0);
      const negCount = allText.reduce((s, t) => s + negative.filter(w => t.toLowerCase().includes(w)).length, 0);
      if (allText.length >= 3) {
        if (posCount > negCount * 2)
          insights.push({ type: 'positive', message: `Text responses are predominantly positive (${posCount} positive vs ${negCount} concern signals detected).` });
        else if (negCount > posCount * 1.5)
          insights.push({ type: 'warning', message: `Text responses show more concerns (${negCount} negative vs ${posCount} positive signals). Review comments for specific issues.` });
        else
          insights.push({ type: 'info', message: `Text feedback sentiment is mixed (${posCount} positive, ${negCount} negative signals across ${allText.length} responses).` });
      }
    }

    // Polarized question detection
    for (const item of allResponseAnalytics) {
      if (item.data.type === 'rating' && item.data.total >= 5) {
        const high = (item.data.distribution[4] || 0) + (item.data.distribution[5] || 0);
        const low = (item.data.distribution[1] || 0) + (item.data.distribution[2] || 0);
        if (high > 0 && low > 0 && (Math.min(high, low) / item.data.total) > 0.2)
          insights.push({ type: 'warning', message: `"${item.questionText}" has polarized opinions — ${Math.round((low / item.data.total) * 100)}% low, ${Math.round((high / item.data.total) * 100)}% high ratings.` });
      }
    }

    // Best question (highest avg rating)
    const ratingQs = allResponseAnalytics.filter(q => q.data.type === 'rating' && q.data.total >= 3);
    if (ratingQs.length > 1) {
      const best = ratingQs.reduce((a, b) => (a.data as { avg: number }).avg > (b.data as { avg: number }).avg ? a : b);
      const bestData = best.data as { avg: number };
      if (bestData.avg >= 4.2)
        insights.push({ type: 'positive', message: `Highest-rated aspect: "${best.questionText}" with avg ${bestData.avg}/5.` });
    }

    return insights;
  }, [feedbacks, dateComparison, questions, allResponseAnalytics]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 sm:space-y-6">
      <Breadcrumb items={[{ label: 'Dashboard', path: '/' }, { label: 'Feedback Analytics' }]} />

      {/* ─── Header ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
            Feedback Analytics
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 dark:text-gray-500 max-w-xl">
            Analyze student feedback responses per question, session, and date.
          </p>
        </div>
        {flattenedRecords.length > 0 && activeView === 'records' && (
          <Button variant="outline" size="sm" className="rounded-full self-start sm:self-auto" onClick={() => exportFeedbackCSV(flattenedRecords, selectedSession?.course_name || 'feedback', selectedAnalyticsDate)}>
            📥 Export CSV
          </Button>
        )}
      </div>

      {/* ─── Session Selector ────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <Select
            label=""
            value={selectedSessionId}
            onChange={setSelectedSessionId}
            options={sessions.map(s => ({
              value: s.session_id,
              label: `${s.course_name} · ${s.teacher_name}${s.feedback_enabled ? '' : ' · OFF'}`,
            }))}
            placeholder="Select session..."
          />
        </div>
        {selectedSession && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleToggleFeedbackEnabled}
              disabled={updatingFeedbackEnabled}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                selectedSession.feedback_enabled
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
              } disabled:opacity-50`}
            >
              {updatingFeedbackEnabled ? '...' : selectedSession.feedback_enabled ? '✓ Live' : '○ Off'}
            </button>
            <button
              onClick={handleToggleAnonymousAllowed}
              disabled={updatingAnonymousAllowed || !selectedSession.feedback_enabled}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                selectedSession.feedback_anonymous_allowed
                  ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
              } disabled:opacity-50`}
            >
              {updatingAnonymousAllowed ? '...' : selectedSession.feedback_anonymous_allowed ? '🕵️ Anon' : '👤 Named'}
            </button>
          </div>
        )}
      </div>

      {/* ─── Loading / Empty States ──────────────────────────── */}
      {sessions.length === 0 && !loading && (
        <div className="text-center py-20">
          <span className="text-5xl block mb-4">📭</span>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Feedback Sessions</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
            Enable feedback in Session settings to start collecting student responses.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent" />
        </div>
      )}

      {pageError && (
        <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {pageError}
        </div>
      )}

      {!loading && selectedSessionId && feedbacks.length === 0 && !pageError && (
        <div className="text-center py-16">
          <span className="text-5xl block mb-3">📊</span>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Responses Yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
            Set up questions in the Attendance page, then students can respond after checking in.
          </p>
        </div>
      )}

      {!loading && selectedSessionId && feedbacks.length > 0 && (
        <>
          {/* ─── KPI Summary Cards ─────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Responses</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{filteredStats.totalResponses}</p>
              <p className="text-[10px] text-gray-400">{filteredStats.engagedStudents} students</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Avg Rating</p>
              <p className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400">
                {filteredStats.averageRating || '—'}<span className="text-xs sm:text-sm font-bold text-gray-400 ml-1">/ 5</span>
              </p>
              <p className="text-[10px] text-gray-400">{RATING_EMOJIS[Math.round(filteredStats.averageRating) - 1] || ''}</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Engagement</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">{filteredResponseRate}%</p>
              <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden mt-1">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${filteredResponseRate}%` }} />
              </div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Dates</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{filteredStats.datesCovered}</p>
              {dateComparison && dateComparison.trendDirection !== 'insufficient' && (
                <p className={`text-[10px] font-semibold ${
                  dateComparison.trendDirection === 'improving' ? 'text-emerald-500' : dateComparison.trendDirection === 'declining' ? 'text-red-500' : 'text-gray-400'
                }`}>
                  {dateComparison.trendDirection === 'improving' ? '📈' : dateComparison.trendDirection === 'declining' ? '📉' : '➡️'} {dateComparison.trendDirection}
                </p>
              )}
            </div>
          </div>

          {/* ─── View Tabs ──────────────────────────────────── */}
          <div className="flex items-center gap-1 p-1.5 bg-gray-100/80 dark:bg-gray-800/80 rounded-2xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50">
            {([
              { key: 'records' as ActiveView, icon: '📋', label: 'Records', badge: flattenedRecords.length },
              { key: 'analytics' as ActiveView, icon: '📊', label: 'Analytics', badge: allResponseAnalytics.length },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveView(t.key)}
                className={`flex-1 px-3 sm:px-4 py-2.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex items-center justify-center gap-1.5 sm:gap-2 ${
                  activeView === t.key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-md ring-1 ring-gray-200/50 dark:ring-gray-600/50'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-white/50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className="text-sm">{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.label}</span>
                {t.badge != null && t.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    activeView === t.key ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                  }`}>{t.badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* VIEW: FEEDBACK RECORDS (one row per Q&A)           */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'records' && (
            <div className="space-y-3 sm:space-y-4">
              {/* Filters Row */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-end">
                <div className="flex-1 min-w-0">
                  <label className="text-[11px] text-gray-400 block mb-1">Search</label>
                  <input
                    type="text"
                    value={feedbackSearch}
                    onChange={e => { setFeedbackSearch(e.target.value); setRecordsPage(0); }}
                    placeholder="Search student, answer, comment..."
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white placeholder:text-gray-400"
                  />
                </div>
                <div className="w-full sm:w-auto sm:min-w-[140px]">
                  <label className="text-[11px] text-gray-400 block mb-1">Date</label>
                  <select
                    value={selectedAnalyticsDate}
                    onChange={e => { setSelectedAnalyticsDate(e.target.value); setRecordsPage(0); }}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="">All Dates</option>
                    {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {(feedbackSearch || selectedAnalyticsDate) && (
                  <button
                    onClick={() => { setFeedbackSearch(''); setSelectedAnalyticsDate(''); setRecordsPage(0); }}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-2 rounded-lg border border-purple-200 dark:border-purple-700"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>

              {/* Records Table — one row per question-answer */}
              {flattenedRecords.length === 0 ? (
                <div className="text-center py-12">
                  <span className="text-4xl block mb-3">🔍</span>
                  <p className="text-sm text-gray-500">No records match your filters.</p>
                </div>
              ) : (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          {['Student', 'Date', 'Type', 'Question', 'Answer', 'Comment'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-gray-400 font-semibold text-left first:pl-4 sm:first:pl-5 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {paginatedRecords.map((row, idx) => (
                          <tr key={`${row.feedbackId}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                            <td className="px-3 py-3 pl-4 sm:pl-5 whitespace-nowrap">
                              {row.isAnonymous ? (
                                <span className="text-gray-400 italic">🕵️ Anon</span>
                              ) : (
                                <span className="font-medium text-gray-900 dark:text-white">{row.studentName}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row.attendanceDate}</td>
                            <td className="px-3 py-3">
                              <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] capitalize whitespace-nowrap">
                                {row.questionType}
                              </span>
                            </td>
                            <td className="px-3 py-3 max-w-[180px]">
                              <p className="text-gray-700 dark:text-gray-300 truncate" title={row.questionText}>{row.questionText}</p>
                            </td>
                            <td className="px-3 py-3 max-w-[160px]">
                              <span className="font-medium text-gray-900 dark:text-white truncate block" title={row.answer}>{row.answer}</span>
                            </td>
                            <td className="px-3 py-3 max-w-[140px]">
                              {row.comment ? (
                                <p className="text-gray-600 dark:text-gray-400 truncate" title={row.comment}>{row.comment}</p>
                              ) : <span className="text-gray-400">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-[11px] text-gray-400">
                        {recordsPage * RECORDS_PER_PAGE + 1}–{Math.min((recordsPage + 1) * RECORDS_PER_PAGE, flattenedRecords.length)} of {flattenedRecords.length}
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setRecordsPage(p => Math.max(0, p - 1))}
                          disabled={recordsPage === 0}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          ‹
                        </button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          const page = totalPages <= 5 ? i : Math.max(0, Math.min(recordsPage - 2, totalPages - 5)) + i;
                          return (
                            <button
                              key={page}
                              onClick={() => setRecordsPage(page)}
                              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all ${
                                recordsPage === page
                                  ? 'border-purple-500 bg-purple-600 text-white'
                                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-purple-300'
                              }`}
                            >
                              {page + 1}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => setRecordsPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={recordsPage >= totalPages - 1}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* VIEW: QUESTION ANALYTICS (response-centric)        */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'analytics' && (
            <div className="space-y-4 sm:space-y-5">
              {/* Filters: Date + Question Type */}
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="w-full sm:w-auto sm:min-w-[160px]">
                  <label className="text-[11px] text-gray-400 block mb-1">Date</label>
                  <select
                    value={selectedAnalyticsDate}
                    onChange={e => setSelectedAnalyticsDate(e.target.value)}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="">All Dates</option>
                    {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'rating', 'text', 'multiple_choice'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setQuestionTypeFilter(t)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                        questionTypeFilter === t
                          ? 'border-purple-500 bg-purple-600 text-white'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-purple-300'
                      }`}
                    >
                      {t === 'all' ? 'All Types' : t === 'multiple_choice' ? 'Multiple Choice' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                {(selectedAnalyticsDate || questionTypeFilter !== 'all') && (
                  <button
                    onClick={() => { setSelectedAnalyticsDate(''); setQuestionTypeFilter('all'); }}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-700 self-start sm:self-auto"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>

              {/* Per-Question Analytics Cards */}
              {responseAnalytics.length === 0 ? (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-3">📊</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Response Data</h3>
                  <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                    {questionTypeFilter !== 'all'
                      ? 'No responses match this type filter. Try "All Types".'
                      : 'No student responses found for this session/date. Questions are analyzed only after students submit answers.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
                  {responseAnalytics.map((item, index) => (
                    <div key={item.questionId} className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{item.questionText}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">{item.questionType.replace('_', ' ')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 font-semibold">{item.data.total} answers</span>
                            {item.attendanceDate && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600">{item.attendanceDate}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Rating visualization */}
                      {item.data.type === 'rating' && (() => {
                        const rd = item.data as { type: 'rating'; distribution: Record<number, number>; avg: number; total: number };
                        return (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{rd.avg}</span>
                            <span className="text-sm text-gray-400">/ 5</span>
                            <span>{RATING_EMOJIS[Math.round(rd.avg) - 1] || ''}</span>
                          </div>
                          {[5, 4, 3, 2, 1].map(r => {
                            const count = rd.distribution[r] || 0;
                            const width = rd.total > 0 ? (count / rd.total) * 100 : 0;
                            return (
                              <div key={r} className="flex items-center gap-2">
                                <span className="text-[10px] w-4 text-right text-gray-500">{r}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: RATING_COLORS[r - 1] }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-7 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {/* Multiple choice distribution */}
                      {item.data.type === 'multiple_choice' && (() => {
                        const mc = item.data as { type: 'multiple_choice'; distribution: Record<string, number>; total: number };
                        return (
                        <div className="space-y-2">
                          {Object.entries(mc.distribution).sort(([, a], [, b]) => b - a).map(([option, count]) => {
                            const width = mc.total > 0 ? (count / mc.total) * 100 : 0;
                            return (
                              <div key={option} className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-600 dark:text-gray-300 w-24 truncate shrink-0" title={option}>{option}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${width}%` }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-14 text-right">{count} ({Math.round(width)}%)</span>
                              </div>
                            );
                          })}
                        </div>
                        );
                      })()}

                      {/* Text responses */}
                      {item.data.type === 'text' && (() => {
                        const td = item.data as { type: 'text'; answers: string[]; total: number };
                        return (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {td.answers.map((answer, ai) => (
                            <p key={ai} className="text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5">"{answer}"</p>
                          ))}
                        </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}

              {/* Rating Trend Chart */}
              {trendData.length >= 2 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                  <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">Rating Trend Over Time</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="rating" stroke="#8b5cf6" fill="url(#ratingGrad)" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} name="Avg Rating" />
                      <Line type="monotone" dataKey="responses" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 2 }} name="Volume" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Date Comparison Table */}
              {dateComparison && dateComparison.dates.length > 1 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Date Comparison</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          {['Date', 'Avg Rating', 'Responses', 'Students', 'Engagement'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-gray-400 font-semibold text-left first:pl-4 sm:first:pl-5 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {dateComparison.dates.map(d => (
                          <tr key={d.date} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                            <td className="px-3 py-2.5 pl-4 sm:pl-5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                              {d.date}
                              {dateComparison.bestDate === d.date && <span className="ml-1 text-[10px] text-emerald-600">★</span>}
                            </td>
                            <td className={`px-3 py-2.5 font-bold ${d.averageRating >= 4 ? 'text-emerald-600' : d.averageRating >= 3 ? 'text-amber-600' : 'text-red-600'}`}>
                              {d.averageRating} {RATING_EMOJIS[Math.round(d.averageRating) - 1] || ''}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{d.responses}</td>
                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{d.uniqueStudents}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <div className="w-12 sm:w-16 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${d.responseRate}%` }} />
                                </div>
                                <span className="text-gray-500">{d.responseRate}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ─── AI Insights Panel ─────────────────────── */}
              {aiInsights.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">AI Insights</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 font-bold">{aiInsights.length}</span>
                  </div>
                  <div className="space-y-2">
                    {aiInsights.map((insight, i) => (
                      <div key={i} className={`flex items-start gap-2 sm:gap-3 rounded-xl px-3 py-2.5 text-xs ${
                        insight.type === 'positive' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200'
                        : insight.type === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200'
                        : 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
                      }`}>
                        <span className="shrink-0 mt-0.5">{insight.type === 'positive' ? '✅' : insight.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                        <span>{insight.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
}
