import { supabase } from '@/shared/lib/supabase';

// Transitional facade for the legacy bulk attendance import workflow.
export const bulkImportDataService = supabase;
