import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { toast } from '../components/ui/toastUtils';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { feedbackService, type SessionFeedback, type FeedbackStats, type FeedbackQuestion, type FeedbackTemplate, type FeedbackTemplateInput, type FeedbackComparison } from '../services/feedbackService';
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

type ActiveTab = 'analytics' | 'questions' | 'responses' | 'dates';

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
  const [templates, setTemplates] = useState<FeedbackTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');
  const [updatingFeedbackEnabled, setUpdatingFeedbackEnabled] = useState(false);
  const [updatingAnonymousAllowed, setUpdatingAnonymousAllowed] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

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

  // Date Comparison tab
  const [dateComparison, setDateComparison] = useState<FeedbackComparison | null>(null);
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [dateStats, setDateStats] = useState<FeedbackStats | null>(null);
  const [loadingDateStats, setLoadingDateStats] = useState(false);
  const [analyticsSortBy, setAnalyticsSortBy] = useState<'date' | 'rating' | 'responses' | 'rate'>('date');
  const [analyticsSortDir, setAnalyticsSortDir] = useState<'asc' | 'desc'>('desc');

  // Question date scope: '' = show all, 'global' = global-only, 'YYYY-MM-DD' = date-specific
  const [questionDateScope, setQuestionDateScope] = useState<string>('');

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
      const [fbResult, statsResult, questionsResult, templatesResult] = await Promise.all([
        feedbackService.getBySession(selectedSessionId),
        feedbackService.getStats(selectedSessionId),
        feedbackService.getQuestions(selectedSessionId),
        feedbackService.getTemplates(),
      ]);
      if (cancelled) return;
      const feedbackError = fbResult.error as { message?: string } | null;
      const statsError = statsResult.error as { message?: string } | null;
      const questionsError = questionsResult.error as { message?: string } | null;
      const templatesError = templatesResult.error as { message?: string } | null;
      const combinedError = feedbackError?.message || statsError?.message || questionsError?.message || templatesError?.message || null;

      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setQuestions(questionsResult.data || []);
      setTemplates(templatesResult.data || []);
      setSelectedTemplateId((current) => current || templatesResult.data?.[0]?.id || '');
      setPageError(combinedError);

      if (combinedError) {
        toast.error(combinedError, 7000);
      }

      // Auto-apply default template if session has no questions yet
      const loadedQuestions = questionsResult.data || [];
      const loadedTemplates = templatesResult.data || [];
      if (loadedQuestions.length === 0 && loadedTemplates.length > 0) {
        const defaultTemplate = loadedTemplates.find(t => t.is_default) || loadedTemplates[0];
        if (defaultTemplate) {
          const applyResult = await feedbackService.applyTemplateToSession(defaultTemplate.id, selectedSessionId);
          if (!applyResult.error) {
            const refreshed = await feedbackService.getQuestions(selectedSessionId);
            if (!cancelled) {
              setQuestions(refreshed.data || []);
              toast.success(`Auto-applied template "${defaultTemplate.name}" with ${defaultTemplate.questions.length} questions`);
            }
          }
        }
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

  // Questions filtered by date scope for the Questions tab
  const scopedQuestions = useMemo(() => {
    if (!questionDateScope) return questions; // show all
    if (questionDateScope === 'global') return questions.filter(q => !q.attendance_date);
    return questions.filter(q => !q.attendance_date || q.attendance_date === questionDateScope);
  }, [questions, questionDateScope]);

  // Distinct dates that have date-specific questions
  const questionDates = useMemo(() => {
    const dates = new Set<string>();
    for (const q of questions) {
      if (q.attendance_date) dates.add(q.attendance_date);
    }
    return [...dates].sort();
  }, [questions]);

  // Count stats for scope selector
  const globalQuestionCount = useMemo(() => questions.filter(q => !q.attendance_date).length, [questions]);
  const dateSpecificQuestionCount = useMemo(() => questions.filter(q => q.attendance_date).length, [questions]);

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

  const latestResponseLabel = stats?.latestResponseDate
    ? `Latest response on ${stats.latestResponseDate}`
    : 'No feedback submitted yet';

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



  // ─── Question handlers ─────────────────────────────────────
  const handleSubmitQuestion = async () => {
    if (!selectedSessionId) return;
    const trimmedText = questionDraft.question_text.trim();
    if (!trimmedText) { setQuestionError('Question text is required.'); return; }

    const parsedOptions = questionDraft.question_type === 'multiple_choice'
      ? questionDraft.optionsText.split(/[,،]/).map(o => o.trim()).filter(Boolean)
      : [];
    if (questionDraft.question_type === 'multiple_choice' && parsedOptions.length < 2) {
      setQuestionError('Multiple choice needs at least 2 options separated by comma (,) or Arabic comma (،)');
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

    // Determine attendance_date from scope
    const scopeDate = questionDateScope && questionDateScope !== 'global' ? questionDateScope : null;

    const result = editingQuestionId
      ? await feedbackService.updateQuestion(editingQuestionId, payload)
      : await feedbackService.createQuestion({ session_id: selectedSessionId, sort_order: questions.length, attendance_date: scopeDate, ...payload });

    if (result.error) { setQuestionError(result.error.message || 'Unable to save.'); toast.error(result.error.message || 'Unable to save question'); setSavingQuestion(false); return; }
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
    // Determine date scope for template application
    const scopeDate = questionDateScope && questionDateScope !== 'global' ? questionDateScope : null;
    const result = await feedbackService.applyTemplateToSession(selectedTemplateId, selectedSessionId, scopeDate);
    if (result.error) { setQuestionError(result.error.message || 'Unable to apply.'); setApplyingTemplate(false); return; }
    const refreshed = await feedbackService.getQuestions(selectedSessionId);
    setQuestions(refreshed.data || []);
    resetQuestionDraft();
    setApplyingTemplate(false);
    toast.success(scopeDate ? `Template applied for ${scopeDate}` : 'Template applied globally');
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
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Student survey insights & form builder</p>
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
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr,1fr] gap-4">
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedSession.course_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Teacher: {selectedSession.teacher_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{selectedSession.start_date} to {selectedSession.end_date}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selectedSession.feedback_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                      {selectedSession.feedback_enabled ? 'Feedback Live' : 'Feedback Off'}
                    </span>
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      {questions.length} question{questions.length === 1 ? '' : 's'}
                    </span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                      {selectedSession.feedback_anonymous_allowed ? 'Anonymous Allowed' : 'Identity Retained'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Collection Health</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{stats?.engagedStudents ?? 0} engaged students</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{stats?.responseRate ?? 0}% of active enrolled students</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Coverage</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{stats?.datesCovered ?? 0} dates covered</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{latestResponseLabel}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400">Form Readiness</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{questions.some((question) => question.is_required) ? 'Required checks active' : 'All questions optional'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Students answer after successful check-in only</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Session Controls</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Keep frontend behavior aligned with what this session should expose to students.</p>
                </div>

                <button
                  type="button"
                  onClick={handleToggleFeedbackEnabled}
                  disabled={updatingFeedbackEnabled}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3 text-left transition hover:border-purple-300 dark:hover:border-purple-700 disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Feedback availability</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Students only see the form when feedback is enabled.</p>
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
                      <p className="text-xs text-gray-500 dark:text-gray-400">Anonymous answers stay hidden in the UI, while duplicate prevention still works.</p>
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
              { key: 'dates' as ActiveTab, label: 'By Date', icon: '📅', badge: dateComparison?.dates.length },
              { key: 'questions' as ActiveTab, label: 'Questions', icon: '🧩', badge: questions.length },
              { key: 'responses' as ActiveTab, label: 'Responses', icon: '💬', badge: feedbacks.length },
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

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: ANALYTICS                                     */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'analytics' && (
            <>
              {/* Analytics date filter */}
              {uniqueDates.length > 1 && (
                <div className="flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <span className="text-xs text-gray-500 shrink-0">📅 Filter analytics:</span>
                  <select
                    value={selectedAnalyticsDate}
                    onChange={e => setSelectedAnalyticsDate(e.target.value)}
                    className="flex-1 text-xs rounded-lg border-0 bg-white dark:bg-gray-800 px-2 py-1.5 text-gray-900 dark:text-white focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="">All dates ({feedbacks.length} total)</option>
                    {uniqueDates.map(d => {
                      const count = feedbacks.filter(f => f.attendance_date === d).length;
                      return <option key={d} value={d}>{d} ({count} responses)</option>;
                    })}
                  </select>
                  {selectedAnalyticsDate && (
                    <button onClick={() => setSelectedAnalyticsDate('')} className="text-[10px] text-purple-600 hover:text-purple-800 dark:text-purple-400 px-2 py-1 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20">
                      ✕ Clear
                    </button>
                  )}
                </div>
              )}

              {stats && stats.totalResponses > 0 ? (
                <div className="space-y-5">
                  {/* KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Responses', value: String(stats.totalResponses), sub: `${stats.datesCovered} teaching dates covered`, color: 'purple' },
                      { label: 'Students', value: `${stats.engagedStudents}`, sub: `${stats.responseRate}% of active enrolled`, color: 'green' },
                      { label: 'Avg Rating', value: `${stats.averageRating}`, sub: RATING_EMOJIS[Math.round(stats.averageRating) - 1] || '', color: 'yellow' },
                      { label: 'NPS', value: `${npsScore > 0 ? '+' : ''}${npsScore}`, sub: latestResponseLabel, color: npsScore >= 0 ? 'green' : 'red' },
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

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">⭐ Rating Distribution</p>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={ratingDistributionData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                          <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32}>
                            {ratingDistributionData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📈 Rating Trend</p>
                      {dailyTrendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={dailyTrendData}>
                            <defs>
                              <linearGradient id="ratingGrad2" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <Tooltip />
                            <Area type="monotone" dataKey="avgRating" stroke="#8b5cf6" fill="url(#ratingGrad2)" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} name="Avg Rating" />
                            <Line type="monotone" dataKey="responses" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 2 }} name="Responses" yAxisId={0} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">No trend data</div>
                      )}
                    </div>
                  </div>

                  {/* Method + Per-Question */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📱 Check-In Method</p>
                      {methodDistribution.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={methodDistribution}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
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
                        <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">No data</div>
                      )}
                    </div>

                    {/* Per-question analytics inline */}
                    <div className="lg:col-span-2 space-y-3">
                      {questionAnalytics.length > 0 && (
                        <>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🔍 Per-Question Breakdown</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {questionAnalytics.map(({ question, data: qData }, qi) => (
                              <div key={question.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0">Q{qi + 1}</span>
                                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2">{question.question_text}</p>
                                </div>
                                {qData.total === 0 ? (
                                  <p className="text-xs text-gray-400 text-center py-3">No responses</p>
                                ) : qData.type === 'rating' ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{qData.avg}</span>
                                      <span>{RATING_EMOJIS[Math.round(qData.avg) - 1] || ''}</span>
                                      <span className="text-[10px] text-gray-400 ml-auto">{qData.total} resp.</span>
                                    </div>
                                    {[5, 4, 3, 2, 1].map(r => {
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
                                      <p key={ai} className="text-[11px] text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 truncate">"{answer}"</p>
                                    ))}
                                    {qData.answers.length > 5 && <p className="text-[10px] text-gray-400 text-center">+{qData.answers.length - 5} more</p>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Recent Comments */}
                  {stats.recentComments.length > 0 && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">💬 Recent Comments</p>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {stats.recentComments.map((c, i) => (
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
                    Set up questions first, then students can respond after checking in.
                  </p>
                  <button onClick={() => setActiveTab('questions')} className="mt-3 text-sm text-purple-600 dark:text-purple-400 hover:underline font-medium">
                    → Set up questions
                  </button>
                </div>
              )}
            </>
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

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: QUESTIONS                                     */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'questions' && (
            <div className="space-y-4">
              {questionError && (
                <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {questionError}
                </div>
              )}
              {selectedSession && !selectedSession.feedback_enabled && (
                <div className="rounded-lg border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
                  Question setup is ready, but students will not see it until feedback availability is enabled for this session.
                </div>
              )}
              {templateError && (
                <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {templateError}
                </div>
              )}

              {/* Date Scope Selector for per-date questions */}
              <div className="rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-700 px-4 py-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">📅 Question Scope:</span>
                    <select
                      value={questionDateScope}
                      onChange={e => setQuestionDateScope(e.target.value)}
                      className="text-xs rounded-lg border border-indigo-200 dark:border-indigo-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">All Questions ({questions.length})</option>
                      <option value="global">🌐 Global Only ({globalQuestionCount})</option>
                      {uniqueDates.map(d => {
                        const dateCount = questions.filter(q => q.attendance_date === d).length;
                        return <option key={d} value={d}>📌 {d} ({dateCount} date-specific)</option>;
                      })}
                      {questionDates.filter(d => !uniqueDates.includes(d)).map(d => {
                        const dateCount = questions.filter(q => q.attendance_date === d).length;
                        return <option key={d} value={d}>📌 {d} ({dateCount} date-specific)</option>;
                      })}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-indigo-600 dark:text-indigo-400">
                    <span className="px-1.5 py-0.5 rounded bg-white/60 dark:bg-gray-800/60 border border-indigo-200 dark:border-indigo-700">🌐 {globalQuestionCount} global</span>
                    {dateSpecificQuestionCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-white/60 dark:bg-gray-800/60 border border-indigo-200 dark:border-indigo-700">📌 {dateSpecificQuestionCount} date-specific</span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-1.5">
                  {questionDateScope && questionDateScope !== 'global'
                    ? `New questions/templates will be applied to ${questionDateScope} only. Students on this date see global + date-specific questions.`
                    : questionDateScope === 'global'
                      ? 'Showing global questions. These appear on every session date. New questions added here will be global.'
                      : 'Showing all questions across all dates. Select a specific date to manage date-specific questions.'}
                </p>
              </div>

              {/* Quick Apply Template - compact bar */}
              {templates.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 px-3 py-2">
                  <span className="text-xs font-medium text-violet-700 dark:text-violet-300 shrink-0">
                    Template {questionDateScope && questionDateScope !== 'global' ? `→ ${questionDateScope}` : '→ Global'}:
                  </span>
                  <select
                    value={selectedTemplateId}
                    onChange={e => setSelectedTemplateId(e.target.value)}
                    className="flex-1 text-xs rounded-lg border-0 bg-white dark:bg-gray-800 px-2 py-1.5 text-gray-900 dark:text-white focus:ring-1 focus:ring-violet-500"
                  >
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' ★' : ''} ({t.questions.length}Q)</option>
                    ))}
                  </select>
                  <Button type="button" onClick={handleApplyTemplate} disabled={!selectedTemplateId || applyingTemplate} size="sm" className="shrink-0">
                    {applyingTemplate ? '...' : '📥 Apply'}
                  </Button>
                </div>
              )}

              {/* Builder: question input */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {editingQuestionId ? '✏️ Edit Question' : '➕ New Question'}
                  </p>
                  <span className="text-[10px] text-gray-400">{scopedQuestions.length} in scope · {questions.length} total</span>
                </div>

                <input
                  value={questionDraft.question_text}
                  onChange={(e) => setQuestionDraft(prev => ({ ...prev, question_text: e.target.value }))}
                  dir={questionDraft.question_text && /[\u0600-\u06FF]/.test(questionDraft.question_text) ? 'rtl' : 'ltr'}
                  placeholder="Type your question... / اكتب سؤالك..."
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-gray-400"
                  onKeyDown={e => { if (e.key === 'Enter' && questionDraft.question_text.trim()) handleSubmitQuestion(); }}
                />

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {(['rating', 'emoji', 'text', 'multiple_choice'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setQuestionDraft(prev => ({ ...prev, question_type: t }))}
                      className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-1.5 rounded-full border transition-all ${
                        questionDraft.question_type === t
                          ? 'border-purple-500 bg-purple-600 text-white'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-purple-300'
                      }`}
                    >
                      {t === 'rating' ? '⭐ Rating' : t === 'emoji' ? '😊 Emoji' : t === 'text' ? '📝 Text' : '📋 Multi'}
                    </button>
                  ))}
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer sm:ml-auto">
                    <input
                      type="checkbox"
                      checked={questionDraft.is_required}
                      onChange={(e) => setQuestionDraft(prev => ({ ...prev, is_required: e.target.checked }))}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 h-3 w-3"
                    />
                    Required
                  </label>
                </div>

                {questionDraft.question_type === 'multiple_choice' && (
                  <div className="space-y-1.5">
                    <input
                      value={questionDraft.optionsText}
                      onChange={(e) => setQuestionDraft(prev => ({ ...prev, optionsText: e.target.value }))}
                      dir={questionDraft.optionsText && /[\u0600-\u06FF]/.test(questionDraft.optionsText) ? 'rtl' : 'ltr'}
                      placeholder="Option A, Option B / الخيار أ، الخيار ب"
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
                    />
                    {questionDraft.optionsText && (
                      <div className="flex flex-wrap gap-1">
                        {questionDraft.optionsText.split(/[,،]/).map(o => o.trim()).filter(Boolean).map((opt, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                            {opt}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="button" onClick={handleSubmitQuestion} disabled={savingQuestion || !questionDraft.question_text.trim()} size="sm">
                    {savingQuestion ? 'Saving...' : editingQuestionId ? '💾 Update' : '➕ Add'}
                  </Button>
                  {editingQuestionId && (
                    <Button type="button" variant="outline" onClick={resetQuestionDraft} size="sm">Cancel</Button>
                  )}
                </div>
              </div>

              {/* Question list */}
              {scopedQuestions.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-10 text-center">
                  <span className="text-4xl block mb-2">📋</span>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{questionDateScope === '' ? 'No questions yet' : questionDateScope === 'global' ? 'No global questions' : `No questions for ${questionDateScope}`}</p>
                  <p className="text-xs text-gray-400 mt-1">{questionDateScope === '' ? 'Add a question above or apply a template to get started.' : 'Switch scope or add questions for this view.'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {scopedQuestions.map((question, index) => (
                    <div key={question.id} className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-purple-200 dark:hover:border-purple-700 transition-colors overflow-hidden">
                      <div className="flex items-stretch">
                        <div className={`w-1 shrink-0 ${
                          question.question_type === 'rating' ? 'bg-yellow-400'
                            : question.question_type === 'emoji' ? 'bg-green-400'
                            : question.question_type === 'multiple_choice' ? 'bg-blue-400'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`} />
                        <div className="flex-1 px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">{index + 1}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
                                  {question.question_type === 'rating' ? '⭐' : question.question_type === 'emoji' ? '😊' : question.question_type === 'multiple_choice' ? '📋' : '📝'} {question.question_type.replace('_', ' ')}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${question.attendance_date ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                                  {question.attendance_date ? `📌 ${question.attendance_date}` : '🌐 Global'}
                                </span>
                                {question.is_required && <span className="text-[10px] text-red-500">*</span>}
                              </div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white" dir={/[\u0600-\u06FF]/.test(question.question_text) ? 'rtl' : 'ltr'}>{question.question_text}</p>
                              {/* Inline answer preview */}
                              <div className="mt-1.5">
                                {question.question_type === 'rating' && (
                                  <div className="flex gap-0.5">{[1,2,3,4,5].map(s => <span key={s} className="text-sm text-gray-300 dark:text-gray-600">★</span>)}</div>
                                )}
                                {question.question_type === 'emoji' && (
                                  <div className="flex gap-1.5 text-sm opacity-40">😴 🤔 😐 😊 🔥</div>
                                )}
                                {question.question_type === 'text' && (
                                  <div className="rounded border border-dashed border-gray-200 dark:border-gray-600 px-2.5 py-1.5 text-[11px] text-gray-300 dark:text-gray-600 w-48">Answer here...</div>
                                )}
                                {question.question_type === 'multiple_choice' && question.options.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {question.options.map((opt, oi) => (
                                      <span key={oi} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-400">{opt}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button type="button" onClick={() => handleEditQuestion(question)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600" title="Edit">✏️</button>
                              <button type="button" onClick={() => handleDeleteQuestion(question.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500" title="Delete">🗑</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Save as Template - compact */}
              <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30">
                <summary className="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl select-none">
                  💾 Templates — save, manage & reuse question sets
                </summary>
                <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                  {/* Save form */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500">{editingTemplateId ? 'Edit Template' : 'Save Current Questions'}</p>
                    <div className="flex gap-2">
                      <input
                        value={templateDraft.name}
                        onChange={(e) => setTemplateDraft(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Template name..."
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                      />
                      <Button type="button" onClick={handleSubmitTemplate} disabled={savingTemplate || questions.length === 0} size="sm">
                        {savingTemplate ? '...' : editingTemplateId ? 'Update' : '💾 Save'}
                      </Button>
                      {editingTemplateId && <Button type="button" variant="outline" onClick={resetTemplateDraft} size="sm">Cancel</Button>}
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        value={templateDraft.description}
                        onChange={(e) => setTemplateDraft(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Description (optional)"
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                        <input type="checkbox" checked={templateDraft.is_default} onChange={e => setTemplateDraft(prev => ({ ...prev, is_default: e.target.checked }))} className="rounded border-gray-300 text-purple-600 h-3 w-3" />
                        Default
                      </label>
                    </div>
                  </div>

                  {/* Template list */}
                  {templates.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-700">
                      {templates.map(template => (
                        <div key={template.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                              {template.name} {template.is_default && <span className="text-violet-500">★</span>}
                            </p>
                            <p className="text-[10px] text-gray-400">{template.questions.length} questions{template.description ? ` · ${template.description}` : ''}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button type="button" onClick={() => handleEditTemplate(template)} className="p-1 rounded hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 text-xs" title="Edit">✏️</button>
                            <button type="button" onClick={() => handleDeleteTemplate(template.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 text-xs" title="Delete">🗑</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* TAB: RESPONSES                                     */}
          {/* ═══════════════════════════════════════════════════ */}
          {activeTab === 'responses' && (
            <div className="space-y-3">
              {/* Filter bar */}
              <div className="flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2">
                <span className="text-xs text-gray-500 shrink-0">📅</span>
                <select
                  value={dateFilter}
                  onChange={e => setDateFilter(e.target.value)}
                  className="flex-1 text-xs rounded-lg border-0 bg-white dark:bg-gray-800 px-2 py-1.5 text-gray-900 dark:text-white focus:ring-1 focus:ring-purple-500"
                >
                  <option value="">All dates ({feedbacks.length})</option>
                  {uniqueDates.map(d => {
                    const count = feedbacks.filter(f => f.attendance_date === d).length;
                    return <option key={d} value={d}>{d} ({count})</option>;
                  })}
                </select>
                {dateFilter && (
                  <button onClick={() => setDateFilter('')} className="text-[10px] text-purple-600 hover:text-purple-800 dark:text-purple-400 px-2 py-1 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20">
                    ✕ Clear
                  </button>
                )}
                <span className="text-[10px] text-gray-400 shrink-0 ml-auto">
                  {filteredFeedbacks.length}/{feedbacks.length}
                </span>
              </div>

              {/* Quick stats for filtered date */}
              {dateFilter && filteredFeedbacks.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const ratings = filteredFeedbacks.filter(f => f.overall_rating != null).map(f => f.overall_rating!);
                    const avg = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '—';
                    const comments = filteredFeedbacks.filter(f => f.comment).length;
                    const anonymous = filteredFeedbacks.filter(f => f.is_anonymous).length;
                    return (
                      <>
                        <span className="text-[11px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded-full">
                          ⭐ Avg: {avg}
                        </span>
                        <span className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
                          💬 {comments} comment{comments !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                          🕵️ {anonymous} anonymous
                        </span>
                      </>
                    );
                  })()}
                </div>
              )}

              {filteredFeedbacks.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
                  <span className="text-4xl block mb-2">💬</span>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No responses yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {dateFilter ? 'No responses for this date.' : 'Students will see the feedback form after checking in.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredFeedbacks.map((fb) => {
                    const isExpanded = expandedResponseId === fb.id;
                    const hasCustomResponses = Object.keys(fb.responses || {}).length > 0;
                    return (
                      <div
                        key={fb.id}
                        className={`rounded-xl border transition-all ${
                          isExpanded
                            ? 'border-purple-200 dark:border-purple-700 bg-purple-50/20 dark:bg-purple-900/10 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedResponseId(isExpanded ? null : fb.id)}
                          className="w-full text-left px-3 py-2.5 flex items-center gap-2.5"
                        >
                          <span className="text-lg shrink-0">
                            {fb.overall_rating ? RATING_EMOJIS[fb.overall_rating - 1] : '❓'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {fb.is_anonymous ? '🕵️ Anonymous' : (fb.student_name || 'Unknown')}
                              </p>
                              {fb.overall_rating && (
                                <div className="flex gap-px shrink-0">
                                  {[1,2,3,4,5].map(s => (
                                    <span key={s} className={`text-[10px] ${s <= fb.overall_rating! ? 'text-yellow-400' : 'text-gray-200 dark:text-gray-700'}`}>★</span>
                                  ))}
                                </div>
                              )}
                              {hasCustomResponses && (
                                <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded shrink-0">
                                  +{Object.keys(fb.responses).length}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-gray-400">{fb.attendance_date}</span>
                              {fb.check_in_method && (
                                <span className="text-[10px] text-gray-400">
                                  {fb.check_in_method === 'qr_code' ? '📱' : fb.check_in_method === 'photo' ? '📷' : ''}
                                </span>
                              )}
                              {fb.comment && (
                                <p className="text-[11px] text-gray-400 truncate">&quot;{fb.comment}&quot;</p>
                              )}
                            </div>
                          </div>
                          <span className={`text-gray-300 text-[10px] transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700 pt-2.5 space-y-2.5">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
                                <span className="text-[10px] text-gray-400 block">Rating</span>
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  {fb.overall_rating ? `${fb.overall_rating}/5 ${RATING_EMOJIS[fb.overall_rating - 1]}` : '—'}
                                </span>
                              </div>
                              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
                                <span className="text-[10px] text-gray-400 block">Date</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{fb.attendance_date}</span>
                              </div>
                              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
                                <span className="text-[10px] text-gray-400 block">Method</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {fb.check_in_method === 'qr_code' ? 'QR Code' : fb.check_in_method === 'photo' ? 'Face Recognition' : fb.check_in_method || '—'}
                                </span>
                              </div>
                              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
                                <span className="text-[10px] text-gray-400 block">Student</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300 truncate block">
                                  {fb.is_anonymous ? '🕵️ Anonymous' : (fb.student_name || 'Unknown')}
                                </span>
                              </div>
                            </div>

                            {fb.comment && (
                              <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2">
                                <span className="text-[10px] text-gray-400 block mb-0.5">Comment</span>
                                <p className="text-sm text-gray-800 dark:text-gray-200">{fb.comment}</p>
                              </div>
                            )}

                            {hasCustomResponses && questions.length > 0 && (
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-gray-400 block">Answers</span>
                                {questions.map(q => {
                                  const val = fb.responses?.[q.id];
                                  if (val === undefined || val === null || val === '') return null;
                                  return (
                                    <div key={q.id} className="rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-3 py-2">
                                      <p className="text-[10px] font-medium text-purple-600 dark:text-purple-400 mb-0.5">{q.question_text}</p>
                                      <div className="text-sm text-gray-800 dark:text-gray-200">
                                        {q.question_type === 'rating' ? (
                                          <span className="flex items-center gap-1">
                                            {[1,2,3,4,5].map(s => (
                                              <span key={s} className={`text-sm ${s <= Number(val) ? 'text-yellow-400' : 'text-gray-300'}`}>★</span>
                                            ))}
                                            <span className="ml-1 text-xs text-gray-500">({String(val)}/5)</span>
                                          </span>
                                        ) : q.question_type === 'emoji' ? (
                                          <span>{MOOD_EMOJIS[String(val)] || String(val)} {String(val)}</span>
                                        ) : (
                                          String(val)
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
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
