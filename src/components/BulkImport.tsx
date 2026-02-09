import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { format, parse, isValid } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from './ui/toastUtils';

interface ImportRow {
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

interface ImportResult {
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

interface BulkImportProps {
  onImportComplete: () => void;
}

export function BulkImport({ onImportComplete }: BulkImportProps) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [previewData, setPreviewData] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');

  // Helper function to normalize date format to YYYY-MM-DD
  const normalizeDate = (dateStr: string): string => {
    if (!dateStr) return '';
    
    // Trim and clean the string
    const cleaned = dateStr.trim();
    
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return cleaned;
    }
    
    // Handle Excel numeric dates (days since 1900-01-01)
    if (/^\d+$/.test(cleaned)) {
      try {
        const excelEpoch = new Date(1900, 0, 1);
        const days = parseInt(cleaned, 10) - 2; // Excel has a leap year bug for 1900
        const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
        if (isValid(date)) {
          return format(date, 'yyyy-MM-dd');
        }
      } catch {
        // Fall through
      }
    }
    
    // Try DD/MM/YYYY or DD-MM-YYYY format (most common international format)
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(cleaned)) {
      const parts = cleaned.split(/[/-]/);
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);
      const year = parts[2];
      
      // If first part > 12, it must be day (DD/MM/YYYY)
      if (first > 12) {
        const day = first.toString().padStart(2, '0');
        const month = second.toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      // If second part > 12, format is MM/DD/YYYY
      else if (second > 12) {
        const month = first.toString().padStart(2, '0');
        const day = second.toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      // Ambiguous case: try to parse as M/d/yyyy
      else {
        try {
          const date = parse(cleaned, 'M/d/yyyy', new Date());
          if (isValid(date)) {
            return format(date, 'yyyy-MM-dd');
          }
        } catch {
          // If parsing fails, assume DD/MM/YYYY (international standard)
          const day = first.toString().padStart(2, '0');
          const month = second.toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
      }
    }
    
    return cleaned;
  };

  const parseCSV = (text: string): ImportRow[] => {
    const lines = text.split('\n').filter(line => {
      const trimmed = line.trim();
      // Filter out empty lines and comment lines (starting with #)
      return trimmed && !trimmed.startsWith('#');
    });
    if (lines.length < 2) return [];

    // Detect delimiter: check if first line has tabs or commas
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    
    // Parse CSV with proper quote handling
    const parseLine = (line: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          // Handle escaped quotes ("")
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    };
    
    const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const rows: ImportRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      const mappedRow = mapRowToImportRow(row);
      if (mappedRow) rows.push(mappedRow);
    }

    return rows;
  };

  const parseExcel = (buffer: ArrayBuffer): ImportRow[] => {
    try {
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { raw: false }) as Record<string, string>[];

      const rows: ImportRow[] = [];
      for (const row of jsonData) {
        // Normalize header names: convert to lowercase and replace spaces with underscores
        const normalizedRow: Record<string, string> = {};
        Object.keys(row).forEach(key => {
          const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
          normalizedRow[normalizedKey] = row[key] || '';
        });

        const mappedRow = mapRowToImportRow(normalizedRow);
        if (mappedRow) rows.push(mappedRow);
      }

      return rows;
    } catch (error) {
      console.error('Failed to parse Excel file:', error);
      throw new Error('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    }
  };

  const mapRowToImportRow = (row: Record<string, string>): ImportRow | null => {
    // Skip empty rows
    if (!row['student_name'] && !row['studentname'] && !row['student_email'] && !row['studentemail']) {
      return null;
    }

    return {
      studentName: row['student_name'] || row['studentname'] || '',
      studentEmail: row['student_email'] || row['studentemail'] || '',
      studentPhone: row['student_phone'] || row['studentphone'] || undefined,
      courseName: row['course_name'] || row['coursename'] || '',
      courseCategory: row['course_category'] || row['coursecategory'] || row['category'] || undefined,
      instructorName: row['instructor_name'] || row['instructorname'] || row['teacher_name'] || '',
      instructorEmail: row['instructor_email'] || row['instructoremail'] || row['teacher_email'] || '',
      instructorPhone: row['instructor_phone'] || row['instructorphone'] || row['teacher_phone'] || undefined,
      sessionStartDate: normalizeDate(row['session_start_date'] || row['start_date'] || row['startdate'] || ''),
      sessionEndDate: normalizeDate(row['session_end_date'] || row['end_date'] || row['enddate'] || ''),
      sessionDay: row['session_day'] || row['day'] || undefined,
      sessionTime: row['session_time'] || row['time'] || undefined,
      sessionLocation: row['session_location'] || row['location'] || undefined,
      attendanceDate: normalizeDate(row['attendance_date'] || row['date'] || ''),
      status: (row['status'] || 'present').toLowerCase() as 'present' | 'absent' | 'late' | 'excused',
      gpsLatitude: row['gps_latitude'] || row['latitude'] ? parseFloat(row['gps_latitude'] || row['latitude']) : undefined,
      gpsLongitude: row['gps_longitude'] || row['longitude'] ? parseFloat(row['gps_longitude'] || row['longitude']) : undefined,
      gpsAccuracy: row['gps_accuracy'] || row['accuracy'] ? parseFloat(row['gps_accuracy'] || row['accuracy']) : undefined,
      gpsTimestamp: row['gps_timestamp'] || row['timestamp'] || undefined,
      hostAddress: row['host_address'] || row['hostaddress'] || row['address'] || undefined,
      notes: row['notes'] || undefined,
      canHost: row['can_host'] || row['canhost'] || row['host'] || undefined,
      excuseReason: row['excuse_reason'] || row['excusereason'] || row['reason'] || undefined,
      hostDate: normalizeDate(row['host_date'] || row['hostdate'] || row['hosting_date'] || ''),
      lateMinutes: row['late_minutes'] || row['lateminutes'] || row['late_duration'] ? parseInt(row['late_minutes'] || row['lateminutes'] || row['late_duration'], 10) || undefined : undefined,
      earlyMinutes: row['early_minutes'] || row['earlyminutes'] || row['early_duration'] ? parseInt(row['early_minutes'] || row['earlyminutes'] || row['early_duration'], 10) || undefined : undefined,
      checkInMethod: row['check_in_method'] || row['checkinmethod'] || row['method'] || undefined,
    };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File is too large. Maximum file size is 10MB.');
      event.target.value = '';
      return;
    }

    setResult(null);
    setFileName(file.name);

    try {
      let rows: ImportRow[] = [];
      
      // Check file type and parse accordingly
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Parse Excel file
        const buffer = await file.arrayBuffer();
        rows = parseExcel(buffer);
      } else if (fileExtension === 'csv') {
        // Parse CSV file
        const text = await file.text();
        rows = parseCSV(text);
      } else {
        throw new Error('Unsupported file format. Please upload a .csv or .xlsx file.');
      }

      if (rows.length === 0) {
        throw new Error('No valid data found in file');
      }

      // Show preview instead of importing immediately
      setPreviewData(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to read file: ${errorMessage}`);
      setPreviewData(null);
    } finally {
      event.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;

    setImporting(true);
    setResult(null);

    try {
      const importResult = await processImport(previewData);
      setResult(importResult);

      if (importResult.success) {
        onImportComplete();
      }
      setPreviewData(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setResult({
        success: false,
        message: `Import failed: ${errorMessage}`,
        teachersCreated: 0,
        studentsCreated: 0,
        coursesCreated: 0,
        sessionsCreated: 0,
        enrollmentsCreated: 0,
        attendanceCreated: 0,
        errors: [errorMessage],
      });
    } finally {
      setImporting(false);
    }
  };

  const handleCancelPreview = () => {
    setPreviewData(null);
    setFileName('');
  };

  const processImport = async (rows: ImportRow[]): Promise<ImportResult> => {
    const result: ImportResult = {
      success: true,
      message: '',
      teachersCreated: 0,
      studentsCreated: 0,
      coursesCreated: 0,
      sessionsCreated: 0,
      enrollmentsCreated: 0,
      attendanceCreated: 0,
      errors: [],
    };

    // Cache for created/existing entities
    const teacherCache = new Map<string, string>(); // email -> teacher_id
    const studentCache = new Map<string, string>(); // email -> student_id
    const courseCache = new Map<string, string>(); // course_name -> course_id
    const sessionCache = new Map<string, string>(); // unique key -> session_id
    const enrollmentCache = new Set<string>(); // student_id-session_id

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because: 0-indexed + header row

      try {
        // 1. Get or create teacher
        let teacherId = teacherCache.get(row.instructorEmail);
        if (!teacherId) {
          const { data: existingTeacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .eq('email', row.instructorEmail)
            .maybeSingle();

          if (existingTeacher) {
            teacherId = existingTeacher.teacher_id;
          } else {
            const { data: newTeacher, error } = await supabase
              .from('teacher')
              .insert({
                name: row.instructorName,
                email: row.instructorEmail,
                phone: row.instructorPhone || null,
              })
              .select('teacher_id')
              .single();

            if (error) throw new Error(`Row ${rowNum}: Failed to create teacher - ${error.message}`);
            teacherId = newTeacher.teacher_id;
            result.teachersCreated++;
          }
          teacherCache.set(row.instructorEmail, teacherId!);
        }

        // 2. Get or create course
        const courseKey = `${row.courseName}-${teacherId}`;
        let courseId = courseCache.get(courseKey);
        if (!courseId) {
          const { data: existingCourse } = await supabase
            .from('course')
            .select('course_id')
            .eq('course_name', row.courseName)
            .eq('teacher_id', teacherId)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.course_id;
          } else {
            const { data: newCourse, error } = await supabase
              .from('course')
              .insert({
                course_name: row.courseName,
                teacher_id: teacherId,
                category: row.courseCategory || null,
              })
              .select('course_id')
              .single();

            if (error) throw new Error(`Row ${rowNum}: Failed to create course - ${error.message}`);
            courseId = newCourse.course_id;
            result.coursesCreated++;
          }
          courseCache.set(courseKey, courseId!);
        }

        // 3. Get or create session
        const sessionKey = `${courseId}-${row.sessionStartDate}-${row.sessionEndDate}`;
        let sessionId = sessionCache.get(sessionKey);
        if (!sessionId) {
          const { data: existingSession } = await supabase
            .from('session')
            .select('session_id')
            .eq('course_id', courseId)
            .eq('teacher_id', teacherId)
            .eq('start_date', row.sessionStartDate)
            .eq('end_date', row.sessionEndDate)
            .maybeSingle();

          if (existingSession) {
            sessionId = existingSession.session_id;
          } else {
            const { data: newSession, error } = await supabase
              .from('session')
              .insert({
                course_id: courseId,
                teacher_id: teacherId,
                start_date: row.sessionStartDate,
                end_date: row.sessionEndDate,
                day: row.sessionDay || null,
                time: row.sessionTime || null,
                location: row.sessionLocation || null,
              })
              .select('session_id')
              .single();

            if (error) throw new Error(`Row ${rowNum}: Failed to create session - ${error.message}`);
            sessionId = newSession.session_id;
            result.sessionsCreated++;
          }
          sessionCache.set(sessionKey, sessionId!);
        }

        // 4. Get or create student
        let studentId = studentCache.get(row.studentEmail);
        if (!studentId) {
          const { data: existingStudent } = await supabase
            .from('student')
            .select('student_id')
            .eq('email', row.studentEmail)
            .maybeSingle();

          if (existingStudent) {
            studentId = existingStudent.student_id;
          } else {
            const { data: newStudent, error } = await supabase
              .from('student')
              .insert({
                name: row.studentName,
                email: row.studentEmail,
                phone: row.studentPhone || null,
                teacher_id: teacherId,
              })
              .select('student_id')
              .single();

            if (error) throw new Error(`Row ${rowNum}: Failed to create student - ${error.message}`);
            studentId = newStudent.student_id;
            result.studentsCreated++;
          }
          studentCache.set(row.studentEmail, studentId!);
        }

        // 5. Get or create enrollment
        const enrollmentKey = `${studentId}-${sessionId}`;
        if (!enrollmentCache.has(enrollmentKey)) {
          const { data: existingEnrollment } = await supabase
            .from('enrollment')
            .select('enrollment_id')
            .eq('student_id', studentId)
            .eq('session_id', sessionId)
            .maybeSingle();

          if (!existingEnrollment) {
            // parse can_host from import row if provided
            const canHostRaw = row.canHost || '';
            const canHost = /^(1|yes|true|y)$/i.test(String(canHostRaw).trim());
            
            // parse host_date if provided (only relevant when can_host is true)
            const hostDate = row.hostDate || null;

            const { error } = await supabase
              .from('enrollment')
              .insert({
                student_id: studentId,
                session_id: sessionId,
                enrollment_date: row.sessionStartDate,
                status: 'active',
                can_host: canHost,
                host_date: hostDate,
              });

            if (error) throw new Error(`Row ${rowNum}: Failed to create enrollment - ${error.message}`);
            result.enrollmentsCreated++;
          }
          enrollmentCache.add(enrollmentKey);
        }

        // 6. Get enrollment_id
        const { data: enrollment } = await supabase
          .from('enrollment')
          .select('enrollment_id')
          .eq('student_id', studentId)
          .eq('session_id', sessionId)
          .single();

        if (!enrollment) {
          throw new Error(`Row ${rowNum}: Enrollment not found`);
        }

        // 7. Get authenticated user for marked_by
        const { data: { user } } = await supabase.auth.getUser();
        const userEmail = user?.email || 'system';

        // 8. Validate excuse_reason for excused status
        if (row.status === 'excused' && !row.excuseReason) {
          throw new Error(`Row ${rowNum}: excuse_reason is required when status is 'excused'`);
        }
        
        // Convert 'present' to 'on time' to match system conventions
        const actualStatus = row.status === 'present' ? 'on time' : row.status;
        
        // 9. Create attendance record
        const { error: attendanceError } = await supabase
          .from('attendance')
          .insert({
            enrollment_id: enrollment.enrollment_id,
            student_id: studentId,
            session_id: sessionId,
            attendance_date: row.attendanceDate,
            status: actualStatus,
            excuse_reason: row.status === 'excused' ? row.excuseReason : null,
            gps_latitude: row.gpsLatitude || null,
            gps_longitude: row.gpsLongitude || null,
            gps_accuracy: row.gpsAccuracy || null,
            gps_timestamp: row.gpsTimestamp || (row.gpsLatitude ? new Date().toISOString() : null),
            host_address: row.hostAddress || null,
            marked_by: `${userEmail} - bulk import`,
            marked_at: new Date().toISOString(),
            notes: row.notes || null,
            late_minutes: row.lateMinutes || null,
            early_minutes: row.earlyMinutes || null,
            check_in_method: row.checkInMethod || 'bulk',
          });

        if (attendanceError) {
          // Check if it's a duplicate - that's okay, skip it
          if (attendanceError.code === '23505') {
            result.errors.push(`Row ${rowNum}: Attendance already exists (skipped)`);
          } else {
            throw new Error(`Row ${rowNum}: Failed to create attendance - ${attendanceError.message}`);
          }
        } else {
          result.attendanceCreated++;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(errorMessage);
        result.success = false;
      }
    }

    result.message = result.success
      ? `Import completed successfully! Created ${result.attendanceCreated} attendance records.`
      : `Import completed with errors. Created ${result.attendanceCreated} attendance records, but ${result.errors.length} rows failed.`;

    return result;
  };

  const downloadTemplate = () => {
    // Create CSV with proper formatting - clean data ready to use
    const headers = [
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

    // Clean example rows ready to import
    const exampleRows = [
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

    // Build CSV content with proper escaping
    const csvRows = [headers];
    exampleRows.forEach(row => {
      csvRows.push(row.map(cell => {
        // Escape cells containing commas, quotes, or newlines
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }));
    });

    const csvContent = csvRows.map(row => row.join(',')).join('\n');

    // Add BOM for proper UTF-8 encoding in Excel
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance_import_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-900/30">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bulk Import Attendance</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Import attendance records from CSV or Excel file. The system will automatically create teachers, students, courses, sessions, and enrollments as needed.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowInstructions(!showInstructions)}
        >
          {showInstructions ? 'Hide' : 'Show'} Instructions
        </Button>
      </div>

      {showInstructions && (
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
      )}

      <div className="flex gap-3 mb-6">
        <Button onClick={downloadTemplate}>
          📥 Download CSV Template
        </Button>
        <label className="inline-block cursor-pointer">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileUpload}
            disabled={importing}
            className="hidden"
          />
          <span 
            className={`inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white ${
              importing 
                ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 cursor-pointer'
            }`}
          >
            {importing ? '⏳ Importing...' : '📤 Upload CSV/Excel File'}
          </span>
        </label>
      </div>

      {/* Preview Section */}
      {previewData && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300">📋 Preview Import Data</h3>
              <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                File: <span className="font-medium">{fileName}</span> - {previewData.length} records found
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                Review the data below and click "Confirm Import" to proceed or "Cancel" to discard.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancelPreview}>
                ❌ Cancel
              </Button>
              <Button onClick={handleConfirmImport} disabled={importing}>
                {importing ? '⏳ Importing...' : '✅ Confirm Import'}
              </Button>
            </div>
          </div>

          {/* Preview Stats */}
          <div className="bg-white dark:bg-gray-700 rounded-lg p-3 mb-4">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Summary:</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Unique Students:</span>
                <span className="font-bold ml-2 text-blue-600">
                  {new Set(previewData.map(r => r.studentEmail)).size}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Unique Instructors:</span>
                <span className="font-bold ml-2 text-blue-600">
                  {new Set(previewData.map(r => r.instructorEmail)).size}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Unique Courses:</span>
                <span className="font-bold ml-2 text-blue-600">
                  {new Set(previewData.map(r => r.courseName)).size}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Attendance Records:</span>
                <span className="font-bold ml-2 text-blue-600">{previewData.length}</span>
              </div>
            </div>
          </div>

          {/* Preview Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Student</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Course</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Instructor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">GPS</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {previewData.slice(0, 50).map((row, index) => (
                  <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{index + 1}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <div>{row.studentName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{row.studentEmail}</div>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{row.courseName}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <div>{row.instructorName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{row.instructorEmail}</div>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{row.attendanceDate}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        row.status === 'present' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                        row.status === 'absent' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                        row.status === 'late' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        row.status === 'excused' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {row.gpsLatitude && row.gpsLongitude ? '✓' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewData.length > 50 && (
              <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 text-center border-t dark:border-gray-600">
                Showing first 50 of {previewData.length} records
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className={`p-4 rounded-lg border ${result.success ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <h3 className="font-semibold mb-2 dark:text-white">{result.success ? '✅ Import Results' : '⚠️ Import Results'}</h3>
          <p className="mb-3 dark:text-gray-300">{result.message}</p>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3 text-sm">
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Teachers Created:</span>
              <span className="font-bold ml-2 dark:text-white">{result.teachersCreated}</span>
            </div>
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Students Created:</span>
              <span className="font-bold ml-2 dark:text-white">{result.studentsCreated}</span>
            </div>
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Courses Created:</span>
              <span className="font-bold ml-2 dark:text-white">{result.coursesCreated}</span>
            </div>
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Sessions Created:</span>
              <span className="font-bold ml-2 dark:text-white">{result.sessionsCreated}</span>
            </div>
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Enrollments Created:</span>
              <span className="font-bold ml-2 dark:text-white">{result.enrollmentsCreated}</span>
            </div>
            <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Attendance Records:</span>
              <span className="font-bold ml-2 dark:text-white">{result.attendanceCreated}</span>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-white dark:bg-gray-800 p-3 rounded border border-red-200 dark:border-red-800 max-h-40 overflow-y-auto">
              <h4 className="font-semibold text-red-900 dark:text-red-400 mb-2">Errors ({result.errors.length}):</h4>
              <ul className="list-disc list-inside text-sm text-red-800 dark:text-red-400 space-y-1">
                {result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
