import { supabase } from '@/shared/lib/supabase';

export const authService = {
  async getCurrentUser() {
    return await supabase.auth.getUser();
  },

  async getSession() {
    return await supabase.auth.getSession();
  },

  async refreshSession() {
    return await supabase.auth.refreshSession();
  },

  /** Resolve role for the current user's email */
  async resolveRole(email: string) {
    const [teacherRes, adminRes, studentRes] = await Promise.all([
      supabase.from('teacher').select('teacher_id').ilike('email', email).maybeSingle(),
      supabase.from('admin').select('admin_id').ilike('email', email).maybeSingle(),
      supabase.from('student').select('student_id').ilike('email', email).maybeSingle(),
    ]);
    return {
      teacher: teacherRes.data,
      admin: adminRes.data,
      student: studentRes.data,
      isTeacher: !!teacherRes.data,
      isAdmin: !!adminRes.data,
      isStudent: !!studentRes.data,
    };
  },

  /** Load courses dropdown list */
  async getCoursesLookup() {
    return await supabase.from('course').select('course_id, course_name').order('course_name');
  },

  /** Self-registration: create auth account for pre-registered system emails */
  async registerUser(email: string, password: string) {
    const { data, error } = await supabase.rpc('register_system_user', {
      p_email: email,
      p_password: password,
    });
    return { data, error };
  },
};
