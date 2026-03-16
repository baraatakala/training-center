export const STUDENT_SPECIALIZATION_OPTIONS = [
  'Computer Science',
  'Software Engineering',
  'Information Systems',
  'Data Science',
  'Cybersecurity',
  'Business Administration',
  'Accounting',
  'Finance',
  'Marketing',
  'Economics',
  'Medicine',
  'Pharmacy',
  'Dentistry',
  'Nursing',
  'Civil Engineering',
  'Architecture',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Law',
  'Psychology',
] as const;

export type StudentSpecialization = (typeof STUDENT_SPECIALIZATION_OPTIONS)[number];

const SPECIALIZATION_LOOKUP = new Map(
  STUDENT_SPECIALIZATION_OPTIONS.map((value) => [value.toLowerCase(), value]),
);

export function normalizeStudentSpecialization(value: string | null | undefined): StudentSpecialization | null {
  if (!value) return null;
  const normalized = SPECIALIZATION_LOOKUP.get(value.trim().toLowerCase());
  return normalized || null;
}