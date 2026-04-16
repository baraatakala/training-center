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

  if (log.table_name === 'excuse_request') {
    const status = (data.status as string) || '';
    const reason = (data.reason as string) || '';
    const reasonPart = reason ? ` — "${reason.slice(0, 50)}"` : '';
    switch (log.operation) {
      case 'INSERT': return `Excuse request submitted${reasonPart}`;
      case 'UPDATE': return `Excuse request ${status || 'updated'}${reasonPart}`;
      case 'DELETE': return `Excuse request cancelled${reasonPart}`;
    }
  }

  if (log.table_name === 'scoring_config') {
    const comp = (data.component_key as string) || '';
    const label = comp ? `Scoring component "${comp}"` : 'Scoring config';
    switch (log.operation) {
      case 'INSERT': return `${label} was configured`;
      case 'UPDATE': return `${label} was updated`;
      case 'DELETE': return log.reason || `${label} was reset`;
    }
  }

  if (log.table_name === 'certificate_template') {
    const tplName = String(data.name || '').trim();
    const label = tplName ? `Certificate template "${tplName}"` : 'Certificate template';
    switch (log.operation) {
      case 'INSERT': return `${label} was created`;
      case 'UPDATE': return `${label} was updated`;
      case 'DELETE': return `${label} was deleted`;
    }
  }

  if (log.table_name === 'issued_certificate') {
    const student = (data.student_name as string) || '';
    const studentPart = student ? ` for ${student}` : '';
    switch (log.operation) {
      case 'INSERT': return `Certificate issued${studentPart}`;
      case 'UPDATE': return log.reason ? `Certificate revoked${studentPart} — ${log.reason}` : `Certificate updated${studentPart}`;
      case 'DELETE': return `Certificate deleted${studentPart}`;
    }
  }

  if (log.table_name === 'session_day_change') {
    const from = (data.original_day as string) || '';
    const to = (data.new_day as string) || '';
    const changePart = from && to ? ` from ${from} to ${to}` : '';
    switch (log.operation) {
      case 'INSERT': return `Session day changed${changePart}`;
      case 'DELETE': return `Session day change reverted${changePart}`;
      default: return `Session day change updated${changePart}`;
    }
  }

  if (log.table_name === 'session_time_change') {
    const reason = (data.reason as string) || '';
    const reasonPart = reason ? ` — ${reason}` : '';
    switch (log.operation) {
      case 'INSERT': return `Session time changed${reasonPart}`;
      case 'DELETE': return `Session time change reverted${reasonPart}`;
      default: return `Session time change updated${reasonPart}`;
    }
  }

  if (log.table_name === 'specialization') {
    const spName = String(data.name || '').trim();
    const label = spName ? `Specialization "${spName}"` : 'Specialization';
    switch (log.operation) {
      case 'INSERT': return `${label} was created`;
      case 'UPDATE': return `${label} was renamed`;
      case 'DELETE': return `${label} was removed`;
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

/** Return the route path to view the entity related to an audit log entry */
export const getEntityRoute = (log: AuditLogEntry): string | null => {
  const data = { ...(log.old_data || {}), ...(log.new_data || {}) } as Record<string, unknown>;
  switch (log.table_name) {
    case 'student': return '/students';
    case 'teacher': return '/teachers';
    case 'course': return '/courses';
    case 'session': return '/sessions';
    case 'enrollment': return '/enrollments';
    case 'attendance':
      return data.session_id ? `/attendance/${data.session_id}` : '/attendance-records';
    case 'session_feedback':
      return data.session_id ? `/feedback-analytics?session=${data.session_id}` : '/feedback-analytics';
    case 'feedback_question':
      return data.session_id ? `/attendance/${data.session_id}` : null;
    case 'feedback_template': return null;
    case 'session_recording':
      return '/sessions';
    case 'announcement': return '/announcements';
    case 'message': return '/messages';
    case 'excuse_request': return '/excuses';
    case 'scoring_config': return data.course_id ? `/scoring?course=${data.course_id}` : '/scoring';
    case 'certificate_template': return '/certificates';
    case 'issued_certificate': return '/certificates';
    case 'session_day_change': return '/sessions';
    case 'session_time_change': return '/sessions';
    case 'session_date_host': return '/sessions';
    case 'course_book_reference': return '/courses';
    case 'specialization': return '/specializations';
    case 'qr_sessions': return '/sessions';
    case 'photo_checkin_sessions': return '/sessions';
    case 'teacher_host_schedule': return '/sessions';
    default: return null;
  }
};
