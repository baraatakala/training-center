import { supabase } from '@/shared/lib/supabase';

// Transitional facade for the Attendance page while its remaining query logic is
// moved into narrower service methods.
export const attendancePageService = supabase;
