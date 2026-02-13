import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Custom hook to check if the current authenticated user is a teacher or admin.
 * Admin = user whose email exists in the admin table (scalable, no hardcoded emails)
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
          // Check admin table (scalable — no hardcoded emails)
          const { data: adminRecord } = await supabase
            .from('admin')
            .select('admin_id')
            .ilike('email', user.email)
            .single();
          
          const admin = !!adminRecord;
          if (!cancelled) setIsAdmin(admin);

          // Check teacher table
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
