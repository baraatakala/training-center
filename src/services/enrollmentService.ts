import { supabase } from '../lib/supabase';
import type { CreateEnrollment, UpdateEnrollment } from '../types/database.types';
import { Tables } from '../types/database.types';
import { logDelete } from './auditService';

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
    return await supabase
      .from(Tables.ENROLLMENT)
      .insert(enrollment)
      .select()
      .single();
  },

  // Update enrollment
  async update(id: string, updates: UpdateEnrollment) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .update(updates)
      .eq('enrollment_id', id)
      .select()
      .single();
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
      await logDelete('enrollment', id, enrollment as Record<string, unknown>);
    }

    return await supabase
      .from(Tables.ENROLLMENT)
      .delete()
      .eq('enrollment_id', id);
  },

  // Check if student is already enrolled in session
  async checkEnrollment(studentId: string, sessionId: string) {
    const { data, error } = await supabase
      .from(Tables.ENROLLMENT)
      .select('enrollment_id, status')
      .eq('student_id', studentId)
      .eq('session_id', sessionId)
      .maybeSingle();

    return { data: !!data, error };
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
};
