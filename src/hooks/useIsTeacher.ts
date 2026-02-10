import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const ADMIN_EMAIL = 'baraatakala2004@gmail.com';

/**
 * Custom hook to check if the current authenticated user is a teacher or admin.
 * Admin = baraatakala2004@gmail.com (full access incl. update/delete)
 * Teacher = email in teacher table (read + insert only at DB level)
 * 
 * @returns {{ isTeacher: boolean, isAdmin: boolean, loading: boolean }} 
 */
export function useIsTeacher() {
  const [isTeacher, setIsTeacher] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;

        if (user?.email) {
          // Check admin
          const admin = user.email.toLowerCase() === ADMIN_EMAIL;
          if (!cancelled) setIsAdmin(admin);

          const { data: teacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .ilike('email', user.email)
            .single();
          if (!cancelled) {
            // Admin is also considered a teacher for page access
            setIsTeacher(!!teacher || admin);
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

  return { isTeacher, isAdmin, loading };
}
