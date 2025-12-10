import { supabase } from '../lib/supabase';

export interface AuditLogEntry {
  audit_id?: string;
  table_name: string;
  record_id: string;
  operation: 'DELETE' | 'UPDATE' | 'INSERT';
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  deleted_by?: string;
  deleted_at?: string;
  reason?: string;
}

/**
 * Log a delete operation to the audit log
 */
export const logDelete = async (
  tableName: string,
  recordId: string,
  recordData: Record<string, unknown>,
  reason?: string
): Promise<void> => {
  try {
    // Get current user email
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || 'system';

    // Insert audit log entry
    const { error } = await supabase
      .from('audit_log')
      .insert({
        table_name: tableName,
        record_id: recordId,
        operation: 'DELETE',
        old_data: recordData,
        deleted_by: userEmail,
        deleted_at: new Date().toISOString(),
        reason: reason || null
      });

    if (error) {
      console.error('Failed to log delete operation:', error);
      // Don't throw - audit logging shouldn't block the delete operation
    }
  } catch (err) {
    console.error('Error in audit logging:', err);
  }
};

/**
 * Log an update operation to the audit log
 */
export const logUpdate = async (
  tableName: string,
  recordId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  reason?: string
): Promise<void> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || 'system';

    const { error } = await supabase
      .from('audit_log')
      .insert({
        table_name: tableName,
        record_id: recordId,
        operation: 'UPDATE',
        old_data: oldData,
        new_data: newData,
        deleted_by: userEmail,
        deleted_at: new Date().toISOString(),
        reason: reason || null
      });

    if (error) {
      console.error('Failed to log update operation:', error);
    }
  } catch (err) {
    console.error('Error in audit logging:', err);
  }
};

/**
 * Fetch audit logs with optional filters
 */
export const getAuditLogs = async (filters?: {
  tableName?: string;
  operation?: string;
  deletedBy?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> => {
  try {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('deleted_at', { ascending: false });

    if (filters?.tableName) {
      query = query.eq('table_name', filters.tableName);
    }
    if (filters?.operation) {
      query = query.eq('operation', filters.operation);
    }
    if (filters?.deletedBy) {
      query = query.eq('deleted_by', filters.deletedBy);
    }
    if (filters?.startDate) {
      query = query.gte('deleted_at', filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte('deleted_at', filters.endDate);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
};
