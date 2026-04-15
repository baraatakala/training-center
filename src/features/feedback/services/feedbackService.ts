import { supabase } from '@/shared/lib/supabase';
import { logDelete, logInsert, logUpdate } from '@/shared/services/auditService';
import type { FeedbackQuestion, SessionFeedback, FeedbackTemplate, FeedbackStats, FeedbackDateSummary, FeedbackComparison } from '@/shared/types/database.types';

// Re-export types for consumers
export type { FeedbackQuestion, SessionFeedback, FeedbackTemplate, FeedbackStats, FeedbackDateSummary, FeedbackComparison };

export interface FeedbackTemplateInput {
  name: string;
  description?: string | null;
  questions: Array<{ type: string; text: string; required: boolean; options?: string[]; correct_answer?: string | null }>;
  is_default?: boolean;
}

function normalizeFeedbackError(error: { message?: string; details?: string; hint?: string } | null) {
  if (!error) return null;

  const raw = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();

  if (raw.includes('row-level security')) {
    return {
      ...error,
      message: 'Feedback could not be saved because the database rejected the request. Check the session_feedback policies and authentication state.',
    };
  }

  if (raw.includes('permission denied') || raw.includes('forbidden')) {
    return {
      ...error,
      message: 'You do not have permission to perform this feedback action with the current account.',
    };
  }

  if (raw.includes('not authenticated') || raw.includes('jwt') || raw.includes('auth')) {
    return {
      ...error,
      message: 'Your session is missing or expired. Sign in again and retry the feedback action.',
    };
  }

  if (raw.includes('duplicate') || raw.includes('unique')) {
    return {
      ...error,
      message: 'Feedback was already submitted for this session date.',
    };
  }

  return error;
}

function toAuditRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

// ─── Feedback Submission ─────────────────────────────────────
export const feedbackService = {
  /** Submit feedback after check-in */
  async submit(feedback: {
    session_id: string;
    attendance_date: string;
    student_id: string | null;
    is_anonymous: boolean;
    overall_rating: number | null;
    comment?: string;
    responses?: Record<string, unknown>;
    check_in_method?: string;
    tab_switch_count?: number;
    is_auto_submitted?: boolean;
  }) {
    if (!feedback.student_id) {
      return {
        data: null,
        error: {
          message: 'Feedback could not be linked to the checked-in student. Reload the page and try again.',
        },
      };
    }

    const row = {
      session_id: feedback.session_id,
      attendance_date: feedback.attendance_date,
      student_id: feedback.student_id,
      is_anonymous: feedback.is_anonymous,
      overall_rating: feedback.overall_rating,
      comment: feedback.comment || null,
      responses: feedback.responses || {},
      check_in_method: feedback.check_in_method || null,
      tab_switch_count: feedback.tab_switch_count ?? 0,
      is_auto_submitted: feedback.is_auto_submitted ?? false,
    };

    const { data, error } = await supabase
      .from('session_feedback')
      .insert(row)
      .select('id')
      .single();

    if (data) {
      try {
        await logInsert(
          'session_feedback',
          String(data.id || ''),
          toAuditRecord(row),
          `Feedback submitted via ${feedback.check_in_method || 'unknown'} check-in`
        );
      } catch {
        /* audit non-critical */
      }
    }

    return { data, error: normalizeFeedbackError(error) };
  },

  /** Check if student already submitted feedback for this session+date */
  async hasSubmitted(sessionId: string, studentId: string, date: string) {
    const { count, error } = await supabase
      .from('session_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .eq('attendance_date', date);

    return { alreadySubmitted: (count || 0) > 0, error: normalizeFeedbackError(error) };
  },

  /** Check if session has feedback enabled */
  async isEnabled(sessionId: string) {
    const { data, error } = await supabase
      .from('session')
      .select('feedback_enabled, feedback_anonymous_allowed, max_tab_switches')
      .eq('session_id', sessionId)
      .single();

    return {
      enabled: data?.feedback_enabled ?? false,
      anonymousAllowed: data?.feedback_anonymous_allowed ?? true,
      maxTabSwitches: data?.max_tab_switches ?? 3,
      error: normalizeFeedbackError(error),
    };
  },

  // ─── Questions ───────────────────────────────────────────
  /**
   * Get questions for a session.
   * - No date param: returns ALL questions (global + date-specific)
   * - With date param: returns global questions (attendance_date IS NULL) + questions for that specific date
   */
  async getQuestions(sessionId: string, date?: string) {
    // Load ALL questions for the session, then filter in JS.
    // The .or() PostgREST filter can misparse dates — this is safer.
    const { data, error } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('session_id', sessionId)
      .order('sort_order', { ascending: true });

    if (error || !data) {
      return { data: data as FeedbackQuestion[] | null, error: normalizeFeedbackError(error) };
    }

    if (date) {
      // Return global (no date) + questions matching this specific date
      const filtered = data.filter(
        (q) => q.attendance_date === null || q.attendance_date === date
      );
      return { data: filtered as FeedbackQuestion[], error: null };
    }

    return { data: data as FeedbackQuestion[], error: null };
  },

  /** Get only global questions (attendance_date IS NULL) */
  async getGlobalQuestions(sessionId: string) {
    const { data, error } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('session_id', sessionId)
      .is('attendance_date', null)
      .order('sort_order', { ascending: true });

    return { data: data as FeedbackQuestion[] | null, error: normalizeFeedbackError(error) };
  },

  /** Get only date-specific questions for a specific date */
  async getDateQuestions(sessionId: string, date: string) {
    const { data, error } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('session_id', sessionId)
      .eq('attendance_date', date)
      .order('sort_order', { ascending: true });

    return { data: data as FeedbackQuestion[] | null, error: normalizeFeedbackError(error) };
  },

  /** Create a question for a session (optionally scoped to a specific date) */
  async createQuestion(question: Omit<FeedbackQuestion, 'id' | 'created_at'>) {
    const payload = {
      ...question,
      attendance_date: question.attendance_date || null, // ensure null not undefined
    };
    const { data, error } = await supabase
      .from('feedback_question')
      .insert(payload)
      .select()
      .single();

    if (data) {
      const scope = question.attendance_date ? `date-specific (${question.attendance_date})` : 'global';
      try { await logInsert('feedback_question', String(data.id), toAuditRecord(data), `Feedback question created — ${scope}`); } catch { /* audit non-critical */ }
    }

    return { data, error: normalizeFeedbackError(error) };
  },

  async updateQuestion(questionId: string, updates: Partial<Omit<FeedbackQuestion, 'id' | 'created_at' | 'session_id'>>) {
    const { data: oldData } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('id', questionId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('feedback_question')
      .update(updates)
      .eq('id', questionId)
      .select()
      .single();

    if (data) {
      try { await logUpdate('feedback_question', questionId, toAuditRecord(oldData), toAuditRecord(data), 'Feedback question updated'); } catch { /* audit non-critical */ }
    }

    return { data, error: normalizeFeedbackError(error) };
  },

  /** Delete a question */
  async deleteQuestion(questionId: string) {
    const { data: oldData } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('id', questionId)
      .maybeSingle();

    const { error } = await supabase
      .from('feedback_question')
      .delete()
      .eq('id', questionId);

    if (!error && oldData) {
      try { await logDelete('feedback_question', questionId, toAuditRecord(oldData), 'Feedback question deleted'); } catch { /* audit non-critical */ }
    }

    return { error: normalizeFeedbackError(error) };
  },

  // ─── Templates ───────────────────────────────────────────
  /** Get all feedback templates */
  async getTemplates() {
    const { data, error } = await supabase
      .from('feedback_template')
      .select('*')
      .order('is_default', { ascending: false });

    return { data: data as FeedbackTemplate[] | null, error: normalizeFeedbackError(error) };
  },

  /** Create a new feedback template (save current questions as a reusable set) */
  async createTemplate(input: FeedbackTemplateInput) {
    const { data, error } = await supabase
      .from('feedback_template')
      .insert({
        name: input.name,
        description: input.description || null,
        questions: input.questions,
        is_default: input.is_default ?? false,
      })
      .select()
      .single();

    if (data) {
      try { await logInsert('feedback_template', data.id, toAuditRecord(data), 'Feedback template created'); } catch { /* audit non-critical */ }
    }

    return { data: data as FeedbackTemplate | null, error: normalizeFeedbackError(error) };
  },

  /** Delete a feedback template */
  async deleteTemplate(templateId: string) {
    const { data: oldData } = await supabase
      .from('feedback_template')
      .select('*')
      .eq('id', templateId)
      .maybeSingle();

    const { error } = await supabase
      .from('feedback_template')
      .delete()
      .eq('id', templateId);

    if (!error && oldData) {
      try { await logDelete('feedback_template', templateId, toAuditRecord(oldData), 'Feedback template deleted'); } catch { /* audit non-critical */ }
    }

    return { error: normalizeFeedbackError(error) };
  },

  async updateTemplate(templateId: string, updates: Partial<FeedbackTemplateInput>) {
    const { data: oldData } = await supabase
      .from('feedback_template')
      .select('*')
      .eq('id', templateId)
      .maybeSingle();

    const payload: Record<string, unknown> = {};

    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description || null;
    if (updates.questions !== undefined) payload.questions = updates.questions;
    if (updates.is_default !== undefined) payload.is_default = updates.is_default;

    const { data, error } = await supabase
      .from('feedback_template')
      .update(payload)
      .eq('id', templateId)
      .select()
      .single();

    if (data) {
      try { await logUpdate('feedback_template', templateId, toAuditRecord(oldData), toAuditRecord(data), 'Feedback template updated'); } catch { /* audit non-critical */ }
    }

    return { data: data as FeedbackTemplate | null, error: normalizeFeedbackError(error) };
  },

  /**
   * Apply a template to a session.
   * - No date: replaces ALL global questions (attendance_date IS NULL)
   * - With date: replaces only questions for that specific date
   */
  async applyTemplateToSession(templateId: string, sessionId: string, attendanceDate?: string | null) {
    let deleteQuery = supabase
      .from('feedback_question')
      .delete()
      .eq('session_id', sessionId);

    if (attendanceDate) {
      deleteQuery = deleteQuery.eq('attendance_date', attendanceDate);
    } else {
      deleteQuery = deleteQuery.is('attendance_date', null);
    }

    const { data: existingQuestions } = await supabase
      .from('feedback_question')
      .select('id')
      .eq('session_id', sessionId);

    const { data: template, error: templateError } = await supabase
      .from('feedback_template')
      .select('questions')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return { error: normalizeFeedbackError(templateError) };
    }

    const questions = Array.isArray(template.questions) ? template.questions : [];
    if (questions.length === 0) {
      return { error: { message: 'This template has no questions. Add questions to the template before applying.' } };
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      return { error: normalizeFeedbackError(deleteError) };
    }

    const { error } = await supabase
      .from('feedback_question')
      .insert(
        questions.map((question, index) => ({
          session_id: sessionId,
          question_text: question.text,
          question_type: question.type,
          options: question.options || [],
          correct_answer: question.correct_answer ?? null,
          sort_order: index,
          is_required: Boolean(question.required),
          attendance_date: attendanceDate || null,
        }))
      );

    if (!error) {
      const scope = attendanceDate ? `for date ${attendanceDate}` : 'global';
      try {
        await logUpdate(
          'feedback_question',
          sessionId,
          { session_id: sessionId, question_count: existingQuestions?.length || 0 },
          { session_id: sessionId, question_count: questions.length, template_id: templateId, scope },
          `Applied feedback template to session — ${scope}`
        );
      } catch {
        /* audit non-critical */
      }
    }

    return { error: normalizeFeedbackError(error) };
  },

  // ─── Analytics ───────────────────────────────────────────
  /** Get all feedback for a session */
  async getBySession(sessionId: string) {
    const { data, error } = await supabase
      .from('session_feedback')
      .select('*, student:student_id(name)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    const mapped = data?.map((row: Record<string, unknown>) => {
      const student = row.student as { name: string } | null;
      return { ...row, student_name: student?.name ?? null, student: undefined } as unknown as SessionFeedback;
    }) ?? null;

    return { data: mapped, error: normalizeFeedbackError(error) };
  },

  /** Get feedback for a specific session+date */
  async getByDate(sessionId: string, date: string) {
    const { data, error } = await supabase
      .from('session_feedback')
      .select('*, student:student_id(name)')
      .eq('session_id', sessionId)
      .eq('attendance_date', date)
      .order('created_at', { ascending: false });

    const mapped = data?.map((row: Record<string, unknown>) => {
      const student = row.student as { name: string } | null;
      return { ...row, student_name: student?.name ?? null, student: undefined } as unknown as SessionFeedback;
    }) ?? null;

    return { data: mapped, error: normalizeFeedbackError(error) };
  },

  /** Get aggregate stats for a session */
  async getStats(sessionId: string): Promise<{ data: FeedbackStats | null; error: unknown }> {
    const { data: feedbacks, error } = await supabase
      .from('session_feedback')
      .select('student_id, overall_rating, comment, attendance_date, is_anonymous, created_at')
      .eq('session_id', sessionId);

    if (error || !feedbacks) return { data: null, error: normalizeFeedbackError(error) };

    const totalResponses = feedbacks.length;
    if (totalResponses === 0) {
      // Still fetch enrolled count even when no responses
      const { count: enrolledCount } = await supabase
        .from('enrollment')
        .select('enrollment_id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'active');

      return {
        data: {
          totalResponses: 0,
          engagedStudents: 0,
          enrolledCount: enrolledCount || 0,
          averageRating: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          responseRate: 0,
          datesCovered: 0,
          latestResponseDate: null,
          recentComments: [],
        },
        error: null,
      };
    }

    const ratings = feedbacks.filter((f) => f.overall_rating != null).map((f) => f.overall_rating!);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) {
      ratingDistribution[r] = (ratingDistribution[r] || 0) + 1;
    }

    const engagedStudents = new Set(
      feedbacks
        .map((feedback) => feedback.student_id)
        .filter((studentId): studentId is string => Boolean(studentId))
    ).size;

    const datesCovered = new Set(feedbacks.map((feedback) => feedback.attendance_date)).size;
    const latestResponseDate = feedbacks
      .map((feedback) => feedback.attendance_date)
      .sort((left, right) => right.localeCompare(left))[0] || null;

    const recentComments = feedbacks
      .filter((f) => f.comment)
      .slice(0, 20)
      .map((f) => ({
        comment: f.comment!,
        rating: f.overall_rating ?? 0,
        date: f.attendance_date,
        is_anonymous: f.is_anonymous,
      }));

    // Get total enrolled students for response rate
    const { count: enrolledCount } = await supabase
      .from('enrollment')
      .select('enrollment_id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'active');

    const responseRate = enrolledCount ? Math.min(100, Math.round((engagedStudents / enrolledCount) * 100)) : 0;

    return {
      data: {
        totalResponses,
        engagedStudents,
        enrolledCount: enrolledCount || 0,
        averageRating: Math.round(avgRating * 10) / 10,
        ratingDistribution,
        responseRate,
        datesCovered,
        latestResponseDate,
        recentComments,
      },
      error: null,
    };
  },

  /** Get daily feedback trend for charts */
  async getDailyTrend(sessionId: string) {
    const { data, error } = await supabase
      .from('session_feedback')
      .select('attendance_date, overall_rating')
      .eq('session_id', sessionId)
      .order('attendance_date', { ascending: true });

    if (error || !data) return { data: null, error };

    const byDate = new Map<string, { total: number; count: number }>();
    for (const fb of data) {
      const entry = byDate.get(fb.attendance_date) || { total: 0, count: 0 };
      if (fb.overall_rating != null) {
        entry.total += fb.overall_rating;
        entry.count++;
      }
      byDate.set(fb.attendance_date, entry);
    }

    const trend = Array.from(byDate.entries()).map(([date, { total, count }]) => ({
      date,
      averageRating: count > 0 ? Math.round((total / count) * 10) / 10 : 0,
      responses: count,
    }));

    return { data: trend, error: null };
  },

  /** Toggle feedback for a session */
  async toggleFeedback(sessionId: string, enabled: boolean) {
    const { data: oldData } = await supabase
      .from('session')
      .select('session_id, feedback_enabled, feedback_anonymous_allowed')
      .eq('session_id', sessionId)
      .maybeSingle();

    const { error } = await supabase
      .from('session')
      .update({ feedback_enabled: enabled })
      .eq('session_id', sessionId);

    if (!error) {
      try {
        await logUpdate(
          'session',
          sessionId,
          toAuditRecord(oldData),
          { ...toAuditRecord(oldData), feedback_enabled: enabled },
          enabled ? 'Feedback enabled for session' : 'Feedback disabled for session'
        );
      } catch {
        /* audit non-critical */
      }
    }

    return { error: normalizeFeedbackError(error) };
  },

  /** Update anonymous allowed setting */
  async setAnonymousAllowed(sessionId: string, allowed: boolean) {
    const { data: oldData } = await supabase
      .from('session')
      .select('session_id, feedback_enabled, feedback_anonymous_allowed')
      .eq('session_id', sessionId)
      .maybeSingle();

    const { error } = await supabase
      .from('session')
      .update({ feedback_anonymous_allowed: allowed })
      .eq('session_id', sessionId);

    if (!error) {
      try {
        await logUpdate(
          'session',
          sessionId,
          toAuditRecord(oldData),
          { ...toAuditRecord(oldData), feedback_anonymous_allowed: allowed },
          allowed ? 'Anonymous feedback enabled for session' : 'Identity retention enabled for session feedback'
        );
      } catch {
        /* audit non-critical */
      }
    }

    return { error: normalizeFeedbackError(error) };
  },

  // ─── Per-Date Analytics ──────────────────────────────────
  /** Get list of dates that have feedback for a session */
  async getDateList(sessionId: string): Promise<{ data: string[]; error: unknown }> {
    const { data, error } = await supabase
      .from('session_feedback')
      .select('attendance_date')
      .eq('session_id', sessionId)
      .order('attendance_date', { ascending: false });

    if (error || !data) return { data: [], error: normalizeFeedbackError(error) };

    const unique = [...new Set(data.map(r => r.attendance_date))];
    return { data: unique, error: null };
  },

  /** Get per-date breakdown with full stats for each date */
  async getDateComparison(sessionId: string): Promise<{ data: FeedbackComparison | null; error: unknown }> {
    const { data: feedbacks, error } = await supabase
      .from('session_feedback')
      .select('student_id, overall_rating, comment, attendance_date, is_anonymous, created_at')
      .eq('session_id', sessionId);

    if (error || !feedbacks) return { data: null, error: normalizeFeedbackError(error) };

    // Get enrolled count for response rate
    const { count: enrolledCount } = await supabase
      .from('enrollment')
      .select('enrollment_id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'active');

    const byDate = new Map<string, typeof feedbacks>();
    for (const fb of feedbacks) {
      const arr = byDate.get(fb.attendance_date) || [];
      arr.push(fb);
      byDate.set(fb.attendance_date, arr);
    }

    const dateSummaries: FeedbackDateSummary[] = [];
    for (const [date, fbs] of byDate.entries()) {
      const ratings = fbs.filter(f => f.overall_rating != null).map(f => f.overall_rating!);
      const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of ratings) dist[r] = (dist[r] || 0) + 1;
      const uniqueStudents = new Set(fbs.map(f => f.student_id).filter(Boolean)).size;
      const responseRate = enrolledCount ? Math.min(100, Math.round((uniqueStudents / enrolledCount) * 100)) : 0;

      dateSummaries.push({
        date,
        responses: fbs.length,
        uniqueStudents,
        averageRating: Math.round(avg * 10) / 10,
        ratingDistribution: dist,
        commentCount: fbs.filter(f => f.comment).length,
        responseRate,
      });
    }

    dateSummaries.sort((a, b) => a.date.localeCompare(b.date));

    // Determine trend
    let trendDirection: FeedbackComparison['trendDirection'] = 'insufficient';
    if (dateSummaries.length >= 3) {
      const half = Math.floor(dateSummaries.length / 2);
      const firstHalfAvg = dateSummaries.slice(0, half).reduce((s, d) => s + d.averageRating, 0) / half;
      const secondHalfAvg = dateSummaries.slice(half).reduce((s, d) => s + d.averageRating, 0) / (dateSummaries.length - half);
      const diff = secondHalfAvg - firstHalfAvg;
      trendDirection = diff > 0.2 ? 'improving' : diff < -0.2 ? 'declining' : 'stable';
    } else if (dateSummaries.length === 2) {
      const diff = dateSummaries[1].averageRating - dateSummaries[0].averageRating;
      trendDirection = diff > 0.2 ? 'improving' : diff < -0.2 ? 'declining' : 'stable';
    }

    const bestDate = dateSummaries.length > 0
      ? dateSummaries.reduce((best, d) => d.averageRating > best.averageRating ? d : best).date
      : null;
    const worstDate = dateSummaries.length > 0
      ? dateSummaries.reduce((worst, d) => d.averageRating < worst.averageRating ? d : worst).date
      : null;

    const allRatings = feedbacks.filter(f => f.overall_rating != null).map(f => f.overall_rating!);
    const overallAvg = allRatings.length > 0
      ? Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 10) / 10
      : 0;

    return {
      data: { dates: dateSummaries, bestDate, worstDate, trendDirection, overallAvg },
      error: null,
    };
  },

  /** Load all sessions with course/teacher info for analytics dropdown */
  async getSessionsForAnalytics() {
    return await supabase
      .from('session')
      .select('session_id, start_date, end_date, feedback_enabled, feedback_anonymous_allowed, course:course_id(course_name), teacher:teacher_id(name)')
      .order('start_date', { ascending: false });
  },

  /** Get per-date stats for a single date */
  async getStatsByDate(sessionId: string, date: string): Promise<{ data: FeedbackStats | null; error: unknown }> {
    const { data: feedbacks, error } = await supabase
      .from('session_feedback')
      .select('student_id, overall_rating, comment, attendance_date, is_anonymous, created_at')
      .eq('session_id', sessionId)
      .eq('attendance_date', date);

    if (error || !feedbacks) return { data: null, error: normalizeFeedbackError(error) };

    const totalResponses = feedbacks.length;
    if (totalResponses === 0) {
      const { count: enrolledCount } = await supabase
        .from('enrollment')
        .select('enrollment_id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'active');

      return {
        data: {
          totalResponses: 0, engagedStudents: 0, enrolledCount: enrolledCount || 0, averageRating: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          responseRate: 0, datesCovered: 1, latestResponseDate: date, recentComments: [],
        },
        error: null,
      };
    }

    const ratings = feedbacks.filter(f => f.overall_rating != null).map(f => f.overall_rating!);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) ratingDistribution[r] = (ratingDistribution[r] || 0) + 1;

    const engagedStudents = new Set(feedbacks.map(f => f.student_id).filter(Boolean)).size;

    const { count: enrolledCount } = await supabase
      .from('enrollment')
      .select('enrollment_id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'active');

    const responseRate = enrolledCount ? Math.min(100, Math.round((engagedStudents / enrolledCount) * 100)) : 0;

    const recentComments = feedbacks
      .filter(f => f.comment)
      .slice(0, 20)
      .map(f => ({ comment: f.comment!, rating: f.overall_rating ?? 0, date: f.attendance_date, is_anonymous: f.is_anonymous }));

    return {
      data: {
        totalResponses, engagedStudents, enrolledCount: enrolledCount || 0,
        averageRating: Math.round(avgRating * 10) / 10,
        ratingDistribution, responseRate, datesCovered: 1,
        latestResponseDate: date, recentComments,
      },
      error: null,
    };
  },
};
