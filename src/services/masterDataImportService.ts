import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { teacherService } from './teacherService';
import { studentService } from './studentService';
import { courseService } from './courseService';
import { sessionService } from './sessionService';
import { enrollmentService } from './enrollmentService';
import { Tables } from '../types/database.types';
import { normalizeStudentSpecialization, STUDENT_SPECIALIZATION_OPTIONS } from '../constants/studentSpecializations';

export type MasterImportEntity = 'teachers' | 'students' | 'courses' | 'sessions' | 'enrollments';

type ImportRow = Record<string, string>;

export interface MasterImportConfig {
  entity: MasterImportEntity;
  label: string;
  description: string;
  columns: string[];
  templateRows: ImportRow[];
}

export interface MasterImportResult {
  entity: MasterImportEntity;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const DESCRIPTION_FORMATS = new Set(['markdown', 'plain_text']);
const LEARNING_METHODS = new Set(['face_to_face', 'online', 'hybrid']);
const VIRTUAL_PROVIDERS = new Set(['zoom', 'google_meet', 'microsoft_teams', 'other']);
const RECORDING_VISIBILITIES = new Set(['private_staff', 'course_staff', 'enrolled_students', 'organization', 'public_link']);
const ENROLLMENT_STATUSES = new Set(['active', 'completed', 'dropped', 'pending']);

export const MASTER_IMPORT_CONFIGS: MasterImportConfig[] = [
  {
    entity: 'teachers',
    label: 'Teachers',
    description: 'Create or update instructors by email.',
    columns: ['name', 'email', 'phone', 'address', 'specialization'],
    templateRows: [
      {
        name: 'Dr. Sarah Malik',
        email: 'sarah.malik@example.com',
        phone: '+201000000001',
        address: 'Cairo, Nasr City',
        specialization: 'Computer Science',
      },
    ],
  },
  {
    entity: 'students',
    label: 'Students',
    description: 'Create or update students by email with constrained specialization values.',
    columns: ['name', 'email', 'phone', 'address', 'location', 'nationality', 'age', 'specialization'],
    templateRows: [
      {
        name: 'Ahmed Hassan',
        email: 'ahmed.hassan@example.com',
        phone: '+201000000101',
        address: 'Giza, Dokki',
        location: 'Giza, Egypt',
        nationality: 'Egyptian',
        age: '21',
        specialization: 'Software Engineering',
      },
    ],
  },
  {
    entity: 'courses',
    label: 'Courses',
    description: 'Attach courses to instructors using teacher email.',
    columns: ['course_name', 'category', 'teacher_email', 'description', 'description_format'],
    templateRows: [
      {
        course_name: 'Advanced React',
        category: 'Programming',
        teacher_email: 'sarah.malik@example.com',
        description: 'Hooks, architecture, and production UI delivery.',
        description_format: 'markdown',
      },
    ],
  },
  {
    entity: 'sessions',
    label: 'Sessions',
    description: 'Create or update class sessions using course and teacher identity.',
    columns: [
      'course_name',
      'teacher_email',
      'start_date',
      'end_date',
      'day',
      'time',
      'location',
      'grace_period_minutes',
      'learning_method',
      'virtual_provider',
      'virtual_meeting_link',
      'requires_recording',
      'default_recording_visibility',
    ],
    templateRows: [
      {
        course_name: 'Advanced React',
        teacher_email: 'sarah.malik@example.com',
        start_date: '2026-01-10',
        end_date: '2026-03-28',
        day: 'Saturday',
        time: '18:00-20:00',
        location: 'Main Campus - Lab 2',
        grace_period_minutes: '15',
        learning_method: 'hybrid',
        virtual_provider: 'microsoft_teams',
        virtual_meeting_link: 'https://teams.microsoft.com/l/meetup-join/example',
        requires_recording: 'true',
        default_recording_visibility: 'course_staff',
      },
    ],
  },
  {
    entity: 'enrollments',
    label: 'Enrollments',
    description: 'Connect students to sessions using student email and session identity.',
    columns: [
      'student_email',
      'teacher_email',
      'course_name',
      'session_start_date',
      'session_end_date',
      'enrollment_date',
      'status',
      'can_host',
      'host_date',
    ],
    templateRows: [
      {
        student_email: 'ahmed.hassan@example.com',
        teacher_email: 'sarah.malik@example.com',
        course_name: 'Advanced React',
        session_start_date: '2026-01-10',
        session_end_date: '2026-03-28',
        enrollment_date: '2026-01-10',
        status: 'active',
        can_host: 'false',
        host_date: '',
      },
    ],
  },
];

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeText(value: string | undefined) {
  return (value || '').trim();
}

function normalizeLower(value: string | undefined) {
  return normalizeText(value).toLowerCase();
}

function parseBoolean(value: string | undefined, defaultValue = false) {
  const normalized = normalizeLower(value);
  if (!normalized) return defaultValue;
  return ['true', '1', 'yes', 'y'].includes(normalized);
}

function parseOptionalNumber(value: string | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredDate(value: string | undefined, field: string, rowIndex: number) {
  const normalized = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Row ${rowIndex}: ${field} must be in YYYY-MM-DD format.`);
  }
  return normalized;
}

function getRequired(row: ImportRow, field: string, rowIndex: number) {
  const value = normalizeText(row[field]);
  if (!value) {
    throw new Error(`Row ${rowIndex}: ${field} is required.`);
  }
  return value;
}

export async function parseImportFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return rows
    .map((row) => {
      const normalized: ImportRow = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[normalizeHeader(key)] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      });
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => normalizeText(value).length > 0));
}

export function buildImportTemplate(entity: MasterImportEntity) {
  const config = MASTER_IMPORT_CONFIGS.find((item) => item.entity === entity);
  if (!config) throw new Error(`Unsupported import entity: ${entity}`);

  const worksheet = XLSX.utils.json_to_sheet(config.templateRows, {
    header: config.columns,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, config.label);
  return workbook;
}

export async function importMasterData(entity: MasterImportEntity, rows: ImportRow[]): Promise<MasterImportResult> {
  switch (entity) {
    case 'teachers':
      return importTeachers(rows);
    case 'students':
      return importStudents(rows);
    case 'courses':
      return importCourses(rows);
    case 'sessions':
      return importSessions(rows);
    case 'enrollments':
      return importEnrollments(rows);
    default:
      throw new Error(`Unsupported import entity: ${entity}`);
  }
}

async function importTeachers(rows: ImportRow[]): Promise<MasterImportResult> {
  const { data: teachers } = await supabase.from(Tables.TEACHER).select('*');
  const existingByEmail = new Map((teachers || []).map((teacher) => [normalizeLower(teacher.email), teacher]));
  const result: MasterImportResult = { entity: 'teachers', created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2;
    try {
      const email = getRequired(row, 'email', rowIndex);
      const payload = {
        name: getRequired(row, 'name', rowIndex),
        email,
        phone: normalizeText(row.phone) || null,
        address: normalizeText(row.address) || null,
        specialization: normalizeText(row.specialization) || null,
      };

      const existing = existingByEmail.get(normalizeLower(email));
      const response = existing
        ? await teacherService.update(existing.teacher_id, payload)
        : await teacherService.create(payload);

      if (response.error) throw response.error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  return result;
}

async function importStudents(rows: ImportRow[]): Promise<MasterImportResult> {
  const { data: students } = await supabase.from(Tables.STUDENT).select('*');
  const existingByEmail = new Map((students || []).map((student) => [normalizeLower(student.email), student]));
  const result: MasterImportResult = { entity: 'students', created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2;
    try {
      const email = getRequired(row, 'email', rowIndex);
      const specializationValue = normalizeText(row.specialization);
      const specialization = specializationValue ? normalizeStudentSpecialization(specializationValue) : null;
      if (specializationValue && !specialization) {
        throw new Error(`Row ${rowIndex}: specialization must be one of ${STUDENT_SPECIALIZATION_OPTIONS.join(', ')}.`);
      }

      const age = parseOptionalNumber(row.age);
      if (normalizeText(row.age) && age === null) {
        throw new Error(`Row ${rowIndex}: age must be numeric.`);
      }

      const payload = {
        name: getRequired(row, 'name', rowIndex),
        email,
        phone: normalizeText(row.phone) || null,
        address: normalizeText(row.address) || null,
        location: normalizeText(row.location) || null,
        nationality: normalizeText(row.nationality) || null,
        age,
        specialization,
        photo_url: null,
      };

      const existing = existingByEmail.get(normalizeLower(email));
      const response = existing
        ? await studentService.update(existing.student_id, payload)
        : await studentService.create(payload);

      if (response.error) throw response.error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  return result;
}

async function importCourses(rows: ImportRow[]): Promise<MasterImportResult> {
  const [{ data: teachers }, { data: courses }] = await Promise.all([
    supabase.from(Tables.TEACHER).select('teacher_id, email'),
    supabase.from(Tables.COURSE).select('course_id, course_name, teacher_id'),
  ]);

  const teacherByEmail = new Map((teachers || []).map((teacher) => [normalizeLower(teacher.email), teacher.teacher_id]));
  const courseByKey = new Map(
    (courses || []).map((course) => [`${normalizeLower(course.course_name)}|${course.teacher_id || ''}`, course]),
  );
  const result: MasterImportResult = { entity: 'courses', created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2;
    try {
      const teacherEmail = getRequired(row, 'teacher_email', rowIndex);
      const teacherId = teacherByEmail.get(normalizeLower(teacherEmail));
      if (!teacherId) throw new Error(`Row ${rowIndex}: teacher_email does not match an existing teacher.`);

      const descriptionFormat = normalizeText(row.description_format) || 'markdown';
      if (!DESCRIPTION_FORMATS.has(descriptionFormat)) {
        throw new Error(`Row ${rowIndex}: description_format must be markdown or plain_text.`);
      }

      const courseName = getRequired(row, 'course_name', rowIndex);
      const payload = {
        course_name: courseName,
        category: getRequired(row, 'category', rowIndex),
        teacher_id: teacherId,
        description: normalizeText(row.description) || null,
        description_format: descriptionFormat as 'markdown' | 'plain_text',
      };

      const existing = courseByKey.get(`${normalizeLower(courseName)}|${teacherId}`);
      const response = existing
        ? await courseService.update(existing.course_id, payload)
        : await courseService.create(payload);

      if (response.error) throw response.error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  return result;
}

async function importSessions(rows: ImportRow[]): Promise<MasterImportResult> {
  const [{ data: teachers }, { data: courses }, { data: sessions }] = await Promise.all([
    supabase.from(Tables.TEACHER).select('teacher_id, email'),
    supabase.from(Tables.COURSE).select('course_id, course_name, teacher_id'),
    supabase.from(Tables.SESSION).select('session_id, course_id, teacher_id, start_date, end_date'),
  ]);

  const teacherByEmail = new Map((teachers || []).map((teacher) => [normalizeLower(teacher.email), teacher.teacher_id]));
  const courseByKey = new Map(
    (courses || []).map((course) => [`${normalizeLower(course.course_name)}|${course.teacher_id || ''}`, course.course_id]),
  );
  const sessionByKey = new Map(
    (sessions || []).map((session) => [`${session.course_id}|${session.teacher_id}|${session.start_date}|${session.end_date}`, session]),
  );
  const result: MasterImportResult = { entity: 'sessions', created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2;
    try {
      const teacherEmail = getRequired(row, 'teacher_email', rowIndex);
      const teacherId = teacherByEmail.get(normalizeLower(teacherEmail));
      if (!teacherId) throw new Error(`Row ${rowIndex}: teacher_email does not match an existing teacher.`);

      const courseName = getRequired(row, 'course_name', rowIndex);
      const courseId = courseByKey.get(`${normalizeLower(courseName)}|${teacherId}`);
      if (!courseId) throw new Error(`Row ${rowIndex}: course_name does not match an existing course for the teacher.`);

      const startDate = parseRequiredDate(row.start_date, 'start_date', rowIndex);
      const endDate = parseRequiredDate(row.end_date, 'end_date', rowIndex);
      const learningMethod = normalizeText(row.learning_method) || 'face_to_face';
      if (!LEARNING_METHODS.has(learningMethod)) {
        throw new Error(`Row ${rowIndex}: learning_method must be face_to_face, online, or hybrid.`);
      }

      const virtualProvider = normalizeText(row.virtual_provider) || null;
      if (virtualProvider && !VIRTUAL_PROVIDERS.has(virtualProvider)) {
        throw new Error(`Row ${rowIndex}: virtual_provider is invalid.`);
      }

      const visibility = normalizeText(row.default_recording_visibility) || 'course_staff';
      if (!RECORDING_VISIBILITIES.has(visibility)) {
        throw new Error(`Row ${rowIndex}: default_recording_visibility is invalid.`);
      }

      const gracePeriod = parseOptionalNumber(row.grace_period_minutes);
      const payload = {
        course_id: courseId,
        teacher_id: teacherId,
        start_date: startDate,
        end_date: endDate,
        day: normalizeText(row.day) || null,
        time: normalizeText(row.time) || null,
        location: normalizeText(row.location) || null,
        grace_period_minutes: gracePeriod ?? 15,
        learning_method: learningMethod as 'face_to_face' | 'online' | 'hybrid',
        virtual_provider: learningMethod === 'face_to_face' ? null : (virtualProvider as 'zoom' | 'google_meet' | 'microsoft_teams' | 'other' | null),
        virtual_meeting_link: learningMethod === 'face_to_face' ? null : (normalizeText(row.virtual_meeting_link) || null),
        requires_recording: parseBoolean(row.requires_recording),
        default_recording_visibility: visibility as 'private_staff' | 'course_staff' | 'enrolled_students' | 'organization' | 'public_link',
      };

      const existing = sessionByKey.get(`${courseId}|${teacherId}|${startDate}|${endDate}`);
      const response = existing
        ? await sessionService.update(existing.session_id, payload)
        : await sessionService.create(payload);

      if (response.error) throw response.error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  return result;
}

async function importEnrollments(rows: ImportRow[]): Promise<MasterImportResult> {
  const [{ data: students }, { data: teachers }, { data: sessions }, { data: enrollments }] = await Promise.all([
    supabase.from(Tables.STUDENT).select('student_id, email'),
    supabase.from(Tables.TEACHER).select('teacher_id, email'),
    supabase.from(Tables.SESSION).select('session_id, teacher_id, start_date, end_date, course:course_id(course_name)'),
    supabase.from(Tables.ENROLLMENT).select('enrollment_id, student_id, session_id'),
  ]);

  const studentByEmail = new Map((students || []).map((student) => [normalizeLower(student.email), student.student_id]));
  const teacherByEmail = new Map((teachers || []).map((teacher) => [normalizeLower(teacher.email), teacher.teacher_id]));
  const sessionByKey = new Map(
    (sessions || []).map((session) => {
      const course = Array.isArray(session.course) ? session.course[0] : session.course;
      return [`${normalizeLower(course?.course_name || '')}|${session.teacher_id}|${session.start_date}|${session.end_date}`, session.session_id];
    }),
  );
  const enrollmentByKey = new Map(
    (enrollments || []).map((enrollment) => [`${enrollment.student_id}|${enrollment.session_id}`, enrollment]),
  );
  const result: MasterImportResult = { entity: 'enrollments', created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowIndex = index + 2;
    try {
      const studentEmail = getRequired(row, 'student_email', rowIndex);
      const teacherEmail = getRequired(row, 'teacher_email', rowIndex);
      const courseName = getRequired(row, 'course_name', rowIndex);
      const studentId = studentByEmail.get(normalizeLower(studentEmail));
      const teacherId = teacherByEmail.get(normalizeLower(teacherEmail));
      if (!studentId) throw new Error(`Row ${rowIndex}: student_email does not match an existing student.`);
      if (!teacherId) throw new Error(`Row ${rowIndex}: teacher_email does not match an existing teacher.`);

      const sessionStartDate = parseRequiredDate(row.session_start_date, 'session_start_date', rowIndex);
      const sessionEndDate = parseRequiredDate(row.session_end_date, 'session_end_date', rowIndex);
      const sessionId = sessionByKey.get(`${normalizeLower(courseName)}|${teacherId}|${sessionStartDate}|${sessionEndDate}`);
      if (!sessionId) {
        throw new Error(`Row ${rowIndex}: session could not be found for the supplied teacher, course, and dates.`);
      }

      const status = normalizeText(row.status) || 'active';
      if (!ENROLLMENT_STATUSES.has(status)) {
        throw new Error(`Row ${rowIndex}: status must be active, completed, dropped, or pending.`);
      }

      const payload = {
        student_id: studentId,
        session_id: sessionId,
        enrollment_date: parseRequiredDate(row.enrollment_date || sessionStartDate, 'enrollment_date', rowIndex),
        status: status as 'active' | 'completed' | 'dropped' | 'pending',
        can_host: parseBoolean(row.can_host),
        host_date: normalizeText(row.host_date) ? parseRequiredDate(row.host_date, 'host_date', rowIndex) : null,
      };

      const existing = enrollmentByKey.get(`${studentId}|${sessionId}`);
      const response = existing
        ? await enrollmentService.update(existing.enrollment_id, payload)
        : await enrollmentService.create(payload);

      if (response.error) throw response.error;
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Row ${rowIndex}: import failed.`);
    }
  }

  return result;
}