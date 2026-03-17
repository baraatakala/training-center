import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────
export interface FeedbackQuestion {
  id: string;
  session_id: string;
  question_text: string;
  question_type: 'rating' | 'text' | 'emoji' | 'multiple_choice';
  options: string[];
  sort_order: number;
  is_required: boolean;
  created_at: string;
}

export interface SessionFeedback {
  id: string;
  session_id: string;
  attendance_date: string;
  student_id: string | null;
  is_anonymous: boolean;
  overall_rating: number | null;
  comment: string | null;
  responses: Record<string, unknown>;
  check_in_method: string | null;
  created_at: string;
  student_name?: string | null;
}

export interface FeedbackTemplate {
  id: string;
  name: string;
  description: string | null;
  questions: Array<{ type: string; text: string; required: boolean; options?: string[] }>;
  is_default: boolean;
  created_at: string;
}

export interface FeedbackTemplateInput {
  name: string;
  description?: string | null;
  questions: Array<{ type: string; text: string; required: boolean; options?: string[] }>;
  is_default?: boolean;
}

export interface FeedbackStats {
  totalResponses: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  responseRate: number;
  recentComments: Array<{ comment: string; rating: number; date: string; is_anonymous: boolean }>;
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

  if (raw.includes('duplicate') || raw.includes('unique')) {
    return {
      ...error,
      message: 'Feedback was already submitted for this session date.',
    };
  }

  return error;
}

// ─── Feedback Submission ─────────────────────────────────────
export const feedbackService = {
  /** Submit feedback after check-in */
  async submit(feedback: {
    session_id: string;
    attendance_date: string;
    student_id: string | null;
    is_anonymous: boolean;
    overall_rating: number;
    comment?: string;
    responses?: Record<string, unknown>;
    check_in_method?: string;
  }) {
    const payload = {
      session_id: feedback.session_id,
      attendance_date: feedback.attendance_date,
      student_id: feedback.is_anonymous ? null : feedback.student_id,
      is_anonymous: feedback.is_anonymous,
      overall_rating: feedback.overall_rating,
      comment: feedback.comment || null,
      responses: feedback.responses || {},
      check_in_method: feedback.check_in_method || null,
    };

    const { data, error } = await supabase
      .from('session_feedback')
      .insert(payload)
      .select()
      .single();

    return { data, error: normalizeFeedbackError(error) };
  },

  /** Check if student already submitted feedback for this session+date */
  async hasSubmitted(sessionId: string, studentId: string, date: string) {
    const { data, error } = await supabase
      .from('session_feedback')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .eq('attendance_date', date)
      .maybeSingle();

    return { alreadySubmitted: !!data, error };
  },

  /** Check if session has feedback enabled */
  async isEnabled(sessionId: string) {
    const { data, error } = await supabase
      .from('session')
      .select('feedback_enabled, feedback_anonymous_allowed')
      .eq('session_id', sessionId)
      .single();

    return {
      enabled: data?.feedback_enabled ?? false,
      anonymousAllowed: data?.feedback_anonymous_allowed ?? true,
      error,
    };
  },

  // ─── Questions ───────────────────────────────────────────
  /** Get custom questions for a session */
  async getQuestions(sessionId: string) {
    const { data, error } = await supabase
      .from('feedback_question')
      .select('*')
      .eq('session_id', sessionId)
      .order('sort_order', { ascending: true });

    return { data: data as FeedbackQuestion[] | null, error };
  },

  /** Create a question for a session */
  async createQuestion(question: Omit<FeedbackQuestion, 'id' | 'created_at'>) {
    const { data, error } = await supabase
      .from('feedback_question')
      .insert(question)
      .select()
      .single();

    return { data, error: normalizeFeedbackError(error) };
  },

  async updateQuestion(questionId: string, updates: Partial<Omit<FeedbackQuestion, 'id' | 'created_at' | 'session_id'>>) {
    const { data, error } = await supabase
      .from('feedback_question')
      .update(updates)
      .eq('id', questionId)
      .select()
      .single();

    return { data, error: normalizeFeedbackError(error) };
  },

  /** Delete a question */
  async deleteQuestion(questionId: string) {
    const { error } = await supabase
      .from('feedback_question')
      .delete()
      .eq('id', questionId);

    return { error: normalizeFeedbackError(error) };
  },

  // ─── Templates ───────────────────────────────────────────
  /** Get all feedback templates */
  async getTemplates() {
    const { data, error } = await supabase
      .from('feedback_template')
      .select('*')
      .order('is_default', { ascending: false });

    return { data: data as FeedbackTemplate[] | null, error };
  },

  async createTemplate(template: FeedbackTemplateInput) {
    const { data, error } = await supabase
      .from('feedback_template')
      .insert({
        name: template.name,
        description: template.description || null,
        questions: template.questions,
        is_default: template.is_default ?? false,
      })
      .select()
      .single();

    return { data: data as FeedbackTemplate | null, error: normalizeFeedbackError(error) };
  },

  async updateTemplate(templateId: string, updates: Partial<FeedbackTemplateInput>) {
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

    return { data: data as FeedbackTemplate | null, error: normalizeFeedbackError(error) };
  },

  async deleteTemplate(templateId: string) {
    const { error } = await supabase
      .from('feedback_template')
      .delete()
      .eq('id', templateId);

    return { error: normalizeFeedbackError(error) };
  },

  async applyTemplateToSession(templateId: string, sessionId: string) {
    const { data: template, error: templateError } = await supabase
      .from('feedback_template')
      .select('questions')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return { error: normalizeFeedbackError(templateError) };
    }

    const { error: deleteError } = await supabase
      .from('feedback_question')
      .delete()
      .eq('session_id', sessionId);

    if (deleteError) {
      return { error: normalizeFeedbackError(deleteError) };
    }

    const questions = Array.isArray(template.questions) ? template.questions : [];
    if (questions.length === 0) {
      return { error: null };
    }

    const { error } = await supabase
      .from('feedback_question')
      .insert(
        questions.map((question, index) => ({
          session_id: sessionId,
          question_text: question.text,
          question_type: question.type,
          options: question.options || [],
          sort_order: index,
          is_required: Boolean(question.required),
        }))
      );

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

    return { data: mapped, error };
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

    return { data: mapped, error };
  },

  /** Get aggregate stats for a session */
  async getStats(sessionId: string): Promise<{ data: FeedbackStats | null; error: unknown }> {
    const { data: feedbacks, error } = await supabase
      .from('session_feedback')
      .select('overall_rating, comment, attendance_date, is_anonymous, created_at')
      .eq('session_id', sessionId);

    if (error || !feedbacks) return { data: null, error };

    const totalResponses = feedbacks.length;
    if (totalResponses === 0) {
      return {
        data: {
          totalResponses: 0,
          averageRating: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          responseRate: 0,
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

    const responseRate = enrolledCount ? Math.round((totalResponses / enrolledCount) * 100) : 0;

    return {
      data: {
        totalResponses,
        averageRating: Math.round(avgRating * 10) / 10,
        ratingDistribution,
        responseRate,
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
    const { error } = await supabase
      .from('session')
      .update({ feedback_enabled: enabled })
      .eq('session_id', sessionId);

    return { error: normalizeFeedbackError(error) };
  },

  /** Update anonymous allowed setting */
  async setAnonymousAllowed(sessionId: string, allowed: boolean) {
    const { error } = await supabase
      .from('session')
      .update({ feedback_anonymous_allowed: allowed })
      .eq('session_id', sessionId);

    return { error: normalizeFeedbackError(error) };
  },
};
