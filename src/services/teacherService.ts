import { supabase } from '../lib/supabase';
import { Tables, type CreateTeacher, type UpdateTeacher } from '../types/database.types';
import { logDelete } from './auditService';

export const teacherService = {
  async getAll() {
    return await supabase
      .from(Tables.TEACHER)
      .select(`
        *,
        assigned_students:student(count)
      `)
      .order('name');
  },

  async getById(teacherId: string) {
    return await supabase
      .from(Tables.TEACHER)
      .select('*')
      .eq('teacher_id', teacherId)
      .single();
  },

  async create(data: CreateTeacher) {
    return await supabase
      .from(Tables.TEACHER)
      .insert([data])
      .select()
      .single();
  },

  async update(teacherId: string, data: UpdateTeacher) {
    return await supabase
      .from(Tables.TEACHER)
      .update(data)
      .eq('teacher_id', teacherId)
      .select()
      .single();
  },

  async delete(teacherId: string) {
    // Fetch teacher data before deletion for audit log
    const { data: teacher } = await supabase
      .from(Tables.TEACHER)
      .select('*')
      .eq('teacher_id', teacherId)
      .single();

    // Log the deletion
    if (teacher) {
      await logDelete('teacher', teacherId, teacher as Record<string, unknown>);
    }

    return await supabase
      .from(Tables.TEACHER)
      .delete()
      .eq('teacher_id', teacherId);
  },

  async getStudents(teacherId: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .eq('teacher_id', teacherId)
      .order('name');
  },

  async getCourses(teacherId: string) {
    return await supabase
      .from(Tables.COURSE)
      .select('*')
      .eq('teacher_id', teacherId)
      .order('course_name');
  },
};
