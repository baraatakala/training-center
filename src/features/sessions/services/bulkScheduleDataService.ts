import { supabase } from '@/shared/lib/supabase';

// Transitional facade for BulkScheduleTable while its scheduling queries are
// extracted into narrower session service methods.
export const bulkScheduleDataService = supabase;
