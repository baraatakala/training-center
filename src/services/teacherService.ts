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
      try { await logInsert('teacher', result.data.teacher_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
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
      try { await logUpdate('teacher', teacherId, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }
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
      try { await logDelete('teacher', teacherId, teacher as Record<string, unknown>); } catch { /* audit non-critical */ }
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

  /**
   * Batch fetch enrolled student counts for ALL teachers in just 3 queries
   * instead of 3 queries per teacher (N+1 fix).
   * Returns a Map<teacher_id, count>.
   */
  async getAllEnrolledStudentCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    // 1. Get all courses with their teacher_id
    const { data: courses } = await supabase
      .from(Tables.COURSE)
      .select('course_id, teacher_id');

    if (!courses || courses.length === 0) return counts;

    // Build teacher → course_ids map
    const teacherCourses = new Map<string, string[]>();
    const allCourseIds: string[] = [];
    for (const c of courses) {
      if (!teacherCourses.has(c.teacher_id)) {
        teacherCourses.set(c.teacher_id, []);
      }
      teacherCourses.get(c.teacher_id)!.push(c.course_id);
      allCourseIds.push(c.course_id);
    }

    // 2. Get all sessions for those courses
    const { data: sessions } = await supabase
      .from(Tables.SESSION)
      .select('session_id, course_id')
      .in('course_id', allCourseIds);

    if (!sessions || sessions.length === 0) return counts;

    // Build course → session_ids map
    const courseSessions = new Map<string, string[]>();
    const allSessionIds: string[] = [];
    for (const s of sessions) {
      if (!courseSessions.has(s.course_id)) {
        courseSessions.set(s.course_id, []);
      }
      courseSessions.get(s.course_id)!.push(s.session_id);
      allSessionIds.push(s.session_id);
    }

    // 3. Get all enrollments for those sessions
    const { data: enrollments } = await supabase
      .from(Tables.ENROLLMENT)
      .select('student_id, session_id')
      .in('session_id', allSessionIds);

    if (!enrollments || enrollments.length === 0) return counts;

    // Build session → student_ids map
    const sessionStudents = new Map<string, Set<string>>();
    for (const e of enrollments) {
      if (!sessionStudents.has(e.session_id)) {
        sessionStudents.set(e.session_id, new Set());
      }
      sessionStudents.get(e.session_id)!.add(e.student_id);
    }

    // Now aggregate: for each teacher, collect unique students across all their sessions
    for (const [teacherId, courseIds] of teacherCourses) {
      const uniqueStudents = new Set<string>();
      for (const courseId of courseIds) {
        const sessionIds = courseSessions.get(courseId) || [];
        for (const sessionId of sessionIds) {
          const students = sessionStudents.get(sessionId);
          if (students) {
            for (const studentId of students) {
              uniqueStudents.add(studentId);
            }
          }
        }
      }
      counts.set(teacherId, uniqueStudents.size);
    }

    return counts;
  },
};
