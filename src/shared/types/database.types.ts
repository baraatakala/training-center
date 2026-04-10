// Database types generated from Supabase schema

export interface Teacher {
  teacher_id: string;
  name: string;
  phone: string | null;
  email: string;
  address: string | null;
  address_latitude?: number | null;
  address_longitude?: number | null;
  specialization?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Student {
  student_id: string;
  name: string;
  phone: string | null;
  email: string;
  address: string | null;
  location: string | null;
  nationality: string | null;
  age: number | null;
  specialization?: string | null;
  address_latitude?: number | null;
  address_longitude?: number | null;
  // URL to student reference photo for face recognition attendance
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  course_id: string;
  teacher_id: string | null;
  course_name: string;
  category: string | null;
  description?: string | null;
  description_format?: 'markdown' | 'plain_text' | null;
  description_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  session_id: string;
  course_id: string;
  teacher_id: string;
  start_date: string;
  end_date: string;
  day: string | null;
  time: string | null;
  location: string | null;
  grace_period_minutes?: number;
  proximity_radius?: number; // Max distance in meters for check-in (default 50m)
  learning_method?: 'face_to_face' | 'online' | 'hybrid';
  virtual_provider?: 'zoom' | 'google_meet' | 'microsoft_teams' | 'other' | null;
  virtual_meeting_link?: string | null;
  requires_recording?: boolean;
  default_recording_visibility?: 'private_staff' | 'course_staff' | 'enrolled_students' | 'organization' | 'public_link' | null;
  feedback_enabled?: boolean;
  feedback_anonymous_allowed?: boolean;
  teacher_can_host?: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionRecording {
  recording_id: string;
  session_id: string;
  attendance_date: string | null;
  recording_type: 'zoom_recording' | 'google_meet_recording' | 'teacher_mobile_recording' | 'uploaded_recording' | 'external_stream';
  recording_url: string | null;
  recording_storage_location: 'supabase_storage' | 'external_link' | 'streaming_link' | 'provider_managed';
  storage_bucket: string | null;
  storage_path: string | null;
  recording_uploaded_by: string | null;
  recording_visibility: 'private_staff' | 'course_staff' | 'enrolled_students' | 'organization' | 'public_link';
  title: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CourseBookReference {
  reference_id: string;
  course_id: string;
  topic: string;
  start_page: number;
  end_page: number;
  display_order: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionBookCoverage {
  coverage_id: string;
  session_id: string;
  attendance_date: string;
  reference_id: string;
  created_at: string;
  updated_at: string;
}

export interface Location {
  location_id: string;
  location_name: string;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionLocation {
  id: string;
  session_id: string;
  location_id: string;
  date: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  enrollment_id: string;
  student_id: string;
  session_id: string;
  enrollment_date: string;
  status: 'active' | 'completed' | 'dropped' | 'pending';
  // Whether this student has agreed to host sessions at their home
  can_host?: boolean | null;
  // Chosen host date (ISO yyyy-mm-dd format) for scheduling
  host_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  attendance_id: string;
  enrollment_id: string;
  session_id: string;
  attendance_date: string;
  student_id: string;
  // 'pending' is used for UI placeholders before attendance is marked
  status: 'on time' | 'absent' | 'late' | 'excused' | 'not enrolled' | 'pending';
  check_in_time: string | null;
  notes: string | null;
  // Reason for excused absence (sick, abroad, on working, etc.)
  excuse_reason?: string | null;
  // Physical address where the session took place (from host student)
  host_address?: string | null;
  // Tiered late scoring - number of minutes late after grace period
  late_minutes?: number | null;
  // Early arrival tracking - number of minutes early before session start
  early_minutes?: number | null;
  // How the attendance was recorded: qr_code, photo, manual, bulk
  check_in_method?: 'qr_code' | 'photo' | 'manual' | 'bulk' | null;
  // Distance in meters from host location when checked in
  distance_from_host?: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  gps_timestamp: string | null;
  marked_by: string | null;
  marked_at: string | null;
  created_at: string;
  updated_at: string;
}

// Extended types with relations
export interface StudentWithTeacher extends Student {
  teacher?: Teacher;
}

export interface EnrollmentWithDetails extends Enrollment {
  student?: Student;
  session?: SessionWithDetails;
}

export interface SessionWithDetails extends Session {
  course?: Course;
  teacher?: Teacher;
}

export interface SessionLocationWithDetails extends SessionLocation {
  session?: SessionWithDetails;
  location?: Location;
}

export interface AttendanceWithDetails extends Attendance {
  student?: Student;
  enrollment?: Enrollment;
  session_location?: SessionLocationWithDetails;
}

// Create/Update types (without generated fields)
export type CreateTeacher = Omit<Teacher, 'teacher_id' | 'created_at' | 'updated_at'>;
export type UpdateTeacher = Partial<CreateTeacher>;

export type CreateStudent = Omit<Student, 'student_id' | 'created_at' | 'updated_at' | 'teacher_id'>;
export type UpdateStudent = Partial<CreateStudent>;

export type CreateCourse = Omit<Course, 'course_id' | 'created_at' | 'updated_at'>;
export type UpdateCourse = Partial<CreateCourse>;

export type CreateSession = Omit<Session, 'session_id' | 'created_at' | 'updated_at'>;
export type UpdateSession = Partial<CreateSession>;

export type CreateSessionRecording = Omit<SessionRecording, 'recording_id' | 'created_at' | 'updated_at' | 'deleted_at'>;
export type UpdateSessionRecording = Partial<CreateSessionRecording>;

export type CreateCourseBookReference = Omit<CourseBookReference, 'reference_id' | 'created_at' | 'updated_at'>;
export type UpdateCourseBookReference = Partial<CreateCourseBookReference>;

export type CreateSessionBookCoverage = Omit<SessionBookCoverage, 'coverage_id' | 'created_at' | 'updated_at'>;
export type UpdateSessionBookCoverage = Partial<CreateSessionBookCoverage>;

export type CreateLocation = Omit<Location, 'location_id' | 'created_at' | 'updated_at'>;
export type UpdateLocation = Partial<CreateLocation>;

export type CreateSessionLocation = Omit<SessionLocation, 'id' | 'created_at' | 'updated_at'>;
export type UpdateSessionLocation = Partial<CreateSessionLocation>;

export type CreateEnrollment = Omit<Enrollment, 'enrollment_id' | 'created_at' | 'updated_at'>;
export type UpdateEnrollment = Partial<CreateEnrollment>;

export type CreateAttendance = Omit<Attendance, 'attendance_id' | 'created_at' | 'updated_at'>;
export type UpdateAttendance = Partial<CreateAttendance>;

// Session Date Host - stores host per session+date (single source of truth)
export interface SessionDateHost {
  id: string;
  session_id: string;
  attendance_date: string;
  host_id: string | null;
  host_type: 'student' | 'teacher';
  host_address: string | null;          // nullable: NULL when row exists only for a time override (migration 009)
  host_latitude?: number | null;
  host_longitude?: number | null;
  created_at: string;
  updated_at: string;
}

export type CreateSessionDateHost = Omit<SessionDateHost, 'id' | 'created_at' | 'updated_at'>;
export type UpdateSessionDateHost = Partial<CreateSessionDateHost>;

export interface SessionTimeChange {
  change_id: string;
  session_id: string;
  old_time: string | null;
  new_time: string;
  effective_date: string;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

// ─── Feedback Types ────────────────────────────────────────
export interface FeedbackQuestion {
  id: string;
  session_id: string;
  question_text: string;
  question_type: 'rating' | 'text' | 'emoji' | 'multiple_choice';
  options: string[];
  sort_order: number;
  is_required: boolean;
  attendance_date: string | null;
  created_at: string;
}

export interface SessionFeedback {
  id: string;
  session_id: string;
  attendance_date: string;
  student_id: string | null;
  is_anonymous: boolean;
  overall_rating: number | null;
  comment: string | null;
  responses: Record<string, unknown>;
  check_in_method: string | null;
  created_at: string;
  student_name?: string | null;
}

export interface FeedbackTemplate {
  id: string;
  name: string;
  description: string | null;
  questions: Array<{ type: string; text: string; required: boolean; options?: string[] }>;
  is_default: boolean;
  created_at: string;
}

export interface FeedbackStats {
  totalResponses: number;
  engagedStudents: number;
  enrolledCount: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  responseRate: number;
  datesCovered: number;
  latestResponseDate: string | null;
  recentComments: Array<{ comment: string; rating: number; date: string; is_anonymous: boolean }>;
}

export interface FeedbackDateSummary {
  date: string;
  responses: number;
  uniqueStudents: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  commentCount: number;
  responseRate: number;
}

export interface FeedbackComparison {
  dates: FeedbackDateSummary[];
  bestDate: string | null;
  worstDate: string | null;
  trendDirection: 'improving' | 'declining' | 'stable' | 'insufficient';
  overallAvg: number;
}

// ─── QR / Photo Check-in Types ────────────────────────────
export interface QRSession {
  id: string;
  session_id: string;
  attendance_date: string;
  token: string;
  expires_at: string;
  is_valid: boolean;
  check_in_mode: 'qr_code' | 'photo';
  linked_photo_token: string | null;
  created_at: string;
}

export interface PhotoCheckinSession {
  id: string;
  session_id: string;
  attendance_date: string;
  token: string;
  expires_at: string;
  is_valid: boolean;
  created_at: string;
}

// Database table names
export const Tables = {
  TEACHER: 'teacher',
  TEACHER_HOST_SCHEDULE: 'teacher_host_schedule',
  STUDENT: 'student',
  COURSE_BOOK_REFERENCE: 'course_book_reference',
  SESSION_BOOK_COVERAGE: 'session_book_coverage',
  SESSION_DATE_HOST: 'session_date_host',
  SESSION_TIME_CHANGE: 'session_time_change',
  SESSION_RECORDING: 'session_recording',
  COURSE: 'course',
  SESSION: 'session',
  LOCATION: 'location',
  SESSION_LOCATION: 'session_location',
  ENROLLMENT: 'enrollment',
  ATTENDANCE: 'attendance',
  SESSION_FEEDBACK: 'session_feedback',
  FEEDBACK_QUESTION: 'feedback_question',
  FEEDBACK_TEMPLATE: 'feedback_template',
} as const;
