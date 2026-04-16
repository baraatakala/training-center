import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select } from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { Breadcrumb } from '@/shared/components/ui/Breadcrumb';
import { feedbackService } from '@/features/feedback/services/feedbackService';
import type { SessionFeedback, FeedbackStats, FeedbackQuestion } from '@/shared/types/database.types';
import { gradeAnswer } from '@/features/feedback/utils/grading';

// ─── Constants ─────────────────────────────────────────────
const RATING_EMOJIS = ['😢', '😕', '😐', '😊', '🤩'];

type QuestionTypeFilter = 'all' | 'rating' | 'text' | 'multiple_choice';
type CorrectnessFilter = 'all' | 'correct' | 'partial' | 'incorrect' | 'not-graded';
type RatingRangeFilter = 'bad' | 'neutral' | 'good';
type ViolationsFilter = 'all' | 'has_violations';

type SortField = 'studentName' | 'attendanceDate' | 'checkInTime' | 'questionType' | 'questionText' | 'answer' | 'comment' | 'overallRating' | 'tabSwitchCount';
type SortDirection = 'asc' | 'desc';

interface SessionOption {
  session_id: string;
  course_name: string;
  teacher_name: string;
  start_date: string;
  end_date: string;
  feedback_enabled: boolean;
  feedback_anonymous_allowed: boolean;
  // parent_session_id removed — column dropped in migration 033
}

// ─── Flattened record (one row per question-answer) ────────
interface FlattenedRecord {
  feedbackId: string;
  studentName: string;
  isAnonymous: boolean;
  attendanceDate: string;
  checkInTime: string | null;
  overallRating: number | null;
  questionType: string;
  questionText: string;
  answer: string;
  comment: string | null;
  /** null = not a test question; true/false = graded result */
  isCorrect: boolean | null;
  correctAnswer: string | null;
  /** e.g. "1/2", "2/3" — from gradeAnswer detail */
  gradingDetail: string | null;
  /** 0–1 score for partial credit */
  gradingScore: number | null;
  tabSwitchCount: number;
  isAutoSubmitted: boolean;
}

// ─── Simple sentiment detection ─────────────────────────────

// ─── CSV export (one row per question-answer) ───────────────
function exportFeedbackCSV(records: FlattenedRecord[], courseName: string, selectedDate?: string) {
  const headers = ['Student', 'Date', 'Check-In Time', 'Question Type', 'Question', 'Answer', 'Correct Answer', 'Correct?', 'Violations', 'Auto-Submitted', 'Comment'];
  const rows = records.map(r => [
    r.studentName, r.attendanceDate,
    r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : '',
    r.questionType, r.questionText, r.answer,
    r.correctAnswer || '',
    r.isCorrect === null ? '' : r.isCorrect ? 'Yes' : (r.gradingScore !== null && r.gradingScore > 0) ? `Partial (${r.gradingDetail})` : 'No',
    String(r.tabSwitchCount),
    r.isAutoSubmitted ? 'Yes' : '',
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
export function FeedbackAnalytics({ embedded = false, arabicMode: arabicModeProp }: { embedded?: boolean; arabicMode?: boolean } = {}) {
  const [searchParams] = useSearchParams();
  const sessionParam = searchParams.get('session');
  const dateParam = searchParams.get('date');

  // Arabic mode — use prop when embedded, own state when standalone
  const [localArabicMode, setLocalArabicMode] = useState(false);
  const arabicMode = arabicModeProp ?? localArabicMode;

  const t = useMemo(() => arabicMode ? {
    feedbackAnalytics: 'تحليلات التقييم',
    subtitle: 'تحليل ردود الطلاب على الأسئلة والجلسات والتواريخ.',
    exportCSV: '📥 تصدير CSV',
    selectSession: 'اختر الجلسة...',
    noFeedbackSessions: 'لا توجد جلسات تقييم',
    noFeedbackDesc: 'لم يتم تفعيل جمع التقييمات لأي جلسة بعد. قم بتفعيلها من إعدادات الجلسة في صفحة الحضور لبدء جمع ردود الطلاب.',
    openSession: 'افتح جلسة',
    enableFeedback: 'فعّل التقييم',
    addQuestions: 'أضف أسئلة',
    awaitingResponses: 'بانتظار الردود',
    awaitingDesc: 'هذه الجلسة مفعّلة للتقييم لكن لم يقدم أي طالب ردوداً بعد. ستظهر الردود هنا بعد تسجيل الحضور وإكمال نموذج التقييم.',
    responses: 'الردود',
    avgRating: 'متوسط التقييم',
    participation: 'المشاركة',
    dates: 'التواريخ',
    students: 'طلاب',
    dateRange: 'نطاق التاريخ',
    from: 'من',
    to: 'إلى',
    student: 'الطالب',
    allStudents: 'جميع الطلاب',
    questionType: 'نوع السؤال',
    allTypes: 'جميع الأنواع',
    rating: 'تقييم',
    text: 'نص',
    multipleChoice: 'اختيار من متعدد',
    search: 'بحث',
    searchPlaceholder: 'بحث في الإجابات والتعليقات...',
    correctness: 'الصحة',
    allResults: 'جميع النتائج',
    correctOnly: '✓ صحيح فقط',
    partialOnly: '◐ جزئي',
    incorrectOnly: '✗ خاطئ فقط',
    notGraded: '— غير مقيّم',
    ratingRange: 'نطاق التقييم',
    bad: '😢 سيء (1-2)',
    neutral: '😐 محايد (3)',
    good: '😊 جيد (4-5)',
    clearFilters: '✕ مسح الفلاتر',
    date: 'التاريخ',
    type: 'النوع',
    question: 'السؤال',
    answer: 'الإجابة',
    correct: 'صحيح؟',
    comment: 'تعليق',
    noRecordsMatch: 'لا توجد سجلات تطابق الفلاتر.',
    anon: '🕵️ مجهول',
    overallRating: 'التقييم العام',
    of: 'من',
    violations: 'مخالفات',
    hasViolations: 'بها مخالفات',
  } : {
    feedbackAnalytics: 'Feedback Analytics',
    subtitle: 'Analyze student feedback responses per question, session, and date.',
    exportCSV: '📥 Export CSV',
    selectSession: 'Select session...',
    noFeedbackSessions: 'No Feedback Sessions',
    noFeedbackDesc: 'Feedback collection is not enabled for any session yet. Enable it in the Attendance page session settings to start gathering student responses.',
    openSession: 'Open a session',
    enableFeedback: 'Enable feedback',
    addQuestions: 'Add questions',
    awaitingResponses: 'Awaiting Responses',
    awaitingDesc: 'This session has feedback enabled but no students have submitted responses yet. Responses appear here after students check in and complete the feedback form.',
    responses: 'Responses',
    avgRating: 'Avg Rating',
    participation: 'Participation',
    dates: 'Dates',
    students: 'students',
    dateRange: 'Date Range',
    from: 'From',
    to: 'To',
    student: 'Student',
    allStudents: 'All Students',
    questionType: 'Question Type',
    allTypes: 'All Types',
    rating: 'Rating',
    text: 'Text',
    multipleChoice: 'Multiple Choice',
    search: 'Search',
    searchPlaceholder: 'Search answers, comments...',
    correctness: 'Correctness',
    allResults: 'All Results',
    correctOnly: '✓ Correct Only',
    partialOnly: '◐ Partial Credit',
    incorrectOnly: '✗ Incorrect Only',
    notGraded: '— Not Graded',
    ratingRange: 'Rating Range',
    bad: '😢 Bad (1-2)',
    neutral: '😐 Neutral (3)',
    good: '😊 Good (4-5)',
    clearFilters: '✕ Clear Filters',
    date: 'Date',
    type: 'Type',
    question: 'Question',
    answer: 'Answer',
    correct: 'Correct?',
    comment: 'Comment',
    noRecordsMatch: 'No records match your filters.',
    anon: '🕵️ Anon',
    overallRating: 'Overall Rating',
    of: 'of',
    violations: 'Violations',
    hasViolations: 'Has Violations',
  }, [arabicMode]);

  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedbacks, setFeedbacks] = useState<SessionFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [questions, setQuestions] = useState<FeedbackQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // ─── Global Filters ───
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<string>('');
  const [correctnessFilter, setCorrectnessFilter] = useState<CorrectnessFilter>('all');
  const [violationsFilter, setViolationsFilter] = useState<ViolationsFilter>('all');
  const [ratingRangeFilters, setRatingRangeFilters] = useState<RatingRangeFilter[]>([]);

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
      if (error) { setPageError(error.message || 'Unable to load feedback sessions.'); setSessionsLoaded(true); return; }
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
        setSessionsLoaded(true);
        setPageError(null);
        if (sessionParam && mapped.some(s => s.session_id === sessionParam)) setSelectedSessionId(sessionParam);
        else if (selectedSessionId && mapped.some(s => s.session_id === selectedSessionId)) { /* keep */ }
        else if (mapped.length > 0) setSelectedSessionId(mapped[0].session_id);
      }
    }
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam]);

  // ─── Load data for selected session (+ its clones) ──────────
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [fbResult, statsResult, qResult] = await Promise.all([
        feedbackService.getBySession(selectedSessionId),
        feedbackService.getStats(selectedSessionId),
        feedbackService.getQuestions(selectedSessionId),
      ]);
      if (cancelled) return;
      setFeedbacks(fbResult.data || []);
      setStats(statsResult.data);
      setQuestions(qResult.data || []);
      const err = fbResult.error || (statsResult.error as { message?: string } | null)?.message || qResult.error || null;
      setPageError(err ? String(err) : null);
      if (err) toast.error(String(err), 7000);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  useEffect(() => { if (dateParam) { setDateFrom(dateParam); setDateTo(dateParam); } }, [dateParam]);

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
      if (dateFrom && fb.attendance_date < dateFrom) return false;
      if (dateTo && fb.attendance_date > dateTo) return false;
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
      if (ratingRangeFilters.length > 0) {
        if (fb.overall_rating == null) return false;
        const r = fb.overall_rating;
        const bucket: RatingRangeFilter = r <= 2 ? 'bad' : r === 3 ? 'neutral' : 'good';
        if (!ratingRangeFilters.includes(bucket)) return false;
      }
      return true;
    });
  }, [feedbacks, dateFrom, dateTo, feedbackSearch, studentFilter, ratingRangeFilters]);

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
            attendanceDate: fb.attendance_date, checkInTime: fb.check_in_time ?? null,
            overallRating: fb.overall_rating != null ? Number(fb.overall_rating) : null,
            questionType: 'rating',
            questionText: t.overallRating,
            answer: fb.overall_rating != null ? String(fb.overall_rating) : '—',
            comment: fb.comment,
            isCorrect: null,
            gradingDetail: null,
            gradingScore: null,
            correctAnswer: null,
            tabSwitchCount: fb.tab_switch_count ?? 0,
            isAutoSubmitted: fb.is_auto_submitted ?? false,
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
          // Compute graded result using centralised grading utility
          const gradeResult = q ? gradeAnswer(q, val) : { isCorrect: null, detail: null, score: null };
          const isCorrect = gradeResult.isCorrect;
          const correctAnswer = q?.correct_answer ?? null;
          const gradingDetail = gradeResult.detail;
          const gradingScore = gradeResult.score;
          // Format answer for display
          const displayAnswer = Array.isArray(val) ? val.join(', ') : (val != null ? String(val) : '—');
          rows.push({
            feedbackId: fb.id, studentName, isAnonymous: fb.is_anonymous,
            attendanceDate: fb.attendance_date, checkInTime: fb.check_in_time ?? null,
            overallRating: fb.overall_rating != null ? Number(fb.overall_rating) : null,
            questionType: qType,
            questionText: q?.question_text || '—',
            answer: displayAnswer,
            comment: fb.comment,
            isCorrect,
            correctAnswer,
            gradingDetail,
            gradingScore,
            tabSwitchCount: fb.tab_switch_count ?? 0,
            isAutoSubmitted: fb.is_auto_submitted ?? false,
          });
        }
      }
    }
    return rows;
  }, [filteredFeedbacks, questions, questionTypeFilter, t]);

  // ─── Correctness + violations filtered records ─────────────
  const displayRecords = useMemo(() => {
    let result = flattenedRecords;
    if (correctnessFilter !== 'all') {
      result = result.filter(r => {
        if (correctnessFilter === 'correct') return r.isCorrect === true;
        if (correctnessFilter === 'partial') return r.isCorrect === false && r.gradingScore !== null && r.gradingScore > 0;
        if (correctnessFilter === 'incorrect') return r.isCorrect === false && (r.gradingScore === null || r.gradingScore === 0);
        return r.isCorrect === null; // not-graded
      });
    }
    if (violationsFilter === 'has_violations') {
      result = result.filter(r => r.tabSwitchCount > 0);
    }
    return result;
  }, [flattenedRecords, correctnessFilter, violationsFilter]);

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

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 sm:space-y-6" dir={arabicMode ? 'rtl' : 'ltr'}>
      {!embedded && <Breadcrumb items={[{ label: 'Dashboard', path: '/' }, { label: t.feedbackAnalytics }]} />}

      {/* ─── Header ───────────────────────────────────────── */}
      {!embedded && (
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="space-y-1 min-w-0 flex items-center gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
              {t.feedbackAnalytics}
            </h1>
            <p className="text-xs sm:text-sm text-gray-400 dark:text-gray-500 max-w-xl">
              {t.subtitle}
            </p>
          </div>
          {arabicModeProp === undefined && (
            <button
              onClick={() => setLocalArabicMode(!localArabicMode)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                arabicMode
                  ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600'
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
              title={arabicMode ? 'Switch to English' : 'التبديل إلى العربية'}
            >
              <span className="text-base">{arabicMode ? '🇺🇸' : '🇸🇦'}</span>
              <span>{arabicMode ? 'EN' : 'عربي'}</span>
            </button>
          )}
        </div>
        {displayRecords.length > 0 && (
          <Button variant="outline" size="sm" className="rounded-full self-start sm:self-auto" onClick={() => exportFeedbackCSV(displayRecords, selectedSession?.course_name || 'feedback', dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || '')}>
            {t.exportCSV}
          </Button>
        )}
      </div>
      )}

      {/* ─── Session Selector ────────────────────────────────── */}
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <Select
            label=""
            value={selectedSessionId}
            onChange={setSelectedSessionId}
            options={sessions.map(s => ({
              value: s.session_id,
              label: `${s.course_name} · ${s.teacher_name}${s.feedback_enabled ? '' : ' · OFF'}`,
            }))}
            placeholder={t.selectSession}
          />
        </div>
        {embedded && displayRecords.length > 0 && (
          <Button variant="outline" size="sm" className="rounded-full shrink-0" onClick={() => exportFeedbackCSV(displayRecords, selectedSession?.course_name || 'feedback', dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : dateFrom || dateTo || '')}>
            {t.exportCSV}
          </Button>
        )}
      </div>

      {/* ─── Loading / Empty States ──────────────────────────── */}
      {sessions.length === 0 && !loading && sessionsLoaded && (
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-8 sm:p-12">
          <div className="max-w-md mx-auto text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/30 dark:to-violet-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t.noFeedbackSessions}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              {t.noFeedbackDesc}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-gray-400">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-500 text-[10px] font-bold">1</span>
                {t.openSession}
              </div>
              <span className="hidden sm:inline text-gray-300 dark:text-gray-600">→</span>
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-500 text-[10px] font-bold">2</span>
                {t.enableFeedback}
              </div>
              <span className="hidden sm:inline text-gray-300 dark:text-gray-600">→</span>
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-500 text-[10px] font-bold">3</span>
                {t.addQuestions}
              </div>
            </div>
          </div>
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
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-8 sm:p-12">
          <div className="max-w-md mx-auto text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t.awaitingResponses}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
              {t.awaitingDesc}
            </p>
            {selectedSession && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                {selectedSession.course_name}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && selectedSessionId && feedbacks.length > 0 && (
        <>
          {/* ─── KPI Summary Cards ─────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{t.responses}</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{filteredStats.totalResponses}</p>
              <p className="text-[10px] text-gray-400">{filteredStats.engagedStudents} {t.students}</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{t.avgRating}</p>
              <p className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400">
                {filteredStats.averageRating || '—'}<span className="text-xs sm:text-sm font-bold text-gray-400 ml-1">/ 5</span>
              </p>
              <p className="text-[10px] text-gray-400">{RATING_EMOJIS[Math.round(filteredStats.averageRating) - 1] || ''}</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1" title="Avg % of enrolled students who submitted feedback per date">{t.participation}</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">{filteredResponseRate}%</p>
              <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden mt-1">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${filteredResponseRate}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{filteredStats.engagedStudents} / {stats?.enrolledCount ?? '?'} {t.students}</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 sm:p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{t.dates}</p>
              <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{filteredStats.datesCovered}</p>
            </div>
          </div>

          {/* ─── Global Filters (shared by Records & Analytics) ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-end">
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">{t.dateRange}</label>
              <div className="flex gap-1">
                <select
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setRecordsPage(0); }}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
                >
                  <option value="">{t.from}</option>
                  {uniqueDates.slice().sort().map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setRecordsPage(0); }}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-gray-900 dark:text-white"
                >
                  <option value="">{t.to}</option>
                  {uniqueDates.slice().sort().map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">{t.student}</label>
              <select
                value={studentFilter}
                onChange={e => { setStudentFilter(e.target.value); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="">{t.allStudents}</option>
                {uniqueStudents.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">{t.questionType}</label>
              <select
                value={questionTypeFilter}
                onChange={e => { setQuestionTypeFilter(e.target.value as QuestionTypeFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">{t.allTypes}</option>
                <option value="rating">{t.rating}</option>
                <option value="text">{t.text}</option>
                <option value="multiple_choice">{t.multipleChoice}</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-[11px] text-gray-400 block mb-1">{t.search}</label>
              <input
                type="text"
                value={feedbackSearch}
                onChange={e => { setFeedbackSearch(e.target.value); setRecordsPage(0); }}
                placeholder={t.searchPlaceholder}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white placeholder:text-gray-400"
              />
            </div>
          </div>
          {/* Correctness filter row + advanced filters + clear button */}
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            {questions.some(q => q.correct_answer) && (
              <div className="min-w-[140px]">
                <label className="text-[11px] text-gray-400 block mb-1">{t.correctness}</label>
                <select
                  value={correctnessFilter}
                  onChange={e => { setCorrectnessFilter(e.target.value as CorrectnessFilter); setRecordsPage(0); }}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
                >
                  <option value="all">{t.allResults}</option>
                  <option value="correct">{t.correctOnly}</option>
                  <option value="partial">{t.partialOnly}</option>
                  <option value="incorrect">{t.incorrectOnly}</option>
                  <option value="not-graded">{t.notGraded}</option>
                </select>
              </div>
            )}
            <div className="min-w-[140px]">
              <label className="text-[11px] text-gray-400 block mb-1">{t.violations}</label>
              <select
                value={violationsFilter}
                onChange={e => { setViolationsFilter(e.target.value as ViolationsFilter); setRecordsPage(0); }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-white"
              >
                <option value="all">{t.allResults}</option>
                <option value="has_violations">⚠️ {t.hasViolations}</option>
              </select>
            </div>
            <div className="min-w-[130px]">
              <label className="text-[11px] text-gray-400 block mb-1">{t.ratingRange}</label>
              <div className="flex flex-col gap-1">
                {([
                  { value: 'bad' as const, label: t.bad },
                  { value: 'neutral' as const, label: t.neutral },
                  { value: 'good' as const, label: t.good },
                ] as { value: RatingRangeFilter; label: string }[]).map(opt => (
                  <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={ratingRangeFilters.includes(opt.value)}
                      onChange={() => setRatingRangeFilters(prev =>
                        prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                      )}
                      className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {(feedbackSearch || dateFrom || dateTo || studentFilter || questionTypeFilter !== 'all' || correctnessFilter !== 'all' || violationsFilter !== 'all' || ratingRangeFilters.length > 0) && (
              <button
                onClick={() => { setFeedbackSearch(''); setDateFrom(''); setDateTo(''); setStudentFilter(''); setQuestionTypeFilter('all'); setCorrectnessFilter('all'); setViolationsFilter('all'); setRatingRangeFilters([]); setRecordsPage(0); }}
                className="text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-700 mt-auto"
              >
                {t.clearFilters}
              </button>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* FEEDBACK RECORDS (one row per Q&A)                 */}
          {/* ═══════════════════════════════════════════════════ */}
            <div className="space-y-3 sm:space-y-4">
              {/* Records Table — one row per question-answer */}
              {displayRecords.length === 0 ? (
                <div className="text-center py-12">
                  <span className="text-4xl block mb-3">🔍</span>
                  <p className="text-sm text-gray-500">{t.noRecordsMatch}</p>
                </div>
              ) : (
                <div className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800/60">
                        <tr>
                          {([
                            { key: 'studentName' as SortField, label: t.student },
                            { key: 'attendanceDate' as SortField, label: t.date },
                            { key: 'checkInTime' as SortField, label: 'Check-In' },
                            { key: 'questionType' as SortField, label: t.type },
                            { key: 'questionText' as SortField, label: t.question },
                            { key: 'answer' as SortField, label: t.answer },
                            { key: null, label: 'Correct Answer' },
                            { key: null, label: t.correct },
                            { key: 'comment' as SortField, label: t.comment },
                            { key: 'tabSwitchCount' as SortField, label: t.violations },
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
                                <span className="text-gray-400 italic">{t.anon}</span>
                              ) : (
                                <span className="font-medium text-gray-900 dark:text-white">{row.studentName}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row.attendanceDate}</td>
                            <td className="px-3 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap text-[10px]">
                              {row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
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
                                : row.isCorrect === false && row.gradingScore !== null && row.gradingScore > 0
                                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                : row.isCorrect === false ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                : 'text-gray-900 dark:text-white'
                              }`} title={row.answer}>{row.answer}</span>
                            </td>
                            <td className="px-3 py-3 max-w-[140px]">
                              {row.correctAnswer ? (
                                <span className="text-green-700 dark:text-green-400 font-medium truncate block text-[10px]" title={row.correctAnswer}>{row.correctAnswer}</span>
                              ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {row.isCorrect === null ? (
                                <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                              ) : row.isCorrect ? (
                                <span title={`Correct answer: ${row.correctAnswer}`}>✅</span>
                              ) : row.gradingScore !== null && row.gradingScore > 0 ? (
                                <span title={`Correct answer: ${row.correctAnswer} — ${row.gradingDetail}`} className="inline-flex flex-col items-center leading-tight">
                                  <span>🟡</span>
                                  <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">{row.gradingDetail}</span>
                                </span>
                              ) : (
                                <span title={`Correct answer: ${row.correctAnswer}`}>❌</span>
                              )}
                            </td>
                            <td className="px-3 py-3 max-w-[140px]">
                              {row.comment ? (
                                <p className="text-gray-600 dark:text-gray-400 truncate" title={row.comment}>{row.comment}</p>
                              ) : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              {row.tabSwitchCount > 0 ? (
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${row.isAutoSubmitted ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>
                                  ⚠️ {row.tabSwitchCount}{row.isAutoSubmitted ? ' 🚨' : ''}
                                </span>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                              )}
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
                        {recordsPage * RECORDS_PER_PAGE + 1}–{Math.min((recordsPage + 1) * RECORDS_PER_PAGE, displayRecords.length)} {t.of} {displayRecords.length}
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

        </>
      )}
    </div>
  );
}
