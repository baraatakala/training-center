import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { toast } from '../components/ui/toastUtils';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { feedbackService, type SessionFeedback, type FeedbackStats, type FeedbackQuestion, type FeedbackComparison } from '../services/feedbackService';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Line,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';

// ─── Constants ─────────────────────────────────────────────
const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];
const MOOD_EMOJIS: Record<string, string> = {
  Tired: '😴', Confused: '🤔', Neutral: '😐', Happy: '😊', Energized: '🔥',
};
const PIE_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1'];

type ActiveTab = 'analytics' | 'questions' | 'dates';
type MethodFilter = 'all' | 'qr_code' | 'photo' | 'manual' | 'bulk' | 'unknown';
type QuestionTypeFilter = 'all' | FeedbackQuestion['question_type'];

interface SessionOption {
  session_id: string;
  course_name: string;
  teacher_name: string;
  start_date: string;
  end_date: string;
  feedback_enabled: boolean;
  feedback_anonymous_allowed: boolean;
}

// ─── Per-question analytics helpers ────────────────────────
function aggregateQuestionResponses(
  question: FeedbackQuestion,
  feedbacks: SessionFeedback[]
) {
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

  // text
  return { type: 'text' as const, answers: values.map(String), total: values.length };
}

// ─── CSV export helper ─────────────────────────────────────
function exportFeedbackCSV(
  feedbacks: SessionFeedback[],
  questions: FeedbackQuestion[],
  courseName: string
) {
  const headers = ['Student', 'Date', 'Overall Rating', 'Comment', 'Anonymous', 'Check-In Method'];
  for (const q of questions) headers.push(q.question_text);
  
  const rows = feedbacks.map(fb => {
    const base = [
      fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown'),
      fb.attendance_date,
      fb.overall_rating != null ? String(fb.overall_rating) : '',
      fb.comment || '',
      fb.is_anonymous ? 'Yes' : 'No',
      fb.check_in_method === 'qr_code' ? 'QR Code' : fb.check_in_method === 'photo' ? 'Photo' : fb.check_in_method || '',
    ];
    for (const q of questions) {
      const val = fb.responses?.[q.id];
      base.push(val != null ? String(val) : '');
    }
    return base;
  });

  const csvContent = [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-${courseName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export function FeedbackAnalytics() {
  const [searchParams] = useSearchParams();
  const sessionParam = searchParams.get('session');
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedbacks, setFeedbacks] = useState<SessionFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');
  const [updatingFeedbackEnabled, setUpdatingFeedbackEnabled] = useState(false);
  const [updatingAnonymousAllowed, setUpdatingAnonymousAllowed] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);


  // Date Comparison tab
  const [dateComparison, setDateComparison] = useState<FeedbackComparison | null>(null);
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [dateStats, setDateStats] = useState<FeedbackStats | null>(null);
  const [loadingDateStats, setLoadingDateStats] = useState(false);
  const [analyticsSortBy, setAnalyticsSortBy] = useState<'date' | 'rating' | 'responses' | 'rate'>('date');
  const [analyticsSortDir, setAnalyticsSortDir] = useState<'asc' | 'desc'>('desc');
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('all');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');

  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);

  // ─── Load sessions ────────────────────────────────────────
  useEffect(() => {
    async function loadSessions() {
      const { data, error } = await supabase
        .from('session')
        .select('session_id, start_date, end_date, feedback_enabled, feedback_anonymous_allowed, course:course_id(course_name), teacher:teacher_id(name)')
        .order('start_date', { ascending: false });

      if (error) {
        const message = error.message || 'Unable to load feedback sessions.';
        setPageError(message);
        toast.error(message, 7000);
        return;
      }

      if (data) {
        const mapped = data.map((s: Record<string, unknown>) => {
          const course = s.course as Record<string, string> | Record<string, string>[] | null;
          const teacher = s.teacher as Record<string, string> | Record<string, string>[] | null;
          const courseName = Array.isArray(course) ? course[0]?.course_name : course?.course_name;
          const teacherName = Array.isArray(teacher) ? teacher[0]?.name : teacher?.name;
          return {
            session_id: s.session_id as string,
            course_name: courseName ?? 'Unknown Course',
            teacher_name: teacherName ?? 'Unknown Teacher',
            start_date: String(s.start_date || ''),
            end_date: String(s.end_date || ''),
            feedback_enabled: Boolean(s.feedback_enabled),
            feedback_anonymous_allowed: Boolean(s.feedback_anonymous_allowed ?? true),
          };
        });
        setSessions(mapped);
        setPageError(null);
        if (sessionParam && mapped.some(s => s.session_id === sessionParam)) {
          setSelectedSessionId(sessionParam);
        } else if (selectedSessionId && mapped.some(s => s.session_id === selectedSessionId)) {
          setSelectedSessionId(selectedSessionId);
        } else if (mapped.length > 0) {
          setSelectedSessionId(mapped[0].session_id);
        }
      }
    }
    loadSessions();
  }, [selectedSessionId, sessionParam]);

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
      const feedbackError = fbResult.error as { message?: string } | null;
      const statsError = statsResult.error as { message?: string } | null;
      const questionsError = questionsResult.error as { message?: string } | null;
      const combinedError = feedbackError?.message || statsError?.message || questionsError?.message || null;

      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setQuestions(questionsResult.data || []);
      setPageError(combinedError);

      if (combinedError) {
        toast.error(combinedError, 7000);
      }

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // Refresh feedback data when tab becomes visible
  const refreshFeedbackData = useCallback(() => {
    if (selectedSessionId) {
      feedbackService.getBySession(selectedSessionId).then(r => { if (r.data) setFeedbacks(r.data); });
      feedbackService.getStats(selectedSessionId).then(r => { if (r.data) setStats(r.data); });
      feedbackService.getDateComparison(selectedSessionId).then(r => { if (r.data) setDateComparison(r.data); });
    }
  }, [selectedSessionId]);
  useRefreshOnFocus(refreshFeedbackData);

  // Load date comparison data when session changes
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    feedbackService.getDateComparison(selectedSessionId).then(r => {
      if (!cancelled && r.data) setDateComparison(r.data);
    });
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // Load per-date stats when a specific date is selected
  useEffect(() => {
    if (!selectedSessionId || !selectedAnalyticsDate) { setDateStats(null); return; }
    let cancelled = false;
    setLoadingDateStats(true);
    feedbackService.getStatsByDate(selectedSessionId, selectedAnalyticsDate).then(r => {
      if (!cancelled) {
        setDateStats(r.data);
        setLoadingDateStats(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedSessionId, selectedAnalyticsDate]);

  // ─── Derived data ──────────────────────────────────────────


  // Per-question aggregation
  const questionAnalytics = useMemo(() => {
    return questions.map(q => ({
      question: q,
      data: aggregateQuestionResponses(q, feedbacks),
    }));
  }, [questions, feedbacks]);

  const filteredFeedbacks = useMemo(() => {
    const normalizedSearch = feedbackSearch.trim().toLowerCase();

    return feedbacks.filter((feedback) => {
      if (selectedAnalyticsDate && feedback.attendance_date !== selectedAnalyticsDate) {
        return false;
      }

      const normalizedMethod = (feedback.check_in_method || 'unknown') as MethodFilter;
      if (methodFilter !== 'all' && normalizedMethod !== methodFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        feedback.student_name,
        feedback.comment,
        feedback.attendance_date,
        feedback.check_in_method,
        ...Object.values(feedback.responses || {}).map(String),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [feedbacks, selectedAnalyticsDate, methodFilter, feedbackSearch]);

  const filteredStats = useMemo(() => {
    const rated = filteredFeedbacks.filter((feedback) => feedback.overall_rating != null);
    const totalResponses = filteredFeedbacks.length;
    const engagedStudents = new Set(filteredFeedbacks.map((feedback) => feedback.student_id).filter(Boolean)).size;
    const averageRating = rated.length > 0
      ? Math.round((rated.reduce((sum, feedback) => sum + Number(feedback.overall_rating || 0), 0) / rated.length) * 10) / 10
      : 0;
    const recentComments = filteredFeedbacks
      .filter((feedback) => feedback.comment)
      .slice(0, 8)
      .map((feedback) => ({
        comment: feedback.comment || '',
        rating: feedback.overall_rating || 0,
        date: feedback.attendance_date,
        is_anonymous: feedback.is_anonymous,
      }));

    return {
      totalResponses,
      engagedStudents,
      averageRating,
      datesCovered: new Set(filteredFeedbacks.map((feedback) => feedback.attendance_date)).size,
      recentComments,
      latestResponseDate: filteredFeedbacks[0]?.attendance_date || null,
    };
  }, [filteredFeedbacks]);

  const methodChartData = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const feedback of filteredFeedbacks) {
      const key = feedback.check_in_method || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }

    return Object.entries(counts).map(([method, count]) => ({
      method: method === 'qr_code'
        ? 'QR'
        : method === 'photo'
          ? 'Face'
          : method === 'manual'
            ? 'Manual'
            : method === 'bulk'
              ? 'Bulk'
              : 'Unknown',
      count,
    }));
  }, [filteredFeedbacks]);

  const filteredQuestionAnalytics = useMemo(() => {
    const selectedQuestion = selectedQuestionId
      ? questions.find((question) => question.id === selectedQuestionId) || null
      : null;

    return questions
      .filter((question) => (questionTypeFilter === 'all' ? true : question.question_type === questionTypeFilter))
      .filter((question) => (selectedQuestion ? question.id === selectedQuestion.id : true))
      .filter((question) => {
        if (!feedbackSearch.trim()) return true;
        return question.question_text.toLowerCase().includes(feedbackSearch.trim().toLowerCase());
      })
      .map((question) => ({
        question,
        data: aggregateQuestionResponses(question, filteredFeedbacks),
      }))
      .sort((left, right) => right.data.total - left.data.total);
  }, [questions, questionTypeFilter, selectedQuestionId, feedbackSearch, filteredFeedbacks]);

  const filteredResponseRate = useMemo(() => {
    if (!stats || stats.engagedStudents === 0) return 0;
    return Math.round((filteredStats.engagedStudents / stats.engagedStudents) * 100);
  }, [filteredStats.engagedStudents, stats]);

  // Unique dates for filter
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(feedbacks.map(f => f.attendance_date))].sort().reverse();
    return dates;
  }, [feedbacks]);

  // Sorted date summaries for Dates tab
  const sortedDateSummaries = useMemo(() => {
    if (!dateComparison) return [];
    const sorted = [...dateComparison.dates];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (analyticsSortBy === 'date') cmp = a.date.localeCompare(b.date);
      else if (analyticsSortBy === 'rating') cmp = a.averageRating - b.averageRating;
      else if (analyticsSortBy === 'responses') cmp = a.responses - b.responses;
      else if (analyticsSortBy === 'rate') cmp = a.responseRate - b.responseRate;
      return analyticsSortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [dateComparison, analyticsSortBy, analyticsSortDir]);

  // Per-question analytics filtered by selected date
  const dateFilteredQuestionAnalytics = useMemo(() => {
    if (!selectedAnalyticsDate) return questionAnalytics;
    const dateFeedbacks = feedbacks.filter(f => f.attendance_date === selectedAnalyticsDate);
    return questions.map(q => ({
      question: q,
      data: aggregateQuestionResponses(q, dateFeedbacks),
    }));
  }, [selectedAnalyticsDate, feedbacks, questions, questionAnalytics]);

  // Radar chart data for date comparison
  const radarData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return [];
    return dateComparison.dates.map(d => {
      const dateLabel = new Date(`${d.date}T00:00:00`);
      return {
        date: `${dateLabel.getMonth() + 1}/${dateLabel.getDate()}`,
        rating: d.averageRating,
        responses: d.responses,
        engagement: d.responseRate,
      };
    });
  }, [dateComparison]);

  // Date heatmap data
  const dateHeatmapData = useMemo(() => {
    if (!dateComparison) return [];
    return dateComparison.dates.map(d => ({
      date: d.date,
      label: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      rating: d.averageRating,
      responses: d.responses,
      rate: d.responseRate,
    }));
  }, [dateComparison]);

  const handleToggleFeedbackEnabled = async () => {
    if (!selectedSession) return;

    const nextValue = !selectedSession.feedback_enabled;
    setUpdatingFeedbackEnabled(true);
    const { error } = await feedbackService.toggleFeedback(selectedSession.session_id, nextValue);
    setUpdatingFeedbackEnabled(false);

    if (error) {
      toast.error(error.message || 'Unable to update feedback availability.', 7000);
      return;
    }

    setSessions((current) => current.map((session) => (
      session.session_id === selectedSession.session_id
        ? { ...session, feedback_enabled: nextValue }
        : session
    )));
    toast.success(nextValue ? 'Feedback is now live for this session.' : 'Feedback is now hidden from students for this session.');
  };

  const handleToggleAnonymousAllowed = async () => {
    if (!selectedSession) return;

    const nextValue = !selectedSession.feedback_anonymous_allowed;
    setUpdatingAnonymousAllowed(true);
    const { error } = await feedbackService.setAnonymousAllowed(selectedSession.session_id, nextValue);
    setUpdatingAnonymousAllowed(false);

    if (error) {
      toast.error(error.message || 'Unable to update anonymous feedback setting.', 7000);
      return;
    }

    setSessions((current) => current.map((session) => (
      session.session_id === selectedSession.session_id
        ? { ...session, feedback_anonymous_allowed: nextValue }
        : session
    )));
    toast.success(nextValue ? 'Anonymous feedback is now allowed.' : 'Feedback now records the student identity internally.');
  };



  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Breadcrumb Navigation */}
      <Breadcrumb items={[
        { label: 'Dashboard', path: '/' },
        { label: 'Feedback Analytics' },
      ]} />
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white text-lg shadow-lg shadow-purple-500/20 shrink-0">💜</div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white truncate">Feedback Analytics</h1>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Student feedback insights & analytics</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <Select
              label=""
              value={selectedSessionId}
              onChange={setSelectedSessionId}
              options={sessions.map(s => ({
                value: s.session_id,
                label: `${s.course_name}${s.feedback_enabled ? '' : ' · Feedback Off'}`,
              }))}
              placeholder="Select session..."
            />
          </div>
          {feedbacks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportFeedbackCSV(feedbacks, questions, selectedSession?.course_name || 'feedback')}
              className="shrink-0"
            >
              📥 CSV
            </Button>
          )}
        </div>
      </div>

      {/* ─── No sessions ─────────────────────────────────────── */}
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

      {!loading && selectedSessionId && (
        <>
          {pageError && (
            <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 break-words leading-relaxed">
              {pageError}
            </div>
          )}

          {selectedSession && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedSession.course_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Teacher: {selectedSession.teacher_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{selectedSession.start_date} to {selectedSession.end_date}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selectedSession.feedback_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {selectedSession.feedback_enabled ? 'Feedback Enabled' : 'Feedback Disabled'}
                  </span>
                  <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    {questions.length} question{questions.length === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    {stats?.datesCovered ?? 0} date{stats?.datesCovered === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleToggleFeedbackEnabled}
                  disabled={updatingFeedbackEnabled}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 text-left transition hover:border-purple-300 dark:hover:border-purple-700 disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Feedback availability</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Students only see the form after a successful check-in when this is enabled.</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selectedSession.feedback_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                      {updatingFeedbackEnabled ? 'Saving...' : selectedSession.feedback_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleToggleAnonymousAllowed}
                  disabled={updatingAnonymousAllowed || !selectedSession.feedback_enabled}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 text-left transition hover:border-purple-300 dark:hover:border-purple-700 disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Anonymous mode</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Keep answers anonymous in the analytics UI while still blocking duplicates.</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selectedSession.feedback_anonymous_allowed ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                      {updatingAnonymousAllowed ? 'Saving...' : selectedSession.feedback_anonymous_allowed ? 'Allowed' : 'Disabled'}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {selectedSession && !selectedSession.feedback_enabled && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              Feedback is currently turned off for this session. You can still prepare questions and templates now, then enable it when you want students to see the form after check-in.
            </div>
          )}

          {/* ─── Tabs (pill style) ──────────────────────────────── */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
            {([
              { key: 'analytics' as ActiveTab, label: 'Analytics', icon: '📊', badge: stats?.totalResponses },
              { key: 'questions' as ActiveTab, label: 'Questions', icon: '🧩', badge: questions.length },
              { key: 'dates' as ActiveTab, label: 'By Date', icon: '📅', badge: dateComparison?.dates.length },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === t.key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <span className="text-xs">{t.icon}</span>
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeTab === t.key
                      ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 p-3">
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Attendance date</label>
              <select
                value={selectedAnalyticsDate}
                onChange={e => setSelectedAnalyticsDate(e.target.value)}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
              >
                <option value="">All dates</option>
                {uniqueDates.map(date => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Check-in method</label>
              <select
                value={methodFilter}
                onChange={e => setMethodFilter(e.target.value as MethodFilter)}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All methods</option>
                <option value="qr_code">QR code</option>
                <option value="photo">Face recognition</option>
                <option value="manual">Manual</option>
                <option value="bulk">Bulk</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Question type</label>
              <select
                value={questionTypeFilter}
                onChange={e => setQuestionTypeFilter(e.target.value as QuestionTypeFilter)}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All question types</option>
                <option value="rating">Rating</option>
                <option value="emoji">Emoji</option>
                <option value="text">Text</option>
                <option value="multiple_choice">Multiple choice</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Search feedback</label>
              <input
                value={feedbackSearch}
                onChange={e => setFeedbackSearch(e.target.value)}
                placeholder="Student, comment, answer..."
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: ANALYTICS                                     */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'analytics' && (
            <>
              {feedbacks.length > 0 ? (
                <div className="space-y-5">
                  {/* KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Responses', value: String(filteredStats.totalResponses), sub: `${filteredStats.datesCovered} filtered dates`, color: 'purple' },
                      { label: 'Students', value: `${filteredStats.engagedStudents}`, sub: `${filteredResponseRate}% of engaged students`, color: 'green' },
                      { label: 'Avg Rating', value: `${filteredStats.averageRating || '—'}`, sub: filteredStats.averageRating ? (RATING_EMOJIS[Math.round(filteredStats.averageRating) - 1] || '') : 'No ratings', color: 'yellow' },
                      { label: 'Questions Used', value: `${filteredQuestionAnalytics.filter(item => item.data.total > 0).length}`, sub: filteredStats.latestResponseDate ? `Latest ${filteredStats.latestResponseDate}` : 'No feedback yet', color: 'purple' },
                    ].map(kpi => (
                      <div key={kpi.label} className={`p-4 rounded-xl border ${
                        kpi.color === 'purple' ? 'border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10' :
                        kpi.color === 'yellow' ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10' :
                        kpi.color === 'green' ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' :
                        kpi.color === 'red' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' :
                        'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30'
                      }`}>
                        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{kpi.label}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{kpi.value}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{kpi.sub}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1.1fr,0.9fr] gap-4">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">📡 Check-In Method Mix</p>
                        <span className="text-[10px] text-gray-400">Filtered results only</span>
                      </div>
                      {methodChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={methodChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                            <XAxis dataKey="method" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#8b5cf6" />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">No method data for current filters.</div>
                      )}
                    </div>

                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🧩 Question Coverage</p>
                        <Button size="sm" variant="outline" onClick={() => setActiveTab('questions')}>Open Insights</Button>
                      </div>
                      <div className="space-y-2">
                        {filteredQuestionAnalytics.slice(0, 5).map(({ question, data }) => (
                          <button
                            key={question.id}
                            type="button"
                            onClick={() => {
                              setSelectedQuestionId(question.id);
                              setActiveTab('questions');
                            }}
                            className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2">{question.question_text}</p>
                              <span className="text-[10px] rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 shrink-0">{data.total}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">{question.question_type.replace('_', ' ')} · {question.attendance_date || 'all dates'}</p>
                          </button>
                        ))}
                        {filteredQuestionAnalytics.length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-8">No question activity for the current filters.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Recent Comments */}
                  {filteredStats.recentComments.length > 0 && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">💬 Matching Comments</p>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {filteredStats.recentComments.map((c, i) => (
                          <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                            <span className="text-lg shrink-0 mt-0.5">{RATING_EMOJIS[c.rating - 1] || '❓'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 dark:text-gray-200">{c.comment}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-gray-400">{c.date}</span>
                                {c.is_anonymous && <span className="text-[10px] text-gray-400">🕵️ Anonymous</span>}
                                <div className="flex gap-0.5 ml-auto">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <span key={s} className={`text-[10px] ${s <= c.rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-3">📊</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Responses Yet</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
                    Set up questions in the Attendance page, then students can respond after checking in.
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === 'questions' && (
            <div className="space-y-5">
              <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
                <div className="lg:w-72">
                  <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Focus question</label>
                  <select
                    value={selectedQuestionId}
                    onChange={e => setSelectedQuestionId(e.target.value)}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="">All questions</option>
                    {questions.map(question => (
                      <option key={question.id} value={question.id}>{question.question_text}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Compare question response volume, answer distribution, and text answers using the same date, method, and search filters above.
                </div>
              </div>

              {filteredQuestionAnalytics.length === 0 ? (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-3">🧩</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Question Matches</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
                    Try clearing a filter or selecting another question type/date combination.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filteredQuestionAnalytics.map(({ question, data }, index) => (
                    <div key={question.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{question.question_text}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">{question.question_type.replace('_', ' ')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">{data.total} answers</span>
                            {question.attendance_date && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">{question.attendance_date}</span>}
                          </div>
                        </div>
                      </div>

                      {data.total === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No responses for this question under the current filters.</p>
                      ) : data.type === 'rating' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{data.avg}</span>
                            <span>{RATING_EMOJIS[Math.round(data.avg) - 1] || ''}</span>
                          </div>
                          {[5, 4, 3, 2, 1].map(rating => {
                            const count = data.distribution[rating] || 0;
                            const width = data.total > 0 ? (count / data.total) * 100 : 0;
                            return (
                              <div key={rating} className="flex items-center gap-2">
                                <span className="text-[10px] w-4 text-right">{rating}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: RATING_COLORS[rating - 1] }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-7 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : data.type === 'emoji' ? (
                        <div className="flex flex-wrap gap-3 justify-center py-2">
                          {Object.entries(data.distribution).sort(([, left], [, right]) => right - left).map(([value, count]) => (
                            <div key={value} className="text-center min-w-[56px]">
                              <span className="text-2xl block">{MOOD_EMOJIS[value] || value}</span>
                              <span className="text-[10px] text-gray-500 dark:text-gray-400">{count}</span>
                            </div>
                          ))}
                        </div>
                      ) : data.type === 'multiple_choice' ? (
                        <div className="space-y-2">
                          {Object.entries(data.distribution).sort(([, left], [, right]) => right - left).map(([option, count], optionIndex) => {
                            const width = data.total > 0 ? (count / data.total) * 100 : 0;
                            return (
                              <div key={option} className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-600 dark:text-gray-300 w-24 truncate shrink-0">{option}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: PIE_COLORS[optionIndex % PIE_COLORS.length] }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-8 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {data.answers.map((answer, answerIndex) => (
                            <p key={answerIndex} className="text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5">
                              {answer}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: DATES (Per-Date Deep Analytics)              */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'dates' && (
            <div className="space-y-5">
              {/* Trend Overview Banner */}
              {dateComparison && dateComparison.dates.length >= 2 && (
                <div className={`rounded-xl border p-4 ${
                  dateComparison.trendDirection === 'improving' ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' :
                  dateComparison.trendDirection === 'declining' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' :
                  'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {dateComparison.trendDirection === 'improving' ? '📈' : dateComparison.trendDirection === 'declining' ? '📉' : '➡️'}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        Feedback trend: <span className="capitalize">{dateComparison.trendDirection}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {dateComparison.dates.length} session dates tracked · Overall avg: {dateComparison.overallAvg}/5
                        {dateComparison.bestDate && ` · Best: ${dateComparison.bestDate}`}
                        {dateComparison.worstDate && dateComparison.worstDate !== dateComparison.bestDate && ` · Needs attention: ${dateComparison.worstDate}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sort Controls */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2">
                <span className="text-xs text-gray-500 shrink-0">Sort by:</span>
                {([
                  { key: 'date' as const, label: '📅 Date' },
                  { key: 'rating' as const, label: '⭐ Rating' },
                  { key: 'responses' as const, label: '📊 Volume' },
                  { key: 'rate' as const, label: '📈 Engagement' },
                ] as const).map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      if (analyticsSortBy === s.key) setAnalyticsSortDir(d => d === 'asc' ? 'desc' : 'asc');
                      else { setAnalyticsSortBy(s.key); setAnalyticsSortDir('desc'); }
                    }}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${
                      analyticsSortBy === s.key
                        ? 'border-purple-500 bg-purple-600 text-white'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-purple-300'
                    }`}
                  >
                    {s.label} {analyticsSortBy === s.key ? (analyticsSortDir === 'asc' ? '↑' : '↓') : ''}
                  </button>
                ))}
                <span className="text-[10px] text-gray-400 ml-auto">{sortedDateSummaries.length} dates</span>
              </div>

              {/* Date Heatmap */}
              {dateHeatmapData.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">🗓️ Rating Heatmap</p>
                  <div className="flex flex-wrap gap-2">
                    {dateHeatmapData.map(d => {
                      const intensity = d.rating > 0 ? Math.max(0.15, d.rating / 5) : 0;
                      const color = d.rating >= 4 ? `rgba(34,197,94,${intensity})` :
                        d.rating >= 3 ? `rgba(234,179,8,${intensity})` :
                        d.rating > 0 ? `rgba(239,68,68,${intensity})` : 'rgba(156,163,175,0.1)';
                      return (
                        <button
                          key={d.date}
                          type="button"
                          onClick={() => setSelectedAnalyticsDate(selectedAnalyticsDate === d.date ? '' : d.date)}
                          title={`${d.date}: ${d.rating}/5 avg · ${d.responses} responses · ${d.rate}% engagement`}
                          className={`relative rounded-lg px-3 py-2 text-center transition-all min-w-[70px] border ${
                            selectedAnalyticsDate === d.date
                              ? 'ring-2 ring-purple-500 border-purple-400 dark:border-purple-600 shadow-md'
                              : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                          style={{ backgroundColor: color }}
                        >
                          <p className="text-[10px] font-medium text-gray-700 dark:text-gray-200">{d.label}</p>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{d.rating > 0 ? d.rating : '—'}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">{d.responses}r · {d.rate}%</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">Click a date to drill down into its feedback details.</p>
                </div>
              )}

              {/* Selected Date Detail Panel */}
              {selectedAnalyticsDate && (
                <div className="rounded-xl border-2 border-purple-200 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📅</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{selectedAnalyticsDate}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {new Date(`${selectedAnalyticsDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedAnalyticsDate('')}
                      className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 px-2 py-1 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/30"
                    >
                      ✕ Close
                    </button>
                  </div>

                  {loadingDateStats ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent" />
                    </div>
                  ) : dateStats ? (
                    <>
                      {/* Per-date KPI strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-800/50">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Responses</p>
                          <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{dateStats.totalResponses}</p>
                        </div>
                        <div className="p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-800/50">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Students</p>
                          <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{dateStats.engagedStudents}</p>
                          <p className="text-[10px] text-gray-400">{dateStats.responseRate}% engagement</p>
                        </div>
                        <div className="p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-800/50">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">Avg Rating</p>
                          <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                            {dateStats.averageRating} {RATING_EMOJIS[Math.round(dateStats.averageRating) - 1] || ''}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-800/50">
                          <p className="text-[11px] uppercase tracking-wide text-gray-400">vs Overall</p>
                          {stats && (
                            <p className={`text-xl font-bold mt-0.5 ${
                              dateStats.averageRating > stats.averageRating ? 'text-emerald-600 dark:text-emerald-400' :
                              dateStats.averageRating < stats.averageRating ? 'text-red-600 dark:text-red-400' :
                              'text-gray-600 dark:text-gray-300'
                            }`}>
                              {dateStats.averageRating > stats.averageRating ? '+' : ''}
                              {(dateStats.averageRating - stats.averageRating).toFixed(1)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Per-date rating distribution */}
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">⭐ Rating Distribution for {selectedAnalyticsDate}</p>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={[1,2,3,4,5].map(r => ({ rating: `${RATING_EMOJIS[r-1]} ${r}`, count: dateStats.ratingDistribution[r] || 0, fill: RATING_COLORS[r-1] }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                            <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32}>
                              {[1,2,3,4,5].map((_, i) => (
                                <Cell key={i} fill={RATING_COLORS[i]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Per-date question breakdown */}
                      {dateFilteredQuestionAnalytics.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🔍 Question Breakdown for {selectedAnalyticsDate}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {dateFilteredQuestionAnalytics.map(({ question, data: qData }, qi) => (
                              <div key={question.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{qi + 1}</span>
                                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2">{question.question_text}</p>
                                </div>
                                {qData.total === 0 ? (
                                  <p className="text-xs text-gray-400 text-center py-3">No responses for this date</p>
                                ) : qData.type === 'rating' ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{qData.avg}</span>
                                      <span>{RATING_EMOJIS[Math.round(qData.avg) - 1] || ''}</span>
                                      <span className="text-[10px] text-gray-400 ml-auto">{qData.total} resp.</span>
                                    </div>
                                    {[5,4,3,2,1].map(r => {
                                      const count = qData.distribution[r] || 0;
                                      const pct = qData.total > 0 ? (count / qData.total) * 100 : 0;
                                      return (
                                        <div key={r} className="flex items-center gap-1.5">
                                          <span className="text-[10px] w-4 text-right">{r}</span>
                                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: RATING_COLORS[r - 1] }} />
                                          </div>
                                          <span className="text-[10px] text-gray-400 w-6 text-right">{count}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : qData.type === 'emoji' ? (
                                  <div className="flex flex-wrap gap-2 justify-center py-1">
                                    {Object.entries(qData.distribution).sort(([, a], [, b]) => b - a).map(([emoji, count]) => (
                                      <div key={emoji} className="text-center">
                                        <span className="text-xl block">{MOOD_EMOJIS[emoji] || emoji}</span>
                                        <span className="text-[10px] text-gray-500">{count}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : qData.type === 'multiple_choice' ? (
                                  <div className="space-y-1">
                                    {Object.entries(qData.distribution).sort(([, a], [, b]) => b - a).map(([option, count], i) => {
                                      const pct = qData.total > 0 ? (count / qData.total) * 100 : 0;
                                      return (
                                        <div key={option} className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-gray-600 dark:text-gray-300 w-20 truncate shrink-0">{option}</span>
                                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                          </div>
                                          <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="space-y-1 max-h-28 overflow-y-auto">
                                    {qData.answers.slice(0, 5).map((answer, ai) => (
                                      <p key={ai} className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 truncate">&quot;{answer}&quot;</p>
                                    ))}
                                    {qData.answers.length > 5 && <p className="text-[10px] text-gray-400 text-center">+{qData.answers.length - 5} more</p>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Per-date comments */}
                      {dateStats.recentComments.length > 0 && (
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">💬 Comments from {selectedAnalyticsDate}</p>
                          <div className="space-y-2 max-h-[250px] overflow-y-auto">
                            {dateStats.recentComments.map((c, i) => (
                              <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                                <span className="text-lg shrink-0 mt-0.5">{RATING_EMOJIS[c.rating - 1] || '❓'}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800 dark:text-gray-200">{c.comment}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    {c.is_anonymous && <span className="text-[10px] text-gray-400">🕵️ Anonymous</span>}
                                    <div className="flex gap-0.5 ml-auto">
                                      {[1,2,3,4,5].map(s => (
                                        <span key={s} className={`text-[10px] ${s <= c.rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-6">No data for this date.</p>
                  )}
                </div>
              )}

              {/* Date Comparison Table */}
              {sortedDateSummaries.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">📋 Date-by-Date Comparison</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Date</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Avg Rating</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Responses</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Students</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Engagement</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Comments</th>
                          <th className="text-center px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Distribution</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {sortedDateSummaries.map(d => {
                          const isBest = dateComparison?.bestDate === d.date;
                          const isWorst = dateComparison?.worstDate === d.date && dateComparison?.bestDate !== d.date;
                          return (
                            <tr
                              key={d.date}
                              className={`cursor-pointer transition-colors ${
                                selectedAnalyticsDate === d.date
                                  ? 'bg-purple-50 dark:bg-purple-900/20'
                                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                              }`}
                              onClick={() => setSelectedAnalyticsDate(selectedAnalyticsDate === d.date ? '' : d.date)}
                            >
                              <td className="px-3 py-2.5">
                                <span className="font-medium text-gray-900 dark:text-white">{d.date}</span>
                                {isBest && <span className="ml-1 text-[10px] text-emerald-600">★ Best</span>}
                                {isWorst && <span className="ml-1 text-[10px] text-red-500">⚠ Low</span>}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`font-bold ${
                                  d.averageRating >= 4 ? 'text-emerald-600 dark:text-emerald-400' :
                                  d.averageRating >= 3 ? 'text-amber-600 dark:text-amber-400' :
                                  'text-red-600 dark:text-red-400'
                                }`}>
                                  {d.averageRating} {RATING_EMOJIS[Math.round(d.averageRating) - 1] || ''}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">{d.responses}</td>
                              <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">{d.uniqueStudents}</td>
                              <td className="px-3 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <div className="w-16 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${d.responseRate}%` }} />
                                  </div>
                                  <span className="text-gray-500 dark:text-gray-400">{d.responseRate}%</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-center text-gray-500 dark:text-gray-400">{d.commentCount}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex gap-px justify-center">
                                  {[1,2,3,4,5].map(r => {
                                    const count = d.ratingDistribution[r] || 0;
                                    const pct = d.responses > 0 ? (count / d.responses) * 100 : 0;
                                    return (
                                      <div
                                        key={r}
                                        className="w-3 rounded-sm"
                                        style={{ height: `${Math.max(2, pct * 0.2)}px`, backgroundColor: RATING_COLORS[r - 1], minHeight: '2px' }}
                                        title={`${r} star: ${count} (${Math.round(pct)}%)`}
                                      />
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Radar / Comparison Charts */}
              {radarData.length >= 3 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📈 Rating Trend by Date</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={radarData}>
                        <defs>
                          <linearGradient id="dateRatingGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <Tooltip />
                        <Legend />
                        <Area type="monotone" dataKey="rating" stroke="#8b5cf6" fill="url(#dateRatingGrad)" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} name="Avg Rating" />
                        <Line type="monotone" dataKey="responses" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 2 }} name="Volume" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">🎯 Engagement Overview</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData.slice(-8)}>
                        <PolarGrid stroke="#e5e7eb" />
                        <PolarAngleAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#9ca3af" />
                        <PolarRadiusAxis tick={{ fontSize: 8 }} stroke="#9ca3af" />
                        <Radar name="Rating" dataKey="rating" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} />
                        <Radar name="Engagement %" dataKey="engagement" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} />
                        <Legend />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {sortedDateSummaries.length === 0 && (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-3">📅</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Date Data Yet</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
                    Feedback responses filed against specific session dates will appear here with per-date breakdowns, comparisons, and trend tracking.
                  </p>
                </div>
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
}
