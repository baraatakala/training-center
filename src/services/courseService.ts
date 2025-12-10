import { supabase } from '../lib/supabase';
import { Tables, type CreateCourse, type UpdateCourse } from '../types/database.types';
import { logDelete } from './auditService';

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
    return await supabase
      .from(Tables.COURSE)
      .insert([data])
      .select()
      .single();
  },

  async update(courseId: string, data: UpdateCourse) {
    return await supabase
      .from(Tables.COURSE)
      .update(data)
      .eq('course_id', courseId)
      .select()
      .single();
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
      await logDelete('course', courseId, course as Record<string, unknown>);
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
