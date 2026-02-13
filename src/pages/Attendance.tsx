import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Skeleton, TableSkeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { Tables, type Session } from '../types/database.types';
import { format } from 'date-fns';
import { getAttendanceDateOptions } from '../utils/attendanceGenerator';
import { QRCodeModal } from '../components/QRCodeModal';
import { PhotoCheckInModal } from '../components/PhotoCheckInModal';
import { logDelete, logInsert, logUpdate } from '../services/auditService';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

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

const EXCUSE_REASONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'abroad', label: 'Abroad' },
  { value: 'on working', label: 'On Working' },
  { value: 'session not held', label: 'Session Not Held' }
];

export function Attendance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const passedDate = (location.state as { selectedDate?: string })?.selectedDate;
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
          .single();

        if (teacher) {
          setIsTeacher(true);
          return;
        }

        // Fallback: check admin table (admin should be synced to teacher, but safety net)
        const { data: adminRecord } = await supabase
          .from('admin')
          .select('admin_id')
          .ilike('email', user.email)
          .single();

        if (adminRecord) {
          // Admin user — ensure teacher record exists for FK compatibility
          const { data: adminTeacher } = await supabase
            .from('teacher')
            .upsert({ name: 'Admin', email: user.email }, { onConflict: 'email' })
            .select('teacher_id')
            .single();
          if (adminTeacher) {
            setIsTeacher(true);
            return;
          }
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
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email || 'system';
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
  const [sessionNotHeld, setSessionNotHeld] = useState<boolean>(false);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [showPhotoModal, setShowPhotoModal] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [bookReferences, setBookReferences] = useState<Array<{ reference_id: string; topic: string; start_page: number; end_page: number }>>([]);
  const [selectedBookReference, setSelectedBookReference] = useState<string>('');
  const [editingLateMinutes, setEditingLateMinutes] = useState<string | null>(null);
  const [lateMinutesInput, setLateMinutesInput] = useState<string>('');
  const [confirmClearAttendance, setConfirmClearAttendance] = useState<string | null>(null);
  const [confirmSessionNotHeld, setConfirmSessionNotHeld] = useState<boolean>(false);
  const [confirmUnmarkSessionNotHeld, setConfirmUnmarkSessionNotHeld] = useState<boolean>(false);
  const [confirmClearGPS, setConfirmClearGPS] = useState<{ hostId: string; isTeacher: boolean } | null>(null);

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
          console.error('Error getting location:', error.message);
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

  // Calculate late_minutes for tiered late scoring
  // Uses session.time (e.g., "14:00") + grace_period_minutes to determine how late the student is
  // If we can't calculate exact minutes, returns a default of 1 minute when forceLate=true
  const calculateLateMinutes = (forceLate: boolean = true): number | null => {
    if (!session?.time || !selectedDate) {
      // If session has no time set but teacher is marking late, use default
      return forceLate ? 1 : null;
    }
    
    try {
      // Parse session time (e.g., "14:00" or "2:00 PM")
      const timeMatch = session.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!timeMatch) {
        return forceLate ? 1 : null;
      }
      
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3]?.toUpperCase();
      
      // Convert to 24-hour format if needed
      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      
      // Create session start datetime
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(hours, minutes, 0, 0);
      
      // Add grace period
      const gracePeriod = session.grace_period_minutes || 0;
      const graceEnd = new Date(sessionStart.getTime() + gracePeriod * 60 * 1000);
      
      // Calculate how many minutes late from grace end
      const now = new Date();
      if (now > graceEnd) {
        const lateMinutes = Math.ceil((now.getTime() - graceEnd.getTime()) / (1000 * 60));
        return Math.max(1, lateMinutes); // At least 1 minute
      }
      // If marking as late but current time shows not late, use default
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
          .select('reference_id, topic, start_page, end_page')
          .eq('course_id', data.course.course_id)
          .order('start_page', { ascending: true });
        
        if (references) {
          setBookReferences(references);
        }
      }
      
      // Generate attendance dates based on session schedule
      const dates = getAttendanceDateOptions(data);
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
      }

      if (enrollmentResult.error) {
        console.error('Error loading enrolled hosts:', enrollmentResult.error);
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
    
    // Add teacher as first option if they have address
    const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
    if (teacher?.address && teacher.address.trim() !== '') {
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
          .select('host_id, host_type, host_address')
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

      if (attendanceResult.error) {
        console.error('Error loading attendance:', attendanceResult.error);
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
        
        await supabase.from(Tables.ATTENDANCE).upsert(newRecords, {
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false
        });
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
      setAttendance([]);
    }
  }, [sessionId, selectedDate]);

  useEffect(() => {
    loadSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, passedDate]);

  useEffect(() => {
    if (selectedDate) {
      // Reset selectedAddress when date changes, loadAttendance will set it if there's a saved value
      setSelectedAddress('');
      loadHostAddresses();
      loadAttendance();
      loadSelectedBookReference();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Auto-suggest planned host based on host_date from Host Schedule
  useEffect(() => {
    // Only suggest if:
    // 1. We have a selected date
    // 2. We have host addresses loaded
    // 3. No address is currently selected (or was just reset)
    // 4. Not in "session not held" mode
    if (!selectedDate || hostAddresses.length === 0 || selectedAddress || sessionNotHeld) {
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
      
      // Update coordinates from the suggested host
      if (plannedHost.address_latitude && plannedHost.address_longitude) {
        setHostCoordinates({
          lat: plannedHost.address_latitude,
          lon: plannedHost.address_longitude
        });
      } else {
        setHostCoordinates(null);
      }
    }
  }, [selectedDate, hostAddresses, selectedAddress, sessionNotHeld, sessionId]);

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
      await supabase
        .from(Tables.SESSION_BOOK_COVERAGE)
        .delete()
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate);
    }
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
    
    // Load coordinates from the selected host (student/teacher table)
    if (hostInfo?.address_latitude && hostInfo?.address_longitude) {
      setHostCoordinates({
        lat: hostInfo.address_latitude,
        lon: hostInfo.address_longitude
      });
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
          // Add late_minutes for tiered late scoring
          updates.late_minutes = status === 'late' ? calculateLateMinutes() : null;
        } else if (status === 'excused') {
          updates.excuse_reason = excuseReason[attendanceId];
          updates.late_minutes = null;
        } else {
          updates.check_in_time = null;
          updates.late_minutes = null;
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
        const newRecord: Record<string, unknown> = {
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: actualStatus,
          check_in_time: (status === 'on time' || status === 'late') ? new Date().toISOString() : null,
          late_minutes: status === 'late' ? calculateLateMinutes() : null,
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
      // Update existing record
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
        updates.check_in_time = new Date().toISOString();
        // Add late_minutes for tiered late scoring
        updates.late_minutes = status === 'late' ? calculateLateMinutes() : null;
      } else if (status === 'excused') {
        updates.excuse_reason = excuseReason[attendanceId];
        updates.late_minutes = null;
      } else {
        updates.check_in_time = null;
        updates.late_minutes = null;
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
        check_in_method: 'bulk', // Track bulk marking
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
        
        await supabase.from(Tables.ATTENDANCE).upsert(newRecords, {
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false
        });
        // Audit log: session not held insert
        try { for (const r of newRecords) { await logInsert('attendance', r.enrollment_id, r as Record<string, unknown>, 'Session marked not held'); } } catch { /* audit non-critical */ }
      }
      
      // Update existing records
      if (realIds.length > 0) {
        await supabase
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
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold">Mark Attendance</h1>
        {selectedDate && !sessionNotHeld && (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (!selectedAddress || selectedAddress === '') {
                  toast.warning('Please select a host address first before generating QR code.');
                  return;
                }
                setShowQRModal(true);
              }}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 flex items-center gap-2"
            >
              <span className="text-xl">📱</span>
              <span className="hidden sm:inline">QR Code</span>
            </Button>
            <Button
              onClick={() => {
                if (!selectedAddress || selectedAddress === '') {
                  toast.warning('Please select a host address first before generating Face Check-In link.');
                  return;
                }
                setShowPhotoModal(true);
              }}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 flex items-center gap-2"
            >
              <span className="text-xl">📸</span>
              <span className="hidden sm:inline">Face Check-In</span>
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Date</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Quick Navigation Buttons */}
          <div className="flex items-center gap-2 mb-4">
            <Button
              onClick={() => {
                const currentIndex = availableDates.findIndex(d => d.value === selectedDate);
                if (currentIndex > 0) {
                  setSelectedDate(availableDates[currentIndex - 1].value);
                }
              }}
              disabled={!selectedDate || availableDates.findIndex(d => d.value === selectedDate) === 0}
              className="bg-gray-600 hover:bg-gray-700 flex-1 sm:flex-none"
            >
              ← Previous
            </Button>
            
            <div className="flex-1 text-center">
              {selectedDate && (
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {format(new Date(selectedDate), 'EEEE, MMM dd, yyyy')}
                </div>
              )}
            </div>
            
            <Button
              onClick={() => {
                const currentIndex = availableDates.findIndex(d => d.value === selectedDate);
                if (currentIndex < availableDates.length - 1) {
                  setSelectedDate(availableDates[currentIndex + 1].value);
                }
              }}
              disabled={!selectedDate || availableDates.findIndex(d => d.value === selectedDate) === availableDates.length - 1}
              className="bg-gray-600 hover:bg-gray-700 flex-1 sm:flex-none"
            >
              Next →
            </Button>
          </div>
          
          {/* Dropdown for jumping to specific date */}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800 font-medium">
              📅 Jump to specific date
            </summary>
            <div className="mt-3">
              <Select
                value={selectedDate}
                onChange={(value) => setSelectedDate(value)}
                options={availableDates}
                placeholder="Select a date"
              />
            </div>
          </details>
          
          {availableDates.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              No attendance dates available. Please check the session schedule.
            </p>
          )}
        </CardContent>
      </Card>

      {selectedDate && (
        <Card>
          <CardHeader>
            <CardTitle>Session Status</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-center gap-3 p-3 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
              <input
                type="checkbox"
                checked={sessionNotHeld}
                onChange={handleSessionNotHeld}
                className="h-5 w-5 text-red-600 focus:ring-red-500 border-gray-300 dark:border-gray-500 rounded"
              />
              <div>
                <span className="font-medium text-gray-900 dark:text-white">Session Not Held</span>
                <p className="text-sm text-gray-500 dark:text-gray-400">Mark this date if the session was cancelled or did not take place</p>
              </div>
            </label>
          </CardContent>
        </Card>
      )}

      {selectedDate && hostAddresses.length > 0 && !sessionNotHeld && (
        <Card>
          <CardHeader>
            <CardTitle>Host Address</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedAddress}
              onChange={handleHostAddressChange}
              options={hostAddresses.map(host => ({
                value: `${host.student_id}|||${host.address}`,
                label: host.host_date === selectedDate 
                  ? `📅 ${host.student_name} - ${host.address} (Scheduled Today)`
                  : `${host.student_name} - ${host.address}`
              }))}
              placeholder="Select host address"
            />
            {selectedAddress && selectedAddress !== 'SESSION_NOT_HELD' && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  📍 Selected Address: <span className="font-medium">{selectedAddress.split('|||')[1] || selectedAddress}</span>
                </p>
                
                {/* GPS Coordinates Section */}
                <div className="mt-4 border-t border-blue-200 pt-4">
                  <p className="text-sm font-medium text-blue-900 mb-2">🌐 GPS Coordinates (for proximity validation)</p>
                  
                  {/* Show current coordinates if set */}
                  {hostCoordinates ? (
                    <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded">
                      <p className="text-sm text-green-800">
                        ✅ <span className="font-medium">Coordinates set:</span> {hostCoordinates.lat.toFixed(6)}, {hostCoordinates.lon.toFixed(6)}
                      </p>
                      <p className="text-xs text-green-600 mt-1">
                        Proximity validation is active. Students must be within {session?.proximity_radius || '?'}m to check in.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 mb-3 p-2 bg-amber-50 border border-amber-200 rounded">
                      ⚠️ No coordinates set. Proximity validation is disabled. Students can check in from anywhere.
                    </p>
                  )}
                  
                  <button
                    onClick={async () => {
                      const currentCoords = hostCoordinates ? `${hostCoordinates.lat},${hostCoordinates.lon}` : '';
                      const coords = prompt(
                        'Enter GPS coordinates in format: latitude,longitude\n\n' +
                        'Example: 33.5138,36.2765\n\n' +
                        'How to find coordinates:\n' +
                        '• Right-click a location on Google Maps\n' +
                        '• Use your phone GPS app\n' +
                        '• Leave blank to disable proximity validation',
                        currentCoords
                      );
                      
                      if (coords === null) return; // Cancelled
                      
                      // Get selected host info
                      const addressParts = selectedAddress.split('|||');
                      const hostId = addressParts[0];
                      const hostInfo = hostAddresses.find(h => h.student_id === hostId);
                      const isTeacher = hostInfo?.is_teacher || hostInfo?.student_name?.includes('Teacher');
                      
                      if (!hostId || !hostInfo) {
                        toast.warning('No host selected. Please select a host address first.');
                        return;
                      }
                      
                      if (coords.trim() === '') {
                        // Clear coordinates
                        setConfirmClearGPS({ hostId, isTeacher: !!isTeacher });
                        return;
                      }
                      
                      // Parse coordinates
                      const parts = coords.split(',');
                      if (parts.length !== 2) {
                        toast.error('Invalid format. Please use: latitude,longitude');
                        return;
                      }
                      
                      const lat = parseFloat(parts[0].trim());
                      const lon = parseFloat(parts[1].trim());
                      
                      const isValidLat = !isNaN(lat) && lat >= -90 && lat <= 90;
                      const isValidLon = !isNaN(lon) && lon >= -180 && lon <= 180;
                      
                      if (!isValidLat || !isValidLon) {
                        toast.error('Invalid coordinates. Latitude must be -90 to 90, longitude must be -180 to 180.');
                        return;
                      }
                      
                      // Save coordinates to student/teacher table (persistent)
                      const table = isTeacher ? Tables.TEACHER : Tables.STUDENT;
                      const idField = isTeacher ? 'teacher_id' : 'student_id';
                      
                      const { error } = await supabase
                        .from(table)
                        .update({ 
                          address_latitude: lat,
                          address_longitude: lon 
                        })
                        .eq(idField, hostId);
                      
                      if (error) {
                        console.error('Failed to save coordinates:', error);
                        toast.error('Failed to save coordinates. Please try again.');
                      } else {
                        setHostCoordinates({ lat, lon });
                        // Update local hostAddresses state
                        setHostAddresses(prev => prev.map(h => 
                          h.student_id === hostId 
                            ? { ...h, address_latitude: lat, address_longitude: lon }
                            : h
                        ));
                        toast.success('Coordinates saved! Lat: ' + lat + ', Lon: ' + lon + '. Proximity validation is now enabled.');
                      }
                    }}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    📍 Set/Update GPS Coordinates
                  </button>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    💡 Tip: Proximity radius is {session?.proximity_radius || 'not set'}{session?.proximity_radius ? 'm' : ''}. Update in Sessions page if needed.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedDate && bookReferences.length > 0 && !sessionNotHeld && (
        <Card>
          <CardHeader>
            <CardTitle>📚 Book Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedBookReference}
              onChange={handleBookReferenceChange}
              options={[
                { value: '', label: 'Select what topic was covered today...' },
                ...bookReferences.map(ref => ({
                  value: ref.reference_id,
                  label: `${ref.topic} (Pages ${ref.start_page}-${ref.end_page})`
                }))
              ]}
              placeholder="Select book reference"
            />
            {selectedBookReference && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                {(() => {
                  const selected = bookReferences.find(r => r.reference_id === selectedBookReference);
                  if (selected) {
                    return (
                      <div className="flex items-start gap-2">
                        <span className="text-xl">📚</span>
                        <div>
                          <p className="font-semibold text-blue-900">{selected.topic}</p>
                          <p className="text-sm text-blue-700 mt-1">
                            Pages {selected.start_page} - {selected.end_page} ({selected.end_page - selected.start_page + 1} pages)
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
            {bookReferences.length > 0 && !selectedBookReference && (
              <p className="mt-2 text-xs text-gray-500">
                💡 Tip: Select which topic was covered in today's session for better tracking
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {selectedDate && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    Attendance for {format(new Date(selectedDate), 'MMMM dd, yyyy')}
                  </CardTitle>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {session.location || 'No location specified'} • {session.time || 'No time specified'}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Course: {courseName}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  {selectedStudents.size > 0 ? (
                    <>
                      <Button
                        onClick={() => handleBulkUpdate('on time')}
                        className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm"
                      >
                        On Time ({selectedStudents.size})
                      </Button>
                      <Button
                        onClick={() => handleBulkUpdate('absent')}
                        className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm"
                      >
                        Absent ({selectedStudents.size})
                      </Button>
                      <Button
                        onClick={() => handleBulkUpdate('late')}
                        className="bg-yellow-600 hover:bg-yellow-700 text-xs sm:text-sm"
                      >
                        Late ({selectedStudents.size})
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={handleSelectAll}
                      className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm"
                    >
                      Select All ({attendance.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {attendance.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No students enrolled in this session
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {attendance.filter(a => a.status !== 'not enrolled').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">
                        {attendance.filter(a => a.status === 'on time').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">On Time</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">
                        {attendance.filter(a => a.status === 'absent').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Absent</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                        {attendance.filter(a => a.status === 'late').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Late</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {attendance.filter(a => a.status === 'excused').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Excused</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-400 dark:text-gray-500">
                        {attendance.filter(a => a.status === 'pending').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Not Marked</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-500 dark:text-gray-400">
                        {attendance.filter(a => a.status === 'not enrolled').length}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Not Enrolled</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={
                        attendance.filter(a => a.status !== 'not enrolled').length > 0 &&
                        selectedStudents.size === attendance.filter(a => a.status !== 'not enrolled').length
                      }
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-500 rounded"
                    />
                    <span className="text-sm font-medium dark:text-gray-300">Select All</span>
                  </div>
                  {/* Search input for students */}
                  <div className="mb-2">
                    <input
                      type="text"
                      placeholder="Search student by name or email..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 bg-white dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    />
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
                    .map((record) => {
                      const isNotEnrolled = record.status === 'not enrolled';
                      return (
                    <div
                      key={record.attendance_id}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border dark:border-gray-600 rounded-lg gap-3 ${
                        isNotEnrolled ? 'bg-gray-50 dark:bg-gray-700/50 opacity-60' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(record.attendance_id)}
                          onChange={() => handleSelectStudent(record.attendance_id)}
                          disabled={isNotEnrolled}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate dark:text-white">{record.student.name}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{record.student.email}</p>
                          {record.check_in_time && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              Checked in: {format(new Date(record.check_in_time), 'HH:mm:ss')}
                            </p>
                          )}
                          {/* Inline late_minutes editor */}
                          {record.status === 'late' && !record.attendance_id.startsWith('temp-') && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                Late:
                              </span>
                              {editingLateMinutes === record.attendance_id ? (
                                <span className="flex items-center gap-1">
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
                                    className="w-14 px-1.5 py-0.5 text-xs border border-yellow-400 dark:border-yellow-600 rounded bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                                  />
                                  <span className="text-xs text-gray-500 dark:text-gray-400">min</span>
                                  <button
                                    onClick={() => saveLateMinutes(record.attendance_id)}
                                    className="p-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400"
                                    title="Save"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                  </button>
                                  <button
                                    onClick={() => { setEditingLateMinutes(null); setLateMinutesInput(''); }}
                                    className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 dark:text-red-400"
                                    title="Cancel"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingLateMinutes(record.attendance_id);
                                    setLateMinutesInput(String(record.late_minutes ?? ''));
                                  }}
                                  className="group flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800/50 transition-colors"
                                  title="Click to edit late duration"
                                >
                                  {record.late_minutes != null ? `${record.late_minutes} min` : '—'}
                                  <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                              )}
                            </div>
                          )}
                          {isNotEnrolled && record.enrollment_date && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">
                              Enrolled on: {format(new Date(record.enrollment_date), 'MMM dd, yyyy')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        {getStatusBadge(record.status)}
                        {!isNotEnrolled && (
                          <>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'on time')}
                          className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          On Time
                        </Button>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'absent')}
                          className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          Absent
                        </Button>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'late')}
                          className="bg-yellow-600 hover:bg-yellow-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          Late
                        </Button>
                        <div className="flex items-center gap-1">
                          {excuseDropdownOpen === record.attendance_id ? (
                            <>
                              <select
                                autoFocus
                                value={excuseReason[record.attendance_id] || ''}
                                onChange={(e) => setExcuseReason(prev => ({ ...prev, [record.attendance_id]: e.target.value }))}
                                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs sm:text-sm font-medium bg-white dark:bg-gray-700 dark:text-white"
                              >
                                <option value="">Select reason...</option>
                                {EXCUSE_REASONS.map(reason => (
                                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                                ))}
                              </select>
                              <Button
                                onClick={() => {
                                  if (!excuseReason[record.attendance_id]) {
                                    toast.warning('Please select an excuse reason');
                                  } else {
                                    updateAttendance(record.attendance_id, 'excused');
                                    setExcuseDropdownOpen(null);
                                  }
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm px-2 sm:px-4"
                                size="sm"
                              >
                                Confirm
                              </Button>
                              <Button
                                onClick={() => {
                                  setExcuseDropdownOpen(null);
                                  setExcuseReason(prev => {
                                    const updated = { ...prev };
                                    delete updated[record.attendance_id];
                                    return updated;
                                  });
                                }}
                                className="bg-gray-400 hover:bg-gray-500 text-xs sm:text-sm px-2 sm:px-4 text-white"
                                size="sm"
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              onClick={() => setExcuseDropdownOpen(record.attendance_id)}
                              className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm px-2 sm:px-4"
                              size="sm"
                            >
                              Excused
                            </Button>
                          )}
                        </div>
                        <Button
                          onClick={() => clearAttendance(record.attendance_id)}
                          className="bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-xs sm:text-sm px-2 sm:px-4 text-gray-700 dark:text-gray-200"
                          size="sm"
                        >
                          Clear
                        </Button>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* QR Code Modal */}
      {showQRModal && sessionId && selectedDate && (
        <QRCodeModal
          sessionId={sessionId}
          date={selectedDate}
          courseName={courseName}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {/* Photo Check-In Modal */}
      {showPhotoModal && sessionId && selectedDate && (
        <PhotoCheckInModal
          sessionId={sessionId}
          date={selectedDate}
          courseName={courseName}
          onClose={() => setShowPhotoModal(false)}
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
        onConfirm={() => {
          if (confirmClearAttendance) doClearAttendance(confirmClearAttendance);
          setConfirmClearAttendance(null);
        }}
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
        onConfirm={() => {
          setConfirmSessionNotHeld(false);
          doMarkSessionNotHeld();
        }}
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
        onConfirm={() => {
          setConfirmUnmarkSessionNotHeld(false);
          doUnmarkSessionNotHeld();
        }}
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
                h.student_id === confirmClearGPS.hostId
                  ? { ...h, address_latitude: null, address_longitude: null }
                  : h
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
    </div>
  );
}
