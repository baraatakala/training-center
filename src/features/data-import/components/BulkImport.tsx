import { useState } from 'react';
import { authService } from '@/shared/services/authService';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';
import type { ImportRow, ImportResult, BulkImportProps } from '@/features/data-import/constants/importConstants';
import { MAX_FILE_SIZE } from '@/features/data-import/constants/importConstants';
import { parseCSV, parseExcel, downloadTemplate } from '@/features/data-import/utils/importHelpers';
import { ImportInstructions } from '@/features/data-import/components/ImportInstructions';
import { ImportPreview } from '@/features/data-import/components/ImportPreview';
import { ImportResults } from '@/features/data-import/components/ImportResults';
import { bulkImportDataService as supabase } from '@/features/data-import/services/bulkImportDataService';

export function BulkImport({ onImportComplete }: BulkImportProps) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [previewData, setPreviewData] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
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
        const { data: { user } } = await authService.getCurrentUser();
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

      {showInstructions && <ImportInstructions />}

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
        <ImportPreview
          previewData={previewData}
          fileName={fileName}
          importing={importing}
          onConfirm={handleConfirmImport}
          onCancel={handleCancelPreview}
        />
      )}

      {result && <ImportResults result={result} />}
    </div>
  );
}
