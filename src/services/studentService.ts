import { supabase } from '../lib/supabase';
import type { CreateStudent, UpdateStudent } from '../types/database.types';
import { Tables } from '../types/database.types';
import { logDelete } from './auditService';

export const studentService = {
  // Get all students
  async getAll() {
    return await supabase
      .from(Tables.STUDENT)
      .select(`
        *,
        teacher:teacher_id(name, email)
      `)
      .order('name', { ascending: true });
  },

  // Get student by ID
  async getById(id: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select(`
        *,
        teacher:teacher_id(*)
      `)
      .eq('student_id', id)
      .single();
  },

  // Get students by teacher
  async getByTeacher(teacherId: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .eq('teacher_id', teacherId)
      .order('name', { ascending: true });
  },

  // Search students by name or email
  async search(query: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select(`
        *,
        teacher:teacher_id(name, email)
      `)
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
      .order('name', { ascending: true });
  },

  // Create new student
  async create(student: CreateStudent) {
    return await supabase
      .from(Tables.STUDENT)
      .insert(student)
      .select()
      .single();
  },

  // Update student
  async update(id: string, updates: UpdateStudent) {
    return await supabase
      .from(Tables.STUDENT)
      .update(updates)
      .eq('student_id', id)
      .select()
      .single();
  },

  // Delete student
  async delete(id: string) {
    // Fetch student data before deletion for audit log
    const { data: student } = await supabase
      .from(Tables.STUDENT)
      .select('*')
      .eq('student_id', id)
      .single();

    // Log the deletion
    if (student) {
      await logDelete('student', id, student as Record<string, unknown>);
    }

    return await supabase
      .from(Tables.STUDENT)
      .delete()
      .eq('student_id', id);
  },

  // Get student enrollments
  async getEnrollments(studentId: string) {
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
};
