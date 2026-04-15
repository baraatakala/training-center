import * as XLSX from 'xlsx';
import { supabase } from '@/shared/lib/supabase';
import { Tables } from '@/shared/types/database.types';
import { normalizeDate } from '@/features/data-import/utils/importHelpers';

export interface AttendanceImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

type ImportRow = Record<string, string>;

const VALID_STATUSES = new Set(['on time', 'absent', 'late', 'excused']);
const VALID_METHODS = new Set(['qr_code', 'photo', 'manual', 'bulk']);

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeText(value: string | undefined) {
  return (value || '').trim();
}

function normalizeLower(value: string | undefined) {
  return normalizeText(value).toLowerCase();
}

function parseOptionalNumber(value: string | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseCsvText(text: string): ImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);

  return lines
    .slice(1)
    .map((line) => {
      const values = parseDelimitedLine(line, delimiter);
      const normalized: ImportRow = {};
      headers.forEach((header, index) => {
        normalized[header] = normalizeText(values[index]);
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => normalizeText(value).length > 0));
}

export async function parseAttendanceFile(file: File): Promise<ImportRow[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || file.type.includes('csv')) {
    const text = await file.text();
    return parseCsvText(text);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  return rows
    .map((row) => {
      const normalized: ImportRow = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[normalizeHeader(key)] = String(value ?? '').trim();
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => normalizeText(value).length > 0));
}

/**
 * Build an XLSX template pre-populated with enrolled students for a specific session.
 */
export async function buildAttendanceTemplate(sessionId: string) {
  const { data: enrollments } = await supabase
    .from(Tables.ENROLLMENT)
    .select('student:student_id(email)')
    .eq('session_id', sessionId)
    .eq('status', 'active');

  const columns = [
    'student_email',
    'attendance_date',
    'status',
    'notes',
    'excuse_reason',
    'late_minutes',
    'check_in_method',
    'host_address',
  ];

  const templateRows: ImportRow[] = [];
  if (enrollments && enrollments.length > 0) {
    const student = Array.isArray(enrollments[0].student)
      ? enrollments[0].student[0]
      : enrollments[0].student;
    templateRows.push({
      student_email: (student as { email: string } | null)?.email || 'student@example.com',
      attendance_date: new Date().toISOString().substring(0, 10),
      status: 'on time',
      notes: '',
      excuse_reason: '',
      late_minutes: '',
      check_in_method: 'manual',
      host_address: '',
    });
  } else {
    templateRows.push({
      student_email: 'student@example.com',
      attendance_date: '2026-01-15',
      status: 'on time',
      notes: '',
      excuse_reason: '',
      late_minutes: '',
      check_in_method: 'manual',
      host_address: '',
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(templateRows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  return workbook;
}

/**
 * Import attendance records for a specific session.
 * Resolves student_email → student_id → enrollment_id, then upserts attendance.
 */
export async function importAttendance(
  sessionId: string,
  rows: ImportRow[],
): Promise<AttendanceImportResult> {
  const result: AttendanceImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // Load enrolled students for this session
  const { data: enrollments } = await supabase
    .from(Tables.ENROLLMENT)
    .select('enrollment_id, student_id, student:student_id(email)')
    .eq('session_id', sessionId);

  if (!enrollments || enrollments.length === 0) {
    result.errors.push('No enrollments found for this session.');
    return result;
  }

  const enrollmentByEmail = new Map<string, { enrollment_id: string; student_id: string }>();
  for (const e of enrollments) {
    const student = Array.isArray(e.student) ? e.student[0] : e.student;
    const email = (student as { email: string } | null)?.email;
    if (email) {
      enrollmentByEmail.set(email.toLowerCase(), {
        enrollment_id: e.enrollment_id,
        student_id: e.student_id,
      });
    }
  }

  // Load existing attendance to differentiate create vs update
  const { data: existingAttendance } = await supabase
    .from(Tables.ATTENDANCE)
    .select('attendance_id, enrollment_id, attendance_date')
    .eq('session_id', sessionId);

  const existingByKey = new Map<string, string>();
  for (const a of existingAttendance || []) {
    existingByKey.set(`${a.enrollment_id}|${a.attendance_date}`, a.attendance_id);
  }

  // Get current user for marked_by
  const { data: { user } } = await supabase.auth.getUser();
  const markedBy = user?.email || 'import';

  // Process rows
  const upsertBatch: Record<string, unknown>[] = [];

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2; // +2 for 1-based + header row
    try {
      const email = normalizeText(row.student_email);
      if (!email) {
        result.errors.push(`Row ${rowIndex}: student_email is required.`);
        continue;
      }

      const enrollment = enrollmentByEmail.get(normalizeLower(email));
      if (!enrollment) {
        result.errors.push(`Row ${rowIndex}: student "${email}" is not enrolled in this session.`);
        continue;
      }

      const rawDate = normalizeText(row.attendance_date);
      if (!rawDate) {
        result.errors.push(`Row ${rowIndex}: attendance_date is required.`);
        continue;
      }
      const attendanceDate = normalizeDate(rawDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
        result.errors.push(`Row ${rowIndex}: attendance_date must be a valid date (YYYY-MM-DD or DD/MM/YYYY).`);
        continue;
      }

      const status = normalizeLower(row.status);
      if (!status) {
        result.errors.push(`Row ${rowIndex}: status is required.`);
        continue;
      }
      if (!VALID_STATUSES.has(status)) {
        result.errors.push(`Row ${rowIndex}: status must be one of: on time, absent, late, excused.`);
        continue;
      }

      if (status === 'excused' && !normalizeText(row.excuse_reason)) {
        result.errors.push(`Row ${rowIndex}: excuse_reason is required when status is "excused".`);
        continue;
      }

      const lateMinutes = parseOptionalNumber(row.late_minutes);
      if (status === 'late' && lateMinutes !== null && lateMinutes < 0) {
        result.errors.push(`Row ${rowIndex}: late_minutes must be a positive number.`);
        continue;
      }

      const method = normalizeLower(row.check_in_method) || 'manual';
      if (!VALID_METHODS.has(method)) {
        result.errors.push(`Row ${rowIndex}: check_in_method must be one of: qr_code, photo, manual, bulk.`);
        continue;
      }

      const key = `${enrollment.enrollment_id}|${attendanceDate}`;
      const isUpdate = existingByKey.has(key);

      const record: Record<string, unknown> = {
        enrollment_id: enrollment.enrollment_id,
        student_id: enrollment.student_id,
        session_id: sessionId,
        attendance_date: attendanceDate,
        status,
        notes: normalizeText(row.notes) || null,
        excuse_reason: status === 'excused' ? normalizeText(row.excuse_reason) : null,
        late_minutes: status === 'late' ? (lateMinutes ?? 1) : null,
        check_in_method: method,
        host_address: normalizeText(row.host_address) || null,
        marked_by: markedBy,
        marked_at: new Date().toISOString(),
      };

      // Set check_in_time for present/late statuses
      if (status === 'on time' || status === 'late') {
        record.check_in_time = new Date().toISOString();
      }

      upsertBatch.push(record);

      if (isUpdate) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  // Batch upsert
  if (upsertBatch.length > 0) {
    const { error } = await supabase
      .from(Tables.ATTENDANCE)
      .upsert(upsertBatch, { onConflict: 'enrollment_id,attendance_date', ignoreDuplicates: false });

    if (error) {
      result.errors.push(`Database error: ${error.message}`);
      result.created = 0;
      result.updated = 0;
    }
  }

  return result;
}
