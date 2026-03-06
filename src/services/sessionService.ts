import { supabase } from '../lib/supabase';
import type { CreateSession, UpdateSession } from '../types/database.types';
import { Tables } from '../types/database.types';
import { logDelete, logUpdate, logInsert } from './auditService';

export const sessionService = {
  // Get all sessions
  async getAll() {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .order('start_date', { ascending: false });
  },

  // Get session by ID
  async getById(id: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(*),
        teacher:teacher_id(*)
      `)
      .eq('session_id', id)
      .single();
  },

  // Get sessions for a specific course
  async getByCourse(courseId: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name),
        teacher:teacher_id(name)
      `)
      .eq('course_id', courseId)
      .order('start_date', { ascending: false });
  },

  // Get sessions for a specific teacher
  async getByTeacher(teacherId: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .eq('teacher_id', teacherId)
      .order('start_date', { ascending: false });
  },

  // Get active sessions (end_date >= today)
  async getActive() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .gte('end_date', today)
      .order('start_date', { ascending: false });
  },

  // Get upcoming sessions (start_date > today)
  async getUpcoming() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .gt('start_date', today)
      .order('start_date', { ascending: true });
  },

  // Get completed sessions (end_date < today)
  async getCompleted() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .lt('end_date', today)
      .order('start_date', { ascending: false });
  },

  // Create new session
  async create(session: CreateSession) {
    const result = await supabase
      .from(Tables.SESSION)
      .insert(session)
      .select()
      .single();

    if (result.data) {
      try { await logInsert('session', result.data.session_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Update session
  async update(id: string, updates: UpdateSession) {
    const { data: oldData } = await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('session_id', id)
      .single();

    const result = await supabase
      .from(Tables.SESSION)
      .update(updates)
      .eq('session_id', id)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logUpdate('session', id, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }

      // Track day changes automatically
      if (updates.day !== undefined && oldData.day !== updates.day) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('session_day_change').insert({
            session_id: id,
            old_day: oldData.day,
            new_day: updates.day,
            effective_date: new Date().toISOString().split('T')[0],
            changed_by: user?.email || null,
          });
        } catch { /* day change log non-critical */ }
      }
    }
    return result;
  },

  // Delete session
  async delete(id: string) {
    // Fetch session data before deletion for audit log
    const { data: session } = await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('session_id', id)
      .single();

    // Log the deletion
    if (session) {
      try { await logDelete('session', id, session as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return await supabase
      .from(Tables.SESSION)
      .delete()
      .eq('session_id', id);
  },

  // Check for scheduling conflicts
  async checkConflict(teacherId: string, startDate: string, endDate: string, excludeSessionId?: string) {
    let query = supabase
      .from(Tables.SESSION)
      .select('session_id, start_date, end_date')
      .eq('teacher_id', teacherId)
      .lte('start_date', endDate)
      .gte('end_date', startDate);

    if (excludeSessionId) {
      query = query.neq('session_id', excludeSessionId);
    }

    return await query;
  },

  // Clone a session (same course/teacher, new dates/day/time) and optionally copy enrollments
  async cloneSession(
    sourceSessionId: string,
    overrides: { start_date: string; end_date: string; day: string; time?: string; location?: string },
    copyEnrollments = true
  ) {
    // Fetch source session
    const { data: source, error: fetchErr } = await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('session_id', sourceSessionId)
      .single();

    if (fetchErr || !source) {
      return { data: null, error: fetchErr || new Error('Source session not found'), copied: 0 };
    }

    // Create new session with same course/teacher but new schedule
    const { data: newSession, error: createErr } = await supabase
      .from(Tables.SESSION)
      .insert({
        course_id: source.course_id,
        teacher_id: source.teacher_id,
        start_date: overrides.start_date,
        end_date: overrides.end_date,
        day: overrides.day,
        time: overrides.time ?? source.time,
        location: overrides.location ?? source.location,
        grace_period_minutes: source.grace_period_minutes,
        proximity_radius: source.proximity_radius,
      })
      .select()
      .single();

    if (createErr || !newSession) {
      return { data: null, error: createErr, copied: 0 };
    }

    try { await logInsert('session', newSession.session_id, newSession as Record<string, unknown>); } catch { /* audit non-critical */ }

    // Copy enrollments if requested
    let copied = 0;
    if (copyEnrollments) {
      const { data: enrollments } = await supabase
        .from(Tables.ENROLLMENT)
        .select('student_id, can_host')
        .eq('session_id', sourceSessionId)
        .eq('status', 'active');

      if (enrollments && enrollments.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const insertData = enrollments.map(e => ({
          student_id: e.student_id,
          session_id: newSession.session_id,
          enrollment_date: today,
          status: 'active' as const,
          can_host: e.can_host || false,
        }));

        const { error: enrollErr } = await supabase
          .from(Tables.ENROLLMENT)
          .insert(insertData);

        if (!enrollErr) copied = enrollments.length;
      }
    }

    return { data: newSession, error: null, copied };
  },

  // Get session with enrollment count
  async getWithEnrollmentCount(id: string) {
    const [sessionRes, enrollmentRes] = await Promise.all([
      this.getById(id),
      supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id')
        .eq('session_id', id)
    ]);

    return {
      data: sessionRes.data ? {
        ...sessionRes.data,
        enrollmentCount: enrollmentRes.data?.length || 0
      } : null,
      error: sessionRes.error || enrollmentRes.error
    };
  },

  // Get day-change history for a session
  async getDayChangeHistory(sessionId: string) {
    return await supabase
      .from('session_day_change')
      .select('*')
      .eq('session_id', sessionId)
      .order('effective_date', { ascending: false });
  },

  // Generate expected session dates from start_date, end_date, and day(s)
  generateSessionDates(
    startDate: string,
    endDate: string,
    days: string | null,
    dayChanges?: Array<{ old_day: string; new_day: string; effective_date: string }>
  ): string[] {
    if (!days) return [];

    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];

    const dayMap: Record<string, number> = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6,
    };

    // Parse day changes to determine which days apply at which point
    const changes = (dayChanges || []).sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );

    // Build date-range → days mapping
    const dayRanges: Array<{ from: Date; to: Date; dayNums: number[] }> = [];

    if (changes.length === 0) {
      // No changes: same days for entire range
      const dayNums = days.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
      dayRanges.push({ from: start, to: end, dayNums });
    } else {
      // Before first change: original days
      let currentDays = days;
      let rangeStart = start;

      for (const change of changes) {
        const effectiveDate = new Date(change.effective_date);
        if (effectiveDate > rangeStart) {
          const dayNums = currentDays.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
          dayRanges.push({ from: rangeStart, to: new Date(effectiveDate.getTime() - 86400000), dayNums });
        }
        currentDays = change.new_day;
        rangeStart = effectiveDate;
      }
      // Last range to end
      const dayNums = currentDays.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
      dayRanges.push({ from: rangeStart, to: end, dayNums });
    }

    // Generate all matching dates
    for (const range of dayRanges) {
      const cursor = new Date(range.from);
      while (cursor <= range.to) {
        if (range.dayNums.includes(cursor.getDay())) {
          dates.push(cursor.toISOString().split('T')[0]);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return dates.sort();
  },
};
