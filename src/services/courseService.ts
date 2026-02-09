import { supabase } from '../lib/supabase';
import { Tables, type CreateCourse, type UpdateCourse } from '../types/database.types';
import { logDelete, logUpdate, logInsert } from './auditService';

export const courseService = {
  async getAll() {
    return await supabase
      .from(Tables.COURSE)
      .select(`
        *,
        teacher:teacher_id(name)
      `)
      .order('course_name');
  },

  async getById(courseId: string) {
    return await supabase
      .from(Tables.COURSE)
      .select(`
        *,
        teacher:teacher_id(name)
      `)
      .eq('course_id', courseId)
      .single();
  },

  async create(data: CreateCourse) {
    const result = await supabase
      .from(Tables.COURSE)
      .insert([data])
      .select()
      .single();

    if (result.data) {
      try { await logInsert('course', result.data.course_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  async update(courseId: string, data: UpdateCourse) {
    const { data: oldData } = await supabase
      .from(Tables.COURSE)
      .select('*')
      .eq('course_id', courseId)
      .single();

    const result = await supabase
      .from(Tables.COURSE)
      .update(data)
      .eq('course_id', courseId)
      .select()
      .single();

    if (oldData && result.data) {
      try { await logUpdate('course', courseId, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
    }
    return result;
  },

  async delete(courseId: string) {
    // Fetch course data before deletion for audit log
    const { data: course } = await supabase
      .from(Tables.COURSE)
      .select('*')
      .eq('course_id', courseId)
      .single();

    // Log the deletion
    if (course) {
      try { await logDelete('course', courseId, course as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    return await supabase
      .from(Tables.COURSE)
      .delete()
      .eq('course_id', courseId);
  },

  async getSessions(courseId: string) {
    return await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('course_id', courseId)
      .order('start_date', { ascending: false });
  },
};
