export const TABLE_ICONS: Record<string, string> = {
  student: '\u{1F393}',
  teacher: '\u{1F468}\u200D\u{1F3EB}',
  course: '\u{1F4DA}',
  session: '\u{1F4C5}',
  enrollment: '\u{1F4CB}',
  attendance: '\u2705',
  session_feedback: '\u{1F49C}',
  feedback_question: '\u{1F9E9}',
  feedback_template: '\u{1F5C2}\uFE0F',
  session_recording: '\u{1F3AC}',
  announcement: '\u{1F4E2}',
  message: '\u{1F4AC}',
};

export const OP_ICONS: Record<string, string> = {
  DELETE: '\u{1F5D1}\uFE0F',
  UPDATE: '\u270F\uFE0F',
  INSERT: '\u2795',
};

/** Key fields to show per table in expanded view (only non-empty values shown) */
export const TABLE_SUMMARY_FIELDS: Record<string, { field: string; label: string }[]> = {
  attendance: [
    { field: 'status', label: 'Status' },
    { field: 'attendance_date', label: 'Date' },
    { field: 'check_in_method', label: 'Method' },
    { field: 'late_minutes', label: 'Late (min)' },
    { field: 'early_minutes', label: 'Early (min)' },
    { field: 'host_address', label: 'Location' },
    { field: 'excuse_reason', label: 'Excuse' },
    { field: 'notes', label: 'Notes' },
  ],
  session_feedback: [
    { field: 'attendance_date', label: 'Date' },
    { field: 'overall_rating', label: 'Rating' },
    { field: 'check_in_method', label: 'Check-In' },
    { field: 'comment', label: 'Comment' },
    { field: 'is_anonymous', label: 'Anonymous' },
  ],
  feedback_question: [
    { field: 'question_text', label: 'Question' },
    { field: 'question_type', label: 'Type' },
    { field: 'is_required', label: 'Required' },
    { field: 'sort_order', label: 'Order' },
  ],
  feedback_template: [
    { field: 'name', label: 'Name' },
    { field: 'description', label: 'Description' },
    { field: 'is_default', label: 'Default' },
  ],
  session_recording: [
    { field: 'attendance_date', label: 'Date' },
    { field: 'recording_url', label: 'Recording URL' },
    { field: 'is_visible_to_students', label: 'Visible To Students' },
    { field: 'recording_uploaded_by', label: 'Uploaded By' },
  ],
  student: [
    { field: 'name', label: 'Name' },
    { field: 'email', label: 'Email' },
    { field: 'phone', label: 'Phone' },
    { field: 'nationality', label: 'Nationality' },
    { field: 'date_of_birth', label: 'Date of Birth' },
  ],
  teacher: [
    { field: 'name', label: 'Name' },
    { field: 'email', label: 'Email' },
    { field: 'phone', label: 'Phone' },
    { field: 'specialization', label: 'Specialization' },
  ],
  course: [
    { field: 'name', label: 'Name' },
    { field: 'course_name', label: 'Course' },
    { field: 'description', label: 'Description' },
    { field: 'start_date', label: 'Start' },
    { field: 'end_date', label: 'End' },
  ],
  session: [
    { field: 'session_date', label: 'Date' },
    { field: 'start_time', label: 'Start' },
    { field: 'end_time', label: 'End' },
    { field: 'location', label: 'Location' },
    { field: 'status', label: 'Status' },
    { field: 'notes', label: 'Notes' },
  ],
  enrollment: [
    { field: 'status', label: 'Status' },
    { field: 'can_host', label: 'Can Host' },
    { field: 'enrollment_date', label: 'Enrolled' },
  ],
  announcement: [
    { field: 'title', label: 'Title' },
    { field: 'content', label: 'Content' },
    { field: 'priority', label: 'Priority' },
  ],
  message: [
    { field: 'subject', label: 'Subject' },
    { field: 'content', label: 'Content' },
  ],
};
