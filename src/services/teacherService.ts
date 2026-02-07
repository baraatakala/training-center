import { supabase } from '../lib/supabase';
import { Tables, type CreateTeacher, type UpdateTeacher } from '../types/database.types';
import { logDelete, logUpdate, logInsert } from './auditService';

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
    const result = await supabase
      .from(Tables.TEACHER)
      .insert([data])
      .select()
      .single();

    if (result.data) {
      await logInsert('teacher', result.data.teacher_id, result.data as Record<string, unknown>);
    }
    return result;
  },

  async update(teacherId: string, data: UpdateTeacher) {
    const { data: oldData } = await supabase
      .from(Tables.TEACHER)
      .select('*')
      .eq('teacher_id', teacherId)
      .single();

    const result = await supabase
      .from(Tables.TEACHER)
      .update(data)
      .eq('teacher_id', teacherId)
      .select()
      .single();

    if (oldData && result.data) {
      await logUpdate('teacher', teacherId, oldData as Record<string, unknown>, result.data as Record<string, unknown>);
    }
    return result;
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

  async getEnrolledStudentsCount(teacherId: string) {
    // Get courses taught by this teacher
    const { data: courses } = await supabase
      .from(Tables.COURSE)
      .select('course_id')
      .eq('teacher_id', teacherId);

    if (!courses || courses.length === 0) {
      return { count: 0, error: null };
    }

    const courseIds = courses.map(c => c.course_id);

    // Get sessions for these courses
    const { data: sessions } = await supabase
      .from(Tables.SESSION)
      .select('session_id')
      .in('course_id', courseIds);

    if (!sessions || sessions.length === 0) {
      return { count: 0, error: null };
    }

    const sessionIds = sessions.map(s => s.session_id);

    // Get unique enrolled students
    const { data: enrollments } = await supabase
      .from(Tables.ENROLLMENT)
      .select('student_id')
      .in('session_id', sessionIds);

    if (!enrollments || enrollments.length === 0) {
      return { count: 0, error: null };
    }

    const uniqueStudents = [...new Set(enrollments.map(e => e.student_id))];
    return { count: uniqueStudents.length, error: null };
  },
};
