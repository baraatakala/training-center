export function ImportInstructions() {
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
      <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">📋 Import Instructions</h3>
      <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-300">
        <li><strong>Download the clean CSV template</strong> - Contains 5 ready-to-use example rows with all field types</li>
        <li><strong>Edit the template</strong> - Replace example data with your actual attendance records or add new rows</li>
        <li><strong>Required fields:</strong> student_name, student_email, course_name, instructor_name, instructor_email, session_start_date, session_end_date, attendance_date, status</li>
        <li><strong>Optional fields:</strong> student_phone, course_category, instructor_phone, session_day, session_time, session_location, excuse_reason, late_minutes, early_minutes, check_in_method, gps_latitude, gps_longitude, gps_accuracy, gps_timestamp, host_address, notes, can_host, host_date</li>
        <li><strong>Status values:</strong> present, absent, late, excused</li>
        <li><strong>⚠️ excuse_reason is REQUIRED when status='excused'</strong> (valid values: sick, abroad, working, family emergency, other)</li>
        <li><strong>late_minutes:</strong> Number of minutes late (e.g., 15). Only used when status=late</li>
        <li><strong>early_minutes:</strong> Number of minutes early (e.g., 5). Only used when status=present</li>
        <li><strong>check_in_method:</strong> manual, qr_code, photo, or bulk (defaults to 'bulk' if not specified)</li>
        <li><strong>Date format:</strong> YYYY-MM-DD (e.g., 2025-01-15)</li>
        <li><strong>GPS timestamp format:</strong> ISO 8601 (e.g., 2025-01-15T10:30:00Z)</li>
        <li><strong>can_host:</strong> yes/no/true/false/1/0 to indicate if student can host sessions</li>
        <li><strong>host_date:</strong> Date when student is scheduled to host (YYYY-MM-DD, only when can_host=yes)</li>
        <li>The system automatically matches or creates teachers, courses, sessions, students, and enrollments</li>
        <li>Duplicate attendance records are automatically skipped</li>
      </ol>
    </div>
  );
}
