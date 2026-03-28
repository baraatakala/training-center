import { supabase } from '@/shared/lib/supabase';

// Transitional facade for AttendanceRecords while remaining ad-hoc filter queries
// are collapsed into narrower attendance service methods.
export const attendanceRecordsDataService = supabase;
