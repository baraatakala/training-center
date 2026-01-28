import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
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
import { logDelete } from '../services/auditService';

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
  const passedDate = (location.state as { selectedDate?: string })?.selectedDate;
  const [session, setSession] = useState<Session | null>(null);

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
  const [sessionNotHeld, setSessionNotHeld] = useState<boolean>(false);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [bookReferences, setBookReferences] = useState<Array<{ reference_id: string; topic: string; start_page: number; end_page: number }>>([]);
  const [selectedBookReference, setSelectedBookReference] = useState<string>('');

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
      // First, load the session to get teacher info
      const { data: sessionData, error: sessionError } = await supabase
        .from(Tables.SESSION)
        .select(`
          teacher_id,
          teacher:teacher_id (
            teacher_id,
            name,
            address
          )
        `)
        .eq('session_id', sessionId)
        .single();

      if (sessionError) {
        console.error('Error loading session teacher:', sessionError);
      }

      // Load ALL students with non-null addresses from student table
      const { data: students, error: studentsError } = await supabase
        .from(Tables.STUDENT)
        .select('student_id, name, address')
        .not('address', 'is', null)
        .neq('address', '');

      if (studentsError) {
        console.error('Error loading host addresses:', studentsError);
        setHostAddresses([]);
        return;
      }

      if (!students || students.length === 0) {
        setHostAddresses([]);
        return;
      }

    // Map to HostInfo format
    const allHosts: HostInfo[] = students
      .map((s: { student_id: string; name: string; address: string }) => ({
        student_id: s.student_id,
        student_name: s.name,
        address: s.address,
        host_date: null,
        is_active: true
      }));
    
    // Add teacher as first option if they have address
    const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
    if (teacher?.address && teacher.address.trim() !== '') {
      allHosts.unshift({
        student_id: teacher.teacher_id,
        student_name: `🎓 ${teacher.name} (Teacher)`,
        address: teacher.address,
        host_date: null,
        is_active: true
      });
    }
    
    // Sort student hosts alphabetically (teacher already at top)
    const teacherHost = allHosts.filter(h => h.student_name.includes('Teacher'));
    const studentHosts = allHosts.filter(h => !h.student_name.includes('Teacher'));
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
      // Load host address from session_date_host table (single source of truth)
      const { data: hostData } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('host_id, host_type, host_address')
        .eq('session_id', sessionId)
        .eq('attendance_date', selectedDate)
        .maybeSingle();

      // Check existing attendance records
      const { data: existingAttendance, error: attendanceError } = await supabase
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
        student_id,
        student:student_id(student_id, name, email)
      `)
      .eq('session_id', sessionId)
      .eq('attendance_date', selectedDate);

      if (attendanceError) {
        console.error('Error loading attendance:', attendanceError);
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
      } else if (savedHostId) {
        // We have host_id from new table - use it directly
        setSelectedAddress(`${savedHostId}|||${savedHostAddress}`);
        setSessionNotHeld(false);
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
        
        await supabase.from(Tables.ATTENDANCE).insert(newRecords);
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
        alert('Failed to save book reference selection');
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
        alert('Failed to save host address selection');
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

  const updateAttendance = async (attendanceId: string, status: string) => {
    const record = attendance.find(a => a.attendance_id === attendanceId);
    if (!record) return;

    // Prevent marking attendance for students not yet enrolled
    if (record.status === 'not enrolled') {
      alert('Cannot mark attendance: Student was not enrolled on this date');
      return;
    }

    // Validate host address is selected
    if (!selectedAddress || selectedAddress === '') {
      alert('Please select a host address before marking attendance');
      return;
    }

    // Validate excuse reason if status is excused
    if (status === 'excused' && !excuseReason[attendanceId]) {
      alert('Please select an excuse reason before marking as excused');
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
        } else if (status === 'excused') {
          updates.excuse_reason = excuseReason[attendanceId];
        } else {
          updates.check_in_time = null;
        }

        const { error } = await supabase
          .from(Tables.ATTENDANCE)
          .update(updates)
          .eq('attendance_id', existingRecord.attendance_id);

        if (error) {
          console.error('Error updating existing attendance:', error);
          alert(`Error: ${error.message}`);
        } else {
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
          .insert([newRecord]);

        if (error) {
          console.error('Error creating attendance:', error);
          alert(`Error: ${error.message}`);
        } else {
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
      } else if (status === 'excused') {
        updates.excuse_reason = excuseReason[attendanceId];
      } else {
        updates.check_in_time = null;
      }

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .update(updates)
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('Error updating attendance:', error);
        alert(`Error: ${error.message}`);
      } else {
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
  const clearAttendance = async (attendanceId: string) => {
    const ok = window.confirm('Clear attendance for this student? This will remove the recorded status.');
    if (!ok) return;

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
        alert('Failed to clear attendance: ' + error.message);
        return;
      }

      // Optimistically update UI
      setAttendance((prev) => prev.map(a => a.attendance_id === attendanceId ? { ...a, status: 'pending', check_in_time: null } : a));
      // Reload to ensure consistent state
      loadAttendance();
    } catch (err: unknown) {
      console.error('Exception clearing attendance:', err);
      const errMessage = err instanceof Error ? err.message : String(err);
      alert('Failed to clear attendance: ' + errMessage);
    }
  };

  const handleBulkUpdate = async (status: string) => {
    if (selectedStudents.size === 0) {
      alert('Please select students first');
      return;
    }

    // Validate host address is selected
    if (!selectedAddress || selectedAddress === '') {
      alert('Please select a host address before marking attendance');
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
        .insert(newRecords);

      if (insertError) {
        console.error('Error creating attendance:', insertError);
        alert(`Error: ${insertError.message}`);
        return;
      }
    }

    // Update existing records
    if (realIds.length > 0) {
      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;
      const updates: {
        status: string;
        check_in_time?: string | null;
        host_address?: string | null;
        gps_latitude?: number | null;
        gps_longitude?: number | null;
        gps_accuracy?: number | null;
        gps_timestamp?: string | null;
        marked_by?: string;
        marked_at?: string;
      } = {
        status: status,
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
        alert(`Error: ${updateError.message}`);
        return;
      }
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
      // Marking as not held
      const confirmed = window.confirm(
        'Mark this session as NOT HELD?\n\n' +
        'This will:\n' +
        '• Mark all students as EXCUSED (session cancelled)\n' +
        '• Set excuse reason to "Session Not Held"\n' +
        '• Set host address to "Session Not Held"\n' +
        '• This date will be skipped in rotation calculations'
      );
      
      if (!confirmed) return;
      
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
        
        await supabase.from(Tables.ATTENDANCE).insert(newRecords);
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
    } else {
      // Unmarking - clear all attendance
      const confirmed = window.confirm('Unmark "Session Not Held"? This will clear all attendance records for this date.');
      if (!confirmed) return;
      
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
    }
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
        return <Badge variant="default" className="bg-gray-300 text-gray-600">Not Enrolled</Badge>;
      case 'pending':
        return <Badge variant="default">Not Marked</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (loading) {
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
        <p className="text-gray-500">Session not found</p>
      </div>
    );
  }

  const sessionInfo = (session as Session & { course?: { course_name: string } })?.course;
  const courseName = sessionInfo?.course_name || 'Unknown Course';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Mark Attendance</h1>
        {selectedDate && !sessionNotHeld && (
          <Button
            onClick={() => setShowQRModal(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 flex items-center gap-2"
          >
            <span className="text-xl">📱</span>
            <span className="hidden sm:inline">Generate QR Code</span>
            <span className="sm:hidden">QR Code</span>
          </Button>
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
                <div className="text-sm font-medium text-gray-700">
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
            <p className="text-sm text-gray-500 mt-2">
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
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={sessionNotHeld}
                onChange={handleSessionNotHeld}
                className="h-5 w-5 text-red-600 focus:ring-red-500 border-gray-300 rounded"
              />
              <div>
                <span className="font-medium text-gray-900">Session Not Held</span>
                <p className="text-sm text-gray-500">Mark this date if the session was cancelled or did not take place</p>
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
                label: `${host.student_name} - ${host.address}`
              }))}
              placeholder="Select host address"
            />
            {selectedAddress && selectedAddress !== 'SESSION_NOT_HELD' && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  📍 Selected Address: <span className="font-medium">{selectedAddress.split('|||')[1] || selectedAddress}</span>
                </p>
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
                  <p className="text-sm text-gray-500 mt-1">
                    {session.location || 'No location specified'} • {session.time || 'No time specified'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
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
                <p className="text-center text-gray-500 py-8">
                  No students enrolled in this session
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg">
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-900">
                        {attendance.filter(a => a.status !== 'not enrolled').length}
                      </div>
                      <div className="text-xs text-gray-600">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-green-600">
                        {attendance.filter(a => a.status === 'on time').length}
                      </div>
                      <div className="text-xs text-gray-600">On Time</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-red-600">
                        {attendance.filter(a => a.status === 'absent').length}
                      </div>
                      <div className="text-xs text-gray-600">Absent</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-yellow-600">
                        {attendance.filter(a => a.status === 'late').length}
                      </div>
                      <div className="text-xs text-gray-600">Late</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-blue-600">
                        {attendance.filter(a => a.status === 'excused').length}
                      </div>
                      <div className="text-xs text-gray-600">Excused</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-400">
                        {attendance.filter(a => a.status === 'pending').length}
                      </div>
                      <div className="text-xs text-gray-600">Not Marked</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-500">
                        {attendance.filter(a => a.status === 'not enrolled').length}
                      </div>
                      <div className="text-xs text-gray-600">Not Enrolled</div>
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
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium">Select All</span>
                  </div>
                  {/* Search input for students */}
                  <div className="mb-2">
                    <input
                      type="text"
                      placeholder="Search student by name or email..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-3 ${
                        isNotEnrolled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(record.attendance_id)}
                          onChange={() => handleSelectStudent(record.attendance_id)}
                          disabled={isNotEnrolled}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{record.student.name}</h3>
                          <p className="text-sm text-gray-500 truncate">{record.student.email}</p>
                          {record.check_in_time && (
                            <p className="text-xs text-gray-400 mt-1">
                              Checked in: {format(new Date(record.check_in_time), 'HH:mm:ss')}
                            </p>
                          )}
                          {isNotEnrolled && record.enrollment_date && (
                            <p className="text-xs text-gray-500 mt-1 italic">
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
                                className="px-2 py-1 border border-gray-300 rounded text-xs sm:text-sm font-medium"
                              >
                                <option value="">Select reason...</option>
                                {EXCUSE_REASONS.map(reason => (
                                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                                ))}
                              </select>
                              <Button
                                onClick={() => {
                                  if (!excuseReason[record.attendance_id]) {
                                    alert('Please select an excuse reason');
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
                          className="bg-gray-200 hover:bg-gray-300 text-xs sm:text-sm px-2 sm:px-4 text-gray-700"
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
    </div>
  );
}
