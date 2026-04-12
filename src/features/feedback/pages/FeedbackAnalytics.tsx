import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select } from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { Breadcrumb } from '@/shared/components/ui/Breadcrumb';
import { feedbackService } from '@/features/feedback/services/feedbackService';
import type { SessionFeedback, FeedbackStats, FeedbackQuestion } from '@/shared/types/database.types';

// ─── Constants ─────────────────────────────────────────────
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];

type QuestionTypeFilter = 'all' | 'rating' | 'text' | 'multiple_choice';
type CorrectnessFilter = 'all' | 'correct' | 'incorrect' | 'not-graded';
type RatingRangeFilter = 'all' | 'bad' | 'neutral' | 'good';
type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';
type ParticipationFilter = 'all' | 'responded' | 'not-responded';
type SortField = 'studentName' | 'attendanceDate' | 'questionType' | 'questionText' | 'answer' | 'comment' | 'overallRating';
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
  overallRating: number | null;
  questionType: string;
  questionText: string;
  answer: string;
  comment: string | null;
  /** null = not a test question; true/false = graded result */
  isCorrect: boolean | null;
  correctAnswer: string | null;
}

// ─── Simple sentiment detection ─────────────────────────────
const POSITIVE_WORDS = new Set(['good','great','excellent','amazing','awesome','love','best','helpful','thank','wonderful','fantastic','outstanding','perfect','nice','happy','enjoyed','useful','clear','interesting','beautiful','brilliant','superb','pleased']);
const NEGATIVE_WORDS = new Set(['bad','poor','terrible','awful','hate','worst','boring','confusing','waste','horrible','disappointing','useless','difficult','hard','slow','unclear','annoying','frustrated','ugly','weak','wrong','problem','issue']);

function detectSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/);
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }
  if (pos > neg && pos > 0) return 'positive';
  if (neg > pos && neg > 0) return 'negative';
  return 'neutral';
}

// ─── CSV export (one row per question-answer) ───────────────
function exportFeedbackCSV(records: FlattenedRecord[], courseName: string, selectedDate?: string) {
  const headers = ['Student', 'Date', 'Rating', 'Question Type', 'Question', 'Answer', 'Correct?', 'Comment'];
  const rows = records.map(r => [
    r.studentName, r.attendanceDate, r.overallRating ?? '',
    r.questionType, r.questionText, r.answer,
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
  const [pageError, setPageError] = useState<string | null>(null);

  // ─── Global Filters ───
  const [selectedAnalyticsDate, setSelectedAnalyticsDate] = useState<string>('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<string>('');
  const [correctnessFilter, setCorrectnessFilter] = useState<CorrectnessFilter>('all');
  const [ratingRangeFilter, setRatingRangeFilter] = useState<RatingRangeFilter>('all');
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [participationFilter, setParticipationFilter] = useState<ParticipationFilter>('all');
  const [recordsPage, setRecordsPage] = useState(0);
  const RECORDS_PER_PAGE = 15;
  // ─── Sorting (Records tab) ─────────────────────────────────
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
    }
  }, [selectedSessionId]);
  useRefreshOnFocus(refreshFeedbackData);

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
      // Rating Range filter
      if (ratingRangeFilter !== 'all' && fb.overall_rating != null) {
        const r = Number(fb.overall_rating);
        if (ratingRangeFilter === 'bad' && r > 2) return false;
        if (ratingRangeFilter === 'neutral' && r !== 3) return false;
        if (ratingRangeFilter === 'good' && r < 4) return false;
      }
      if (ratingRangeFilter !== 'all' && fb.overall_rating == null) return false;
      // Sentiment filter on comments
      if (sentimentFilter !== 'all') {
        if (!fb.comment) return false;
        const s = detectSentiment(fb.comment);
        if (s !== sentimentFilter) return false;
      }
      return true;
    });
  }, [feedbacks, selectedAnalyticsDate, feedbackSearch, studentFilter, ratingRangeFilter, sentimentFilter]);

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
            attendanceDate: fb.attendance_date, overallRating: fb.overall_rating != null ? Number(fb.overall_rating) : null,
            questionType: 'rating',
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
            attendanceDate: fb.attendance_date, overallRating: fb.overall_rating != null ? Number(fb.overall_rating) : null,
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
        {displayRecords.length > 0 && (
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
          {/* Correctness filter row + advanced filters + clear button */}
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
            <div className="min-w-[130px]">
              <label className="text-[11px] text-gray-400 block mb-1">Rating Range</label>
              <select
                value={ratingRangeFilter}
                onChange={e => { setRatingRangeFilter(e.target.value as RatingRangeFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All Ratings</option>
                <option value="bad">😢 Bad (1-2)</option>
                <option value="neutral">😐 Neutral (3)</option>
                <option value="good">😊 Good (4-5)</option>
              </select>
            </div>
            <div className="min-w-[130px]">
              <label className="text-[11px] text-gray-400 block mb-1">Sentiment</label>
              <select
                value={sentimentFilter}
                onChange={e => { setSentimentFilter(e.target.value as SentimentFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All Sentiments</option>
                <option value="positive">😊 Positive</option>
                <option value="neutral">😐 Neutral</option>
                <option value="negative">😞 Negative</option>
              </select>
            </div>
            <div className="min-w-[140px]">
              <label className="text-[11px] text-gray-400 block mb-1">Participation</label>
              <select
                value={participationFilter}
                onChange={e => { setParticipationFilter(e.target.value as ParticipationFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">All Students</option>
                <option value="responded">✓ Responded</option>
                <option value="not-responded">✗ Not Responded</option>
              </select>
            </div>
            {(feedbackSearch || selectedAnalyticsDate || studentFilter || questionTypeFilter !== 'all' || correctnessFilter !== 'all' || ratingRangeFilter !== 'all' || sentimentFilter !== 'all' || participationFilter !== 'all') && (
              <button
                onClick={() => { setFeedbackSearch(''); setSelectedAnalyticsDate(''); setStudentFilter(''); setQuestionTypeFilter('all'); setCorrectnessFilter('all'); setRatingRangeFilter('all'); setSentimentFilter('all'); setParticipationFilter('all'); setRecordsPage(0); }}
                className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-700 mt-auto"
              >
                ✕ Clear Filters
              </button>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* FEEDBACK RECORDS (one row per Q&A)                 */}
          {/* ═══════════════════════════════════════════════════ */}
          {participationFilter === 'not-responded' ? (
            <div className="space-y-3 sm:space-y-4">
              {/* Show students who never submitted feedback */}
              {(() => {
                const respondedIds = new Set(feedbacks.map(fb => fb.student_id).filter(Boolean));
                const enrolledCount = stats?.enrolledCount ?? 0;
                const notRespondedCount = Math.max(0, enrolledCount - respondedIds.size);
                return (
                  <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">👤</span>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Students Who Haven't Responded</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold">
                        ~{notRespondedCount} of {enrolledCount}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {notRespondedCount === 0
                        ? 'All enrolled students have submitted feedback.'
                        : `Approximately ${notRespondedCount} enrolled student${notRespondedCount !== 1 ? 's' : ''} haven't submitted any feedback. Student names are not available for non-respondents — check the enrollment list for details.`
                      }
                    </p>
                  </div>
                );
              })()}
            </div>
          ) : (
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
                            { key: 'overallRating' as SortField, label: 'Rating' },
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
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              {row.overallRating != null ? (
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  row.overallRating >= 4 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                  : row.overallRating >= 3 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                }`}>
                                  {RATING_EMOJIS[row.overallRating - 1] || ''} {row.overallRating}
                                </span>
                              ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                            </td>
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

        </>
      )}
    </div>
  );
}
