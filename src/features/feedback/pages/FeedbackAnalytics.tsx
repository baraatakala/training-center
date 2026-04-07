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
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, Line, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

// ─── Sub-components (new executive design) ─────────────────
import { FeedbackKPICards } from '../components/FeedbackKPICards';
import { EmojiDistribution } from '../components/EmojiDistribution';
import { InstructorMatrix } from '../components/InstructorMatrix';
import { ResponseRepository } from '../components/ResponseRepository';
import { EnrollmentPolls } from '../components/EnrollmentPolls';
import { IntelligenceFeed } from '../components/IntelligenceFeed';

// ─── Constants ─────────────────────────────────────────────
const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];
const MOOD_EMOJIS: Record<string, string> = {
  Tired: '😴', Confused: '🤔', Neutral: '😐', Happy: '😊', Energized: '🔥',
};

type ActiveView = 'overview' | 'drilldown' | 'questions' | 'dates';
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
function aggregateQuestionResponses(question: FeedbackQuestion, feedbacks: SessionFeedback[]) {
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

// ─── CSV export helper ─────────────────────────────────────
function exportFeedbackCSV(feedbacks: SessionFeedback[], questions: FeedbackQuestion[], courseName: string, selectedDate?: string) {
  const headers = ['Student', 'Date', 'Overall Rating', 'Comment', 'Anonymous', 'Check-In Method'];
  for (const q of questions) headers.push(`${q.question_text}${q.attendance_date ? ` (${q.attendance_date})` : ''}`);
  const rows = feedbacks.map(fb => {
    const base = [
      fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown'),
      fb.attendance_date,
      fb.overall_rating != null ? String(fb.overall_rating) : '',
      fb.comment || '',
      fb.is_anonymous ? 'Yes' : 'No',
      fb.check_in_method || '',
    ];
    for (const q of questions) base.push(fb.responses?.[q.id] != null ? String(fb.responses[q.id]) : '');
    return base;
  });
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
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [updatingFeedbackEnabled, setUpdatingFeedbackEnabled] = useState(false);
  const [updatingAnonymousAllowed, setUpdatingAnonymousAllowed] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Date Comparison
  const [dateComparison, setDateComparison] = useState<FeedbackComparison | null>(null);
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [dateStats, setDateStats] = useState<FeedbackStats | null>(null);
  const [loadingDateStats, setLoadingDateStats] = useState(false);
  const [analyticsSortBy, setAnalyticsSortBy] = useState<'date' | 'rating' | 'responses' | 'rate'>('date');
  const [analyticsSortDir, setAnalyticsSortDir] = useState<'asc' | 'desc'>('desc');
  const [methodFilter, _setMethodFilter] = useState<MethodFilter>('all');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');

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

  useEffect(() => {
    if (!selectedSessionId || !selectedAnalyticsDate) { setDateStats(null); return; }
    let cancelled = false;
    setLoadingDateStats(true);
    feedbackService.getStatsByDate(selectedSessionId, selectedAnalyticsDate).then(r => {
      if (!cancelled) { setDateStats(r.data); setLoadingDateStats(false); }
    });
    return () => { cancelled = true; };
  }, [selectedSessionId, selectedAnalyticsDate]);

  // ─── Derived data ──────────────────────────────────────────
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter(fb => {
      if (selectedAnalyticsDate && fb.attendance_date !== selectedAnalyticsDate) return false;
      if (methodFilter !== 'all' && (fb.check_in_method || 'unknown') !== methodFilter) return false;
      if (feedbackSearch.trim()) {
        const haystack = [fb.student_name, fb.comment, ...Object.values(fb.responses || {}).map(String)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(feedbackSearch.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [feedbacks, selectedAnalyticsDate, methodFilter, feedbackSearch]);

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

  const filteredQuestionAnalytics = useMemo(() => {
    return questions
      .filter(q => questionTypeFilter === 'all' || q.question_type === questionTypeFilter)
      .filter(q => !selectedQuestionId || q.id === selectedQuestionId)
      .filter(q => !feedbackSearch.trim() || q.question_text.toLowerCase().includes(feedbackSearch.trim().toLowerCase()))
      .map(q => ({ question: q, data: aggregateQuestionResponses(q, filteredFeedbacks) }))
      .sort((a, b) => b.data.total - a.data.total);
  }, [questions, questionTypeFilter, selectedQuestionId, feedbackSearch, filteredFeedbacks]);

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

  const dateFilteredQuestionAnalytics = useMemo(() => {
    if (!selectedAnalyticsDate) return filteredQuestionAnalytics;
    const dateFb = feedbacks.filter(f => f.attendance_date === selectedAnalyticsDate);
    return questions.map(q => ({ question: q, data: aggregateQuestionResponses(q, dateFb) }));
  }, [selectedAnalyticsDate, feedbacks, questions, filteredQuestionAnalytics]);

  const radarData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return [];
    return dateComparison.dates.map(d => ({
      date: `${new Date(`${d.date}T00:00:00`).getMonth() + 1}/${new Date(`${d.date}T00:00:00`).getDate()}`,
      rating: d.averageRating, responses: d.responses, engagement: d.responseRate,
    }));
  }, [dateComparison]);

  const dateHeatmapData = useMemo(() => {
    if (!dateComparison) return [];
    return dateComparison.dates.map(d => ({
      date: d.date,
      label: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      rating: d.averageRating, responses: d.responses, rate: d.responseRate,
    }));
  }, [dateComparison]);

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

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Dashboard', path: '/' }, { label: 'Feedback Intelligence' }]} />

      {/* ─── Executive Header ──────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
            Feedback Intelligence
          </h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 max-w-lg">
            High-density aggregation of institutional sentiment across all course categories and instructional staff.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedAnalyticsDate}
            onChange={e => setSelectedAnalyticsDate(e.target.value)}
            className="text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-200"
          >
            <option value="">All Dates</option>
            {uniqueDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {feedbacks.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportFeedbackCSV(filteredFeedbacks, questions, selectedSession?.course_name || 'feedback', selectedAnalyticsDate)}>
              📥 Export CSV
            </Button>
          )}
        </div>
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
          {/* ─── View Tabs ──────────────────────────────────── */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
            {([
              { key: 'overview' as ActiveView, label: 'Executive Overview', badge: stats?.totalResponses },
              { key: 'drilldown' as ActiveView, label: 'Response Repository', badge: filteredFeedbacks.length },
              { key: 'questions' as ActiveView, label: 'Question Insights', badge: questions.length },
              { key: 'dates' as ActiveView, label: 'Date Analysis', badge: dateComparison?.dates.length },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveView(t.key)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  activeView === t.key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeView === t.key ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                  }`}>{t.badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* VIEW: EXECUTIVE OVERVIEW (Stitch-inspired)        */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'overview' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <FeedbackKPICards
                stats={stats}
                filteredTotal={filteredStats.totalResponses}
                filteredStudents={filteredStats.engagedStudents}
                filteredAvg={filteredStats.averageRating}
                responseRate={filteredResponseRate}
                questionsUsed={filteredQuestionAnalytics.filter(a => a.data.total > 0).length}
                latestDate={filteredStats.latestResponseDate}
                datesCovered={filteredStats.datesCovered}
              />

              {/* Emoji Distribution (like Stitch screenshot 2) */}
              <EmojiDistribution questions={questions} feedbacks={filteredFeedbacks} />

              {/* Session Performance Matrix (like Stitch Institutional Matrix) */}
              <InstructorMatrix dateComparison={dateComparison} questions={questions} feedbacks={filteredFeedbacks} />

              {/* Two-column: Enrollment Polls + Intelligence Feed */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <EnrollmentPolls questions={questions} feedbacks={filteredFeedbacks} />
                <IntelligenceFeed feedbacks={filteredFeedbacks} questions={questions} />
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* VIEW: RESPONSE REPOSITORY (Session Drill-Down)    */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'drilldown' && (
            <div className="space-y-5">
              {/* Session Header Bento Cards */}
              {selectedSession && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Session Score</p>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black text-purple-600 dark:text-purple-400">{filteredStats.averageRating || '—'}</span>
                      <span className="text-sm font-bold text-gray-400 mb-1">/ 5.0</span>
                    </div>
                    {dateComparison && dateComparison.trendDirection !== 'insufficient' && (
                      <div className={`mt-2 flex items-center gap-1 text-[11px] font-semibold ${
                        dateComparison.trendDirection === 'improving' ? 'text-emerald-600 dark:text-emerald-400'
                          : dateComparison.trendDirection === 'declining' ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {dateComparison.trendDirection === 'improving' ? '📈' : dateComparison.trendDirection === 'declining' ? '📉' : '➡️'}
                        {dateComparison.trendDirection}
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Session Benchmark</p>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-gray-600 dark:text-gray-300 italic">Current Session</span>
                      <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{filteredStats.averageRating}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden mb-3">
                      <div className="bg-purple-600 h-full rounded-full transition-all" style={{ width: `${(filteredStats.averageRating / 5) * 100}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold uppercase">
                      <span>Avg: {dateComparison?.overallAvg ?? '—'}</span>
                      {dateComparison && filteredStats.averageRating > dateComparison.overallAvg && (
                        <span className="text-emerald-500">Outperforming by {(filteredStats.averageRating - dateComparison.overallAvg).toFixed(1)}</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Engagement</p>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-gray-600 dark:text-gray-300 italic">Response Rate</span>
                      <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{filteredResponseRate}%</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full overflow-hidden mb-3">
                      <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${filteredResponseRate}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold uppercase">
                      <span>{filteredStats.engagedStudents} students participated</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Session metadata chips */}
              {selectedSession && (
                <div className="flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs font-semibold text-gray-600 dark:text-gray-300">
                    📅 {selectedSession.start_date} → {selectedSession.end_date}
                  </span>
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs font-semibold text-gray-600 dark:text-gray-300">
                    👤 {selectedSession.teacher_name}
                  </span>
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs font-semibold text-gray-600 dark:text-gray-300">
                    👥 {filteredStats.engagedStudents} Respondents
                  </span>
                </div>
              )}

              {/* Response Repository Table */}
              <ResponseRepository
                feedbacks={filteredFeedbacks}
                questions={questions}
                search={feedbackSearch}
                onSearchChange={setFeedbackSearch}
              />
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* VIEW: QUESTION INSIGHTS                            */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'questions' && (
            <div className="space-y-5">
              {/* Filters */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="min-w-[200px]">
                  <label className="text-[11px] text-gray-400 block mb-1">Question type</label>
                  <select
                    value={questionTypeFilter}
                    onChange={e => setQuestionTypeFilter(e.target.value as QuestionTypeFilter)}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="all">All types</option>
                    <option value="rating">Rating</option>
                    <option value="emoji">Emoji</option>
                    <option value="text">Text</option>
                    <option value="multiple_choice">Multiple choice</option>
                  </select>
                </div>
                <div className="min-w-[200px]">
                  <label className="text-[11px] text-gray-400 block mb-1">Focus question</label>
                  <select
                    value={selectedQuestionId}
                    onChange={e => setSelectedQuestionId(e.target.value)}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                  >
                    <option value="">All questions</option>
                    {questions.map(q => <option key={q.id} value={q.id}>{q.question_text}</option>)}
                  </select>
                </div>
              </div>

              {filteredQuestionAnalytics.length === 0 ? (
                <div className="text-center py-16">
                  <span className="text-5xl block mb-3">🧩</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Question Matches</h3>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filteredQuestionAnalytics.map(({ question, data }, index) => (
                    <div key={question.id} className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{question.question_text}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">{question.question_type.replace('_', ' ')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">{data.total} answers</span>
                            {question.attendance_date && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600">{question.attendance_date}</span>}
                          </div>
                        </div>
                      </div>

                      {data.total === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No responses.</p>
                      ) : data.type === 'rating' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{data.avg}</span>
                            <span>{RATING_EMOJIS[Math.round(data.avg) - 1] || ''}</span>
                          </div>
                          {[5, 4, 3, 2, 1].map(r => {
                            const count = data.distribution[r] || 0;
                            const width = data.total > 0 ? (count / data.total) * 100 : 0;
                            return (
                              <div key={r} className="flex items-center gap-2">
                                <span className="text-[10px] w-4 text-right">{r}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: RATING_COLORS[r - 1] }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-7 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : data.type === 'emoji' ? (
                        <div className="flex flex-wrap gap-3 justify-center py-2">
                          {Object.entries(data.distribution).sort(([, a], [, b]) => b - a).map(([value, count]) => (
                            <div key={value} className="text-center min-w-[56px]">
                              <span className="text-2xl block">{MOOD_EMOJIS[value] || value}</span>
                              <span className="text-[10px] text-gray-500">{count}</span>
                            </div>
                          ))}
                        </div>
                      ) : data.type === 'multiple_choice' ? (
                        <div className="space-y-2">
                          {Object.entries(data.distribution).sort(([, a], [, b]) => b - a).map(([option, count]) => {
                            const width = data.total > 0 ? (count / data.total) * 100 : 0;
                            return (
                              <div key={option} className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-600 dark:text-gray-300 w-24 truncate shrink-0">{option}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${width}%` }} />
                                </div>
                                <span className="text-[10px] text-gray-400 w-8 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {data.answers.map((answer, ai) => (
                            <p key={ai} className="text-[11px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5">{answer}</p>
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
          {/* VIEW: DATE ANALYSIS                                */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeView === 'dates' && (
            <div className="space-y-5">
              {/* Trend Overview Banner */}
              {dateComparison && dateComparison.dates.length >= 2 && (
                <div className={`rounded-2xl p-5 border ${
                  dateComparison.trendDirection === 'improving' ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' :
                  dateComparison.trendDirection === 'declining' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' :
                  'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{dateComparison.trendDirection === 'improving' ? '📈' : dateComparison.trendDirection === 'declining' ? '📉' : '➡️'}</span>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        Trend: <span className="capitalize">{dateComparison.trendDirection}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {dateComparison.dates.length} dates · Avg: {dateComparison.overallAvg}/5
                        {dateComparison.bestDate && ` · Best: ${dateComparison.bestDate}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sort Controls */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 shrink-0">Sort by:</span>
                {(['date', 'rating', 'responses', 'rate'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => {
                      if (analyticsSortBy === key) setAnalyticsSortDir(d => d === 'asc' ? 'desc' : 'asc');
                      else { setAnalyticsSortBy(key); setAnalyticsSortDir('desc'); }
                    }}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${
                      analyticsSortBy === key ? 'border-purple-500 bg-purple-600 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-purple-300'
                    }`}
                  >
                    {key === 'date' ? '📅 Date' : key === 'rating' ? '⭐ Rating' : key === 'responses' ? '📊 Volume' : '📈 Engagement'}
                    {analyticsSortBy === key ? (analyticsSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>

              {/* Date Heatmap */}
              {dateHeatmapData.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                  <p className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide mb-4">Rating Heatmap</p>
                  <div className="flex flex-wrap gap-2">
                    {dateHeatmapData.map(d => {
                      const intensity = d.rating > 0 ? Math.max(0.15, d.rating / 5) : 0;
                      const color = d.rating >= 4 ? `rgba(34,197,94,${intensity})`
                        : d.rating >= 3 ? `rgba(234,179,8,${intensity})`
                        : d.rating > 0 ? `rgba(239,68,68,${intensity})` : 'rgba(156,163,175,0.1)';
                      return (
                        <button
                          key={d.date}
                          onClick={() => setSelectedAnalyticsDate(selectedAnalyticsDate === d.date ? '' : d.date)}
                          title={`${d.date}: ${d.rating}/5 · ${d.responses} responses`}
                          className={`relative rounded-xl px-3 py-2 text-center transition-all min-w-[70px] border ${
                            selectedAnalyticsDate === d.date ? 'ring-2 ring-purple-500 border-purple-400 shadow-md' : 'border-transparent hover:border-gray-300'
                          }`}
                          style={{ backgroundColor: color }}
                        >
                          <p className="text-[10px] font-medium text-gray-700 dark:text-gray-200">{d.label}</p>
                          <p className="text-lg font-black text-gray-900 dark:text-white">{d.rating > 0 ? d.rating : '—'}</p>
                          <p className="text-[10px] text-gray-500">{d.responses}r</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected Date Detail */}
              {selectedAnalyticsDate && (
                <div className="rounded-2xl border-2 border-purple-200 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📅</span>
                      <div>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{selectedAnalyticsDate}</p>
                        <p className="text-[11px] text-gray-500">{new Date(`${selectedAnalyticsDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    </div>
                    <button onClick={() => setSelectedAnalyticsDate('')} className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 px-2 py-1 rounded-lg">✕ Close</button>
                  </div>

                  {loadingDateStats ? (
                    <div className="flex items-center justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent" /></div>
                  ) : dateStats ? (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Responses', value: dateStats.totalResponses },
                          { label: 'Students', value: dateStats.engagedStudents, sub: `${dateStats.responseRate}% rate` },
                          { label: 'Avg Rating', value: `${dateStats.averageRating} ${RATING_EMOJIS[Math.round(dateStats.averageRating) - 1] || ''}` },
                          { label: 'vs Overall', value: stats ? `${dateStats.averageRating > stats.averageRating ? '+' : ''}${(dateStats.averageRating - stats.averageRating).toFixed(1)}` : '—' },
                        ].map(kpi => (
                          <div key={kpi.label} className="p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-800/50">
                            <p className="text-[11px] uppercase tracking-wide text-gray-400">{kpi.label}</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{kpi.value}</p>
                            {'sub' in kpi && kpi.sub && <p className="text-[10px] text-gray-400">{kpi.sub}</p>}
                          </div>
                        ))}
                      </div>

                      {/* Per-date rating distribution */}
                      <div className="rounded-xl bg-white dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Rating Distribution</p>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={[1,2,3,4,5].map(r => ({ rating: `${RATING_EMOJIS[r-1]} ${r}`, count: dateStats.ratingDistribution[r] || 0 }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                            <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32}>
                              {[1,2,3,4,5].map((_, i) => <Cell key={i} fill={RATING_COLORS[i]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Per-date question breakdown */}
                      {dateFilteredQuestionAnalytics.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Question Breakdown</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {dateFilteredQuestionAnalytics.map(({ question, data: qData }, qi) => (
                              <div key={question.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="text-[10px] font-bold text-purple-600 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{qi + 1}</span>
                                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2">{question.question_text}</p>
                                </div>
                                {qData.total === 0 ? (
                                  <p className="text-xs text-gray-400 text-center py-3">No responses</p>
                                ) : qData.type === 'rating' ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-lg font-bold text-purple-600">{qData.avg}</span>
                                      <span>{RATING_EMOJIS[Math.round(qData.avg) - 1] || ''}</span>
                                    </div>
                                    {[5,4,3,2,1].map(r => (
                                      <div key={r} className="flex items-center gap-1.5">
                                        <span className="text-[10px] w-4 text-right">{r}</span>
                                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                          <div className="h-full rounded-full" style={{ width: `${qData.total > 0 ? ((qData.distribution[r] || 0) / qData.total) * 100 : 0}%`, backgroundColor: RATING_COLORS[r-1] }} />
                                        </div>
                                        <span className="text-[10px] text-gray-400 w-6 text-right">{qData.distribution[r] || 0}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : qData.type === 'emoji' ? (
                                  <div className="flex flex-wrap gap-2 justify-center py-1">
                                    {Object.entries(qData.distribution).sort(([,a],[,b]) => b-a).map(([emoji, count]) => (
                                      <div key={emoji} className="text-center"><span className="text-xl block">{MOOD_EMOJIS[emoji] || emoji}</span><span className="text-[10px] text-gray-500">{count}</span></div>
                                    ))}
                                  </div>
                                ) : qData.type === 'multiple_choice' ? (
                                  <div className="space-y-1">
                                    {Object.entries(qData.distribution).sort(([,a],[,b]) => b-a).map(([option, count]) => (
                                      <div key={option} className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-gray-600 w-20 truncate shrink-0">{option}</span>
                                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                          <div className="h-full rounded-full bg-purple-500" style={{ width: `${qData.total > 0 ? (count / qData.total) * 100 : 0}%` }} />
                                        </div>
                                        <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(qData.total > 0 ? (count / qData.total) * 100 : 0)}%</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="space-y-1 max-h-28 overflow-y-auto">
                                    {qData.answers.slice(0, 5).map((a, ai) => (
                                      <p key={ai} className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 truncate">"{a}"</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : <p className="text-sm text-gray-400 text-center py-6">No data for this date.</p>}
                </div>
              )}

              {/* Date Comparison Table */}
              {sortedDateSummaries.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Date-by-Date Comparison</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          {['Date', 'Avg Rating', 'Responses', 'Students', 'Engagement', 'Comments', 'Distribution'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-gray-400 font-semibold text-left first:pl-5">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {sortedDateSummaries.map(d => (
                          <tr key={d.date} onClick={() => setSelectedAnalyticsDate(selectedAnalyticsDate === d.date ? '' : d.date)}
                            className={`cursor-pointer transition-colors ${selectedAnalyticsDate === d.date ? 'bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}>
                            <td className="px-3 py-2.5 pl-5 font-medium text-gray-900 dark:text-white">
                              {d.date}
                              {dateComparison?.bestDate === d.date && <span className="ml-1 text-[10px] text-emerald-600">★</span>}
                            </td>
                            <td className={`px-3 py-2.5 font-bold ${d.averageRating >= 4 ? 'text-emerald-600' : d.averageRating >= 3 ? 'text-amber-600' : 'text-red-600'}`}>
                              {d.averageRating} {RATING_EMOJIS[Math.round(d.averageRating) - 1] || ''}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{d.responses}</td>
                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{d.uniqueStudents}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <div className="w-16 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${d.responseRate}%` }} />
                                </div>
                                <span className="text-gray-500">{d.responseRate}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-500">{d.commentCount}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex gap-px">
                                {[1,2,3,4,5].map(r => (
                                  <div key={r} className="w-3 rounded-sm" style={{ height: `${Math.max(2, (d.ratingDistribution[r] || 0) / Math.max(1, d.responses) * 100 * 0.2)}px`, backgroundColor: RATING_COLORS[r-1], minHeight: '2px' }} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Charts */}
              {radarData.length >= 3 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                    <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">Rating Trend</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={radarData}>
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
                  <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-5">
                    <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">Engagement Radar</p>
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
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
