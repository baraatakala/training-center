export interface ImportRow {
  studentName: string;
  studentEmail: string;
  studentPhone?: string;
  courseName: string;
  courseCategory?: string;
  instructorName: string;
  instructorEmail: string;
  instructorPhone?: string;
  sessionStartDate: string;
  sessionEndDate: string;
  sessionDay?: string;
  sessionTime?: string;
  sessionLocation?: string;
  attendanceDate: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAccuracy?: number;
  gpsTimestamp?: string;
  hostAddress?: string;
  notes?: string;
  // Optional: can host column (yes/no/true/1)
  canHost?: string;
  // Excuse reason for excused absences (required when status is 'excused')
  excuseReason?: string;
  // Host date for enrollment (when student is scheduled to host)
  hostDate?: string;
  // Late/early minutes and check-in method
  lateMinutes?: number;
  earlyMinutes?: number;
  checkInMethod?: string;
}

export interface ImportResult {
  success: boolean;
  message: string;
  teachersCreated: number;
  studentsCreated: number;
  coursesCreated: number;
  sessionsCreated: number;
  enrollmentsCreated: number;
  attendanceCreated: number;
  errors: string[];
}

export interface BulkImportProps {
  onImportComplete: () => void;
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const TEMPLATE_HEADERS = [
  'student_name',
  'student_email',
  'student_phone',
  'course_name',
  'course_category',
  'instructor_name',
  'instructor_email',
  'instructor_phone',
  'session_start_date',
  'session_end_date',
  'session_day',
  'session_time',
  'session_location',
  'attendance_date',
  'status',
  'excuse_reason',
  'gps_latitude',
  'gps_longitude',
  'gps_accuracy',
  'gps_timestamp',
  'host_address',
  'notes',
  'can_host',
  'host_date',
  'late_minutes',
  'early_minutes',
  'check_in_method'
];

export const EXAMPLE_ROWS = [
  [
    'John Doe',
    'john@example.com',
    '1234567890',
    'Web Development',
    'Programming',
    'Jane Teacher',
    'jane@example.com',
    '9876543210',
    '2025-01-01',
    '2025-03-31',
    'Monday',
    '09:00-12:00',
    'Main Campus',
    '2025-01-15',
    'present',
    '',
    '25.2048',
    '55.2708',
    '10',
    '2025-01-15T10:30:00Z',
    '123 Main St',
    'Present with GPS',
    'yes',
    '2025-02-01',
    '',
    '',
    'manual'
  ],
  [
    'Mary Smith',
    'mary@example.com',
    '1234567891',
    'Web Development',
    'Programming',
    'Jane Teacher',
    'jane@example.com',
    '9876543210',
    '2025-01-01',
    '2025-03-31',
    'Monday',
    '09:00-12:00',
    'Main Campus',
    '2025-01-22',
    'excused',
    'sick',
    '',
    '',
    '',
    '',
    '456 Oak Ave',
    'Medical appointment',
    'no',
    '',
    '',
    '',
    ''
  ],
  [
    'Bob Johnson',
    'bob@example.com',
    '1234567892',
    'Web Development',
    'Programming',
    'Jane Teacher',
    'jane@example.com',
    '9876543210',
    '2025-01-01',
    '2025-03-31',
    'Monday',
    '09:00-12:00',
    'Main Campus',
    '2025-01-29',
    'late',
    '',
    '25.2050',
    '55.2710',
    '12',
    '2025-01-29T09:15:00Z',
    '789 Elm St',
    'Late arrival',
    'no',
    '',
    '15',
    '',
    'manual'
  ],
  [
    'Sarah Wilson',
    'sarah@example.com',
    '5551234567',
    'Web Development',
    'Programming',
    'Jane Teacher',
    'jane@example.com',
    '9876543210',
    '2025-01-01',
    '2025-03-31',
    'Monday',
    '09:00-12:00',
    'Main Campus',
    '2025-02-05',
    'absent',
    '',
    '',
    '',
    '',
    '',
    '',
    'Unexcused absence',
    '',
    '',
    '',
    '',
    ''
  ],
  [
    'Tom Brown',
    'tom@example.com',
    '5559876543',
    'Web Development',
    'Programming',
    'Jane Teacher',
    'jane@example.com',
    '9876543210',
    '2025-01-01',
    '2025-03-31',
    'Monday',
    '09:00-12:00',
    'Main Campus',
    '2025-02-12',
    'excused',
    'family emergency',
    '',
    '',
    '',
    '',
    '321 Pine St',
    'Notified in advance',
    'yes',
    '2025-03-15',
    '',
    '',
    ''
  ]
];
