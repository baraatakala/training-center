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
  changed_by?: string;
  changed_at?: string;
  reason?: string;
}

/** Get current user info for audit context */
const getAuditUser = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return { email: user?.email || 'system', id: user?.id || null };
  } catch {
    return { email: 'system', id: null };
  }
};

/** Write an audit entry (shared by all log functions) */
const writeAuditEntry = async (entry: {
  table_name: string;
  record_id: string;
  operation: 'DELETE' | 'UPDATE' | 'INSERT';
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<void> => {
  try {
    const user = await getAuditUser();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('audit_log')
      .insert({
        table_name: entry.table_name,
        record_id: entry.record_id,
        operation: entry.operation,
        old_data: entry.old_data || null,
        new_data: entry.new_data || null,
        deleted_by: user.email,
        deleted_at: now,
        changed_by: user.id,
        changed_at: now,
        reason: entry.reason || null,
      });

    if (error) {
      console.error(`Failed to log ${entry.operation} on ${entry.table_name}:`, error);
    }
  } catch (err) {
    console.error('Error in audit logging:', err);
  }
};

/**
 * Log a DELETE operation
 */
export const logDelete = async (
  tableName: string,
  recordId: string,
  recordData: Record<string, unknown>,
  reason?: string
): Promise<void> => {
  await writeAuditEntry({
    table_name: tableName,
    record_id: recordId,
    operation: 'DELETE',
    old_data: recordData,
    reason,
  });
};

/**
 * Log an UPDATE operation (old + new data)
 */
export const logUpdate = async (
  tableName: string,
  recordId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  reason?: string
): Promise<void> => {
  await writeAuditEntry({
    table_name: tableName,
    record_id: recordId,
    operation: 'UPDATE',
    old_data: oldData,
    new_data: newData,
    reason,
  });
};

/**
 * Log an INSERT operation
 */
export const logInsert = async (
  tableName: string,
  recordId: string,
  recordData: Record<string, unknown>,
  reason?: string
): Promise<void> => {
  await writeAuditEntry({
    table_name: tableName,
    record_id: recordId,
    operation: 'INSERT',
    new_data: recordData,
    reason,
  });
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

/**
 * Delete a specific audit log entry (admin only)
 */
export const deleteAuditLog = async (auditId: string): Promise<void> => {
  const { error } = await supabase
    .from('audit_log')
    .delete()
    .eq('audit_id', auditId);

  if (error) throw error;
};

/**
 * Delete multiple audit log entries (admin only)
 */
export const deleteAuditLogs = async (auditIds: string[]): Promise<void> => {
  const { error } = await supabase
    .from('audit_log')
    .delete()
    .in('audit_id', auditIds);

  if (error) throw error;
};
