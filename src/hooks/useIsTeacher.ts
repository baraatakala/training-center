import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Custom hook to check if the current authenticated user is a teacher.
 * Replaces the duplicated `checkTeacherAccess` pattern found across all pages.
 * 
 * @returns {{ isTeacher: boolean, loading: boolean }} 
 */
export function useIsTeacher() {
  const [isTeacher, setIsTeacher] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;

        if (user?.email) {
          const { data: teacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .ilike('email', user.email)
            .single();
          if (!cancelled) {
            setIsTeacher(!!teacher);
          }
        }
      } catch {
        // Silently handle — user is not a teacher
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    return () => { cancelled = true; };
  }, []);

  return { isTeacher, loading };
}
