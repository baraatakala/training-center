// Database types generated from Supabase schema

export interface Teacher {
  teacher_id: string;
  name: string;
  phone: string | null;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Student {
  student_id: string;
  teacher_id: string | null;
  name: string;
  phone: string | null;
  email: string;
  address: string | null;
  location: string | null;
  nationality: string | null;
  age: number | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  course_id: string;
  teacher_id: string | null;
  course_name: string;
  category: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  attendance_id: string;
  enrollment_id: string;
  session_location_id: string | null;
  session_id: string;
  attendance_date: string;
  student_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  check_in_time: string | null;
  notes: string | null;
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

export type CreateStudent = Omit<Student, 'student_id' | 'created_at' | 'updated_at'>;
export type UpdateStudent = Partial<CreateStudent>;

export type CreateCourse = Omit<Course, 'course_id' | 'created_at' | 'updated_at'>;
export type UpdateCourse = Partial<CreateCourse>;

export type CreateSession = Omit<Session, 'session_id' | 'created_at' | 'updated_at'>;
export type UpdateSession = Partial<CreateSession>;

export type CreateLocation = Omit<Location, 'location_id' | 'created_at' | 'updated_at'>;
export type UpdateLocation = Partial<CreateLocation>;

export type CreateSessionLocation = Omit<SessionLocation, 'id' | 'created_at' | 'updated_at'>;
export type UpdateSessionLocation = Partial<CreateSessionLocation>;

export type CreateEnrollment = Omit<Enrollment, 'enrollment_id' | 'created_at' | 'updated_at'>;
export type UpdateEnrollment = Partial<CreateEnrollment>;

export type CreateAttendance = Omit<Attendance, 'attendance_id' | 'created_at' | 'updated_at'>;
export type UpdateAttendance = Partial<CreateAttendance>;

// Database table names
export const Tables = {
  TEACHER: 'teacher',
  STUDENT: 'student',
  COURSE: 'course',
  SESSION: 'session',
  LOCATION: 'location',
  SESSION_LOCATION: 'session_location',
  ENROLLMENT: 'enrollment',
  ATTENDANCE: 'attendance',
} as const;
