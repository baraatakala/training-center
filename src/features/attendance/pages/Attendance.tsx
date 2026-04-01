import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import '@/features/attendance/styles/win2k.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Select } from '@/shared/components/ui/Select';
import { Skeleton, TableSkeleton } from '@/shared/components/ui/Skeleton';
import { attendancePageService as supabase } from '@/features/attendance/services/attendancePageService';
import { Tables, type Session } from '@/shared/types/database.types';
import { format } from 'date-fns';
import { getAttendanceDateOptions, type DayChange } from '@/shared/utils/attendanceGenerator';
import { sessionService } from '@/features/sessions/services/sessionService';
import { QRCodeModal } from '@/features/checkin/components/QRCodeModal';
import { logDelete, logInsert, logUpdate } from '@/shared/services/auditService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { Breadcrumb } from '@/shared/components/ui/Breadcrumb';
import { excuseRequestService, EXCUSE_REASONS as SERVICE_EXCUSE_REASONS, type ExcuseRequest } from '@/features/excuses/services/excuseRequestService';
import { sessionRecordingService } from '@/features/sessions/services/sessionRecordingService';
import { feedbackService, type FeedbackQuestion, type FeedbackTemplate } from '@/features/feedback/services/feedbackService';

function toTemplateQuestions(questions: Array<Pick<FeedbackQuestion, 'question_type' | 'question_text' | 'is_required' | 'options'>>) {
  return questions.map((question) => ({
    type: question.question_type,
    text: question.question_text,
    required: question.is_required,
    options: question.options?.length ? question.options : undefined,
  }));
}

type AttendanceRecord = {
  attendance_id: string;
  enrollment_id: string;
  student_id: string;
  enrollment_date?: string;
  status: string;
  excuse_reason?: string | null;
  check_in_time: string | null;
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  attendance_date: string;
  host_address?: string | null;
  late_minutes?: number | null;
  student: {
    student_id: string;
    name: string;
    email: string;
  };
};

type HostInfo = {
  student_id: string;
  student_name: string;
  address: string | null;
  host_date: string | null;
  is_active?: boolean;
  is_teacher?: boolean;
  address_latitude?: number | null;
  address_longitude?: number | null;
};

// Use SERVICE_EXCUSE_REASONS from excuseRequestService for the excuse dropdown.
// 'session not held' is set programmatically and not user-selectable.

export function Attendance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const passedDate = searchParams.get('date') || (location.state as { selectedDate?: string })?.selectedDate;
  const [session, setSession] = useState<Session | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);

  // Check if user is a teacher or admin (TEACHERS + ADMINS can access this page)
  useEffect(() => {
    const checkTeacherAccess = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) {
          navigate('/');
          return;
        }

        // Check if user's email exists in teacher table
        const { data: teacher } = await supabase
          .from('teacher')
          .select('teacher_id')
          .ilike('email', user.email)
          .maybeSingle();

        if (teacher) {
          setIsTeacher(true);
          return;
        }

        // Fallback: check admin table (admin should be synced to teacher, but safety net)
        const { data: adminRecord } = await supabase
          .from('admin')
          .select('admin_id')
          .ilike('email', user.email)
          .maybeSingle();

        if (adminRecord) {
          // Admin user — no fake teacher record needed
          setIsTeacher(true);
          return;
        }

        // Not a teacher or admin - redirect to dashboard
        navigate('/');
      } catch (err) {
        console.error('Teacher check failed:', err);
        navigate('/');
      }
    };

    checkTeacherAccess();
  }, [navigate]);

  // Get authenticated user email
  const getCurrentUserEmail = async (): Promise<string> => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user?.email) {
        console.error('Failed to get current user:', error);
        toast.error('Authentication error — please refresh the page');
        return 'unknown';
      }
      return user.email;
    } catch (err) {
      console.error('Auth exception:', err);
      return 'unknown';
    }
  };
  const [availableDates, setAvailableDates] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedDate, setSelectedDate] = useState<string>(passedDate || '');
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [excuseReason, setExcuseReason] = useState<{ [key: string]: string }>({});
  const [excuseDropdownOpen, setExcuseDropdownOpen] = useState<string | null>(null);
  const [hostAddresses, setHostAddresses] = useState<HostInfo[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [hostCoordinates, setHostCoordinates] = useState<{ lat: number; lon: number } | null>(null);
  const [hostDataLoaded, setHostDataLoaded] = useState(false);
  const [sessionNotHeld, setSessionNotHeld] = useState<boolean>(false);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [bookReferences, setBookReferences] = useState<Array<{ reference_id: string; topic: string; start_page: number; end_page: number; parent_id: string | null }>>([]);
  const [selectedBookReference, setSelectedBookReference] = useState<string>('');
  const [editingLateMinutes, setEditingLateMinutes] = useState<string | null>(null);
  const [lateMinutesInput, setLateMinutesInput] = useState<string>('');
  const [confirmClearAttendance, setConfirmClearAttendance] = useState<string | null>(null);
  const [confirmSessionNotHeld, setConfirmSessionNotHeld] = useState<boolean>(false);
  const [confirmUnmarkSessionNotHeld, setConfirmUnmarkSessionNotHeld] = useState<boolean>(false);
  const [confirmClearGPS, setConfirmClearGPS] = useState<{ hostId: string; isTeacher: boolean } | null>(null);

  // Per-date time override loaded from session_date_host.override_time / override_end_time
  const [dateOverrideTime, setDateOverrideTime] = useState<string | null>(null);
  const [dateOverrideEndTime, setDateOverrideEndTime] = useState<string | null>(null);
  // Inline editor state for per-date time override
  const [editingTimeOverride, setEditingTimeOverride] = useState(false);
  const [timeOverrideInput, setTimeOverrideInput] = useState('');
  const [endTimeOverrideInput, setEndTimeOverrideInput] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [pendingExcuseRequests, setPendingExcuseRequests] = useState<ExcuseRequest[]>([]);

  // Recording URL for this attendance date
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [savingRecording, setSavingRecording] = useState(false);

  // Feedback question management
  const [fbQuestions, setFbQuestions] = useState<FeedbackQuestion[]>([]);
  const [fbTemplates, setFbTemplates] = useState<FeedbackTemplate[]>([]);
  const [fbSelectedTemplateId, setFbSelectedTemplateId] = useState('');
  const [fbApplyingTemplate, setFbApplyingTemplate] = useState(false);
  const [fbSavingQuestion, setFbSavingQuestion] = useState(false);
  const [fbEditingQuestionId, setFbEditingQuestionId] = useState<string | null>(null);
  const [showFeedbackSetup, setShowFeedbackSetup] = useState(false);
  const [fbQuestionText, setFbQuestionText] = useState('');
  const [fbQuestionType, setFbQuestionType] = useState<'rating' | 'text' | 'emoji' | 'multiple_choice'>('rating');
  const [fbQuestionRequired, setFbQuestionRequired] = useState(false);
  const [fbOptionsText, setFbOptionsText] = useState('');

  // Memoized attendance stats to avoid re-filtering on every render
  const attendanceStats = useMemo(() => ({
    total: attendance.filter(a => a.status !== 'not enrolled').length,
    onTime: attendance.filter(a => a.status === 'on time').length,
    absent: attendance.filter(a => a.status === 'absent').length,
    late: attendance.filter(a => a.status === 'late').length,
    excused: attendance.filter(a => a.status === 'excused').length,
    pending: attendance.filter(a => a.status === 'pending').length,
    notEnrolled: attendance.filter(a => a.status === 'not enrolled').length,
  }), [attendance]);

  // GPS Geolocation capture function
  const captureGPSLocation = (): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  } | null> => {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        console.warn('Geolocation is not supported by this browser');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString()
          });
        },
        (error) => {
          // GPS is optional for teacher-side attendance. Timeout on desktop (no GPS hardware)
          // is expected — log silently, do not interrupt the teacher's workflow.
          console.warn('GPS location unavailable (non-blocking):', error.message);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  };

  // Calculate late_minutes for tiered late scoring.
  // Uses the student's actual check_in_time when available (from QR/photo/prior check-in).
  // Falls back to the current time only for fresh manual entries with no prior check-in.
  const calculateLateMinutes = (checkInTime?: string | null, forceLate: boolean = true): number | null => {
    const effectiveTime = dateOverrideTime ?? session?.time ?? null;
    if (!effectiveTime || !selectedDate) {
      return forceLate ? 1 : null;
    }
    
    try {
      const timeMatch = effectiveTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!timeMatch) {
        return forceLate ? 1 : null;
      }
      
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3]?.toUpperCase();
      
      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(hours, minutes, 0, 0);
      
      const gracePeriod = session?.grace_period_minutes || 0;
      const graceEnd = new Date(sessionStart.getTime() + gracePeriod * 60 * 1000);
      
      // Prefer the student's recorded check-in time over the current clock.
      // This ensures that if a student checked in via QR at 15:19 but the teacher
      // is clicking "late" at 15:16, we calculate against the actual arrival time.
      const referenceTime = checkInTime ? new Date(checkInTime) : new Date();
      
      if (referenceTime > graceEnd) {
        const lateMs = referenceTime.getTime() - graceEnd.getTime();
        const lateMinutes = Math.round(lateMs / (1000 * 60)); // round, not ceil
        return Math.max(1, lateMinutes);
      }
      return forceLate ? 1 : null;
    } catch {
      console.error('Error calculating late minutes');
      return forceLate ? 1 : null;
    }
  };

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      setError(null);
      const { data, error: sessionError } = await supabase
        .from(Tables.SESSION)
        .select(`
          *,
          course:course_id(course_id, course_name)
        `)
        .eq('session_id', sessionId)
        .single();

      if (sessionError) {
        setError('Failed to load session: ' + sessionError.message);
        setLoading(false);
        return;
      }

      if (data) {
      setSession(data);
      
      // Load book references for this course
      if (data.course && !Array.isArray(data.course)) {
        const { data: references } = await supabase
          .from(Tables.COURSE_BOOK_REFERENCE)
          .select('reference_id, topic, start_page, end_page, parent_id')
          .eq('course_id', data.course.course_id)
          .order('start_page', { ascending: true });
        
        if (references) {
          setBookReferences(references);
        }
      }
      
      // Generate attendance dates based on session schedule (with day-change history)
      let dayChanges: DayChange[] = [];
      try {
        const { data: changes } = await sessionService.getDayChangeHistory(sessionId!);
        if (changes) dayChanges = changes;
      } catch { /* non-critical */ }
      const dates = getAttendanceDateOptions(data, dayChanges);
      setAvailableDates(dates);
      
      // If a date was passed via navigation, use it; otherwise select the date nearest to today
      if (!passedDate) {
        const today = new Date();
        // Find the available date with the smallest absolute difference to today
        let nearest = dates[0]?.value || '';
        let minDiff = Number.POSITIVE_INFINITY;
        for (const d of dates) {
          try {
            const dt = new Date(d.value + 'T00:00:00');
            const diff = Math.abs(dt.getTime() - today.getTime());
            if (diff < minDiff) {
              minDiff = diff;
              nearest = d.value;
            }
          } catch (error) {
            // ignore parse errors
            console.debug('Date parse error:', error);
          }
        }
        setSelectedDate(nearest);
      }
      // If passedDate exists, it's already set in the initial state
    }
    setLoading(false);
    } catch (err) {
      setError('Unexpected error loading session: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setLoading(false);
    }
  }, [sessionId, passedDate]);

  const loadHostAddresses = useCallback(async () => {
    if (!sessionId) return;

    try {
      // Load session teacher and enrolled hosts in parallel
      const [sessionResult, enrollmentResult] = await Promise.all([
        supabase
          .from(Tables.SESSION)
          .select(`
            teacher_id,
            teacher_can_host,
            teacher:teacher_id (
              teacher_id,
              name,
              address,
              address_latitude,
              address_longitude
            )
          `)
          .eq('session_id', sessionId)
          .single(),
        supabase
          .from(Tables.ENROLLMENT)
          .select(`
            student_id,
            can_host,
            host_date,
            student:student_id (
              student_id,
              name,
              address,
              address_latitude,
              address_longitude
            )
          `)
          .eq('session_id', sessionId)
          .eq('status', 'active')
          .eq('can_host', true),
      ]);

      const sessionData = sessionResult.data;
      if (sessionResult.error) {
        console.error('Error loading session teacher:', sessionResult.error);
        toast.error('Failed to load session teacher data');
      }

      if (enrollmentResult.error) {
        console.error('Error loading enrolled hosts:', enrollmentResult.error);
        toast.error('Failed to load host addresses');
        setHostAddresses([]);
        return;
      }

      const enrollments = enrollmentResult.data;

      // Filter students with addresses
      const hostsWithAddresses = (enrollments || [])
        .filter(e => {
          const student = Array.isArray(e.student) ? e.student[0] : e.student;
          return student?.address && student.address.trim() !== '';
        })
        .map(e => {
          const student = Array.isArray(e.student) ? e.student[0] : e.student;
          return {
            student_id: student.student_id,
            student_name: student.name,
            address: student.address,
            host_date: e.host_date || null,
            is_active: true,
            is_teacher: false,
            address_latitude: student.address_latitude ? Number(student.address_latitude) : null,
            address_longitude: student.address_longitude ? Number(student.address_longitude) : null
          };
        });
    
    // Add teacher as first option only if teacher_can_host is enabled and they have address
    const teacherCanHost = sessionData?.teacher_can_host !== false; // default true if not set
    const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
    if (teacherCanHost && teacher?.address && teacher.address.trim() !== '') {
      // Load teacher's host_date from teacher_host_schedule
      const { data: teacherHostData } = await supabase
        .from('teacher_host_schedule')
        .select('host_date')
        .eq('teacher_id', teacher.teacher_id)
        .eq('session_id', sessionId)
        .maybeSingle();

      hostsWithAddresses.unshift({
        student_id: teacher.teacher_id,
        student_name: `🎓 ${teacher.name} (Teacher)`,
        address: teacher.address,
        host_date: teacherHostData?.host_date || null,
        is_active: true,
        is_teacher: true,
        address_latitude: teacher.address_latitude ? Number(teacher.address_latitude) : null,
        address_longitude: teacher.address_longitude ? Number(teacher.address_longitude) : null
      });
    }
    
    // Sort student hosts alphabetically (teacher already at top)
    const teacherHost = hostsWithAddresses.filter(h => h.student_name.includes('Teacher'));
    const studentHosts = hostsWithAddresses.filter(h => !h.student_name.includes('Teacher'));
    studentHosts.sort((a, b) => a.student_name.localeCompare(b.student_name));
    
    setHostAddresses([...teacherHost, ...studentHosts]);
    } catch (err) {
      console.error('Unexpected error loading host addresses:', err);
      toast.error('Unexpected error loading host addresses');
      setHostAddresses([]);
    }
  }, [sessionId]);

  const loadAttendance = useCallback(async () => {
    if (!sessionId || !selectedDate) return;

    try {
      // Load host data and attendance records in parallel (independent queries)
      const [hostResult, attendanceResult] = await Promise.all([
        supabase
          .from(Tables.SESSION_DATE_HOST)
          .select('host_id, host_type, host_address, override_time, override_end_time')
          .eq('session_id', sessionId)
          .eq('attendance_date', selectedDate)
          .maybeSingle(),
        supabase
          .from(Tables.ATTENDANCE)
          .select(`
            attendance_id,
            status,
            excuse_reason,
            check_in_time,
            notes,
            gps_latitude,
            gps_longitude,
            gps_accuracy,
            attendance_date,
            host_address,
            late_minutes,
            student_id,
            student:student_id(student_id, name, email)
          `)
          .eq('session_id', sessionId)
          .eq('attendance_date', selectedDate),
      ]);

      const hostData = hostResult.data;
      const existingAttendance = attendanceResult.data;

      // Store per-date time override (null means use session.time)
      setDateOverrideTime((hostData as { override_time?: string | null } | null)?.override_time ?? null);
      setDateOverrideEndTime((hostData as { override_end_time?: string | null } | null)?.override_end_time ?? null);
      // Reset the inline override editor when navigating to a new date
      setEditingTimeOverride(false);

      if (attendanceResult.error) {
        console.error('Error loading attendance:', attendanceResult.error);
        toast.error('Failed to load attendance records');
        return;
      }

    // Determine host address: prefer session_date_host table, fallback to attendance records
    let savedHostAddress: string | null = null;
    let savedHostId: string | null = null;
    
    if (hostData?.host_address) {
      // New system: load from session_date_host table
      savedHostAddress = hostData.host_address;
      savedHostId = hostData.host_id;
    } else {
      // Fallback: check attendance records (backwards compatibility)
      savedHostAddress = existingAttendance?.find(r => r.host_address)?.host_address || null;
    }
    
    // Check if this date was marked as "Session Not Held"
    const isSessionNotHeld = savedHostAddress === 'SESSION_NOT_HELD';
    
    // Only update selectedAddress if there's a saved value, don't reset if empty
    if (savedHostAddress) {
      if (savedHostAddress === 'SESSION_NOT_HELD') {
        setSessionNotHeld(true);
        setSelectedAddress('SESSION_NOT_HELD');
        setHostCoordinates(null);
      } else if (savedHostId) {
        // We have host_id from new table - use it directly
        setSelectedAddress(`${savedHostId}|||${savedHostAddress}`);
        setSessionNotHeld(false);
        
        // Load coordinates from the host's profile (student or teacher table)
        const isTeacher = hostData?.host_type === 'teacher';
        if (isTeacher) {
          const { data: teacherData } = await supabase
            .from(Tables.TEACHER)
            .select('address_latitude, address_longitude')
            .eq('teacher_id', savedHostId)
            .single();
          if (teacherData?.address_latitude && teacherData?.address_longitude) {
            setHostCoordinates({
              lat: Number(teacherData.address_latitude),
              lon: Number(teacherData.address_longitude)
            });
          } else {
            setHostCoordinates(null);
          }
        } else {
          const { data: studentData } = await supabase
            .from(Tables.STUDENT)
            .select('address_latitude, address_longitude')
            .eq('student_id', savedHostId)
            .single();
          if (studentData?.address_latitude && studentData?.address_longitude) {
            setHostCoordinates({
              lat: Number(studentData.address_latitude),
              lon: Number(studentData.address_longitude)
            });
          } else {
            setHostCoordinates(null);
          }
        }
      } else {
        // Address is saved but no host_id - need to find matching student
        const { data: students, error: studentError } = await supabase
          .from(Tables.STUDENT)
          .select('student_id, address')
          .eq('address', savedHostAddress)
          .limit(1);

        if (students && students.length > 0 && !studentError) {
          // Found match - use proper format
          setSelectedAddress(`${students[0].student_id}|||${savedHostAddress}`);
        } else {
          // No match found - just use plain address (backwards compatibility)
          setSelectedAddress(savedHostAddress);
        }
        setSessionNotHeld(false);
      }
    } else {
      // No saved address - only reset session not held flag, don't touch selectedAddress
      setSessionNotHeld(false);
    }

    // Signal that host data has been loaded — auto-suggest can now safely fire
    setHostDataLoaded(true);

    // Get all enrollments for this session
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        enrollment_id,
        student_id,
        enrollment_date,
        student:student_id(student_id, name, email)
      `)
      .eq('session_id', sessionId)
      .eq('status', 'active');

      if (enrollmentsError) {
        console.error('Error loading enrollments:', enrollmentsError);
        toast.error('Failed to load enrolled students');
        setAttendance([]);
        return;
      }

    if (!enrollments || enrollments.length === 0) {
      setAttendance([]);
      return;
    }

    // Build attendance list: combine enrollments with existing records
    const attendanceList = enrollments.map((enrollment: { enrollment_id: string; student_id: string; enrollment_date: string; student: { student_id: string; name: string; email: string } | { student_id: string; name: string; email: string }[] }) => {
      const existingRecord = existingAttendance?.find(
        (a: { student_id: string }) => a.student_id === enrollment.student_id
      );
      
      // Handle both single object and array from Supabase
      const student = Array.isArray(enrollment.student) ? enrollment.student[0] : enrollment.student;
      
      // Check if attendance date is before enrollment date
      const isBeforeEnrollment = selectedDate < enrollment.enrollment_date;

      if (existingRecord) {
        // If before enrollment, override status to 'not enrolled'
        const finalStatus = isBeforeEnrollment ? 'not enrolled' : existingRecord.status;
        // Return existing attendance record
        const record = {
          ...existingRecord,
          status: finalStatus,
          student: Array.isArray(existingRecord.student) 
            ? existingRecord.student[0] 
            : existingRecord.student,
          enrollment_id: enrollment.enrollment_id
        };
        
        // Populate excuse_reason state if present (but not for 'not enrolled' records)
        if (existingRecord.excuse_reason && !isBeforeEnrollment) {
          setExcuseReason(prev => ({ 
            ...prev, 
            [existingRecord.attendance_id]: existingRecord.excuse_reason 
          }));
        }
        
        // Check if this date was marked as session not held
        if (existingRecord.host_address === 'SESSION_NOT_HELD') {
          setSessionNotHeld(true);
          setSelectedAddress('SESSION_NOT_HELD');
        }
        
        return record;
      } else {
        // Return placeholder (not saved to DB yet)
        // Priority order for status:
        // 1. If before enrollment date: 'not enrolled'
        // 2. If session was marked as not held: 'excused' (with session not held reason)
        // 3. Otherwise: 'pending'
        let placeholderStatus = 'pending';
        let placeholderExcuseReason = null;
        
        if (isBeforeEnrollment) {
          placeholderStatus = 'not enrolled';
        } else if (isSessionNotHeld) {
          // Session was marked as not held - this student should also be excused
          placeholderStatus = 'excused';
          placeholderExcuseReason = 'session not held';
        }
        
        return {
          attendance_id: `temp-${enrollment.student_id}`,
          enrollment_id: enrollment.enrollment_id,
          student_id: enrollment.student_id,
          status: placeholderStatus,
          excuse_reason: placeholderExcuseReason,
          check_in_time: null,
          notes: null,
          gps_latitude: null,
          gps_longitude: null,
          gps_accuracy: null,
          attendance_date: selectedDate,
          student: student
        };
      }
    });

    setAttendance(attendanceList as AttendanceRecord[]);
    
    // Auto-save excused records for newly enrolled students on "Session Not Held" dates
    if (isSessionNotHeld) {
      const newlyEnrolledStudents = attendanceList.filter(
        a => a.attendance_id.startsWith('temp-') && a.status === 'excused'
      );
      
      if (newlyEnrolledStudents.length > 0) {
        const userEmail = await getCurrentUserEmail();
        const newRecords = newlyEnrolledStudents.map(record => ({
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: 'excused',
          excuse_reason: 'session not held',
          host_address: 'SESSION_NOT_HELD',
          check_in_time: null,
          gps_latitude: null,
          gps_longitude: null,
          gps_accuracy: null,
          gps_timestamp: null,
          marked_by: `${userEmail} - auto-excused (session not held)`,
          marked_at: new Date().toISOString()
        }));
        
        const { error: upsertErr } = await supabase.from(Tables.ATTENDANCE).upsert(newRecords, {
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false
        });
        if (upsertErr) {
          console.error('Error auto-excusing newly enrolled:', upsertErr);
          toast.error('Failed to auto-excuse some newly enrolled students');
        }
        // Audit log: bulk auto-excuse for session not held (newly enrolled)
        try { for (const r of newRecords) { await logInsert('attendance', r.enrollment_id, r as Record<string, unknown>, 'Auto-excused: session not held (newly enrolled)'); } } catch { /* audit non-critical */ }
        // Reload to show saved records instead of temp placeholders
        const { data: refreshedAttendance } = await supabase
          .from(Tables.ATTENDANCE)
          .select(`
            attendance_id,
            status,
            excuse_reason,
            check_in_time,
            notes,
            gps_latitude,
            gps_longitude,
            gps_accuracy,
            attendance_date,
            host_address,
            late_minutes,
            student_id,
            student:student_id(student_id, name, email)
          `)
          .eq('session_id', sessionId)
          .eq('attendance_date', selectedDate);
        
        // Rebuild attendance list with saved records
        const updatedList = enrollments.map((enrollment: { enrollment_id: string; student_id: string; enrollment_date: string; student: { student_id: string; name: string; email: string } | { student_id: string; name: string; email: string }[] }) => {
          const savedRecord = refreshedAttendance?.find(
            (a: { student_id: string }) => a.student_id === enrollment.student_id
          );
          
          const student = Array.isArray(enrollment.student) ? enrollment.student[0] : enrollment.student;
          const isBeforeEnrollment = selectedDate < enrollment.enrollment_date;
          
          if (savedRecord) {
            const finalStatus = isBeforeEnrollment ? 'not enrolled' : savedRecord.status;
            return {
              ...savedRecord,
              status: finalStatus,
              student: Array.isArray(savedRecord.student) 
                ? savedRecord.student[0] 
                : savedRecord.student,
              enrollment_id: enrollment.enrollment_id
            };
          }
          
          return attendanceList.find(a => a.student_id === enrollment.student_id) || {
            attendance_id: `temp-${enrollment.student_id}`,
            enrollment_id: enrollment.enrollment_id,
            student_id: enrollment.student_id,
            status: isBeforeEnrollment ? 'not enrolled' : 'pending',
            check_in_time: null,
            notes: null,
            gps_latitude: null,
            gps_longitude: null,
            gps_accuracy: null,
            attendance_date: selectedDate,
            student: student
          };
        });
        
        setAttendance(updatedList as AttendanceRecord[]);
      }
    }
    } catch (err) {
      console.error('Unexpected error loading attendance:', err);
      toast.error('Failed to load attendance data');
      setAttendance([]);
    }
  }, [sessionId, selectedDate]);

  useEffect(() => {
    loadSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, passedDate]);

  // Load pending excuse requests for the current session + date
  const loadPendingExcuseRequests = useCallback(async () => {
    if (!sessionId || !selectedDate) {
      setPendingExcuseRequests([]);
      return;
    }
    try {
      const { data } = await excuseRequestService.getForSessionDate(sessionId, selectedDate);
      setPendingExcuseRequests(data || []);
    } catch {
      // Non-critical
      setPendingExcuseRequests([]);
    }
  }, [sessionId, selectedDate]);

  // Handle approve/reject excuse request directly from attendance page
  const handleExcuseAction = async (requestId: string, action: 'approved' | 'rejected') => {
    const userEmail = await getCurrentUserEmail();
    const { error } = await excuseRequestService.review(requestId, {
      status: action,
      reviewed_by: userEmail,
    });
    if (error) {
      toast.error(`Failed to ${action === 'approved' ? 'approve' : 'reject'} excuse: ${error.message}`);
    } else {
      toast.success(`Excuse request ${action}`);
      // Reload both attendance (approval changes it) and pending requests
      loadAttendance();
      loadPendingExcuseRequests();
    }
  };

  useEffect(() => {
    if (selectedDate) {
      // Reset state before loading new date data
      setSelectedAddress('');
      setHostAddresses([]);  // Clear stale host data to prevent auto-suggest race
      setHostDataLoaded(false);  // Block auto-suggest until loadAttendance confirms host status
      setExcuseReason({});  // Clear stale excuse reasons from previous date
      setSelectedStudents(new Set());  // Clear bulk selection from previous date
      setSessionNotHeld(false);  // Reset until loadAttendance confirms
      loadHostAddresses();
      loadAttendance();
      loadSelectedBookReference();
      loadPendingExcuseRequests();
      loadRecordingForDate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Load feedback questions and templates for the selected attendance date
  useEffect(() => {
    if (!sessionId || !selectedDate) {
      setFbQuestions([]);
      setFbEditingQuestionId(null);
      setFbQuestionText('');
      setFbQuestionType('rating');
      setFbQuestionRequired(false);
      setFbOptionsText('');
      return;
    }

    let cancelled = false;

    async function loadFb() {
      const activeSessionId = sessionId!;
      const activeDate = selectedDate;
      const [qRes, tRes] = await Promise.all([
        feedbackService.getQuestions(activeSessionId, activeDate),
        feedbackService.getTemplates(),
      ]);

      if (cancelled) return;

      setFbQuestions(qRes.data || []);
      setFbTemplates(tRes.data || []);
    }
    loadFb();
    return () => { cancelled = true; };
  }, [sessionId, selectedDate]);

  const syncSelectedTemplate = useCallback(async (questionsToSync: FeedbackQuestion[]) => {
    if (!fbSelectedTemplateId) return;

    const { error } = await feedbackService.updateTemplate(fbSelectedTemplateId, {
      questions: toTemplateQuestions(questionsToSync),
    });

    if (!error) {
      const { data } = await feedbackService.getTemplates();
      if (data) {
        setFbTemplates(data);
      }
    }
  }, [fbSelectedTemplateId]);

  // Feedback handlers
  const handleAddOrUpdateQuestion = useCallback(async () => {
    if (!sessionId || !fbQuestionText.trim()) return;
    setFbSavingQuestion(true);
    const options = fbQuestionType === 'multiple_choice'
      ? fbOptionsText.split(/[,،]/).map(o => o.trim()).filter(Boolean)
      : [];
    if (fbEditingQuestionId) {
      const { error } = await feedbackService.updateQuestion(fbEditingQuestionId, {
        question_text: fbQuestionText.trim(),
        question_type: fbQuestionType,
        is_required: fbQuestionRequired,
        options,
        attendance_date: selectedDate,
      });
      if (error) { toast.error('Failed to update question'); }
      else { toast.success('Question updated'); }
    } else {
      const { error } = await feedbackService.createQuestion({
        session_id: sessionId,
        question_text: fbQuestionText.trim(),
        question_type: fbQuestionType,
        is_required: fbQuestionRequired,
        options,
        sort_order: fbQuestions.length + 1,
        attendance_date: selectedDate,
      });
      if (error) { toast.error('Failed to add question'); }
      else { toast.success('Question added'); }
    }

    // Reset form
    setFbEditingQuestionId(null);
    setFbQuestionText('');
    setFbQuestionType('rating');
    setFbQuestionRequired(false);
    setFbOptionsText('');
    setFbSavingQuestion(false);

    // Reload questions
    const { data } = await feedbackService.getQuestions(sessionId, selectedDate);
    if (data) {
      setFbQuestions(data);
      await syncSelectedTemplate(data);
    }
  }, [sessionId, selectedDate, fbQuestionText, fbQuestionType, fbQuestionRequired, fbOptionsText, fbEditingQuestionId, fbQuestions.length, syncSelectedTemplate]);

  const handleDeleteQuestion = useCallback(async (questionId: string) => {
    if (!sessionId) return;
    const { error } = await feedbackService.deleteQuestion(questionId);
    if (error) { toast.error('Failed to delete question'); return; }
    toast.success('Question deleted');
    const { data } = await feedbackService.getQuestions(sessionId, selectedDate);
    if (data) {
      setFbQuestions(data);
      await syncSelectedTemplate(data);
    }
  }, [sessionId, selectedDate, syncSelectedTemplate]);

  const handleApplyTemplate = useCallback(async (templateId: string) => {
    if (!sessionId || !templateId) return;
    setFbApplyingTemplate(true);
    const { error } = await feedbackService.applyTemplateToSession(templateId, sessionId, selectedDate);
    setFbApplyingTemplate(false);
    if (error) { toast.error('Failed to apply template'); return; }
    toast.success('Template applied');
    const { data } = await feedbackService.getQuestions(sessionId, selectedDate);
    if (data) setFbQuestions(data);
  }, [sessionId, selectedDate]);

  const startEditQuestion = useCallback((q: FeedbackQuestion) => {
    setFbEditingQuestionId(q.id);
    setFbQuestionText(q.question_text);
    setFbQuestionType(q.question_type);
    setFbQuestionRequired(q.is_required);
    setFbOptionsText(q.options?.join(', ') || '');
  }, []);

  const cancelEditQuestion = useCallback(() => {
    setFbEditingQuestionId(null);
    setFbQuestionText('');
    setFbQuestionType('rating');
    setFbQuestionRequired(false);
    setFbOptionsText('');
  }, []);

  const handleTemplateChange = useCallback(async (templateId: string) => {
    setFbSelectedTemplateId(templateId);
    cancelEditQuestion();
    if (!templateId) return;
    await handleApplyTemplate(templateId);
  }, [cancelEditQuestion, handleApplyTemplate]);

  // Auto-suggest planned host based on host_date from Host Schedule
  useEffect(() => {
    // Only suggest if:
    // 1. We have a selected date
    // 2. loadAttendance has confirmed no saved host exists (hostDataLoaded = true)
    // 3. We have host addresses loaded (fresh, not stale)
    // 4. No address is currently selected
    // 5. Not in "session not held" mode
    if (!selectedDate || !hostDataLoaded || hostAddresses.length === 0 || selectedAddress || sessionNotHeld) {
      return;
    }

    // Check if any host has this date as their planned host_date
    const plannedHost = hostAddresses.find(h => h.host_date === selectedDate);
    if (plannedHost) {
      // Auto-select the planned host
      const value = `${plannedHost.student_id}|||${plannedHost.address}`;
      
      // Save to session_date_host table immediately
      const hostType = plannedHost.is_teacher ? 'teacher' : 'student';
      supabase
        .from(Tables.SESSION_DATE_HOST)
        .upsert({
          session_id: sessionId,
          attendance_date: selectedDate,
          host_id: plannedHost.student_id,
          host_type: hostType,
          host_address: plannedHost.address,
        }, {
          onConflict: 'session_id,attendance_date'
        })
        .then(({ error }) => {
          if (error) {
            console.error('Error auto-saving suggested host:', error);
          }
        });
      
      setSelectedAddress(value);
      
      // Fetch fresh coordinates from student/teacher table
      (async () => {
        const table = plannedHost.is_teacher ? Tables.TEACHER : Tables.STUDENT;
        const idField = plannedHost.is_teacher ? 'teacher_id' : 'student_id';
        const { data: coordData } = await supabase
          .from(table)
          .select('address_latitude, address_longitude')
          .eq(idField, plannedHost.student_id)
          .single();
        if (coordData?.address_latitude && coordData?.address_longitude) {
          const lat = Number(coordData.address_latitude);
          const lon = Number(coordData.address_longitude);
          setHostCoordinates({ lat, lon });
          setHostAddresses(prev => prev.map(h =>
            h.student_id === plannedHost.student_id ? { ...h, address_latitude: lat, address_longitude: lon } : h
          ));
        } else {
          setHostCoordinates(null);
        }
      })();
    }
  }, [selectedDate, hostDataLoaded, hostAddresses, selectedAddress, sessionNotHeld, sessionId]);

  const loadSelectedBookReference = async () => {
    if (!sessionId || !selectedDate) return;

    const { data } = await supabase
      .from(Tables.SESSION_BOOK_COVERAGE)
      .select('reference_id')
      .eq('session_id', sessionId)
      .eq('attendance_date', selectedDate)
      .maybeSingle();

    if (data) {
      setSelectedBookReference(data.reference_id);
    } else {
      setSelectedBookReference('');
    }
  };

  const handleBookReferenceChange = async (referenceId: string) => {
    setSelectedBookReference(referenceId);
    
    if (!sessionId || !selectedDate) return;

    if (referenceId) {
      // Upsert the book coverage
      const { error } = await supabase
        .from(Tables.SESSION_BOOK_COVERAGE)
        .upsert({
          session_id: sessionId,
          attendance_date: selectedDate,
          reference_id: referenceId,
        }, {
          onConflict: 'session_id,attendance_date'
        });

      if (error) {
        console.error('Error saving book reference:', error);
        toast.error('Failed to save book reference selection');
      }
    } else {
      // Delete if empty
      const { error } = await supabase
        .from(Tables.SESSION_BOOK_COVERAGE)
        .delete()
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate);
      if (error) {
        console.error('Error deleting book reference:', error);
        toast.error('Failed to clear book reference');
      }
    }
  };

  // Load recording URL for the selected date
  const loadRecordingForDate = useCallback(async () => {
    if (!sessionId || !selectedDate) { setRecordingUrl(''); setRecordingId(null); return; }
    const { data } = await sessionRecordingService.getBySession(sessionId, selectedDate);
    if (data && data.length > 0) {
      setRecordingUrl(data[0].recording_url || '');
      setRecordingId(data[0].recording_id);
    } else {
      setRecordingUrl('');
      setRecordingId(null);
    }
  }, [sessionId, selectedDate]);

  const saveRecordingUrl = async (urlOverride?: string) => {
    if (!sessionId || !selectedDate) return;
    const url = (urlOverride !== undefined ? urlOverride : recordingUrl).trim();
    setSavingRecording(true);
    const { data: { user } } = await supabase.auth.getUser();
    const showRecordingError = (fallback: string, error?: { message?: string } | null) => {
      toast.error(error?.message || fallback, 7000);
    };

    if (recordingId) {
      if (!url) {
        // Delete if emptied
        const { error } = await sessionRecordingService.softDelete(recordingId);
        if (error) { showRecordingError('Failed to remove recording link.', error); }
        else { setRecordingId(null); toast.success('Recording link removed.'); }
      } else {
        const { error } = await sessionRecordingService.update(recordingId, { recording_url: url });
        if (error) showRecordingError('Failed to update recording link.', error);
        else toast.success('Recording link updated.');
      }
    } else if (url) {
      const result = await sessionRecordingService.create({
        session_id: sessionId,
        attendance_date: selectedDate,
        recording_type: 'external_stream',
        recording_url: url,
        recording_storage_location: 'external_link',
        storage_bucket: null,
        storage_path: null,
        recording_uploaded_by: user?.id || null,
        recording_visibility: 'enrolled_students',
        title: null,
        duration_seconds: null,
        file_size_bytes: null,
        mime_type: null,
        provider_name: null,
        provider_recording_id: null,
        is_primary: false,
      });
      if (result.error) {
        showRecordingError('Failed to save recording link.', result.error);
      } else {
        if (result.data) setRecordingId(result.data.recording_id);
        toast.success('Recording link saved.');
      }
    }
    setSavingRecording(false);
  };

  // Save host address immediately when selected (single source of truth)
  const handleHostAddressChange = async (value: string) => {
    setSelectedAddress(value);
    
    if (!sessionId || !selectedDate) return;

    // Extract host info from value format: "student_id|||address"
    const parts = value.split('|||');
    const hostId = parts[0] || null;
    const hostAddress = parts[1] || value;
    
    // Determine if host is teacher (check if name contains "Teacher")
    const hostInfo = hostAddresses.find(h => h.student_id === hostId);
    const hostType = hostInfo?.student_name?.includes('Teacher') ? 'teacher' : 'student';
    
    // Always fetch fresh coordinates from student/teacher table (not cached hostAddresses state)
    if (hostId) {
      const isTeacher = hostType === 'teacher';
      const table = isTeacher ? Tables.TEACHER : Tables.STUDENT;
      const idField = isTeacher ? 'teacher_id' : 'student_id';
      const { data: coordData } = await supabase
        .from(table)
        .select('address_latitude, address_longitude')
        .eq(idField, hostId)
        .single();
      if (coordData?.address_latitude && coordData?.address_longitude) {
        const lat = Number(coordData.address_latitude);
        const lon = Number(coordData.address_longitude);
        setHostCoordinates({ lat, lon });
        // Sync local hostAddresses state
        setHostAddresses(prev => prev.map(h =>
          h.student_id === hostId ? { ...h, address_latitude: lat, address_longitude: lon } : h
        ));
      } else {
        setHostCoordinates(null);
      }
    } else {
      setHostCoordinates(null);
    }

    if (value && value !== '') {
      // Upsert the host address to session_date_host table
      const { error } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .upsert({
          session_id: sessionId,
          attendance_date: selectedDate,
          host_id: hostId,
          host_type: hostType,
          host_address: hostAddress,
        }, {
          onConflict: 'session_id,attendance_date'
        });

      if (error) {
        console.error('Error saving host address:', error);
        toast.error('Failed to save host address selection');
      }
    } else {
      // Delete if empty/cleared
      await supabase
        .from(Tables.SESSION_DATE_HOST)
        .delete()
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate);
    }
  };

  // Save edited late_minutes for a specific attendance record
  const saveLateMinutes = async (attendanceId: string) => {
    const parsed = parseInt(lateMinutesInput, 10);
    if (isNaN(parsed) || parsed < 0) {
      toast.warning('Please enter a valid number of minutes (0 or more)');
      return;
    }
    const newValue = parsed === 0 ? null : parsed;
    const { error } = await supabase
      .from(Tables.ATTENDANCE)
      .update({ late_minutes: newValue })
      .eq('attendance_id', attendanceId);
    if (error) {
      console.error('Error updating late_minutes:', error);
      toast.error(error.message);
    } else {
      try { await logUpdate('attendance', attendanceId, {} as Record<string, unknown>, { late_minutes: newValue } as Record<string, unknown>, 'Late minutes updated'); } catch { /* audit non-critical */ }
      // Update local state immediately
      setAttendance(prev => prev.map(a =>
        a.attendance_id === attendanceId ? { ...a, late_minutes: newValue } : a
      ));
      setEditingLateMinutes(null);
      setLateMinutesInput('');
    }
  };

  const updateAttendance = async (attendanceId: string, status: string) => {
    const record = attendance.find(a => a.attendance_id === attendanceId);
    if (!record) return;

    // Prevent marking attendance for students not yet enrolled
    if (record.status === 'not enrolled') {
      toast.warning('Cannot mark attendance: Student was not enrolled on this date');
      return;
    }

    // Validate host address is selected
    if (!selectedAddress || selectedAddress === '') {
      toast.warning('Please select a host address before marking attendance');
      return;
    }

    // Validate excuse reason if status is excused
    if (status === 'excused' && !excuseReason[attendanceId]) {
      toast.warning('Please select an excuse reason before marking as excused');
      return;
    }

    // Capture GPS location
    const gpsData = await captureGPSLocation();
    const userEmail = await getCurrentUserEmail();

    // Teacher manual marking: use the status they selected without auto-detection
    // (Auto-detection only applies to student QR check-ins in StudentCheckIn.tsx)
    const actualStatus = status;

    // Check if this is a temporary/unsaved record
    if (attendanceId.startsWith('temp-')) {
      // Before inserting, check if a record already exists (e.g., from student QR check-in)
      const { data: existingRecord } = await supabase
        .from(Tables.ATTENDANCE)
        .select('attendance_id')
        .eq('enrollment_id', record.enrollment_id)
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate)
        .maybeSingle();

      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;

      if (existingRecord) {
        // Record exists - UPDATE it instead of inserting
        const updates: Record<string, unknown> = {
          status: actualStatus,
          check_in_method: 'manual', // Track check-in method
          host_address: addressOnly,
          gps_latitude: gpsData?.latitude || null,
          gps_longitude: gpsData?.longitude || null,
          gps_accuracy: gpsData?.accuracy || null,
          gps_timestamp: gpsData?.timestamp || null,
          marked_by: userEmail,
          marked_at: new Date().toISOString()
        };
        
        if (status === 'on time' || status === 'late') {
          updates.check_in_time = new Date().toISOString();
          updates.late_minutes = status === 'late' ? calculateLateMinutes(updates.check_in_time as string) : null;
          updates.excuse_reason = null;
        } else if (status === 'excused') {
          updates.excuse_reason = excuseReason[attendanceId];
          updates.late_minutes = null;
        } else {
          updates.check_in_time = null;
          updates.late_minutes = null;
          updates.excuse_reason = null;
        }

        const { error } = await supabase
          .from(Tables.ATTENDANCE)
          .update(updates)
          .eq('attendance_id', existingRecord.attendance_id);

        if (error) {
          console.error('Error updating existing attendance:', error);
          toast.error(error.message);
        } else {
          try { await logUpdate('attendance', existingRecord.attendance_id, {} as Record<string, unknown>, updates as Record<string, unknown>, 'Manual attendance update'); } catch { /* audit non-critical */ }
          setExcuseReason(prev => {
            const updated = { ...prev };
            delete updated[attendanceId];
            return updated;
          });
          loadAttendance();
        }
      } else {
        // No existing record - INSERT new one
        const freshCheckInTime = (status === 'on time' || status === 'late') ? new Date().toISOString() : null;
        const newRecord: Record<string, unknown> = {
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: actualStatus,
          check_in_time: freshCheckInTime,
          late_minutes: status === 'late' ? calculateLateMinutes(freshCheckInTime) : null,
          check_in_method: 'manual', // Track check-in method
          host_address: addressOnly,
          gps_latitude: gpsData?.latitude || null,
          gps_longitude: gpsData?.longitude || null,
          gps_accuracy: gpsData?.accuracy || null,
          gps_timestamp: gpsData?.timestamp || null,
          marked_by: userEmail,
          marked_at: new Date().toISOString()
        };

        if (status === 'excused') {
          newRecord.excuse_reason = excuseReason[attendanceId];
        }

        const { error } = await supabase
          .from(Tables.ATTENDANCE)
          .upsert([newRecord], {
            onConflict: 'enrollment_id,attendance_date',
            ignoreDuplicates: false
          });

        if (error) {
          console.error('Error creating attendance:', error);
          toast.error(error.message);
        } else {
          try { await logInsert('attendance', record.enrollment_id, newRecord, 'Manual attendance insert'); } catch { /* audit non-critical */ }
          setExcuseReason(prev => {
            const updated = { ...prev };
            delete updated[attendanceId];
            return updated;
          });
          loadAttendance();
        }
      }
    } else {
      // Update existing record — preserve the original check_in_time if already set,
      // so that QR/photo check-in timestamps are not overwritten by teacher click time.
      const existingCheckInTime = record?.check_in_time as string | undefined;
      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;
      const updates: Record<string, unknown> = {
        status: actualStatus,
        check_in_method: 'manual', // Track check-in method
        host_address: addressOnly,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: userEmail,
        marked_at: new Date().toISOString()
      };
      
      if (status === 'on time' || status === 'late') {
        // Keep original check_in_time if student already checked in (QR/photo), else record now
        const effectiveCheckInTime = existingCheckInTime || new Date().toISOString();
        updates.check_in_time = effectiveCheckInTime;
        updates.late_minutes = status === 'late' ? calculateLateMinutes(effectiveCheckInTime) : null;
        updates.excuse_reason = null;
      } else if (status === 'excused') {
        updates.excuse_reason = excuseReason[attendanceId];
        updates.late_minutes = null;
      } else {
        updates.check_in_time = null;
        updates.late_minutes = null;
        updates.excuse_reason = null;
      }

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .update(updates)
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('Error updating attendance:', error);
        toast.error(error.message);
      } else {
        try { await logUpdate('attendance', attendanceId, {} as Record<string, unknown>, updates as Record<string, unknown>, 'Manual attendance update'); } catch { /* audit non-critical */ }
        setExcuseReason(prev => {
          const updated = { ...prev };
          delete updated[attendanceId];
          return updated;
        });
        loadAttendance();
      }
    }
  };

  // Clear attendance for a single record: delete saved record or reset a temp placeholder
  const clearAttendance = (attendanceId: string) => {
    setConfirmClearAttendance(attendanceId);
  };

  // Save a per-date time override for the currently selected date
  const handleSaveTimeOverride = async () => {
    if (!sessionId || !selectedDate) return;
    setSavingOverride(true);
    try {
      const { error } = await sessionService.setDateTimeOverride(
        sessionId,
        selectedDate,
        timeOverrideInput.trim() || null,
        undefined,
        endTimeOverrideInput.trim() || null
      );
      if (error) {
        toast.error('Failed to save time override: ' + error.message);
      } else {
        setDateOverrideTime(timeOverrideInput.trim() || null);
        setDateOverrideEndTime(endTimeOverrideInput.trim() || null);
        setEditingTimeOverride(false);
        toast.success('Time override saved for this date');
      }
    } finally {
      setSavingOverride(false);
    }
  };

  // Clear the time override for the currently selected date
  const handleClearTimeOverride = async () => {
    if (!sessionId || !selectedDate) return;
    setSavingOverride(true);
    try {
      const { error } = await sessionService.setDateTimeOverride(sessionId, selectedDate, null, undefined, null);
      if (error) {
        toast.error('Failed to clear time override: ' + error.message);
      } else {
        setDateOverrideTime(null);
        setDateOverrideEndTime(null);
        setEditingTimeOverride(false);
        toast.success('Time override cleared — using session default time');
      }
    } finally {
      setSavingOverride(false);
    }
  };

  const doClearAttendance = async (attendanceId: string) => {
    // If this is a temp (not-yet-saved) record, just reset locally
    if (attendanceId.startsWith('temp-')) {
      setAttendance((prev) => prev.map(a => a.attendance_id === attendanceId ? { ...a, status: 'pending', check_in_time: null } : a));
      // no DB change required
      return;
    }

    try {
      // Fetch the record before deletion for audit log
      const { data: recordToDelete } = await supabase
        .from(Tables.ATTENDANCE)
        .select('*')
        .eq('attendance_id', attendanceId)
        .single();

      // Log the deletion
      if (recordToDelete) {
        await logDelete(Tables.ATTENDANCE, attendanceId, recordToDelete, 'Cleared attendance from Attendance page');
      }

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .delete()
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('Error deleting attendance record:', error);
        toast.error('Failed to clear attendance: ' + error.message);
        return;
      }

      setExcuseReason(prev => {
        const updated = { ...prev };
        delete updated[attendanceId];
        return updated;
      });

      // Optimistically update UI
      setAttendance((prev) => prev.map(a => a.attendance_id === attendanceId ? { ...a, status: 'pending', check_in_time: null } : a));
      // Reload to ensure consistent state
      loadAttendance();
    } catch (err: unknown) {
      console.error('Exception clearing attendance:', err);
      const errMessage = err instanceof Error ? err.message : String(err);
      toast.error('Failed to clear attendance: ' + errMessage);
    }
  };

  const handleBulkUpdate = async (status: string) => {
    if (selectedStudents.size === 0) {
      toast.warning('Please select students first');
      return;
    }

    // Validate host address is selected
    if (!selectedAddress || selectedAddress === '') {
      toast.warning('Please select a host address before marking attendance');
      return;
    }

    // Capture GPS location once for bulk operation
    const gpsData = await captureGPSLocation();
    const userEmail = await getCurrentUserEmail();

    // Extract actual address from student_id|||address format
    const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;

    const attendanceIds = Array.from(selectedStudents);
    const tempIds = attendanceIds.filter(id => id.startsWith('temp-'));
    const realIds = attendanceIds.filter(id => !id.startsWith('temp-'));

    // Create new records for temp IDs
    if (tempIds.length > 0) {
      const lateMinutes = status === 'late' ? calculateLateMinutes() : null;
      const newRecords = tempIds.map(tempId => {
        const record = attendance.find(a => a.attendance_id === tempId);
        if (!record) return null;
        
        return {
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: status,
          check_in_time: (status === 'on time' || status === 'late') ? new Date().toISOString() : null,
          late_minutes: lateMinutes,
          check_in_method: 'bulk', // Track bulk marking
          host_address: addressOnly,
          gps_latitude: gpsData?.latitude || null,
          gps_longitude: gpsData?.longitude || null,
          gps_accuracy: gpsData?.accuracy || null,
          gps_timestamp: gpsData?.timestamp || null,
          marked_by: userEmail,
          marked_at: new Date().toISOString()
        };
      }).filter(r => r !== null);

      const { error: insertError } = await supabase
        .from(Tables.ATTENDANCE)
        .upsert(newRecords, {
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error('Error creating attendance:', insertError);
        toast.error(insertError.message);
        return;
      }
      // Audit log: bulk insert
      try { for (const r of newRecords) { await logInsert('attendance', r.enrollment_id as string, r as Record<string, unknown>, `Bulk mark: ${status}`); } } catch { /* audit non-critical */ }
    }

    // Update existing records
    if (realIds.length > 0) {
      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;
      const lateMinutes = status === 'late' ? calculateLateMinutes() : null;
      const updates: {
        status: string;
        check_in_time?: string | null;
        late_minutes?: number | null;
        excuse_reason?: string | null;
        check_in_method?: string;
        host_address?: string | null;
        gps_latitude?: number | null;
        gps_longitude?: number | null;
        gps_accuracy?: number | null;
        gps_timestamp?: string | null;
        marked_by?: string;
        marked_at?: string;
      } = {
        status: status,
        late_minutes: lateMinutes,
        excuse_reason: null,
        check_in_method: 'bulk',
        host_address: addressOnly,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: userEmail,
        marked_at: new Date().toISOString()
      };
      
      if (status === 'on time' || status === 'late') {
        updates.check_in_time = new Date().toISOString();
      } else {
        updates.check_in_time = null;
      }

      const { error: updateError } = await supabase
        .from(Tables.ATTENDANCE)
        .update(updates)
        .in('attendance_id', realIds);

      if (updateError) {
        console.error('Error updating attendance:', updateError);
        toast.error(updateError.message);
        return;
      }
      // Audit log: bulk update
      try { for (const id of realIds) { await logUpdate('attendance', id, {} as Record<string, unknown>, updates as Record<string, unknown>, `Bulk mark: ${status}`); } } catch { /* audit non-critical */ }
    }

    setExcuseReason(prev => {
      const updated = { ...prev };
      for (const id of attendanceIds) {
        delete updated[id];
      }
      return updated;
    });

    setSelectedStudents(new Set());
    loadAttendance();
  };

  const handleSelectAll = () => {
    // Filter out 'not enrolled' records from selection
    const selectableAttendance = attendance.filter(a => a.status !== 'not enrolled');
    if (selectedStudents.size === selectableAttendance.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(selectableAttendance.map(a => a.attendance_id)));
    }
  };

  const handleSelectStudent = (attendanceId: string) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(attendanceId)) {
      newSelected.delete(attendanceId);
    } else {
      newSelected.add(attendanceId);
    }
    setSelectedStudents(newSelected);
  };

  const handleSessionNotHeld = async () => {
    if (!sessionNotHeld) {
      // Marking as not held - show confirm dialog
      setConfirmSessionNotHeld(true);
    } else {
      // Unmarking - show confirm dialog
      setConfirmUnmarkSessionNotHeld(true);
    }
  };

  const doMarkSessionNotHeld = async () => {
      
      // Mark all students as excused with special marker
      const gpsData = await captureGPSLocation();
      const userEmail = await getCurrentUserEmail();
      const tempIds = attendance.filter(a => a.attendance_id.startsWith('temp-'));
      const realIds = attendance.filter(a => !a.attendance_id.startsWith('temp-'));
      
      // Create new records for temp students
      if (tempIds.length > 0) {
        const newRecords = tempIds.map(record => ({
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: 'excused',
          excuse_reason: 'session not held',
          host_address: 'SESSION_NOT_HELD', // Special marker
          check_in_time: null,
          gps_latitude: gpsData?.latitude || null,
          gps_longitude: gpsData?.longitude || null,
          gps_accuracy: gpsData?.accuracy || null,
          gps_timestamp: gpsData?.timestamp || null,
          marked_by: `${userEmail} - session cancelled`,
          marked_at: new Date().toISOString()
        }));
        
        const { error: upsertErr } = await supabase.from(Tables.ATTENDANCE).upsert(newRecords, {
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false
        });
        if (upsertErr) {
          console.error('Error marking session not held:', upsertErr);
          toast.error('Failed to create attendance records for session not held');
        }
        // Audit log: session not held insert
        try { for (const r of newRecords) { await logInsert('attendance', r.enrollment_id, r as Record<string, unknown>, 'Session marked not held'); } } catch { /* audit non-critical */ }
      }
      
      // Update existing records
      if (realIds.length > 0) {
        const { error: updateErr } = await supabase
          .from(Tables.ATTENDANCE)
          .update({
            status: 'excused',
            excuse_reason: 'session not held',
            host_address: 'SESSION_NOT_HELD',
            check_in_time: null,
            gps_latitude: gpsData?.latitude || null,
            gps_longitude: gpsData?.longitude || null,
            gps_accuracy: gpsData?.accuracy || null,
            gps_timestamp: gpsData?.timestamp || null,
            marked_by: `${userEmail} - session cancelled`,
            marked_at: new Date().toISOString()
          })
          .in('attendance_id', realIds.map(r => r.attendance_id));
        if (updateErr) {
          console.error('Error updating existing records:', updateErr);
          toast.error('Failed to update some existing attendance records');
        }
        // Audit log: session not held update
        try { for (const r of realIds) { await logUpdate('attendance', r.attendance_id, {} as Record<string, unknown>, { status: 'excused', excuse_reason: 'session not held' } as Record<string, unknown>, 'Session marked not held'); } } catch { /* audit non-critical */ }
      }
      
      // Also save to session_date_host table (single source of truth)
      await supabase
        .from(Tables.SESSION_DATE_HOST)
        .upsert({
          session_id: sessionId,
          attendance_date: selectedDate,
          host_id: null,
          host_type: 'student',
          host_address: 'SESSION_NOT_HELD',
        }, {
          onConflict: 'session_id,attendance_date'
        });
      
      setSessionNotHeld(true);
      setSelectedAddress('SESSION_NOT_HELD');
      loadAttendance();
  };

  const doUnmarkSessionNotHeld = async () => {
      
      const realIds = attendance.filter(a => !a.attendance_id.startsWith('temp-'));
      if (realIds.length > 0) {
        // Fetch records before deletion for audit log
        const { data: recordsToDelete } = await supabase
          .from(Tables.ATTENDANCE)
          .select('*')
          .in('attendance_id', realIds.map(r => r.attendance_id));

        // Log each deletion
        if (recordsToDelete && recordsToDelete.length > 0) {
          for (const record of recordsToDelete) {
            await logDelete(
              Tables.ATTENDANCE,
              record.attendance_id,
              record,
              'Unmarked session not held - clearing all attendance'
            );
          }
        }

        await supabase
          .from(Tables.ATTENDANCE)
          .delete()
          .in('attendance_id', realIds.map(r => r.attendance_id));
      }
      
      // Clean up orphaned feedback rows for this session+date
      if (sessionId && selectedDate) {
        await supabase.from('session_feedback').delete()
          .eq('session_id', sessionId).eq('attendance_date', selectedDate);
        // Also clean up recording links for cancelled dates
        const { data: orphanedRecordings } = await supabase
          .from(Tables.SESSION_RECORDING)
          .select('recording_id')
          .eq('session_id', sessionId)
          .eq('attendance_date', selectedDate)
          .is('deleted_at', null);
        if (orphanedRecordings && orphanedRecordings.length > 0) {
          for (const rec of orphanedRecordings) {
            await sessionRecordingService.softDelete(rec.recording_id);
          }
        }
      }

      // Also delete from session_date_host table
      await supabase
        .from(Tables.SESSION_DATE_HOST)
        .delete()
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate);
      
      setSessionNotHeld(false);
      setSelectedAddress('');
      loadAttendance();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'on time':
        return <Badge variant="success">On Time</Badge>;
      case 'absent':
        return <Badge variant="danger">Absent</Badge>;
      case 'late':
        return <Badge variant="warning">Late</Badge>;
      case 'excused':
        return <Badge variant="info">Excused</Badge>;
      case 'not enrolled':
        return <Badge variant="default" className="bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-200">Not Enrolled</Badge>;
      case 'pending':
        return <Badge variant="default">Not Marked</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (loading || isTeacher === null) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <TableSkeleton rows={5} columns={5} />
        </div>
      </div>
    );
  }

  // Block non-teachers from accessing this page
  if (isTeacher === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <span className="text-3xl">🔒</span>
              <span>Access Denied</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              This page is only accessible to teachers. Students can check in using QR codes or face recognition.
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="inline-block p-6 bg-red-50 border-2 border-red-200 rounded-lg">
          <p className="text-red-600 font-semibold mb-2">⚠️ Error Loading Attendance</p>
          <p className="text-red-500 text-sm">{error}</p>
          <Button onClick={() => { setError(null); setLoading(true); loadSession(); }} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Session not found</p>
      </div>
    );
  }

  const sessionInfo = (session as Session & { course?: { course_name: string } })?.course;
  const courseName = sessionInfo?.course_name || 'Unknown Course';

  return (
    <div className="win2k-root win2k-desktop">
      {/* ── Address bar (breadcrumb) ── */}
      <div className="win2k-addressbar">
        <span style={{ fontSize: 12 }}>📁</span>
        <span style={{ fontSize: 11 }}>Sessions</span>
        <span style={{ fontSize: 11, color: '#808080' }}> &rsaquo; </span>
        <span style={{ fontSize: 11 }}>{courseName}</span>
        <span style={{ fontSize: 11, color: '#808080' }}> &rsaquo; </span>
        <span style={{ fontSize: 11, fontWeight: 'bold' }}>Attendance</span>
      </div>

      {/* ── Main Window ── */}
      <div className="win2k-window">
        {/* Title bar */}
        <div className="win2k-titlebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="win2k-titlebar-icon">📋</span>
            <span>Mark Attendance — {courseName}</span>
            {session.day && <span style={{ fontWeight: 'normal', opacity: 0.85 }}>&nbsp;({session.day}{(dateOverrideTime ?? session.time) ? ` @ ${dateOverrideTime ?? session.time}` : ''})</span>}
            {(dateOverrideTime || dateOverrideEndTime) && (
              <span className="win2k-badge" style={{ marginLeft: 6 }}>⏱ Override</span>
            )}
          </div>
          <div className="win2k-titlebar-controls">
            <button className="win2k-titlebar-btn" aria-label="Minimize">_</button>
            <button className="win2k-titlebar-btn" aria-label="Maximize">□</button>
            <button className="win2k-titlebar-btn" style={{ fontWeight: 900 }} aria-label="Close">✕</button>
          </div>
        </div>

        {/* Toolbar row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderBottom: '1px solid #808080', background: '#D4D0C8', flexWrap: 'wrap' }}>
          {selectedDate && !sessionNotHeld && (
            <button
              className="win2k-btn win2k-btn-blue"
              onClick={() => {
                if (!selectedAddress || selectedAddress === '') {
                  toast.warning('Please select a host address first before generating check-in.');
                  return;
                }
                setShowQRModal(true);
              }}
            >
              📱 QR Check-In
            </button>
          )}
          <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>
            Session: {courseName}
          </span>
        </div>

        <div className="win2k-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* ── Date Selector Window ── */}
          <div className="win2k-groupbox" style={{ position: 'relative' }}>
            <span className="win2k-groupbox-legend">📅 Select Session Date</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <button
                className="win2k-btn"
                onClick={() => {
                  const currentIndex = availableDates.findIndex(d => d.value === selectedDate);
                  if (currentIndex > 0) setSelectedDate(availableDates[currentIndex - 1].value);
                }}
                disabled={!selectedDate || availableDates.findIndex(d => d.value === selectedDate) === 0}
              >
                ◄ Previous
              </button>
              <div className="win2k-inset" style={{ flex: 1, minWidth: 160, textAlign: 'center', padding: '3px 8px' }}>
                <span style={{ fontSize: 11, fontWeight: 'bold' }}>
                  {selectedDate ? format(new Date(selectedDate), 'EEEE, MMM dd, yyyy') : '— No date selected —'}
                </span>
              </div>
              <button
                className="win2k-btn"
                onClick={() => {
                  const currentIndex = availableDates.findIndex(d => d.value === selectedDate);
                  if (currentIndex < availableDates.length - 1) setSelectedDate(availableDates[currentIndex + 1].value);
                }}
                disabled={!selectedDate || availableDates.findIndex(d => d.value === selectedDate) === availableDates.length - 1}
              >
                Next ►
              </button>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: '#000080', fontWeight: 'bold' }}>
                📅 Jump to specific date...
              </summary>
              <div style={{ marginTop: 6 }}>
                <Select
                  value={selectedDate}
                  onChange={(value) => setSelectedDate(value)}
                  options={availableDates}
                  placeholder="Select a date"
                />
              </div>
            </details>
            {availableDates.length === 0 && (
              <div className="win2k-warning-box" style={{ marginTop: 4 }}>
                No attendance dates available. Please check the session schedule.
              </div>
            )}
          </div>

          {/* ── Time Override Panel ── */}
          {selectedDate && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">
                ⏱ Session Time — {format(new Date(selectedDate), 'MMM dd, yyyy')}
                {(dateOverrideTime || dateOverrideEndTime) && (
                  <span className="win2k-badge" style={{ marginLeft: 6 }}>Override Active</span>
                )}
              </span>
              {!editingTimeOverride ? (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="win2k-label">Start:</span>
                    <span className="win2k-inset" style={{ padding: '1px 8px', display: 'inline-block', minWidth: 60, textAlign: 'center', fontFamily: 'Courier New, monospace', fontWeight: 'bold', fontSize: 12 }}>
                      {dateOverrideTime ?? session?.time ?? '—'}
                    </span>
                    {dateOverrideTime && session?.time && (
                      <span className="win2k-subtext">(default: {session.time})</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="win2k-label">End:</span>
                    <span className="win2k-inset" style={{ padding: '1px 8px', display: 'inline-block', minWidth: 60, textAlign: 'center', fontFamily: 'Courier New, monospace', fontWeight: 'bold', fontSize: 12 }}>
                      {dateOverrideEndTime ?? '—'}
                    </span>
                  </div>
                  {!(dateOverrideTime || dateOverrideEndTime) && (
                    <span className="win2k-badge">session default</span>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                    <button
                      className="win2k-btn win2k-btn-amber"
                      onClick={() => {
                        setTimeOverrideInput(dateOverrideTime ?? session?.time ?? '');
                        setEndTimeOverrideInput(dateOverrideEndTime ?? '');
                        setEditingTimeOverride(true);
                      }}
                    >
                      ✏ {(dateOverrideTime || dateOverrideEndTime) ? 'Edit Override' : 'Set Override'}
                    </button>
                    {(dateOverrideTime || dateOverrideEndTime) && (
                      <button
                        className="win2k-btn win2k-btn-red"
                        onClick={handleClearTimeOverride}
                        disabled={savingOverride}
                      >
                        {savingOverride ? '…' : '🗑 Clear'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="win2k-label">Start:</span>
                      <input type="time" value={timeOverrideInput} onChange={(e) => setTimeOverrideInput(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="win2k-label">End:</span>
                      <input type="time" value={endTimeOverrideInput} onChange={(e) => setEndTimeOverrideInput(e.target.value)} />
                      <span className="win2k-subtext">(optional)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                      <button className="win2k-btn win2k-btn-green" onClick={handleSaveTimeOverride} disabled={savingOverride}>
                        {savingOverride ? 'Saving…' : '✓ Save'}
                      </button>
                      <button className="win2k-btn" onClick={() => setEditingTimeOverride(false)} disabled={savingOverride}>
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="win2k-info-box">
                    💡 <strong>Start time</strong> affects late-arrival calculation. <strong>End time</strong> is informational.
                    Leave a field empty to use the session default.
                  </div>
                </div>
              )}
              <p className="win2k-subtext" style={{ marginTop: 4 }}>
                Override affects this date only. To manage all overrides, use the Host Table in Sessions.
              </p>
            </div>
          )}

          {/* ── Session Status ── */}
          {selectedDate && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">Session Status</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={sessionNotHeld}
                  onChange={handleSessionNotHeld}
                />
                <div>
                  <span style={{ fontWeight: 'bold', fontSize: 11 }}>Session Not Held</span>
                  <p className="win2k-subtext">Mark this date if the session was cancelled or did not take place</p>
                </div>
              </label>
            </div>
          )}

          {selectedDate && hostAddresses.length > 0 && !sessionNotHeld && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">🏠 Host Address</span>
              <Select
                value={selectedAddress}
                onChange={handleHostAddressChange}
                options={hostAddresses.map(host => ({
                  value: `${host.student_id}|||${host.address}`,
                  label: host.host_date === selectedDate 
                    ? `[Today] ${host.student_name} - ${host.address}`
                    : `${host.student_name} - ${host.address}`
                }))}
                placeholder="Select host address"
              />
              {selectedAddress && selectedAddress !== 'SESSION_NOT_HELD' && (
                <div style={{ marginTop: 8 }}>
                  <div className="win2k-inset" style={{ padding: '4px 8px', marginBottom: 6 }}>
                    <span className="win2k-label">📍 Address: </span>
                    <span style={{ fontSize: 11 }}>{selectedAddress.split('|||')[1] || selectedAddress}</span>
                  </div>
                  
                  {/* GPS Coordinates Section */}
                  <div className="win2k-groupbox" style={{ position: 'relative', marginTop: 6 }}>
                    <span className="win2k-groupbox-legend">🌐 GPS Coordinates</span>
                    {hostCoordinates ? (
                      <div className="win2k-success-box">
                        ✅ <strong>Coordinates set:</strong> {hostCoordinates.lat.toFixed(6)}, {hostCoordinates.lon.toFixed(6)}<br />
                        <span className="win2k-subtext">Proximity validation active — students must be within {session?.proximity_radius || '?'}m</span>
                      </div>
                    ) : (
                      <div className="win2k-warning-box">
                        ⚠️ No coordinates set. Proximity validation disabled. Students can check in from anywhere.
                      </div>
                    )}
                    <button
                      className="win2k-btn win2k-btn-blue"
                      style={{ marginTop: 6 }}
                      onClick={async () => {
                        const currentCoords = hostCoordinates ? `${hostCoordinates.lat},${hostCoordinates.lon}` : '';
                        const coords = prompt(
                          'Enter GPS coordinates in format: latitude,longitude\n\nExample: 33.5138,36.2765\n\nHow to find coordinates:\n• Right-click a location on Google Maps\n• Use your phone GPS app\n• Leave blank to disable proximity validation',
                          currentCoords
                        );
                        if (coords === null) return;
                        const addressParts = selectedAddress.split('|||');
                        const hostId = addressParts[0];
                        const hostInfo = hostAddresses.find(h => h.student_id === hostId);
                        const isTeacherHost = hostInfo?.is_teacher || hostInfo?.student_name?.includes('Teacher');
                        if (!hostId || !hostInfo) { toast.warning('No host selected.'); return; }
                        if (coords.trim() === '') { setConfirmClearGPS({ hostId, isTeacher: !!isTeacherHost }); return; }
                        const parts = coords.split(',');
                        if (parts.length !== 2) { toast.error('Invalid format. Please use: latitude,longitude'); return; }
                        const lat = parseFloat(parts[0].trim());
                        const lon = parseFloat(parts[1].trim());
                        if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
                          toast.error('Invalid coordinates range.'); return;
                        }
                        const table = isTeacherHost ? Tables.TEACHER : Tables.STUDENT;
                        const idField = isTeacherHost ? 'teacher_id' : 'student_id';
                        const { error } = await supabase.from(table).update({ address_latitude: lat, address_longitude: lon }).eq(idField, hostId);
                        if (error) { toast.error('Failed to save coordinates.'); }
                        else {
                          setHostCoordinates({ lat, lon });
                          setHostAddresses(prev => prev.map(h => h.student_id === hostId ? { ...h, address_latitude: lat, address_longitude: lon } : h));
                          toast.success('Coordinates saved! Proximity validation enabled.');
                        }
                      }}
                    >
                      📍 Set/Update GPS Coordinates
                    </button>
                    <p className="win2k-subtext" style={{ marginTop: 4 }}>
                      Proximity radius: {session?.proximity_radius || 'not set'}{session?.proximity_radius ? 'm' : ''}. Update in Sessions page.
                    </p>
                  </div>
                </div>
              )}
            </div>

          {/* ── Book Reference ── */}
          {selectedDate && bookReferences.length > 0 && !sessionNotHeld && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">📚 Book Reference</span>
              <Select
                value={selectedBookReference}
                onChange={handleBookReferenceChange}
                options={[
                  { value: '', label: 'Select what topic was covered today...' },
                  ...(() => {
                    const chapters = bookReferences.filter(r => !r.parent_id);
                    const opts: Array<{ value: string; label: string }> = [];
                    chapters.forEach(ch => {
                      opts.push({ value: ch.reference_id, label: `📖 ${ch.topic} (pp. ${ch.start_page}–${ch.end_page})` });
                      bookReferences.filter(r => r.parent_id === ch.reference_id).forEach(sub => {
                        opts.push({ value: sub.reference_id, label: `  ↳ ${sub.topic} (pp. ${sub.start_page}–${sub.end_page})` });
                      });
                    });
                    const chapterIds = new Set(chapters.map(c => c.reference_id));
                    bookReferences.filter(r => r.parent_id && !chapterIds.has(r.parent_id)).forEach(orphan => {
                      opts.push({ value: orphan.reference_id, label: `${orphan.topic} (pp. ${orphan.start_page}–${orphan.end_page})` });
                    });
                    return opts;
                  })()
                ]}
                placeholder="Select book reference"
              />
              {selectedBookReference && (() => {
                const selected = bookReferences.find(r => r.reference_id === selectedBookReference);
                if (selected) return (
                  <div className="win2k-inset" style={{ marginTop: 6, padding: '4px 8px' }}>
                    <span className="win2k-label">📚 {selected.topic}</span>
                    <p className="win2k-subtext">Pages {selected.start_page} - {selected.end_page} ({selected.end_page - selected.start_page + 1} pages)</p>
                  </div>
                );
                return null;
              })()}
              {bookReferences.length > 0 && !selectedBookReference && (
                <p className="win2k-subtext" style={{ marginTop: 4 }}>💡 Select which topic was covered in today&apos;s session for better tracking</p>
              )}
            </div>
          )}

          {/* ── Recording Link ── */}
          {selectedDate && !sessionNotHeld && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">
                🎥 Recording Link
                {recordingId && recordingUrl.trim() && <span className="win2k-badge" style={{ marginLeft: 4 }}>Saved</span>}
              </span>
              <p className="win2k-subtext" style={{ marginBottom: 6 }}>Save the replay for this date. Students see it in Sessions under Recordings.</p>
              {recordingId && recordingUrl.trim() && (() => {
                const u = recordingUrl.trim().toLowerCase();
                const prov = [
                  { test: (s: string) => /youtube\.com|youtu\.be/.test(s), name: 'YouTube', icon: '▶' },
                  { test: (s: string) => /zoom\.(us|com)/.test(s), name: 'Zoom', icon: '🟦' },
                  { test: (s: string) => /drive\.google\.com/.test(s), name: 'Google Drive', icon: '🟩' },
                  { test: (s: string) => /teams\.microsoft\.com/.test(s), name: 'MS Teams', icon: '🟪' },
                ];
                const match = prov.find(p => p.test(u)) || { name: 'Link', icon: '🔗' };
                return (
                  <div className="win2k-inset" style={{ marginBottom: 6, padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <span style={{ fontSize: 11 }}>{match.icon} {match.name}: <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10 }}>{recordingUrl.trim().substring(0, 50)}{recordingUrl.trim().length > 50 ? '…' : ''}</span></span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <a href={recordingUrl.trim()} target="_blank" rel="noopener noreferrer" className="win2k-btn win2k-btn-blue" style={{ textDecoration: 'none' }}>🔗 Open</a>
                      <button className="win2k-btn win2k-btn-red" type="button" onClick={() => { if (window.confirm('Remove this recording link?')) { setRecordingUrl(''); saveRecordingUrl(''); } }}>🗑 Remove</button>
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="url"
                  value={recordingUrl}
                  onChange={e => setRecordingUrl(e.target.value)}
                  placeholder={recordingId ? 'Update recording link...' : 'Paste recording link (YouTube, Zoom, Drive, etc.)...'}
                  style={{ flex: 1, fontFamily: 'Courier New, monospace', fontSize: 11 }}
                  onKeyDown={e => { if (e.key === 'Enter') saveRecordingUrl(); }}
                />
                <button
                  className="win2k-btn win2k-btn-blue"
                  onClick={() => saveRecordingUrl()}
                  disabled={savingRecording || !recordingUrl.trim()}
                >
                  {savingRecording ? '...' : recordingId ? '💾 Update' : '💾 Save'}
                </button>
              </div>
            </div>
          )}

          {/* ─── Feedback Question Management ─── */}
          {selectedDate && session && (
            <div className="win2k-groupbox" style={{ position: 'relative' }}>
              <span className="win2k-groupbox-legend">📋 Feedback Setup — {format(new Date(selectedDate), 'MMM dd, yyyy')}</span>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <span className="win2k-label">Feedback:</span>
                <button
                  type="button"
                  className="win2k-btn"
                  style={{ background: session?.feedback_enabled ? '#008000' : '#800000', color: '#FFFFFF' }}
                  onClick={async () => {
                    const next = !session?.feedback_enabled;
                    const { error } = await feedbackService.toggleFeedback(sessionId!, next);
                    if (error) { toast.error('Failed to toggle feedback'); return; }
                    setSession(prev => prev ? { ...prev, feedback_enabled: next } : prev);
                    toast.success(next ? 'Feedback enabled' : 'Feedback disabled');
                  }}
                >
                  {session?.feedback_enabled ? '● ON' : '○ OFF'}
                </button>
                <span className="win2k-badge">{fbQuestions.length} question{fbQuestions.length === 1 ? '' : 's'}</span>
                <button
                  className="win2k-btn"
                  type="button"
                  onClick={() => { if (showFeedbackSetup) cancelEditQuestion(); setShowFeedbackSetup(prev => !prev); }}
                >
                  {showFeedbackSetup ? '▲ Hide Setup' : '▼ Open Setup'}
                </button>
              </div>

              {!session?.feedback_enabled && fbQuestions.length > 0 && (
                <div className="win2k-warning-box">⚠️ You have {fbQuestions.length} question{fbQuestions.length === 1 ? '' : 's'} but feedback is <strong>OFF</strong>. Toggle ON so students see the form after check-in.</div>
              )}

              {!showFeedbackSetup && (
                <div className="win2k-inset" style={{ padding: '4px 8px' }}>
                  <span className="win2k-subtext">Add feedback questions for this date before students scan the check-in code.</span>
                </div>
              )}

              {showFeedbackSetup && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {fbTemplates.length > 0 && (
                    <div className="win2k-inset" style={{ padding: '6px 8px' }}>
                      <label className="win2k-label" style={{ display: 'block', marginBottom: 4 }}>Question template (optional):</label>
                      <select
                        value={fbSelectedTemplateId}
                        onChange={e => void handleTemplateChange(e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Choose template...</option>
                        {fbTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.questions?.length || 0} questions)</option>
                        ))}
                      </select>
                      <p className="win2k-subtext" style={{ marginTop: 2 }}>{fbApplyingTemplate ? 'Applying...' : 'Selecting a template applies it immediately.'}</p>
                    </div>
                  )}

                  <div className="win2k-raised" style={{ padding: '6px 8px' }}>
                    <p className="win2k-label" style={{ marginBottom: 4 }}>{fbEditingQuestionId ? 'Edit Question' : 'Add Question'}</p>
                    <input
                      type="text"
                      placeholder="Enter question text"
                      value={fbQuestionText}
                      onChange={e => setFbQuestionText(e.target.value)}
                      style={{ width: '100%', marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                      {(['rating', 'emoji', 'text', 'multiple_choice'] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          className="win2k-btn"
                          style={fbQuestionType === t ? { background: '#000080', color: '#FFFFFF', borderTopColor: '#808080', borderLeftColor: '#808080', borderRightColor: '#FFFFFF', borderBottomColor: '#FFFFFF' } : {}}
                          onClick={() => setFbQuestionType(t)}
                        >
                          {t === 'rating' ? 'Rating' : t === 'emoji' ? 'Emoji' : t === 'text' ? 'Text' : 'Multi-Choice'}
                        </button>
                      ))}
                    </div>
                    {fbQuestionType === 'multiple_choice' && (
                      <input type="text" placeholder="Options separated by commas" value={fbOptionsText} onChange={e => setFbOptionsText(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
                        <input type="checkbox" checked={fbQuestionRequired} onChange={e => setFbQuestionRequired(e.target.checked)} />
                        Required answer
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {fbEditingQuestionId && <button className="win2k-btn" onClick={cancelEditQuestion}>Cancel</button>}
                        <button className="win2k-btn win2k-btn-blue" onClick={handleAddOrUpdateQuestion} disabled={fbSavingQuestion || !fbQuestionText.trim()}>
                          {fbSavingQuestion ? 'Saving...' : fbEditingQuestionId ? 'Update Question' : 'Add Question'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {fbQuestions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <p className="win2k-label">Questions for {format(new Date(selectedDate), 'MMM dd, yyyy')}:</p>
                      {fbQuestions.map((q, idx) => (
                        <div key={q.id} className={fbEditingQuestionId === q.id ? 'win2k-raised' : 'win2k-inset'} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 6px' }}>
                          <span style={{ fontSize: 10, fontWeight: 'bold', minWidth: 16 }}>{idx + 1}.</span>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: 11 }}>{q.question_text}</span>
                            <span className="win2k-badge" style={{ marginLeft: 4 }}>{q.question_type}</span>
                            {q.is_required && <span className="win2k-badge" style={{ marginLeft: 2, background: '#FFC0C0', border: '1px solid #800000' }}>Required</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button className="win2k-btn" style={{ padding: '1px 6px', fontSize: 10 }} type="button" onClick={() => startEditQuestion(q)} title="Edit">✏</button>
                            <button className="win2k-btn win2k-btn-red" style={{ padding: '1px 6px', fontSize: 10 }} type="button" onClick={() => handleDeleteQuestion(q.id)} title="Delete">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="win2k-inset" style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <span className="win2k-subtext">No feedback questions yet. Add them above or apply a saved question set.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedDate && (
            <>
              {/* ── Main Attendance Window ── */}
              <div className="win2k-window" style={{ marginTop: 0 }}>
                {/* Inner title bar for the attendance table */}
                <div className="win2k-titlebar" style={{ background: 'linear-gradient(to right, #003380, #1060C0)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="win2k-titlebar-icon">📅</span>
                    <span>Attendance — {format(new Date(selectedDate), 'MMMM dd, yyyy')}</span>
                    <span style={{ fontWeight: 'normal', opacity: 0.85, fontSize: 10 }}>&nbsp;{session.location || ''} {(dateOverrideTime ?? session.time) ? `@ ${dateOverrideTime ?? session.time}` : ''}</span>
                  </div>
                  {/* Bulk action toolbar */}
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {selectedStudents.size > 0 ? (
                      <>
                        <button className="win2k-titlebar-btn" style={{ width: 'auto', padding: '0 6px', fontWeight: 'normal', fontSize: 10 }} onClick={() => handleBulkUpdate('on time')}>✅ On Time ({selectedStudents.size})</button>
                        <button className="win2k-titlebar-btn" style={{ width: 'auto', padding: '0 6px', fontWeight: 'normal', fontSize: 10 }} onClick={() => handleBulkUpdate('absent')}>❌ Absent ({selectedStudents.size})</button>
                        <button className="win2k-titlebar-btn" style={{ width: 'auto', padding: '0 6px', fontWeight: 'normal', fontSize: 10 }} onClick={() => handleBulkUpdate('late')}>⏰ Late ({selectedStudents.size})</button>
                      </>
                    ) : (
                      <button className="win2k-titlebar-btn" style={{ width: 'auto', padding: '0 6px', fontWeight: 'normal', fontSize: 10 }} onClick={handleSelectAll}>Select All ({attendanceStats.total})</button>
                    )}
                  </div>
                </div>
                <div className="win2k-content">
                  {attendance.length === 0 ? (
                    <div className="win2k-inset" style={{ padding: 12, textAlign: 'center' }}>
                      <span className="win2k-subtext">No students enrolled in this session</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {/* ── Summary Stats bar ── */}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 0' }}>
                        <div className="win2k-stat-box">
                          <div className="win2k-stat-number">{attendanceStats.total}</div>
                          <div className="win2k-stat-label">Total</div>
                        </div>
                        <div className="win2k-stat-box" style={{ borderLeft: '3px solid #008000' }}>
                          <div className="win2k-stat-number" style={{ color: '#008000' }}>{attendanceStats.onTime}</div>
                          <div className="win2k-stat-label">On Time</div>
                        </div>
                        <div className="win2k-stat-box" style={{ borderLeft: '3px solid #800000' }}>
                          <div className="win2k-stat-number" style={{ color: '#800000' }}>{attendanceStats.absent}</div>
                          <div className="win2k-stat-label">Absent</div>
                        </div>
                        <div className="win2k-stat-box" style={{ borderLeft: '3px solid #808000' }}>
                          <div className="win2k-stat-number" style={{ color: '#808000' }}>{attendanceStats.late}</div>
                          <div className="win2k-stat-label">Late</div>
                        </div>
                        <div className="win2k-stat-box" style={{ borderLeft: '3px solid #000080' }}>
                          <div className="win2k-stat-number" style={{ color: '#000080' }}>{attendanceStats.excused}</div>
                          <div className="win2k-stat-label">Excused</div>
                        </div>
                        <div className="win2k-stat-box">
                          <div className="win2k-stat-number" style={{ color: '#808080' }}>{attendanceStats.pending}</div>
                          <div className="win2k-stat-label">Not Marked</div>
                        </div>
                        <div className="win2k-stat-box">
                          <div className="win2k-stat-number" style={{ color: '#A0A0A0' }}>{attendanceStats.notEnrolled}</div>
                          <div className="win2k-stat-label">Not Enrolled</div>
                        </div>
                      </div>
                      <hr className="win2k-separator" />

                  {/* Pending Excuse Requests Banner */}
                  {pendingExcuseRequests.length > 0 && (
                    <div className="win2k-warning-box">
                      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>📋 {pendingExcuseRequests.length} Pending Excuse Request{pendingExcuseRequests.length > 1 ? 's' : ''}</div>
                      {pendingExcuseRequests.map(req => {
                        const reasonObj = SERVICE_EXCUSE_REASONS.find(r => r.value === req.reason);
                        return (
                          <div key={req.request_id} className="win2k-raised" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4, padding: '3px 6px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 'bold', fontSize: 11 }}>{req.student?.name || 'Unknown'}</span>
                              <span style={{ fontSize: 10, marginLeft: 6 }}>{reasonObj ? `${reasonObj.label}` : req.reason}</span>
                              {req.description && <p style={{ fontSize: 10, marginTop: 1 }}>&ldquo;{req.description}&rdquo;</p>}
                              {req.supporting_doc_url && <a href={req.supporting_doc_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#000080' }}>📎 Document</a>}
                            </div>
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button className="win2k-btn win2k-btn-green" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => handleExcuseAction(req.request_id, 'approved')}>✓ Approve</button>
                              <button className="win2k-btn win2k-btn-red" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => handleExcuseAction(req.request_id, 'rejected')}>✕ Reject</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Search + Select all toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={attendanceStats.total > 0 && selectedStudents.size === attendanceStats.total}
                      onChange={handleSelectAll}
                    />
                    <label style={{ fontSize: 11, cursor: 'pointer' }} onClick={handleSelectAll}>Select All</label>
                    <input
                      type="text"
                      placeholder="Search by name or email..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      style={{ flex: 1, fontSize: 11 }}
                    />
                  </div>

                  {/* ── Student rows (list-view style) ── */}
                  <div className="win2k-inset" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* List-view header */}
                    <div style={{ display: 'flex', background: '#D4D0C8', borderBottom: '2px solid #808080', padding: '2px 4px', gap: 4, fontSize: 10, fontWeight: 'bold', userSelect: 'none' }}>
                      <span style={{ width: 18 }}></span>
                      <span style={{ flex: 2, minWidth: 120 }}>Name</span>
                      <span style={{ flex: 2, minWidth: 120 }}>Email</span>
                      <span style={{ width: 80 }}>Check-in</span>
                      <span style={{ width: 70 }}>Status</span>
                      <span style={{ flex: 1 }}>Actions</span>
                    </div>
                  {attendance
                    .filter(record => {
                      const term = searchTerm.trim().toLowerCase();
                      if (!term) return true;
                      return (
                        record.student.name.toLowerCase().includes(term) ||
                        record.student.email.toLowerCase().includes(term)
                      );
                    })
                    .map((record, rowIdx) => {
                      const isNotEnrolled = record.status === 'not enrolled';
                      const studentExcuseReq = pendingExcuseRequests.find(r => r.student_id === record.student_id);
                      const rowBg = isNotEnrolled ? '#E8E8E8' : rowIdx % 2 === 0 ? '#FFFFFF' : '#EEF0F8';
                      const leftBorderColor = record.status === 'on time' ? '#008000' : record.status === 'absent' ? '#800000' : record.status === 'late' ? '#808000' : record.status === 'excused' ? '#000080' : '#C0C0C0';
                      return (
                    <div
                      key={record.attendance_id}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '3px 4px', borderBottom: '1px solid #DFDFDF', background: rowBg, borderLeft: `3px solid ${leftBorderColor}`, flexWrap: 'wrap', opacity: isNotEnrolled ? 0.5 : 1 }}
                    >
                      {/* Checkbox */}
                      <div style={{ width: 18, paddingTop: 2 }}>
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(record.attendance_id)}
                          onChange={() => handleSelectStudent(record.attendance_id)}
                          disabled={isNotEnrolled}
                        />
                      </div>
                      <div style={{ flex: 2, minWidth: 100 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 'bold' }}>{record.student.name}</span>
                          {studentExcuseReq && (
                            <span className="win2k-badge" style={{ background: '#FFFFC0', border: '1px solid #808000' }} title={`Pending: ${studentExcuseReq.reason}`}>📋 Excuse?</span>
                          )}
                        </div>
                        <div style={{ flex: 2, minWidth: 100, fontSize: 10, color: '#444' }}>{record.student.email}</div>
                        {record.check_in_time && (
                          <span style={{ fontSize: 9, color: '#444', fontFamily: 'Courier New, monospace' }}>
                            In: {format(new Date(record.check_in_time), 'HH:mm:ss')}
                          </span>
                        )}
                          {/* Inline late_minutes editor */}
                          {record.status === 'late' && !record.attendance_id.startsWith('temp-') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <span style={{ fontSize: 10, color: '#808000' }}>⏰ Late:</span>
                              {editingLateMinutes === record.attendance_id ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <input
                                    type="number"
                                    min="0"
                                    max="999"
                                    autoFocus
                                    value={lateMinutesInput}
                                    onChange={e => setLateMinutesInput(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveLateMinutes(record.attendance_id);
                                      if (e.key === 'Escape') { setEditingLateMinutes(null); setLateMinutesInput(''); }
                                    }}
                                    style={{ width: 40, fontSize: 10, fontFamily: 'Courier New, monospace' }}
                                  />
                                  <span style={{ fontSize: 9 }}>min</span>
                                  <button className="win2k-btn win2k-btn-green" style={{ padding: '0 4px', fontSize: 9, minHeight: 0 }} onClick={() => saveLateMinutes(record.attendance_id)} title="Save">✓</button>
                                  <button className="win2k-btn" style={{ padding: '0 4px', fontSize: 9, minHeight: 0 }} onClick={() => { setEditingLateMinutes(null); setLateMinutesInput(''); }} title="Cancel">✕</button>
                                </span>
                              ) : (
                                <button
                                  className="win2k-btn win2k-btn-amber"
                                  style={{ padding: '0 6px', fontSize: 9, minHeight: 0 }}
                                  onClick={() => { setEditingLateMinutes(record.attendance_id); setLateMinutesInput(String(record.late_minutes ?? '')); }}
                                  title="Edit late minutes"
                                >
                                  {record.late_minutes != null ? `${record.late_minutes} min` : '—'}
                                </button>
                              )}
                            </div>
                          )}
                          {isNotEnrolled && record.enrollment_date && (
                            <span style={{ fontSize: 9, color: '#666', fontStyle: 'italic' }}>Enrolled: {format(new Date(record.enrollment_date), 'MMM dd, yyyy')}</span>
                          )}
                      </div>
                      {/* Status + Action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
                        {getStatusBadge(record.status)}
                        {!isNotEnrolled && (
                          <>
                            <button className="win2k-btn win2k-btn-green" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => updateAttendance(record.attendance_id, 'on time')}>✓ On Time</button>
                            <button className="win2k-btn win2k-btn-red" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => updateAttendance(record.attendance_id, 'absent')}>✕ Absent</button>
                            <button className="win2k-btn win2k-btn-amber" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => updateAttendance(record.attendance_id, 'late')}>⏰ Late</button>
                            {excuseDropdownOpen === record.attendance_id ? (
                              <>
                                <select
                                  autoFocus
                                  value={excuseReason[record.attendance_id] || ''}
                                  onChange={(e) => setExcuseReason(prev => ({ ...prev, [record.attendance_id]: e.target.value }))}
                                  style={{ fontSize: 10 }}
                                >
                                  <option value="">Reason...</option>
                                  {SERVICE_EXCUSE_REASONS.map(reason => (
                                    <option key={reason.value} value={reason.value}>{reason.label}</option>
                                  ))}
                                </select>
                                <button className="win2k-btn win2k-btn-blue" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => { if (!excuseReason[record.attendance_id]) { toast.warning('Select reason'); } else { updateAttendance(record.attendance_id, 'excused'); setExcuseDropdownOpen(null); } }}>OK</button>
                                <button className="win2k-btn" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => { setExcuseDropdownOpen(null); setExcuseReason(prev => { const u = {...prev}; delete u[record.attendance_id]; return u; }); }}>Cancel</button>
                              </>
                            ) : (
                              <button className="win2k-btn win2k-btn-blue" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => setExcuseDropdownOpen(record.attendance_id)}>Excused</button>
                            )}
                            <button className="win2k-btn" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => clearAttendance(record.attendance_id)}>Clear</button>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  </div>{/* end list-view inset */}
                </div>
              )}
            </div>
          </div>{/* end win2k-content */}
        </div>{/* end win2k-window (attendance) */}
            </>
          )}

        </div>{/* end win2k-content (main) */}
      </div>{/* end win2k-window (main) */}
      {/* QR Code Modal */}
      {showQRModal && sessionId && selectedDate && (
        <QRCodeModal
          sessionId={sessionId}
          date={selectedDate}
          courseName={courseName}
          onClose={() => setShowQRModal(false)}
        />
      )}
      {/* Confirm: Clear Attendance */}
      <ConfirmDialog
        isOpen={confirmClearAttendance !== null}
        title="Clear Attendance"
        message="Clear attendance for this student? This will remove the recorded status."
        confirmText="Clear"
        cancelText="Cancel"
        type="danger"
        onConfirm={() => { if (confirmClearAttendance) doClearAttendance(confirmClearAttendance); setConfirmClearAttendance(null); }}
        onCancel={() => setConfirmClearAttendance(null)}
      />
      {/* Confirm: Mark Session Not Held */}
      <ConfirmDialog
        isOpen={confirmSessionNotHeld}
        title="Mark Session Not Held"
        message={'Mark this session as NOT HELD?\n\nThis will:\n• Mark all students as EXCUSED (session cancelled)\n• Set excuse reason to "Session Not Held"\n• Set host address to "Session Not Held"\n• This date will be skipped in rotation calculations'}
        confirmText="Mark Not Held"
        cancelText="Cancel"
        type="warning"
        onConfirm={() => { setConfirmSessionNotHeld(false); doMarkSessionNotHeld(); }}
        onCancel={() => setConfirmSessionNotHeld(false)}
      />
      {/* Confirm: Unmark Session Not Held */}
      <ConfirmDialog
        isOpen={confirmUnmarkSessionNotHeld}
        title="Unmark Session Not Held"
        message={'Unmark "Session Not Held"? This will clear all attendance records for this date.'}
        confirmText="Unmark"
        cancelText="Cancel"
        type="danger"
        onConfirm={() => { setConfirmUnmarkSessionNotHeld(false); doUnmarkSessionNotHeld(); }}
        onCancel={() => setConfirmUnmarkSessionNotHeld(false)}
      />
      {/* Confirm: Clear GPS Coordinates */}
      <ConfirmDialog
        isOpen={confirmClearGPS !== null}
        title="Clear GPS Coordinates"
        message="Remove GPS coordinates? This will disable proximity validation."
        confirmText="Remove"
        cancelText="Cancel"
        type="warning"
        onConfirm={async () => {
          if (confirmClearGPS) {
            const table = confirmClearGPS.isTeacher ? Tables.TEACHER : Tables.STUDENT;
            const idField = confirmClearGPS.isTeacher ? 'teacher_id' : 'student_id';
            const { error: clearError } = await supabase
              .from(table)
              .update({ address_latitude: null, address_longitude: null })
              .eq(idField, confirmClearGPS.hostId);
            if (!clearError) {
              setHostCoordinates(null);
              setHostAddresses(prev => prev.map(h =>
                h.student_id === confirmClearGPS.hostId ? { ...h, address_latitude: null, address_longitude: null } : h
              ));
              toast.success('Coordinates cleared. Proximity validation disabled.');
            } else {
              toast.error('Failed to clear coordinates.');
            }
          }
          setConfirmClearGPS(null);
        }}
        onCancel={() => setConfirmClearGPS(null)}
      />
    </div>{/* end win2k-root desktop */}
  );
}
