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

// ---------------------------------------------------------------------------
// Column alias map.
// Each key is a canonical import field. The values are all accepted
// normalised header forms (lowercase, spaces → underscores) that map to it.
// This covers the Advanced Export Builder's English labels, Arabic labels,
// the field keys, and template-specific headers.
// ---------------------------------------------------------------------------
const FIELD_ALIASES: Record<string, string[]> = {
  student_name: ['student_name', 'اسم_الطالب', 'name'],
  student_id:   ['student_id', 'رقم_الطالب'],
  student_email: ['student_email', 'email'],
  date:          ['date', 'attendance_date', 'التاريخ'],
  status:        ['status', 'الحالة'],
  late_minutes:  ['late_minutes', 'late_duration_(min)', 'مدة_التأخر'],
  excuse_reason: ['excuse_reason', 'سبب_العذر'],
  check_in_method: ['check_in_method', 'check-in_method', 'طريقة_التسجيل'],
  host_address:  ['host_address', 'عنوان_المضيف'],
  notes:         ['notes', 'ملاحظات'],
};

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

/**
 * Resolve a field value from a row by trying all known aliases.
 */
function resolveField(row: ImportRow, field: string): string {
  const aliases = FIELD_ALIASES[field];
  if (!aliases) return '';
  for (const alias of aliases) {
    const val = row[alias];
    if (val !== undefined && val !== '') return val;
  }
  return '';
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
    .filter((line) => line.length > 0 && !line.startsWith('#'));

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
  // Prefer the "Data" / "البيانات" sheet (export builder puts Summary first)
  const dataSheetName = workbook.SheetNames.find(
    (n) => n === 'Data' || n === 'البيانات',
  ) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[dataSheetName];
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
 * Build an XLSX template pre-populated with enrolled students.
 * Column headers match the Advanced Export Builder "Records" field labels
 * so exported and template files are interchangeable.
 */
export async function buildAttendanceTemplate(sessionId: string) {
  const { data: enrollments } = await supabase
    .from(Tables.ENROLLMENT)
    .select('student:student_id(name)')
    .eq('session_id', sessionId)
    .eq('status', 'active');

  // Headers match the export builder English labels for the Records data type
  const columns = [
    'Student Name',
    'Date',
    'Status',
    'Excuse Reason',
    'Late Duration (min)',
    'Check-in Method',
    'Host Address',
  ];

  type TemplateRow = Record<string, string>;
  const templateRows: TemplateRow[] = [];

  if (enrollments && enrollments.length > 0) {
    const student = Array.isArray(enrollments[0].student)
      ? enrollments[0].student[0]
      : enrollments[0].student;
    templateRows.push({
      'Student Name': (student as { name: string } | null)?.name || 'Student Name',
      'Date': new Date().toISOString().substring(0, 10),
      'Status': 'on time',
      'Excuse Reason': '',
      'Late Duration (min)': '',
      'Check-in Method': 'manual',
      'Host Address': '',
    });
  } else {
    templateRows.push({
      'Student Name': 'Student Name',
      'Date': '2026-01-15',
      'Status': 'on time',
      'Excuse Reason': '',
      'Late Duration (min)': '',
      'Check-in Method': 'manual',
      'Host Address': '',
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(templateRows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  return workbook;
}

/**
 * Import attendance records for a specific session.
 * Resolves students by name, student_id, or email (in that priority order),
 * accepting columns from the Advanced Export Builder or the template.
 */
export async function importAttendance(
  sessionId: string,
  rows: ImportRow[],
): Promise<AttendanceImportResult> {
  const result: AttendanceImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // Load enrolled students with name + email for flexible matching
  const { data: enrollments } = await supabase
    .from(Tables.ENROLLMENT)
    .select('enrollment_id, student_id, student:student_id(name, email)')
    .eq('session_id', sessionId);

  if (!enrollments || enrollments.length === 0) {
    result.errors.push('No enrollments found for this session.');
    return result;
  }

  // Build lookup maps
  const enrollmentByName = new Map<string, { enrollment_id: string; student_id: string } | null>();
  const enrollmentByEmail = new Map<string, { enrollment_id: string; student_id: string }>();
  const enrollmentByStudentId = new Map<string, { enrollment_id: string; student_id: string }>();

  for (const e of enrollments) {
    const student = Array.isArray(e.student) ? e.student[0] : e.student;
    const name = (student as { name: string } | null)?.name;
    const email = (student as { email: string } | null)?.email;
    const enrollData = { enrollment_id: e.enrollment_id, student_id: e.student_id };

    if (name) {
      const key = name.toLowerCase().trim();
      // Mark as null (ambiguous) if duplicate name exists
      enrollmentByName.set(key, enrollmentByName.has(key) ? null : enrollData);
    }
    if (email) {
      enrollmentByEmail.set(email.toLowerCase().trim(), enrollData);
    }
    enrollmentByStudentId.set(e.student_id, enrollData);
  }

  // Load existing attendance for create/update differentiation
  const { data: existingAttendance } = await supabase
    .from(Tables.ATTENDANCE)
    .select('attendance_id, enrollment_id, attendance_date')
    .eq('session_id', sessionId);

  const existingByKey = new Map<string, string>();
  for (const a of existingAttendance || []) {
    existingByKey.set(`${a.enrollment_id}|${a.attendance_date}`, a.attendance_id);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const markedBy = user?.email || 'import';

  const upsertBatch: Record<string, unknown>[] = [];

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2; // +2 for 1-based + header row
    try {
      // --- Resolve student (student_id → email → name) ---
      let enrollment: { enrollment_id: string; student_id: string } | null | undefined;

      const sid = normalizeText(resolveField(row, 'student_id'));
      if (sid) enrollment = enrollmentByStudentId.get(sid);

      if (!enrollment) {
        const email = normalizeLower(resolveField(row, 'student_email'));
        if (email) enrollment = enrollmentByEmail.get(email);
      }

      if (!enrollment) {
        const name = normalizeLower(resolveField(row, 'student_name'));
        if (name) {
          const match = enrollmentByName.get(name);
          if (match === null) {
            result.errors.push(`Row ${rowIndex}: multiple students named "${resolveField(row, 'student_name')}" — include Student ID to disambiguate.`);
            continue;
          }
          enrollment = match;
        }
      }

      if (!enrollment) {
        const ident = resolveField(row, 'student_name') || resolveField(row, 'student_email') || sid || '(empty)';
        result.errors.push(`Row ${rowIndex}: student "${ident}" not enrolled in this session.`);
        continue;
      }

      // --- Resolve date ---
      const rawDate = normalizeText(resolveField(row, 'date'));
      if (!rawDate) {
        result.errors.push(`Row ${rowIndex}: Date is required.`);
        continue;
      }
      const attendanceDate = normalizeDate(rawDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
        result.errors.push(`Row ${rowIndex}: invalid date "${rawDate}" (use YYYY-MM-DD or DD/MM/YYYY).`);
        continue;
      }

      // --- Resolve status ---
      const status = normalizeLower(resolveField(row, 'status'));
      if (!status) {
        result.errors.push(`Row ${rowIndex}: Status is required.`);
        continue;
      }
      if (!VALID_STATUSES.has(status)) {
        result.errors.push(`Row ${rowIndex}: status "${status}" invalid. Use: on time, absent, late, excused.`);
        continue;
      }

      if (status === 'excused' && !normalizeText(resolveField(row, 'excuse_reason'))) {
        result.errors.push(`Row ${rowIndex}: Excuse Reason required when status is "excused".`);
        continue;
      }

      const lateMinutes = parseOptionalNumber(resolveField(row, 'late_minutes'));
      if (status === 'late' && lateMinutes !== null && lateMinutes < 0) {
        result.errors.push(`Row ${rowIndex}: Late Duration must be positive.`);
        continue;
      }

      const method = normalizeLower(resolveField(row, 'check_in_method')) || 'manual';
      if (!VALID_METHODS.has(method)) {
        result.errors.push(`Row ${rowIndex}: check_in_method must be: qr_code, photo, manual, or bulk.`);
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
        notes: normalizeText(resolveField(row, 'notes')) || null,
        excuse_reason: status === 'excused' ? normalizeText(resolveField(row, 'excuse_reason')) : null,
        late_minutes: status === 'late' ? (lateMinutes ?? 1) : null,
        check_in_method: method,
        host_address: normalizeText(resolveField(row, 'host_address')) || null,
        marked_by: markedBy,
        marked_at: new Date().toISOString(),
      };

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
