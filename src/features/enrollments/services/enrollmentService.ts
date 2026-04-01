import { supabase } from '@/shared/lib/supabase';
import type { CreateEnrollment, UpdateEnrollment } from '@/shared/types/database.types';
import { Tables } from '@/shared/types/database.types';
import { logDelete, logUpdate, logInsert } from '@/shared/services/auditService';

export const enrollmentService = {
  // Get all enrollments
  async getAll() {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        student:student_id(name, email),
        session:session_id(
          *,
          course:course_id(course_name),
          teacher:teacher_id(name)
        )
      `)
      .order('enrollment_date', { ascending: false });
  },

  // Get enrollment by ID
  async getById(id: string) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        student:student_id(*),
        session:session_id(
          *,
          course:course_id(*),
          teacher:teacher_id(*)
        )
      `)
      .eq('enrollment_id', id)
      .single();
  },

  // Get enrollments for a specific session
  async getBySession(sessionId: string) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        student:student_id(name, email, phone)
      `)
      .eq('session_id', sessionId)
      .order('student.name', { ascending: true });
  },

  // Get enrollments for a specific student
  async getByStudent(studentId: string) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        session:session_id(
          *,
          course:course_id(course_name, category),
          teacher:teacher_id(name, email)
        )
      `)
      .eq('student_id', studentId)
      .order('enrollment_date', { ascending: false });
  },

  // Get active enrollments
  async getActive() {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        student:student_id(name, email),
        session:session_id(
          *,
          course:course_id(course_name)
        )
      `)
      .eq('status', 'active')
      .order('enrollment_date', { ascending: false });
  },

  // Create new enrollment
  async create(enrollment: CreateEnrollment) {
    const result = await supabase
      .from(Tables.ENROLLMENT)
      .insert(enrollment)
      .select()
      .single();

    // Translate DB unique constraint violation into a user-friendly error.
    // Code 23505 = unique_violation (PostgreSQL)
    if (result.error?.code === '23505') {
      return {
        data: null,
        error: Object.assign({}, result.error, {
          message: 'This student is already enrolled in this session.',
        }),
      };
    }

    if (result.data) {
      try { await logInsert('enrollment', result.data.enrollment_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Update enrollment
  async update(id: string, updates: UpdateEnrollment) {
    const { data: oldData } = await supabase
      .from(Tables.ENROLLMENT)
      .select('*')
      .eq('enrollment_id', id)
      .single();

    const result = await supabase
      .from(Tables.ENROLLMENT)
      .update(updates)
      .eq('enrollment_id', id)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logUpdate('enrollment', id, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  // Update enrollment status
  async updateStatus(id: string, status: 'active' | 'completed' | 'dropped' | 'pending') {
    return await this.update(id, { status });
  },

  // Update enrollment status with can_host logic
  async updateStatusWithCanHost(id: string, status: 'active' | 'completed' | 'dropped' | 'pending', canHost?: boolean) {
    // If changing to non-active status, force can_host to false
    const updates: UpdateEnrollment = { status };
    if (status !== 'active') {
      updates.can_host = false;
    } else if (typeof canHost === 'boolean') {
      updates.can_host = canHost;
    }
    return await this.update(id, updates);
  },

  // Delete enrollment
  async delete(id: string) {
    // Fetch enrollment data before deletion for audit log
    const { data: enrollment } = await supabase
      .from(Tables.ENROLLMENT)
      .select('*')
      .eq('enrollment_id', id)
      .single();

    // Log the deletion
    if (enrollment) {
      try { await logDelete('enrollment', id, enrollment as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return await supabase
      .from(Tables.ENROLLMENT)
      .delete()
      .eq('enrollment_id', id);
  },

  // Check if student is already enrolled in session.
  // Returns the existing enrollment row (with enrollment_id and status) or null.
  async checkEnrollment(studentId: string, sessionId: string) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .select('enrollment_id, status')
      .eq('student_id', studentId)
      .eq('session_id', sessionId)
      .maybeSingle();
  },

  // Get session capacity and current enrollment count
  async getSessionCapacity(sessionId: string) {
    // Get total enrollments (active + pending)
    const { data: enrollments, error: enrollError } = await supabase
      .from(Tables.ENROLLMENT)
      .select('enrollment_id')
      .eq('session_id', sessionId)
      .in('status', ['active', 'pending']);

    if (enrollError) return { data: null, error: enrollError };

    // Get session details with course capacity
    const { data: session, error: sessionError } = await supabase
      .from(Tables.SESSION)
      .select(`
        session_id,
        course:course_id (
          max_students
        )
      `)
      .eq('session_id', sessionId)
      .single();

    if (sessionError) return { data: null, error: sessionError };

    const maxCapacity = (session.course as { max_students?: number } | null)?.max_students || null;
    const currentCount = enrollments?.length || 0;

    return {
      data: {
        currentCount,
        maxCapacity,
        isAtCapacity: maxCapacity ? currentCount >= maxCapacity : false,
        spotsRemaining: maxCapacity ? Math.max(0, maxCapacity - currentCount) : null,
      },
      error: null,
    };
  },

  // Copy all active enrollments from one session to another
  async copyEnrollments(fromSessionId: string, toSessionId: string) {
    // Get active enrollments from source session
    const { data: sourceEnrollments, error: fetchError } = await supabase
      .from(Tables.ENROLLMENT)
      .select('student_id, can_host')
      .eq('session_id', fromSessionId)
      .eq('status', 'active');

    if (fetchError) return { copied: 0, skipped: 0, error: fetchError };
    if (!sourceEnrollments || sourceEnrollments.length === 0) {
      return { copied: 0, skipped: 0, error: null };
    }

    // Get existing enrollments in target session to avoid duplicates
    const { data: existingEnrollments } = await supabase
      .from(Tables.ENROLLMENT)
      .select('student_id')
      .eq('session_id', toSessionId);

    const existingStudentIds = new Set(
      (existingEnrollments || []).map((e: { student_id: string }) => e.student_id)
    );

    // Filter out already-enrolled students
    const newEnrollments = sourceEnrollments.filter(
      e => !existingStudentIds.has(e.student_id)
    );

    if (newEnrollments.length === 0) {
      return { copied: 0, skipped: sourceEnrollments.length, error: null };
    }

    // Bulk insert new enrollments
    const today = new Date().toISOString().split('T')[0];
    const insertData = newEnrollments.map(e => ({
      student_id: e.student_id,
      session_id: toSessionId,
      enrollment_date: today,
      status: 'active' as const,
      can_host: e.can_host || false,
    }));

    const { error: insertError } = await supabase
      .from(Tables.ENROLLMENT)
      .insert(insertData);

    if (insertError) return { copied: 0, skipped: 0, error: insertError };

    return {
      copied: newEnrollments.length,
      skipped: sourceEnrollments.length - newEnrollments.length,
      error: null,
    };
  },

  // Lookups for EnrollmentForm
  async getFormLookups() {
    const [students, sessions] = await Promise.all([
      supabase.from(Tables.STUDENT).select('student_id, name, email, address').order('name'),
      supabase.from(Tables.SESSION).select(`
        session_id, day, time, start_date, end_date, location,
        course:course_id(course_name),
        teacher:teacher_id(name)
      `).order('start_date', { ascending: false }),
    ]);
    return { students, sessions };
  },
};
