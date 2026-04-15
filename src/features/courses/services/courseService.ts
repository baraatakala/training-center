import { supabase } from '@/shared/lib/supabase';
import { Tables, type CreateCourse, type UpdateCourse } from '@/shared/types/database.types';
import { logDelete, logUpdate, logInsert } from '@/shared/services/auditService';

export const courseService = {
  async getAll() {
    return await supabase
      .from(Tables.COURSE)
      .select(`
        *,
        teacher:teacher_id(name, email)
      `)
      .order('course_name');
  },

  async getById(courseId: string) {
    return await supabase
      .from(Tables.COURSE)
      .select(`
        *,
        teacher:teacher_id(name, email)
      `)
      .eq('course_id', courseId)
      .single();
  },

  async create(data: CreateCourse) {
    const payload = {
      ...data,
      description_updated_at: data.description ? new Date().toISOString() : null,
    };

    const result = await supabase
      .from(Tables.COURSE)
      .insert([payload])
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

    const payload = {
      ...data,
      ...(data.description !== undefined ? { description_updated_at: new Date().toISOString() } : {}),
    };

    const result = await supabase
      .from(Tables.COURSE)
      .update(payload)
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

  // Book references
  async getBookReferences(courseId: string) {
    return await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .select('*')
      .eq('course_id', courseId)
      .order('display_order', { ascending: true })
      .order('start_page', { ascending: true });
  },

  async createBookReference(data: Record<string, unknown>) {
    return await supabase.from(Tables.COURSE_BOOK_REFERENCE).insert([data]);
  },

  async updateBookReference(referenceId: string, data: Record<string, unknown>) {
    return await supabase.from(Tables.COURSE_BOOK_REFERENCE).update(data).eq('reference_id', referenceId);
  },

  async deleteBookReference(referenceId: string) {
    return await supabase.from(Tables.COURSE_BOOK_REFERENCE).delete().eq('reference_id', referenceId);
  },

  async deleteBookReferencesByParent(parentId: string) {
    return await supabase.from(Tables.COURSE_BOOK_REFERENCE).delete().eq('parent_id', parentId);
  },

  // Lookup: teachers for dropdowns
  async getTeachersLookup() {
    return await supabase.from(Tables.TEACHER).select('teacher_id, name').order('name');
  },
};
