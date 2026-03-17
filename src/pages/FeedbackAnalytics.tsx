import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { feedbackService, type SessionFeedback, type FeedbackStats, type FeedbackQuestion, type FeedbackTemplate, type FeedbackTemplateInput } from '../services/feedbackService';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Line,
} from 'recharts';

// ─── Constants ─────────────────────────────────────────────
const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];
const MOOD_EMOJIS: Record<string, string> = {
  Tired: '😴', Confused: '🤔', Neutral: '😐', Happy: '😊', Energized: '🔥',
};
const PIE_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1'];

type ActiveTab = 'analytics' | 'questions' | 'responses';

interface SessionOption {
  session_id: string;
  course_name: string;
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
  const headers = ['Date', 'Overall Rating', 'Comment', 'Anonymous', 'Check-In Method'];
  for (const q of questions) headers.push(q.question_text);
  
  const rows = feedbacks.map(fb => {
    const base = [
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
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedbacks, setFeedbacks] = useState<SessionFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [templates, setTemplates] = useState<FeedbackTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');

  // Question management
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState({
    question_text: '',
    question_type: 'text' as FeedbackQuestion['question_type'],
    optionsText: '',
    is_required: false,
  });
  const [templateDraft, setTemplateDraft] = useState({
    name: '',
    description: '',
    is_default: false,
  });

  // Responses tab
  const [dateFilter, setDateFilter] = useState('');
  const [expandedResponseId, setExpandedResponseId] = useState<string | null>(null);

  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);

  // ─── Resets ────────────────────────────────────────────────
  const resetQuestionDraft = useCallback(() => {
    setEditingQuestionId(null);
    setQuestionDraft({ question_text: '', question_type: 'text', optionsText: '', is_required: false });
  }, []);

  const resetTemplateDraft = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateDraft({ name: '', description: '', is_default: false });
  }, []);

  // ─── Load sessions ────────────────────────────────────────
  useEffect(() => {
    async function loadSessions() {
      const { data } = await supabase
        .from('session')
        .select('session_id, feedback_enabled, course:course_id(course_name)')
        .eq('feedback_enabled', true)
        .order('created_at', { ascending: false });

      if (data) {
        const mapped = data.map((s: Record<string, unknown>) => {
          const course = s.course as Record<string, string> | Record<string, string>[] | null;
          const courseName = Array.isArray(course) ? course[0]?.course_name : course?.course_name;
          return { session_id: s.session_id as string, course_name: courseName ?? 'Unknown Course' };
        });
        setSessions(mapped);
        if (mapped.length > 0) setSelectedSessionId(mapped[0].session_id);
      }
    }
    loadSessions();
  }, []);

  // ─── Load data for selected session ────────────────────────
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [fbResult, statsResult, questionsResult, templatesResult] = await Promise.all([
        feedbackService.getBySession(selectedSessionId),
        feedbackService.getStats(selectedSessionId),
        feedbackService.getQuestions(selectedSessionId),
        feedbackService.getTemplates(),
      ]);
      if (cancelled) return;
      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setQuestions(questionsResult.data || []);
      setTemplates(templatesResult.data || []);
      setSelectedTemplateId((current) => current || templatesResult.data?.[0]?.id || '');
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // ─── Derived data ──────────────────────────────────────────
  const ratingDistributionData = useMemo(() => {
    if (!stats) return [];
    return [1, 2, 3, 4, 5].map(r => ({
      rating: `${RATING_EMOJIS[r - 1]} ${r}`,
      count: stats.ratingDistribution[r] || 0,
      fill: RATING_COLORS[r - 1],
    }));
  }, [stats]);

  const dailyTrendData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number; responses: number }>();
    for (const fb of feedbacks) {
      const entry = byDate.get(fb.attendance_date) || { total: 0, count: 0, responses: 0 };
      entry.responses++;
      if (fb.overall_rating != null) {
        entry.total += fb.overall_rating;
        entry.count++;
      }
      byDate.set(fb.attendance_date, entry);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, count, responses }]) => {
        const d = new Date(date + 'T00:00:00');
        return {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          avgRating: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
          responses,
        };
      });
  }, [feedbacks]);

  const methodDistribution = useMemo(() => {
    const byMethod: Record<string, number> = {};
    for (const fb of feedbacks) {
      const method = fb.check_in_method || 'unknown';
      byMethod[method] = (byMethod[method] || 0) + 1;
    }
    return Object.entries(byMethod).map(([name, value]) => ({
      name: name === 'qr_code' ? 'QR Code' : name === 'photo' ? 'Face Recognition' : name,
      value,
    }));
  }, [feedbacks]);

  const anonymousRate = useMemo(() => {
    if (feedbacks.length === 0) return 0;
    return Math.round((feedbacks.filter(f => f.is_anonymous).length / feedbacks.length) * 100);
  }, [feedbacks]);

  const npsScore = useMemo(() => {
    const withRating = feedbacks.filter(f => f.overall_rating != null);
    if (withRating.length === 0) return 0;
    const promoters = withRating.filter(f => f.overall_rating! >= 4).length;
    const detractors = withRating.filter(f => f.overall_rating! <= 2).length;
    return Math.round(((promoters - detractors) / withRating.length) * 100);
  }, [feedbacks]);

  // Per-question aggregation
  const questionAnalytics = useMemo(() => {
    return questions.map(q => ({
      question: q,
      data: aggregateQuestionResponses(q, feedbacks),
    }));
  }, [questions, feedbacks]);

  // Unique dates for filter
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(feedbacks.map(f => f.attendance_date))].sort().reverse();
    return dates;
  }, [feedbacks]);

  // Filtered responses
  const filteredFeedbacks = useMemo(() => {
    if (!dateFilter) return feedbacks;
    return feedbacks.filter(f => f.attendance_date === dateFilter);
  }, [feedbacks, dateFilter]);

  const templatePreview = useMemo(
    () => templates.find(t => t.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  // ─── Question handlers ─────────────────────────────────────
  const handleSubmitQuestion = async () => {
    if (!selectedSessionId) return;
    const trimmedText = questionDraft.question_text.trim();
    if (!trimmedText) { setQuestionError('Question text is required.'); return; }

    const parsedOptions = questionDraft.question_type === 'multiple_choice'
      ? questionDraft.optionsText.split(',').map(o => o.trim()).filter(Boolean)
      : [];
    if (questionDraft.question_type === 'multiple_choice' && parsedOptions.length < 2) {
      setQuestionError('Multiple choice needs at least two comma-separated options.');
      return;
    }

    setSavingQuestion(true);
    setQuestionError(null);
    const payload = {
      question_text: trimmedText,
      question_type: questionDraft.question_type,
      options: parsedOptions,
      is_required: questionDraft.is_required,
    };

    const result = editingQuestionId
      ? await feedbackService.updateQuestion(editingQuestionId, payload)
      : await feedbackService.createQuestion({ session_id: selectedSessionId, sort_order: questions.length, ...payload });

    if (result.error) { setQuestionError(result.error.message || 'Unable to save.'); setSavingQuestion(false); return; }
    const refreshed = await feedbackService.getQuestions(selectedSessionId);
    setQuestions(refreshed.data || []);
    resetQuestionDraft();
    setSavingQuestion(false);
  };

  const handleEditQuestion = (q: FeedbackQuestion) => {
    setEditingQuestionId(q.id);
    setQuestionError(null);
    setQuestionDraft({
      question_text: q.question_text,
      question_type: q.question_type,
      optionsText: q.options.join(', '),
      is_required: q.is_required,
    });
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!selectedSessionId) return;
    const result = await feedbackService.deleteQuestion(questionId);
    if (result.error) { setQuestionError(result.error.message || 'Unable to delete.'); return; }
    const refreshed = await feedbackService.getQuestions(selectedSessionId);
    setQuestions(refreshed.data || []);
    if (editingQuestionId === questionId) resetQuestionDraft();
  };

  const handleApplyTemplate = async () => {
    if (!selectedSessionId || !selectedTemplateId) return;
    setApplyingTemplate(true);
    setQuestionError(null);
    const result = await feedbackService.applyTemplateToSession(selectedTemplateId, selectedSessionId);
    if (result.error) { setQuestionError(result.error.message || 'Unable to apply.'); setApplyingTemplate(false); return; }
    const refreshed = await feedbackService.getQuestions(selectedSessionId);
    setQuestions(refreshed.data || []);
    resetQuestionDraft();
    setApplyingTemplate(false);
  };

  const handleEditTemplate = (t: FeedbackTemplate) => {
    setEditingTemplateId(t.id);
    setTemplateError(null);
    setSelectedTemplateId(t.id);
    setTemplateDraft({ name: t.name, description: t.description || '', is_default: t.is_default });
  };

  const handleSubmitTemplate = async () => {
    const trimmedName = templateDraft.name.trim();
    if (!trimmedName) { setTemplateError('Template name is required.'); return; }
    if (questions.length === 0) { setTemplateError('Add at least one question first.'); return; }

    setSavingTemplate(true);
    setTemplateError(null);
    const payload: FeedbackTemplateInput = {
      name: trimmedName,
      description: templateDraft.description.trim() || null,
      is_default: templateDraft.is_default,
      questions: questions.map(q => ({
        type: q.question_type, text: q.question_text, required: q.is_required,
        options: q.options.length > 0 ? q.options : undefined,
      })),
    };

    const result = editingTemplateId
      ? await feedbackService.updateTemplate(editingTemplateId, payload)
      : await feedbackService.createTemplate(payload);

    if (result.error) { setTemplateError(result.error.message || 'Unable to save.'); setSavingTemplate(false); return; }
    const refreshed = await feedbackService.getTemplates();
    const next = refreshed.data || [];
    setTemplates(next);
    if (result.data?.id) setSelectedTemplateId(result.data.id);
    else if (next.length > 0) setSelectedTemplateId(next[0].id);
    resetTemplateDraft();
    setSavingTemplate(false);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const result = await feedbackService.deleteTemplate(templateId);
    if (result.error) { setTemplateError(result.error.message || 'Unable to delete.'); return; }
    const refreshed = await feedbackService.getTemplates();
    const next = refreshed.data || [];
    setTemplates(next);
    if (selectedTemplateId === templateId) setSelectedTemplateId(next[0]?.id || '');
    if (editingTemplateId === templateId) resetTemplateDraft();
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 md:space-y-6">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            💜 Feedback Analytics
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Insights from post-check-in student surveys
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="w-full sm:w-64">
            <Select
              label=""
              value={selectedSessionId}
              onChange={setSelectedSessionId}
              options={sessions.map(s => ({ value: s.session_id, label: s.course_name }))}
              placeholder="Select session..."
            />
          </div>
          {feedbacks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportFeedbackCSV(feedbacks, questions, selectedSession?.course_name || 'feedback')}
              className="shrink-0 justify-center"
            >
              📥 Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* ─── No sessions state ────────────────────────────────── */}
      {sessions.length === 0 && !loading && (
        <Card>
          <CardContent>
            <div className="text-center py-12 sm:py-16">
              <span className="text-6xl block mb-4">📭</span>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No Feedback Sessions Yet</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
                Enable feedback in Session settings to start collecting responses from students after they check in via QR code or face recognition.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
        </div>
      )}

      {!loading && selectedSessionId && (
        <>
          {/* ─── Tabs ──────────────────────────────────────────── */}
          <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <nav className="flex gap-1 min-w-max">
              {([
                { key: 'analytics' as ActiveTab, label: '📊 Analytics', badge: stats?.totalResponses },
                { key: 'questions' as ActiveTab, label: '🧩 Questions', badge: questions.length },
                { key: 'responses' as ActiveTab, label: '💬 Responses', badge: feedbacks.length },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === t.key
                      ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {t.label}
                  {t.badge != null && t.badge > 0 && (
                    <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                      activeTab === t.key
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}>
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: ANALYTICS                                     */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'analytics' && (
            <>
              {stats && stats.totalResponses > 0 ? (
                <div className="space-y-4 md:space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
                    <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/30 dark:to-violet-900/30 p-3 sm:p-4 rounded-xl border border-purple-100 dark:border-purple-800/50">
                      <p className="text-[10px] sm:text-xs font-medium text-purple-600 dark:text-purple-400">Total Responses</p>
                      <p className="text-xl sm:text-2xl font-bold text-purple-900 dark:text-purple-100">{stats.totalResponses}</p>
                    </div>
                    <div className="bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 p-3 sm:p-4 rounded-xl border border-yellow-100 dark:border-yellow-800/50">
                      <p className="text-[10px] sm:text-xs font-medium text-yellow-600 dark:text-yellow-400">Average Rating</p>
                      <p className="text-xl sm:text-2xl font-bold text-yellow-900 dark:text-yellow-100">
                        {stats.averageRating} <span className="text-base sm:text-lg">{RATING_EMOJIS[Math.round(stats.averageRating) - 1] || ''}</span>
                      </p>
                    </div>
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-3 sm:p-4 rounded-xl border border-green-100 dark:border-green-800/50">
                      <p className="text-[10px] sm:text-xs font-medium text-green-600 dark:text-green-400">Response Rate</p>
                      <p className="text-xl sm:text-2xl font-bold text-green-900 dark:text-green-100">{stats.responseRate}%</p>
                    </div>
                    <div className={`bg-gradient-to-br p-3 sm:p-4 rounded-xl border ${
                      npsScore >= 50 ? 'from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 border-emerald-100 dark:border-emerald-800/50'
                        : npsScore >= 0 ? 'from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 border-blue-100 dark:border-blue-800/50'
                        : 'from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 border-red-100 dark:border-red-800/50'
                    }`}>
                      <p className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400">NPS Score</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{npsScore > 0 ? '+' : ''}{npsScore}</p>
                    </div>
                    <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-900/30 dark:to-slate-900/30 p-3 sm:p-4 rounded-xl border border-gray-200 dark:border-gray-700 col-span-2 sm:col-span-1">
                      <p className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400">Anonymous</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">🕵️ {anonymousRate}%</p>
                    </div>
                  </div>

                  {/* Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                    <Card>
                      <CardHeader><CardTitle className="text-sm">⭐ Rating Distribution</CardTitle></CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={ratingDistributionData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                            <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={36}>
                              {ratingDistributionData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="text-sm">📈 Rating Trend</CardTitle></CardHeader>
                      <CardContent>
                        {dailyTrendData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={dailyTrendData}>
                              <defs>
                                <linearGradient id="ratingGrad2" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                              <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                              <Tooltip />
                              <Area type="monotone" dataKey="avgRating" stroke="#8b5cf6" fill="url(#ratingGrad2)" strokeWidth={2.5} dot={{ r: 4, fill: '#8b5cf6' }} name="Avg Rating" />
                              <Line type="monotone" dataKey="responses" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 3 }} name="Responses" yAxisId={0} />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="text-center py-8 text-gray-400 text-sm">No trend data yet</div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle className="text-sm">📱 By Check-In Method</CardTitle></CardHeader>
                      <CardContent>
                        {methodDistribution.length > 0 ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie
                                data={methodDistribution}
                                cx="50%"
                                cy="50%"
                                innerRadius={45}
                                outerRadius={80}
                                paddingAngle={3}
                                dataKey="value"
                                label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                              >
                                {methodDistribution.map((_, i) => (
                                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="text-center py-8 text-gray-400 text-sm">No data</div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Per-Question Analytics */}
                  {questionAnalytics.length > 0 && (
                    <div className="space-y-4">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        🔍 Question Breakdown
                      </h2>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {questionAnalytics.map(({ question, data }, qi) => (
                          <Card key={question.id}>
                            <CardHeader>
                              <CardTitle className="text-sm flex items-start gap-2">
                                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40 px-1.5 py-0.5 rounded shrink-0">Q{qi + 1}</span>
                                <span className="line-clamp-2">{question.question_text}</span>
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              {data.total === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">No responses yet</p>
                              ) : data.type === 'rating' ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="text-gray-500 dark:text-gray-400">Average:</span>
                                    <span className="font-bold text-lg text-purple-600 dark:text-purple-400">{data.avg}</span>
                                    <span className="text-base">{RATING_EMOJIS[Math.round(data.avg) - 1] || ''}</span>
                                    <span className="text-xs text-gray-400 ml-auto">{data.total} responses</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {[5, 4, 3, 2, 1].map(r => {
                                      const count = data.distribution[r] || 0;
                                      const pct = data.total > 0 ? (count / data.total) * 100 : 0;
                                      return (
                                        <div key={r} className="flex items-center gap-2">
                                          <span className="text-sm w-6 text-right shrink-0">{RATING_EMOJIS[r - 1]}</span>
                                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: RATING_COLORS[r - 1] }} />
                                          </div>
                                          <span className="text-xs text-gray-500 dark:text-gray-400 w-10 text-right">{count} ({Math.round(pct)}%)</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : data.type === 'emoji' ? (
                                <div className="space-y-3">
                                  <p className="text-xs text-gray-400 text-right">{data.total} responses</p>
                                  <div className="flex flex-wrap gap-3 justify-center">
                                    {Object.entries(data.distribution).sort(([, a], [, b]) => b - a).map(([emoji, count]) => {
                                      const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
                                      return (
                                        <div key={emoji} className="flex flex-col items-center gap-1 min-w-[60px] p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                                          <span className="text-2xl">{MOOD_EMOJIS[emoji] || emoji}</span>
                                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{emoji}</span>
                                          <span className="text-[10px] text-gray-500">{count} ({pct}%)</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : data.type === 'multiple_choice' ? (
                                <div className="space-y-3">
                                  <p className="text-xs text-gray-400 text-right">{data.total} responses</p>
                                  <div className="space-y-1.5">
                                    {Object.entries(data.distribution).sort(([, a], [, b]) => b - a).map(([option, count], i) => {
                                      const pct = data.total > 0 ? (count / data.total) * 100 : 0;
                                      return (
                                        <div key={option} className="flex items-center gap-2">
                                          <span className="text-xs text-gray-700 dark:text-gray-300 w-24 sm:w-32 truncate shrink-0" title={option}>{option}</span>
                                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                          </div>
                                          <span className="text-xs text-gray-500 w-10 text-right">{Math.round(pct)}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                /* text type */
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  <p className="text-xs text-gray-400">{data.total} responses</p>
                                  {data.answers.slice(0, 10).map((answer, ai) => (
                                    <div key={ai} className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                      "{answer}"
                                    </div>
                                  ))}
                                  {data.answers.length > 10 && (
                                    <p className="text-xs text-gray-400 text-center">+{data.answers.length - 10} more responses</p>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Comments */}
                  {stats.recentComments.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">💬 Recent Comments</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                          {stats.recentComments.map((c, i) => (
                            <div key={i} className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                              <div className="text-2xl shrink-0">{RATING_EMOJIS[c.rating - 1] || '❓'}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 dark:text-gray-200">{c.comment}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{c.date}</span>
                                  {c.is_anonymous && (
                                    <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                                      🕵️ Anonymous
                                    </span>
                                  )}
                                  <div className="flex gap-0.5">
                                    {[1, 2, 3, 4, 5].map(s => (
                                      <span key={s} className={`text-xs ${s <= c.rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <Card>
                  <CardContent>
                    <div className="text-center py-12">
                      <span className="text-5xl block mb-3">📊</span>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Responses Yet</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
                        Students will see the feedback form after checking in via QR code or face recognition. Set up questions in the Questions tab.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4" onClick={() => setActiveTab('questions')}>
                        🧩 Set Up Questions
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: QUESTIONS & TEMPLATES                         */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'questions' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr,0.85fr] gap-4 md:gap-6">
              {/* Session Questions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">🧩 Session Questions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {questionError && (
                      <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                        {questionError}
                      </div>
                    )}

                    {/* Question Form */}
                    <div className="rounded-xl border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10 p-4 space-y-3">
                      <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                        {editingQuestionId ? '✏️ Edit Question' : '➕ New Question'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Question Text</label>
                          <input
                            value={questionDraft.question_text}
                            onChange={(e) => setQuestionDraft(prev => ({ ...prev, question_text: e.target.value }))}
                            placeholder="e.g. How clear was the instructor's explanation?"
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
                          <select
                            value={questionDraft.question_type}
                            onChange={(e) => setQuestionDraft(prev => ({ ...prev, question_type: e.target.value as FeedbackQuestion['question_type'] }))}
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                          >
                            <option value="text">📝 Text</option>
                            <option value="emoji">😊 Emoji</option>
                            <option value="rating">⭐ Rating (1-5)</option>
                            <option value="multiple_choice">📋 Multiple Choice</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 cursor-pointer sm:mt-5">
                          <input
                            type="checkbox"
                            checked={questionDraft.is_required}
                            onChange={(e) => setQuestionDraft(prev => ({ ...prev, is_required: e.target.checked }))}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Required</span>
                        </label>
                        {questionDraft.question_type === 'multiple_choice' && (
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Options (comma-separated)</label>
                            <input
                              value={questionDraft.optionsText}
                              onChange={(e) => setQuestionDraft(prev => ({ ...prev, optionsText: e.target.value }))}
                              placeholder="Clear, Average, Confusing"
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleSubmitQuestion} disabled={savingQuestion} size="sm">
                          {savingQuestion ? 'Saving...' : editingQuestionId ? '💾 Update' : '➕ Add Question'}
                        </Button>
                        {editingQuestionId && (
                          <Button type="button" variant="outline" onClick={resetQuestionDraft} size="sm">Cancel</Button>
                        )}
                      </div>
                    </div>

                    {/* Question List */}
                    <div className="space-y-2">
                      {questions.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-4 py-8 text-center">
                          <span className="text-3xl block mb-2">🧩</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">No questions yet</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add questions above or apply a template from the right panel.</p>
                        </div>
                      ) : (
                        questions.map((question, index) => (
                          <div key={question.id} className="group rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 bg-white dark:bg-gray-800/50 hover:border-purple-200 dark:hover:border-purple-700 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">Q{index + 1}</span>
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 capitalize">
                                    {question.question_type === 'multiple_choice' ? '📋 MC' : question.question_type === 'rating' ? '⭐ Rating' : question.question_type === 'emoji' ? '😊 Emoji' : '📝 Text'}
                                  </span>
                                  {question.is_required && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300">Required</span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-900 dark:text-white">{question.question_text}</p>
                                {question.options.length > 0 && (
                                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Options: {question.options.join(' · ')}</p>
                                )}
                              </div>
                              <div className="flex gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditQuestion(question)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuestion(question.id)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                >
                                  🗑
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Templates */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">📋 Templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {templateError && (
                      <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                        {templateError}
                      </div>
                    )}

                    {/* Save as template */}
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                        {editingTemplateId ? '✏️ Edit Template' : '💾 Save as Template'}
                      </p>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                        <input
                          value={templateDraft.name}
                          onChange={(e) => setTemplateDraft(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Weekly session check-in"
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
                        <textarea
                          value={templateDraft.description}
                          onChange={(e) => setTemplateDraft(prev => ({ ...prev, description: e.target.value }))}
                          rows={2}
                          placeholder="Describe when to use this template..."
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={templateDraft.is_default}
                          onChange={(e) => setTemplateDraft(prev => ({ ...prev, is_default: e.target.checked }))}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">Default template</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleSubmitTemplate} disabled={savingTemplate || questions.length === 0} size="sm">
                          {savingTemplate ? 'Saving...' : editingTemplateId ? '💾 Update' : '💾 Save Template'}
                        </Button>
                        {editingTemplateId && (
                          <Button type="button" variant="outline" onClick={resetTemplateDraft} size="sm">Cancel</Button>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400">
                        Copies current session questions into a reusable template.
                      </p>
                    </div>

                    {/* Apply Template */}
                    <div className="rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/10 p-4 space-y-3">
                      <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                        📥 Apply Template
                      </p>
                      <Select
                        label=""
                        value={selectedTemplateId}
                        onChange={setSelectedTemplateId}
                        options={templates.map(t => ({ value: t.id, label: t.is_default ? `${t.name} (Default)` : t.name }))}
                        placeholder="Choose template..."
                      />
                      <Button type="button" onClick={handleApplyTemplate} disabled={!selectedTemplateId || applyingTemplate} size="sm" className="w-full justify-center">
                        {applyingTemplate ? 'Applying...' : '📥 Apply to Session'}
                      </Button>
                      <p className="text-[10px] text-gray-400">
                        Replaces current questions with the template's questions.
                      </p>
                    </div>

                    {/* Template List */}
                    <div className="space-y-2">
                      {templates.length === 0 ? (
                        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-4 py-6 text-center">
                          <p className="text-sm text-gray-400">No templates saved yet.</p>
                        </div>
                      ) : (
                        templates.map(template => (
                          <div
                            key={template.id}
                            className={`rounded-xl border p-3 transition-colors ${
                              selectedTemplateId === template.id
                                ? 'border-violet-300 dark:border-violet-600 bg-violet-50/70 dark:bg-violet-900/20'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                          >
                            <div className="flex flex-col gap-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{template.name}</p>
                                    {template.is_default && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Default</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                    {template.description || 'No description'}
                                  </p>
                                  <p className="text-[10px] text-gray-400 mt-1">
                                    {template.questions.length} question{template.questions.length === 1 ? '' : 's'}
                                  </p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => { setSelectedTemplateId(template.id); }}
                                    className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
                                  >
                                    👁
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEditTemplate(template)}
                                    className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteTemplate(template.id)}
                                    className="text-[10px] px-2 py-1 rounded border border-red-200 dark:border-red-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  >
                                    🗑
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Template Preview */}
                    {templatePreview && (
                      <div className="rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/10 p-4">
                        <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 mb-2">{templatePreview.name}</p>
                        {templatePreview.description && (
                          <p className="text-xs text-violet-600/80 dark:text-violet-300/80 mb-3">{templatePreview.description}</p>
                        )}
                        <div className="space-y-1.5">
                          {templatePreview.questions.map((q, i) => (
                            <div key={`${templatePreview.id}-${i}`} className="rounded-lg bg-white/80 dark:bg-gray-900/40 px-3 py-2 border border-violet-100 dark:border-violet-800">
                              <p className="text-sm text-gray-900 dark:text-white">{i + 1}. {q.text}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {q.type.replace('_', ' ')}{q.required ? ' · required' : ''}
                                {q.options?.length ? ` · ${q.options.join(', ')}` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: RESPONSES (Individual viewer)                 */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'responses' && (
            <div className="space-y-4">
              {/* Date Filter */}
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <select
                    value={dateFilter}
                    onChange={e => setDateFilter(e.target.value)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  >
                    <option value="">All dates ({feedbacks.length})</option>
                    {uniqueDates.map(d => {
                      const count = feedbacks.filter(f => f.attendance_date === d).length;
                      return <option key={d} value={d}>{d} ({count})</option>;
                    })}
                  </select>
                  {dateFilter && (
                    <button onClick={() => setDateFilter('')} className="text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400">
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {filteredFeedbacks.length} of {feedbacks.length} responses
                </p>
              </div>

              {filteredFeedbacks.length === 0 ? (
                <Card>
                  <CardContent>
                    <div className="text-center py-12">
                      <span className="text-5xl block mb-3">💬</span>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Responses</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {dateFilter ? 'No responses for this date.' : 'No feedback has been submitted yet.'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {filteredFeedbacks.map((fb, idx) => {
                    const isExpanded = expandedResponseId === fb.id;
                    const hasCustomResponses = Object.keys(fb.responses || {}).length > 0;
                    return (
                      <div
                        key={fb.id}
                        className={`rounded-xl border transition-all ${
                          isExpanded
                            ? 'border-purple-200 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {/* Summary Row */}
                        <button
                          type="button"
                          onClick={() => setExpandedResponseId(isExpanded ? null : fb.id)}
                          className="w-full text-left px-4 py-3 flex items-center gap-3"
                        >
                          {/* Rating emoji */}
                          <span className="text-xl shrink-0">
                            {fb.overall_rating ? RATING_EMOJIS[fb.overall_rating - 1] : '❓'}
                          </span>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Stars */}
                              {fb.overall_rating && (
                                <div className="flex gap-0.5">
                                  {[1, 2, 3, 4, 5].map(s => (
                                    <span key={s} className={`text-xs ${s <= fb.overall_rating! ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                                  ))}
                                </div>
                              )}
                              <span className="text-[10px] text-gray-400">{fb.attendance_date}</span>
                              {fb.is_anonymous && (
                                <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">🕵️</span>
                              )}
                              <span className="text-[10px] text-gray-400">
                                {fb.check_in_method === 'qr_code' ? '📱 QR' : fb.check_in_method === 'photo' ? '📷 Photo' : ''}
                              </span>
                              {hasCustomResponses && (
                                <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded">
                                  +{Object.keys(fb.responses).length} answers
                                </span>
                              )}
                            </div>
                            {fb.comment && (
                              <p className={`text-sm text-gray-600 dark:text-gray-300 mt-0.5 ${isExpanded ? '' : 'line-clamp-1'}`}>
                                {fb.comment}
                              </p>
                            )}
                          </div>

                          <span className={`text-gray-400 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                        </button>

                        {/* Expanded Detail */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div>
                                <span className="text-gray-400 block">Rating</span>
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  {fb.overall_rating ? `${fb.overall_rating}/5 ${RATING_EMOJIS[fb.overall_rating - 1]}` : '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 block">Date</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{fb.attendance_date}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 block">Method</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {fb.check_in_method === 'qr_code' ? 'QR Code' : fb.check_in_method === 'photo' ? 'Face Recognition' : fb.check_in_method || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 block">Response #{idx + 1}</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {fb.is_anonymous ? '🕵️ Anonymous' : 'Identified'}
                                </span>
                              </div>
                            </div>

                            {fb.comment && (
                              <div>
                                <span className="text-xs text-gray-400 block mb-1">Comment</span>
                                <p className="text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                                  {fb.comment}
                                </p>
                              </div>
                            )}

                            {/* Custom question responses */}
                            {hasCustomResponses && questions.length > 0 && (
                              <div>
                                <span className="text-xs text-gray-400 block mb-2">Question Responses</span>
                                <div className="space-y-2">
                                  {questions.map(q => {
                                    const val = fb.responses?.[q.id];
                                    if (val === undefined || val === null || val === '') return null;
                                    return (
                                      <div key={q.id} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                        <p className="text-[10px] font-medium text-purple-600 dark:text-purple-400 mb-0.5">{q.question_text}</p>
                                        <p className="text-sm text-gray-800 dark:text-gray-200">
                                          {q.question_type === 'rating' ? (
                                            <span className="flex items-center gap-1">
                                              {[1, 2, 3, 4, 5].map(s => (
                                                <span key={s} className={`text-sm ${s <= Number(val) ? 'text-yellow-400' : 'text-gray-300'}`}>★</span>
                                              ))}
                                              <span className="ml-1 text-xs text-gray-500">({String(val)}/5)</span>
                                            </span>
                                          ) : q.question_type === 'emoji' ? (
                                            <span>{MOOD_EMOJIS[String(val)] || String(val)} {String(val)}</span>
                                          ) : (
                                            String(val)
                                          )}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
