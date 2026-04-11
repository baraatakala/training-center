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
  BarChart, Bar, Cell,
} from 'recharts';

// ─── Constants ─────────────────────────────────────────────
const RATING_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#8b5cf6'];
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];

type ActiveView = 'records' | 'analytics';
type QuestionTypeFilter = 'all' | 'rating' | 'text' | 'multiple_choice';
type CorrectnessFilter = 'all' | 'correct' | 'incorrect' | 'not-graded';
type SortField = 'studentName' | 'attendanceDate' | 'questionType' | 'questionText' | 'answer' | 'comment';
type SortDirection = 'asc' | 'desc';

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
  /** null = not a test question; true/false = graded result */
  isCorrect: boolean | null;
  correctAnswer: string | null;
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
  const headers = ['Student', 'Date', 'Question Type', 'Question', 'Answer', 'Correct?', 'Comment'];
  const rows = records.map(r => [
    r.studentName, r.attendanceDate, r.questionType,
    r.questionText, r.answer,
    r.isCorrect === null ? '' : r.isCorrect ? 'Yes' : 'No',
    r.comment || '',
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
  const [pageError, setPageError] = useState<string | null>(null);

  // Date Comparison
  const [dateComparison, setDateComparison] = useState<FeedbackComparison | null>(null);
  // ─── Global Filters (shared by Records & Analytics tabs) ───
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<string>('');
  const [correctnessFilter, setCorrectnessFilter] = useState<CorrectnessFilter>('all');
  const [recordsPage, setRecordsPage] = useState(0);
  const RECORDS_PER_PAGE = 15;
  // ─── Sorting (Records tab) ─────────────────────────────────
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [heatmapDateAsc, setHeatmapDateAsc] = useState(false);

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
      if (studentFilter) {
        const name = fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown');
        if (name !== studentFilter) return false;
      }
      if (feedbackSearch.trim()) {
        const haystack = [fb.student_name, fb.comment, ...Object.values(fb.responses || {}).map(String)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(feedbackSearch.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [feedbacks, selectedAnalyticsDate, feedbackSearch, studentFilter]);

  const uniqueStudents = useMemo(() => {
    const names = new Set<string>();
    for (const fb of feedbacks) {
      names.add(fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown'));
    }
    return [...names].sort();
  }, [feedbacks]);

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
    if (!stats) return 0;
    const enrolled = stats.enrolledCount;
    if (enrolled === 0) return 0;

    // Compute per-date average participation: for each date, what % of enrolled students gave feedback
    const dateStudents = new Map<string, Set<string>>();
    for (const fb of filteredFeedbacks) {
      if (!fb.attendance_date || !fb.student_id) continue;
      if (!dateStudents.has(fb.attendance_date)) dateStudents.set(fb.attendance_date, new Set());
      dateStudents.get(fb.attendance_date)!.add(fb.student_id);
    }
    if (dateStudents.size === 0) return 0;

    let totalRate = 0;
    for (const students of dateStudents.values()) {
      totalRate += Math.min(100, (students.size / enrolled) * 100);
    }
    return Math.round(totalRate / dateStudents.size);
  }, [filteredFeedbacks, stats]);

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
        if (questionTypeFilter === 'all' || questionTypeFilter === 'rating') {
          rows.push({
            feedbackId: fb.id, studentName, isAnonymous: fb.is_anonymous,
            attendanceDate: fb.attendance_date, questionType: 'rating',
            questionText: 'Overall Rating',
            answer: fb.overall_rating != null ? String(fb.overall_rating) : '—',
            comment: fb.comment,
            isCorrect: null,
            correctAnswer: null,
          });
        }
      } else {
        for (const [qId, val] of entries) {
          const q = qMap.get(qId);
          const qType = q?.question_type?.replace('_', ' ') || '—';
          // Apply question type filter
          if (questionTypeFilter !== 'all') {
            const rawType = q?.question_type || '';
            if (rawType !== questionTypeFilter) continue;
          }
          // Compute graded result for test questions
          let isCorrect: boolean | null = null;
          let correctAnswer: string | null = null;
          if (q?.correct_answer) {
            correctAnswer = q.correct_answer;
            isCorrect = String(val ?? '').trim().toLowerCase() === q.correct_answer.trim().toLowerCase();
          }
          rows.push({
            feedbackId: fb.id, studentName, isAnonymous: fb.is_anonymous,
            attendanceDate: fb.attendance_date,
            questionType: qType,
            questionText: q?.question_text || '—',
            answer: val != null ? String(val) : '—',
            comment: fb.comment,
            isCorrect,
            correctAnswer,
          });
        }
      }
    }
    return rows;
  }, [filteredFeedbacks, questions, questionTypeFilter]);

  // ─── Correctness-filtered records (for display/export) ─────
  const displayRecords = useMemo(() => {
    if (correctnessFilter === 'all') return flattenedRecords;
    return flattenedRecords.filter(r => {
      if (correctnessFilter === 'correct') return r.isCorrect === true;
      if (correctnessFilter === 'incorrect') return r.isCorrect === false;
      return r.isCorrect === null; // not-graded
    });
  }, [flattenedRecords, correctnessFilter]);

  // ─── Response-centric analytics ────────────────────────────
  const allResponseAnalytics = useMemo(() =>
    buildResponseAnalytics(filteredFeedbacks, questions),
    [filteredFeedbacks, questions]);

  // ─── Filtered Overall Rating Distribution ─────────────────
  const filteredRatingDistribution = useMemo(() => {
    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const fb of filteredFeedbacks) {
      if (fb.overall_rating != null) {
        const r = Number(fb.overall_rating);
        if (r >= 1 && r <= 5) dist[r] = (dist[r] || 0) + 1;
      }
    }
    return dist;
  }, [filteredFeedbacks]);

  const trendData = useMemo(() => {
    if (!dateComparison || dateComparison.dates.length < 2) return [];
    return dateComparison.dates.map(d => ({
      date: `${new Date(`${d.date}T00:00:00`).getMonth() + 1}/${new Date(`${d.date}T00:00:00`).getDate()}`,
      rating: d.averageRating, responses: d.responses, engagement: d.responseRate,
    }));
  }, [dateComparison]);

  // ─── Word Frequency (text responses) ───────────────────────
  const wordFrequency = useMemo(() => {
    const textItems = allResponseAnalytics.filter(a => a.data.type === 'text');
    if (textItems.length === 0) return [];
    const wordCounts = new Map<string, number>();
    const stopWords = new Set([
      'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did',
      'will','would','could','should','may','might','can','shall','to','of','in','for','on','with',
      'at','by','from','as','into','about','between','through','during','and','but','or','not','no',
      'so','if','it','its','that','this','these','those','i','me','my','we','our','you','your','he',
      'she','they','them','very','just','also','than','more','most','all','each','every','both','few',
      'some','any','other','what','which','who','how','when','where','why',
      '\u0641\u064a','\u0645\u0646','\u0639\u0644\u0649','\u0625\u0644\u0649','\u0623\u0646','\u0647\u0630\u0627','\u0647\u0630\u0647','\u0627\u0644\u062a\u064a','\u0627\u0644\u0630\u064a','\u0643\u0627\u0646','\u0639\u0646','\u0647\u0648','\u0647\u064a','\u0644\u0627','\u0645\u0627','\u0645\u0639','\u0644\u0645','\u0642\u062f','\u0628\u0639\u062f','\u0643\u0644','\u0630\u0644\u0643','\u0628\u064a\u0646','\u062d\u062a\u0649','\u0639\u0646\u062f','\u062b\u0645','\u0623\u0648','\u0625\u0630\u0627','\u0644\u0643\u0646','\u062d\u064a\u062b',
    ]);
    for (const item of textItems) {
      const answers = (item.data as { answers: string[] }).answers;
      for (const answer of answers) {
        const words = answer.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
        for (const word of words) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
    return [...wordCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([word, count]) => ({ word, count }));
  }, [allResponseAnalytics]);

  // ─── Participation Heatmap (students × dates) ──────────────
  const participationGrid = useMemo(() => {
    if (uniqueDates.length < 2 || uniqueStudents.length < 2) return null;
    const sortedDates = heatmapDateAsc ? [...uniqueDates].reverse() : uniqueDates;
    const grid = uniqueStudents.slice(0, 30).map(student => {
      const cells = sortedDates.map(date => {
        const fb = feedbacks.find(f => {
          const name = f.is_anonymous ? 'Anonymous' : (f.student_name || 'Unknown');
          return name === student && f.attendance_date === date;
        });
        return { date, responded: !!fb, rating: fb?.overall_rating ? Number(fb.overall_rating) : null };
      });
      return { student, cells };
    });
    return { dates: sortedDates, students: grid };
  }, [uniqueDates, uniqueStudents, feedbacks, heatmapDateAsc]);

  const paginatedRecords = useMemo(() => {
    const sorted = [...displayRecords];
    if (sortField) {
      sorted.sort((a, b) => {
        const valA = (a[sortField] ?? '').toString().toLowerCase();
        const valB = (b[sortField] ?? '').toString().toLowerCase();
        const cmp = valA.localeCompare(valB, undefined, { numeric: true });
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    const start = recordsPage * RECORDS_PER_PAGE;
    return sorted.slice(start, start + RECORDS_PER_PAGE);
  }, [displayRecords, recordsPage, sortField, sortDirection]);

  const totalPages = Math.ceil(displayRecords.length / RECORDS_PER_PAGE);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setRecordsPage(0);
  };

  // ─── AI Insights computation ───────────────────────────────
  const aiInsights = useMemo(() => {
    if (feedbacks.length < 3) return [];
    const insights: { type: 'positive' | 'warning' | 'info'; message: string }[] = [];
    const ratingFeedbacks = feedbacks.filter(f => f.overall_rating != null);
    const avgRating = ratingFeedbacks.length > 0
      ? ratingFeedbacks.reduce((s, f) => s + Number(f.overall_rating), 0) / ratingFeedbacks.length
      : 0;

    // 1. Overall satisfaction summary
    if (ratingFeedbacks.length > 0) {
      const pct5 = Math.round(ratingFeedbacks.filter(f => Number(f.overall_rating) === 5).length / ratingFeedbacks.length * 100);
      const pctLow = Math.round(ratingFeedbacks.filter(f => Number(f.overall_rating) <= 2).length / ratingFeedbacks.length * 100);
      if (avgRating >= 4.2)
        insights.push({ type: 'positive', message: `Avg rating ${avgRating.toFixed(1)}/5 — ${pct5}% gave 5 stars.` });
      else if (avgRating < 3)
        insights.push({ type: 'warning', message: `Avg rating ${avgRating.toFixed(1)}/5 — ${pctLow}% rated 1-2. Needs attention.` });
      else
        insights.push({ type: 'info', message: `Avg rating ${avgRating.toFixed(1)}/5 across ${ratingFeedbacks.length} responses.` });
    }

    // 2. Trend
    if (dateComparison && dateComparison.dates.length >= 2) {
      if (dateComparison.trendDirection === 'declining')
        insights.push({ type: 'warning', message: 'Ratings declining over sessions — review recent changes.' });
      else if (dateComparison.trendDirection === 'improving')
        insights.push({ type: 'positive', message: 'Ratings improving across sessions.' });
    }

    // 3. Participation gap
    if (stats && stats.enrolledCount > 0) {
      const participated = new Set(feedbacks.map(f => f.student_id).filter(Boolean)).size;
      const missing = stats.enrolledCount - participated;
      const missPct = Math.round((missing / stats.enrolledCount) * 100);
      if (missPct > 50)
        insights.push({ type: 'warning', message: `${missing}/${stats.enrolledCount} students (${missPct}%) never responded.` });
      else if (missing > 0)
        insights.push({ type: 'info', message: `${missing} student${missing !== 1 ? 's' : ''} (${missPct}%) haven't submitted feedback.` });
      else
        insights.push({ type: 'positive', message: `All ${stats.enrolledCount} enrolled students submitted feedback.` });
    }

    // 4. Polarized questions (divisive opinions)
    const polarized: string[] = [];
    for (const item of allResponseAnalytics) {
      if (item.data.type === 'rating' && item.data.total >= 2) {
        const high = (item.data.distribution[4] || 0) + (item.data.distribution[5] || 0);
        const low = (item.data.distribution[1] || 0) + (item.data.distribution[2] || 0);
        if (high > 0 && low > 0 && (Math.min(high, low) / item.data.total) > 0.25)
          polarized.push(`"${item.questionText}"`);
      }
    }
    if (polarized.length > 0)
      insights.push({ type: 'warning', message: `Divisive opinions on ${polarized.join(', ')} — ratings split between high and low.` });

    // 5. Worst-rated question
    const ratingQs = allResponseAnalytics.filter(q => q.data.type === 'rating' && q.data.total >= 2);
    if (ratingQs.length >= 1) {
      const worst = ratingQs.reduce((a, b) => (a.data as { avg: number }).avg < (b.data as { avg: number }).avg ? a : b);
      const worstData = worst.data as { avg: number };
      if (worstData.avg < 3.5)
        insights.push({ type: 'warning', message: `Lowest-rated: "${worst.questionText}" at ${worstData.avg.toFixed(1)}/5.` });
    }

    // 6. Frequently skipped questions
    const skipped = allResponseAnalytics.filter(item => {
      const skipRate = 1 - (item.data.total / feedbacks.length);
      return feedbacks.length >= 3 && skipRate > 0.4;
    });
    if (skipped.length > 0)
      insights.push({ type: 'info', message: `${skipped.length} question${skipped.length !== 1 ? 's' : ''} skipped by >40% — consider simplifying or making required.` });

    // 7. Test difficulty (only the hardest)
    const testQs = questions.filter(q => q.correct_answer);
    if (testQs.length > 0) {
      let worstPct = 100;
      let worstQ = testQs[0];
      for (const q of testQs) {
        const attempts = feedbacks.filter(fb => fb.responses?.[q.id] !== undefined && fb.responses?.[q.id] !== '');
        const correct = attempts.filter(fb => String(fb.responses?.[q.id] ?? '').trim().toLowerCase() === q.correct_answer!.trim().toLowerCase());
        const pct = attempts.length > 0 ? Math.round((correct.length / attempts.length) * 100) : 100;
        if (pct < worstPct) { worstPct = pct; worstQ = q; }
      }
      if (worstPct <= 50)
        insights.push({ type: 'warning', message: `"${worstQ.question_text}" — only ${worstPct}% correct. May need review.` });
    }

    // 8. Anonymous honesty gap
    const anonSub = feedbacks.filter(f => f.is_anonymous && f.overall_rating != null);
    const namedSub = feedbacks.filter(f => !f.is_anonymous && f.overall_rating != null);
    if (anonSub.length >= 2 && namedSub.length >= 2) {
      const anonAvg = anonSub.reduce((s, f) => s + Number(f.overall_rating), 0) / anonSub.length;
      const namedAvg = namedSub.reduce((s, f) => s + Number(f.overall_rating), 0) / namedSub.length;
      if (Math.abs(anonAvg - namedAvg) > 0.8)
        insights.push({ type: 'info', message: `Anonymous avg ${anonAvg.toFixed(1)} vs named ${namedAvg.toFixed(1)} — ${anonAvg < namedAvg ? 'students rate lower anonymously' : 'students rate higher anonymously'}.` });
    }

    return insights.slice(0, 6);
  }, [feedbacks, dateComparison, questions, allResponseAnalytics, stats]);

  // ─── Knowledge Assessment (test questions only) ────────────
  const knowledgeAssessment = useMemo(() => {
    const testQuestions = questions.filter(q => q.correct_answer);
    if (testQuestions.length === 0) return null;

    // Per-question accuracy
    interface QuestionAccuracy {
      questionId: string;
      questionText: string;
      correctAnswer: string;
      totalAttempts: number;
      correctCount: number;
      accuracyPct: number;
    }
    const perQuestion: QuestionAccuracy[] = testQuestions.map(q => {
      const attempts = filteredFeedbacks.filter(fb => fb.responses?.[q.id] !== undefined && fb.responses?.[q.id] !== '');
      const correct = attempts.filter(fb =>
        String(fb.responses?.[q.id] ?? '').trim().toLowerCase() === q.correct_answer!.trim().toLowerCase()
      );
      return {
        questionId: q.id,
        questionText: q.question_text,
        correctAnswer: q.correct_answer!,
        totalAttempts: attempts.length,
        correctCount: correct.length,
        accuracyPct: attempts.length > 0 ? Math.round((correct.length / attempts.length) * 100) : 0,
      };
    }).filter(q => q.totalAttempts > 0);

    if (perQuestion.length === 0) return null;

    // Per-student scores
    interface StudentScore {
      studentId: string;
      studentName: string;
      attempted: number;
      correct: number;
      scorePct: number;
    }
    const studentMap = new Map<string, StudentScore>();
    for (const fb of filteredFeedbacks) {
      const sid = fb.student_id || fb.id;
      const name = fb.is_anonymous ? 'Anonymous' : (fb.student_name || 'Unknown');
      if (!studentMap.has(sid)) studentMap.set(sid, { studentId: sid, studentName: name, attempted: 0, correct: 0, scorePct: 0 });
      const entry = studentMap.get(sid)!;
      for (const q of testQuestions) {
        const val = fb.responses?.[q.id];
        if (val === undefined || val === '') continue;
        entry.attempted++;
        if (String(val).trim().toLowerCase() === q.correct_answer!.trim().toLowerCase()) entry.correct++;
      }
    }
    for (const entry of studentMap.values()) {
      entry.scorePct = entry.attempted > 0 ? Math.round((entry.correct / entry.attempted) * 100) : 0;
    }
    const studentScores = [...studentMap.values()].filter(s => s.attempted > 0).sort((a, b) => b.scorePct - a.scorePct);

    const overallPct = perQuestion.reduce((s, q) => s + q.accuracyPct, 0) / perQuestion.length;

    return { perQuestion, studentScores, overallPct: Math.round(overallPct) };
  }, [filteredFeedbacks, questions]);

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
        {displayRecords.length > 0 && activeView === 'records' && (
          <Button variant="outline" size="sm" className="rounded-full self-start sm:self-auto" onClick={() => exportFeedbackCSV(displayRecords, selectedSession?.course_name || 'feedback', selectedAnalyticsDate)}>
            📥 Export CSV
          </Button>
        )}
      </div>

      {/* ─── Session Selector ────────────────────────────────── */}
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
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1" title="Avg % of enrolled students who submitted feedback per date">Participation</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">{filteredResponseRate}%</p>
              <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden mt-1">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${filteredResponseRate}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{filteredStats.engagedStudents} / {stats?.enrolledCount ?? '?'} students</p>
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

          {/* ─── Global Filters (shared by Records & Analytics) ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-end">
            <div className="min-w-0">
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
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">Student</label>
              <select
                value={studentFilter}
                onChange={e => { setStudentFilter(e.target.value); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="">All Students</option>
                {uniqueStudents.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">Question Type</label>
              <select
                value={questionTypeFilter}
                onChange={e => { setQuestionTypeFilter(e.target.value as QuestionTypeFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All Types</option>
                <option value="rating">Rating</option>
                <option value="text">Text</option>
                <option value="multiple_choice">Multiple Choice</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">Search</label>
              <input
                type="text"
                value={feedbackSearch}
                onChange={e => { setFeedbackSearch(e.target.value); setRecordsPage(0); }}
                placeholder="Search answers, comments..."
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white placeholder:text-gray-400"
              />
            </div>
          </div>
          {/* Correctness filter row + clear button */}
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            {knowledgeAssessment && (
              <div className="min-w-[140px]">
                <label className="text-[11px] text-gray-400 block mb-1">Correctness</label>
                <select
                  value={correctnessFilter}
                  onChange={e => { setCorrectnessFilter(e.target.value as CorrectnessFilter); setRecordsPage(0); }}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                >
                  <option value="all">All Results</option>
                  <option value="correct">✓ Correct Only</option>
                  <option value="incorrect">✗ Incorrect Only</option>
                  <option value="not-graded">— Not Graded</option>
                </select>
              </div>
            )}
            {(feedbackSearch || selectedAnalyticsDate || studentFilter || questionTypeFilter !== 'all' || correctnessFilter !== 'all') && (
              <button
                onClick={() => { setFeedbackSearch(''); setSelectedAnalyticsDate(''); setStudentFilter(''); setQuestionTypeFilter('all'); setCorrectnessFilter('all'); setRecordsPage(0); }}
                className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-700 mt-auto"
              >
                ✕ Clear Filters
              </button>
            )}
          </div>

          {/* ─── View Tabs ──────────────────────────────────── */}
          <div className="flex items-center gap-1 p-1.5 bg-gray-100/80 dark:bg-gray-800/80 rounded-2xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50">
            {([
              { key: 'records' as ActiveView, icon: '📋', label: 'Records', badge: displayRecords.length },
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
              {/* Records Table — one row per question-answer */}
              {displayRecords.length === 0 ? (
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
                          {([
                            { key: 'studentName' as SortField, label: 'Student' },
                            { key: 'attendanceDate' as SortField, label: 'Date' },
                            { key: 'questionType' as SortField, label: 'Type' },
                            { key: 'questionText' as SortField, label: 'Question' },
                            { key: 'answer' as SortField, label: 'Answer' },
                            { key: null, label: 'Correct?' },
                            { key: 'comment' as SortField, label: 'Comment' },
                          ]).map(col => (
                            <th
                              key={col.label}
                              onClick={() => col.key && handleSort(col.key)}
                              className={`px-3 py-2.5 text-gray-400 font-semibold text-left first:pl-4 sm:first:pl-5 whitespace-nowrap ${col.key ? 'cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-200 transition-colors' : ''}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {col.label}
                                {col.key && (sortField === col.key ? (
                                  <span className="text-purple-500">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">⇅</span>
                                ))}
                              </span>
                            </th>
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
                              <span className={`font-medium truncate block px-1.5 py-0.5 rounded ${
                                row.isCorrect === true ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                : row.isCorrect === false ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                : 'text-gray-900 dark:text-white'
                              }`} title={row.answer}>{row.answer}</span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {row.isCorrect === null ? (
                                <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                              ) : row.isCorrect ? (
                                <span title={`Correct answer: ${row.correctAnswer}`}>✅</span>
                              ) : (
                                <span title={`Correct answer: ${row.correctAnswer}`}>❌</span>
                              )}
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
                        {recordsPage * RECORDS_PER_PAGE + 1}–{Math.min((recordsPage + 1) * RECORDS_PER_PAGE, displayRecords.length)} of {displayRecords.length}
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

              {/* ─── Overall Rating Distribution ─────────────── */}
              {Object.values(filteredRatingDistribution).some(v => v > 0) && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                  <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">Overall Rating Distribution</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[5, 4, 3, 2, 1].map(r => ({ rating: `${r} ${RATING_EMOJIS[r - 1]}`, count: filteredRatingDistribution[r] || 0, fill: RATING_COLORS[r - 1] }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                      <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                      <Tooltip />
                      <Bar dataKey="count" name="Responses" radius={[6, 6, 0, 0]}>
                        {[5, 4, 3, 2, 1].map((r, i) => <Cell key={i} fill={RATING_COLORS[r - 1]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
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

              {/* ─── Participation Heatmap ──────────────────── */}
              {participationGrid && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">🗓️</span>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Participation Heatmap</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 font-semibold">{participationGrid.students.length} students × {participationGrid.dates.length} dates</span>
                    <button
                      onClick={() => setHeatmapDateAsc(v => !v)}
                      className="ml-auto text-[10px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title={heatmapDateAsc ? 'Oldest first' : 'Newest first'}
                    >
                      Date {heatmapDateAsc ? '↑ Old→New' : '↓ New→Old'}
                    </button>
                  </div>
                  <div className="overflow-x-auto pb-2">
                    <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `minmax(80px, 120px) repeat(${participationGrid.dates.length}, 28px)` }}>
                      {/* Header: date labels */}
                      <div />
                      {participationGrid.dates.map(date => (
                        <div key={date} className="text-[7px] sm:text-[8px] text-center text-gray-400 truncate" title={date}>
                          {date.slice(5)}
                        </div>
                      ))}
                      {/* Student rows */}
                      {participationGrid.students.map(row => (
                        <div key={row.student} className="contents">
                          <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate pr-1.5 flex items-center" title={row.student}>{row.student}</div>
                          {row.cells.map(cell => (
                            <div
                              key={cell.date}
                              className={`w-7 h-6 rounded-sm transition-colors ${
                                !cell.responded ? 'bg-gray-100 dark:bg-gray-800/60'
                                : cell.rating === null ? 'bg-blue-200 dark:bg-blue-800/60'
                                : cell.rating >= 4 ? 'bg-green-400 dark:bg-green-600'
                                : cell.rating >= 3 ? 'bg-yellow-300 dark:bg-yellow-600'
                                : 'bg-red-300 dark:bg-red-600'
                              }`}
                              title={`${row.student} · ${cell.date}: ${!cell.responded ? 'No response' : cell.rating != null ? `Rating: ${cell.rating}` : 'Responded'}`}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700" /> No response</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-400" /> Rating 4-5</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-300" /> Rating 3</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-300" /> Rating 1-2</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-200" /> Responded (no rating)</span>
                  </div>
                </div>
              )}

              {/* ─── Word Frequency Panel ───────────────────── */}
              {wordFrequency.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">💬</span>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Top Keywords from Text Responses</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-300 font-semibold">{wordFrequency.length} words</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {wordFrequency.map((item, i) => {
                      const maxCount = wordFrequency[0].count;
                      const width = (item.count / maxCount) * 100;
                      return (
                        <div key={item.word} className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 w-4 text-right font-mono">{i + 1}</span>
                          <span className="text-xs text-gray-700 dark:text-gray-300 w-20 sm:w-24 truncate font-medium shrink-0" title={item.word}>{item.word}</span>
                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${width}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-400 w-6 text-right font-mono">{item.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── Knowledge Assessment Panel ─────────────── */}
              {knowledgeAssessment && (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-amber-200 dark:border-amber-700 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-amber-100 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/10">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🎯</span>
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-300">Knowledge Assessment</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold">
                        {knowledgeAssessment.perQuestion.length} test Q{knowledgeAssessment.perQuestion.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-black ${
                      knowledgeAssessment.overallPct >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : knowledgeAssessment.overallPct >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {knowledgeAssessment.overallPct}% overall
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-5">
                    {/* Per-question accuracy bars */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Question Accuracy</p>
                      {knowledgeAssessment.perQuestion.map(q => (
                        <div key={q.questionId} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1" title={q.questionText}>{q.questionText}</p>
                            <span className={`text-xs font-bold shrink-0 ${
                              q.accuracyPct >= 80 ? 'text-green-600 dark:text-green-400'
                              : q.accuracyPct >= 50 ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                            }`}>{q.correctCount}/{q.totalAttempts} — {q.accuracyPct}%</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                q.accuracyPct >= 80 ? 'bg-green-500'
                                : q.accuracyPct >= 50 ? 'bg-amber-500'
                                : 'bg-red-500'
                              }`}
                              style={{ width: `${q.accuracyPct}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-gray-400">✓ Correct answer: <span className="font-semibold text-gray-600 dark:text-gray-300">{q.correctAnswer}</span></p>
                        </div>
                      ))}
                    </div>


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
