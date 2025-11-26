import { supabase } from '../lib/supabase';
import { Tables, type CreateTeacher, type UpdateTeacher } from '../types/database.types';

export const teacherService = {
  async getAll() {
    return await supabase
      .from(Tables.TEACHER)
      .select('*')
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
