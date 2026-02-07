import { supabase } from '../lib/supabase';
import type { CreateStudent, UpdateStudent } from '../types/database.types';
import { Tables } from '../types/database.types';
import { logDelete, logUpdate, logInsert } from './auditService';

export const studentService = {
  // Get all students
  async getAll() {
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .order('name', { ascending: true });
  },

  // Get student by ID
  async getById(id: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .eq('student_id', id)
      .single();
  },

  // Get students by teacher (through enrollments)
  async getByTeacher(teacherId: string) {
    // Get courses taught by this teacher
    const { data: courses } = await supabase
      .from(Tables.COURSE)
      .select('course_id')
      .eq('teacher_id', teacherId);

    if (!courses || courses.length === 0) {
      return { data: [], error: null };
    }

    const courseIds = courses.map(c => c.course_id);

    // Get sessions for these courses
    const { data: sessions } = await supabase
      .from(Tables.SESSION)
      .select('session_id')
      .in('course_id', courseIds);

    if (!sessions || sessions.length === 0) {
      return { data: [], error: null };
    }

    const sessionIds = sessions.map(s => s.session_id);

    // Get enrolled students
    const { data: enrollments } = await supabase
      .from(Tables.ENROLLMENT)
      .select('student_id')
      .in('session_id', sessionIds);

    if (!enrollments || enrollments.length === 0) {
      return { data: [], error: null };
    }

    const studentIds = [...new Set(enrollments.map(e => e.student_id))];
    
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .in('student_id', studentIds)
      .order('name', { ascending: true });
  },

  // Search students by name or email
  async search(query: string) {
    return await supabase
      .from(Tables.STUDENT)
      .select('*')
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
      .order('name', { ascending: true });
  },

  // Create new student
  async create(student: CreateStudent) {
    const result = await supabase
      .from(Tables.STUDENT)
      .insert(student)
      .select()
      .single();

    if (result.data) {
      await logInsert('student', result.data.student_id, result.data as Record<string, unknown>);
    }
    return result;
  },

  // Update student
  async update(id: string, updates: UpdateStudent) {
    // Fetch old data for audit
    const { data: oldData } = await supabase
      .from(Tables.STUDENT)
      .select('*')
      .eq('student_id', id)
      .single();

    const result = await supabase
      .from(Tables.STUDENT)
      .update(updates)
      .eq('student_id', id)
      .select()
      .single();

    if (oldData && result.data) {
      await logUpdate('student', id, oldData as Record<string, unknown>, result.data as Record<string, unknown>);
    }
    return result;
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
