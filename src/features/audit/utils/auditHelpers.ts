import type { AuditLogEntry } from '@/shared/services/auditService';
import { TABLE_SUMMARY_FIELDS } from '@/features/audit/constants/auditConstants';

/** Fields to skip in UPDATE diffs (technical noise) */
export const NOISE_FIELDS = new Set(['updated_at', 'created_at', 'marked_at']);

/** Extract the actor (who performed the action) from log data when deleted_by is null */
export const getActor = (log: AuditLogEntry): string => {
  if (log.deleted_by) return log.deleted_by;
  const newData = (log.new_data || {}) as Record<string, unknown>;
  const oldData = (log.old_data || {}) as Record<string, unknown>;
  const data = { ...oldData, ...newData };
  for (const field of ['marked_by', 'reviewed_by', 'changed_by', 'sender_email', 'created_by']) {
    const val = data[field];
    if (typeof val === 'string' && val.trim()) {
      const clean = val.split(' - ')[0].trim();
      return clean;
    }
  }
  return 'system';
};

/** Return keys that differ between old and new data objects */
export const getChangedFields = (
  oldData: Record<string, unknown> | undefined,
  newData: Record<string, unknown> | undefined
): { key: string; old: unknown; new: unknown }[] => {
  if (!oldData || !newData) return [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const changes: { key: string; old: unknown; new: unknown }[] = [];
  allKeys.forEach((key) => {
    const oldVal = JSON.stringify(oldData[key]);
    const newVal = JSON.stringify(newData[key]);
    if (oldVal !== newVal) {
      changes.push({ key, old: oldData[key], new: newData[key] });
    }
  });
  return changes;
};

export const formatValue = (val: unknown): string => {
  if (val === null || val === undefined) return '\u2013';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

/** Turn a table + operation + data into a human-readable sentence */
export const describeAction = (log: AuditLogEntry): string => {
  const newData = (log.new_data || {}) as Record<string, unknown>;
  const oldData = (log.old_data || {}) as Record<string, unknown>;
  const data = { ...oldData, ...newData };
  const name = data.name || data.course_name || data.student_name || data.teacher_name || data.title || '';
  const entity = log.table_name.charAt(0).toUpperCase() + log.table_name.slice(1);
  const article = /^[aeiou]/i.test(log.table_name) ? 'An' : 'A';

  if (log.table_name === 'attendance') {
    const status = (newData.status as string) || (oldData.status as string) || '';
    const method = (data.check_in_method as string) || '';
    const date = (data.attendance_date as string) || '';
    const datePart = date ? ` on ${date}` : '';
    const methodPart = method ? ` (${method})` : '';
    switch (log.operation) {
      case 'INSERT': return `Attendance marked as ${status || 'recorded'}${datePart}${methodPart}`;
      case 'UPDATE': {
        const changes = getChangedFields(log.old_data, log.new_data).filter(c => !NOISE_FIELDS.has(c.key));
        const changedKeys = changes.map(c => c.key.replace(/_/g, ' '));
        if (changedKeys.length > 0) {
          return `${changedKeys.join(', ')} updated${status ? ` (${status})` : ''}${datePart}`;
        }
        return `Attendance updated${status ? ` (${status})` : ''}${datePart}`;
      }
      case 'DELETE': return `Attendance record${status ? ` (${status})` : ''} deleted${datePart}`;
    }
  }

  if (log.table_name === 'session_feedback') {
    const date = (data.attendance_date as string) || '';
    const method = (data.check_in_method as string) || '';
    const rating = newData.overall_rating ?? oldData.overall_rating;
    const datePart = date ? ` on ${date}` : '';
    const methodPart = method ? ` via ${method}` : '';
    switch (log.operation) {
      case 'INSERT': return `Session feedback submitted${datePart}${methodPart}${rating ? ` (${rating}/5)` : ''}`;
      case 'UPDATE': return `Session feedback updated${datePart}`;
      case 'DELETE': return `Session feedback deleted${datePart}`;
    }
  }

  if (log.table_name === 'feedback_question') {
    const questionText = String(data.question_text || '').trim();
    const label = questionText ? `Question "${questionText}"` : 'Feedback question';
    switch (log.operation) {
      case 'INSERT': return `${label} was created`;
      case 'UPDATE': return log.reason || `${label} was updated`;
      case 'DELETE': return `${label} was deleted`;
    }
  }

  if (log.table_name === 'feedback_template') {
    const templateName = String(data.name || '').trim();
    const label = templateName ? `Feedback template "${templateName}"` : 'Feedback template';
    switch (log.operation) {
      case 'INSERT': return `${label} was created`;
      case 'UPDATE': return `${label} was updated`;
      case 'DELETE': return `${label} was deleted`;
    }
  }

  if (log.table_name === 'session_recording') {
    const date = (data.attendance_date as string) || '';
    const datePart = date ? ` for ${date}` : '';
    switch (log.operation) {
      case 'INSERT': return `Session recording link was published${datePart}`;
      case 'UPDATE': return `Session recording link was updated${datePart}`;
      case 'DELETE': return `Session recording link was removed${datePart}`;
    }
  }

  switch (log.operation) {
    case 'DELETE':
      return name ? `${entity} "${name}" was deleted` : `${article} ${log.table_name} record was deleted`;
    case 'UPDATE':
      return name ? `${entity} "${name}" was updated` : `${article} ${log.table_name} record was updated`;
    case 'INSERT':
      return name ? `${entity} "${name}" was created` : `${article} new ${log.table_name} record was created`;
    default:
      return `${log.operation} on ${log.table_name}`;
  }
};

/** Get key summary entries for a record based on its table */
export const getSummaryEntries = (
  tableName: string,
  data: Record<string, unknown>
): { label: string; value: string }[] => {
  const config = TABLE_SUMMARY_FIELDS[tableName];
  if (!config) {
    return Object.entries(data)
      .filter(([k, v]) => v != null && v !== '' && !k.endsWith('_id') && !k.endsWith('_at') && !k.startsWith('gps_'))
      .slice(0, 6)
      .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: formatValue(v) }));
  }
  return config
    .filter(({ field }) => data[field] != null && data[field] !== '')
    .map(({ field, label }) => ({ label, value: formatValue(data[field]) }));
};
