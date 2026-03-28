import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authService } from '@/shared/services/authService';
import { checkinService } from '@/features/checkin/services/checkinService';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { format } from 'date-fns';
import { isWithinProximity, formatDistance } from '@/shared/services/geocodingService';
import { logInsert } from '@/shared/services/auditService';
import { feedbackService } from '@/features/feedback/services/feedbackService';

const SessionFeedbackForm = lazy(() => import('@/features/feedback/components/SessionFeedbackForm'));

type CheckInData = {
  session_id: string;
  attendance_date: string;
  token: string;
  session?: {
    course?: {
      course_name: string;
    };
    time?: string;
    location?: string;
    grace_period_minutes?: number;
    proximity_radius?: number;
  };
};

type HostInfo = {
  student_id: string;
  student_name: string;
  address: string | null;
  host_date: string | null;
  is_teacher?: boolean;
};

export function StudentCheckIn() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [wasLate, setWasLate] = useState(false);
  const [checkedInAfterSession, setCheckedInAfterSession] = useState(false);
  const [checkInData, setCheckInData] = useState<CheckInData | null>(null);
  const [studentInfo, setStudentInfo] = useState<{ student_id: string; name: string; email: string } | null>(null);
  const [hostAddresses, setHostAddresses] = useState<HostInfo[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Small delay to ensure auth state is fully propagated after login redirect
    const timer = setTimeout(() => {
      validateAndLoadCheckIn();
    }, 100);
    return () => { clearTimeout(timer); if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const validateAndLoadCheckIn = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!token) {
        setError('Invalid QR code: No token provided');
        setLoading(false);
        return;
      }

      // STEP 1: Check authentication FIRST (required for RLS to work)
      // Use getSession for more reliable session state after redirect
      const { data: { session: authSession }, error: authError } = await authService.getSession();
      
      if (authError || !authSession?.user) {
        // Redirect to login with return URL - user must log in first
        const returnUrl = encodeURIComponent(window.location.pathname);
        navigate(`/login?returnUrl=${returnUrl}`);
        return;
      }
      
      const user = authSession.user;

      // STEP 2: Validate QR token via database (requires authentication)
      const { data: qrSession, error: qrError } = await checkinService
        .validateQrToken(token);

      if (qrError || !qrSession) {
        console.error('QR validation error:', qrError);
        setError('Invalid QR code. Please ask your teacher to generate a new one.');
        setLoading(false);
        return;
      }

      // Check if expired
      if (new Date(qrSession.expires_at) < new Date()) {
        setError(`QR code expired at ${format(new Date(qrSession.expires_at), 'HH:mm')}. Please ask your teacher to generate a new one.`);
        setLoading(false);
        return;
      }

      // Check if invalidated
      if (!qrSession.is_valid) {
        setError('QR code is no longer valid. Please ask your teacher to generate a new one.');
        setLoading(false);
        return;
      }

      if (qrSession.check_in_mode === 'photo') {
        if (!qrSession.linked_photo_token) {
          setError('This face check-in QR is missing its linked session. Please ask your teacher to generate a new one.');
          setLoading(false);
          return;
        }

        const { data: linkedPhotoSession, error: linkedPhotoError } = await checkinService
          .validateLinkedPhotoToken(qrSession.linked_photo_token);

        if (
          linkedPhotoError ||
          !linkedPhotoSession ||
          !linkedPhotoSession.is_valid ||
          new Date(linkedPhotoSession.expires_at).getTime() <= Date.now() ||
          linkedPhotoSession.session_id !== qrSession.session_id ||
          linkedPhotoSession.attendance_date !== qrSession.attendance_date
        ) {
          setError('This face check-in QR is linked to an invalid or expired photo session. Please ask your teacher to generate a new one.');
          setLoading(false);
          return;
        }

        navigate(`/photo-checkin/${qrSession.linked_photo_token}`, { replace: true });
        return;
      }

      // Extract session_id and date from validated QR session
      const sessionId = qrSession.session_id;
      const date = qrSession.attendance_date;

      // STEP 3: Get student info (case-insensitive email lookup)
      const { data: student, error: studentError } = await checkinService
        .getStudentByEmail(user.email || '');

      if (studentError || !student) {
        setError('Student account not found. Please contact administration.');
        setLoading(false);
        return;
      }

      setStudentInfo(student);

      // STEP 4: Load session details
      const { data: session, error: sessionError } = await checkinService
        .getSessionDetails(sessionId);

      if (sessionError) {
        console.error('Session error:', sessionError);
        setError(`Invalid session: ${sessionError.message || 'Session not found'}`);
        setLoading(false);
        return;
      }

      if (!session) {
        setError('Invalid session');
        setLoading(false);
        return;
      }

      // STEP 5: Verify student is enrolled
      const { data: enrollment, error: enrollmentError } = await checkinService
        .getEnrollment(sessionId, student.student_id);

      if (enrollmentError) {
        console.error('Enrollment error:', enrollmentError);
        setError(`You are not enrolled in this session (${enrollmentError.message})`);
        setLoading(false);
        return;
      }

      if (!enrollment) {
        setError('You are not enrolled in this session');
        setLoading(false);
        return;
      }

      // STEP 6: Check if already checked in
      const { data: existingAttendance } = await checkinService
        .getExistingAttendance(sessionId, student.student_id, date);

      if (existingAttendance && existingAttendance.status !== 'absent') {
        setError('You have already checked in for this session');
        setLoading(false);
        return;
      }

      // STEP 7: Load ALL host addresses (students with addresses + teacher)
      // First, get session's teacher info
      const { data: sessionData } = await checkinService
        .getSessionTeacherInfo(sessionId);

      // Load ALL students with non-null addresses
      const { data: allStudentsWithAddress } = await checkinService
        .getStudentsWithAddresses();

      const hostList: HostInfo[] = [];

      // Add teacher as first option if they have address
      const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
      if (teacher?.address && teacher.address.trim() !== '') {
        hostList.push({
          student_id: teacher.teacher_id,
          student_name: `Ã°Å¸Å½â€œ ${teacher.name} (Teacher)`,
          address: teacher.address,
          host_date: null,
          is_teacher: true
        });
      }

      // Add all students with addresses
      if (allStudentsWithAddress) {
        const studentHosts: HostInfo[] = allStudentsWithAddress
          .map((s: { student_id: string; name: string; address: string }) => ({
            student_id: s.student_id,
            student_name: s.name,
            address: s.address,
            host_date: null,
            is_teacher: false
          }))
          .sort((a, b) => a.student_name.localeCompare(b.student_name));
        hostList.push(...studentHosts);
      }

      setHostAddresses(hostList);

      // STEP 8: Check if host is already set for this date in session_date_host table
      const { data: hostData } = await checkinService
        .getSessionDateHost(sessionId, date);

      // VALIDATION: Host address MUST be set by teacher
      if (!hostData?.host_address || hostData.host_address === 'SESSION_NOT_HELD') {
        setError('Ã¢ÂÅ’ Host address not set. Please ask your teacher to select a host address before check-in.');
        setLoading(false);
        return;
      }

      // Set the pre-saved host address (read-only for students)
      if (hostData.host_id) {
        setSelectedAddress(`${hostData.host_id}|||${hostData.host_address}`);
      } else {
        setSelectedAddress(`unknown|||${hostData.host_address}`);
      }

      // Handle both single object and array from Supabase for course relation
      const courseData = session.course ? (Array.isArray(session.course) ? session.course[0] : session.course) : undefined;
      
      setCheckInData({
        session_id: sessionId,
        attendance_date: date,
        token: token!,
        session: {
          course: courseData,
          time: session.time,
          location: session.location,
          grace_period_minutes: session.grace_period_minutes,
          proximity_radius: session.proximity_radius,
        },
      });

      setLoading(false);
    } catch (err: unknown) {
      console.error('Validation error:', err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const captureGPSLocation = (): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  } | null> => {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        console.warn('Geolocation not supported by browser');
        reject(new Error('GPS_NOT_SUPPORTED'));
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
          console.error('GPS error:', error);
          if (error.code === error.PERMISSION_DENIED) {
            reject(new Error('GPS_PERMISSION_DENIED'));
          } else if (error.code === error.TIMEOUT) {
            reject(new Error('GPS_TIMEOUT'));
          } else {
            reject(new Error('GPS_UNAVAILABLE'));
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  const handleCheckIn = async () => {
    if (!checkInData || !studentInfo) return;

    setSubmitting(true);
    setError(null);

    try {
      // PROXIMITY VALIDATION: First check if host has coordinates set
      // Get host info from session_date_host
      const { data: hostData } = await checkinService
        .getSessionDateHost(checkInData.session_id, checkInData.attendance_date);

      // Load coordinates from student/teacher table (persistent storage)
      let hostLat: number | null = null;
      let hostLon: number | null = null;
      
      if (hostData?.host_id) {
        const isTeacher = hostData.host_type === 'teacher';
        
        const { data: coordData } = await checkinService
          .getHostCoordinates(hostData.host_id, isTeacher);
        
        if (coordData?.address_latitude && coordData?.address_longitude) {
          hostLat = Number(coordData.address_latitude);
          hostLon = Number(coordData.address_longitude);
        }
      }

      // Determine if proximity validation is required
      const proximityRequired = checkInData.session?.proximity_radius && hostLat && hostLon;
      
      // Capture GPS - required if proximity validation is enabled
      let gpsData: { latitude: number; longitude: number; accuracy: number; timestamp: string } | null = null;
      
      try {
        gpsData = await captureGPSLocation();
      } catch (gpsError) {
        const errorMessage = (gpsError as Error).message;
        
        if (proximityRequired) {
          // GPS is REQUIRED but failed - block check-in
          if (errorMessage === 'GPS_PERMISSION_DENIED') {
            setError('Ã¢ÂÅ’ Location permission denied!\n\nGPS is required for check-in at this session.\n\nPlease enable location access in your browser settings and try again.');
          } else if (errorMessage === 'GPS_TIMEOUT') {
            setError('Ã¢ÂÅ’ Could not get your location (timeout).\n\nGPS is required for check-in. Please ensure you have a clear view of the sky and try again.');
          } else if (errorMessage === 'GPS_NOT_SUPPORTED') {
            setError('Ã¢ÂÅ’ Your browser does not support GPS.\n\nPlease use a modern browser with location services enabled.');
          } else {
            setError('Ã¢ÂÅ’ Could not get your location.\n\nGPS is required for check-in at this session. Please try again.');
          }
          setSubmitting(false);
          return;
        }
        // GPS failed but not required - continue without it
        console.warn('GPS failed but proximity not required, continuing:', errorMessage);
      }

      // Perform proximity validation if required
      let distanceFromHost: number | null = null; // Track distance for analytics
      
      if (proximityRequired && gpsData) {
        const proximityResult = isWithinProximity(
          gpsData.latitude,
          gpsData.longitude,
          hostLat!,
          hostLon!,
          checkInData.session!.proximity_radius!
        );

        // Store distance for database record
        distanceFromHost = Math.round(proximityResult.distance * 100) / 100; // Round to 2 decimals

        if (!proximityResult.isWithinRadius) {
          setError(
            `Ã¢Å¡Â Ã¯Â¸Â You are too far from the session location!\n\n` +
            `Your distance: ${formatDistance(proximityResult.distance)}\n` +
            `Maximum allowed: ${formatDistance(checkInData.session!.proximity_radius!)}\n\n` +
            `Please move closer to ${hostData?.host_address || 'the host'} to check in.`
          );
          setSubmitting(false);
          return;
        }

      } else if (checkInData.session?.proximity_radius && !hostLat) {
        console.warn('Ã°Å¸â€œÂ Proximity radius configured but no host coordinates set - validation skipped');
      }

      // Get enrollment
      const { data: enrollment } = await checkinService
        .getEnrollmentId(checkInData.session_id, studentInfo.student_id);

      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;

      // Determine attendance status based on session time and grace period
      let attendanceStatus: 'on time' | 'late' | 'absent' = 'on time';
      let checkInAfterSession = false;
      let lateMinutes: number | null = null; // Track how many minutes late
      let earlyMinutes: number | null = null; // Track how many minutes early
      const now = new Date();
      
      // Get grace period from session (default to 15 if not set)
      const gracePeriodMinutes = checkInData.session?.grace_period_minutes ?? 15;
      
      // Parse session time if available (e.g., "09:00-12:00" or "09:00 AM - 12:00 PM")
      if (checkInData.session?.time) {
        // Helper function to parse time with AM/PM support
        const parseTime = (timeStr: string): { hours: number; minutes: number } | null => {
          // Match time like "09:00", "9:00 AM", "12:30 PM"
          const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (!match) return null;
          
          let hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const period = match[3]?.toUpperCase();
          
          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          
          return { hours, minutes };
        };
        
        // Split by common separators and parse each time
        const timeParts = checkInData.session.time.split(/[-Ã¢â‚¬â€œÃ¢â‚¬â€]/);
        const startTime = timeParts[0] ? parseTime(timeParts[0].trim()) : null;
        const endTime = timeParts[1] ? parseTime(timeParts[1].trim()) : null;
        
        if (startTime && endTime) {
          // Create session start and end times using the ATTENDANCE DATE (not current date)
          const sessionStart = new Date(checkInData.attendance_date);
          sessionStart.setHours(startTime.hours, startTime.minutes, 0, 0);
          
          const sessionEnd = new Date(checkInData.attendance_date);
          sessionEnd.setHours(endTime.hours, endTime.minutes, 0, 0);
          
          // Add configurable grace period to start time
          const graceEnd = new Date(sessionStart.getTime() + gracePeriodMinutes * 60 * 1000);
          
          // Compare current time with session times
          const attendanceDate = new Date(checkInData.attendance_date);
          attendanceDate.setHours(0, 0, 0, 0); // Reset to start of day for date-only comparison
          
          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0); // Reset to start of day for date-only comparison
          
          const isToday = attendanceDate.getTime() === todayDate.getTime();
          const isFutureDate = attendanceDate.getTime() > todayDate.getTime();
          
          // Only enforce time restrictions if checking in on the same day as the session
          if (isToday) {
            // Allow early check-in up to 30 minutes before session starts
            const earliestCheckIn = new Date(sessionStart.getTime() - 30 * 60 * 1000);
            
            if (now < earliestCheckIn) {
              setError('Cannot check in more than 30 minutes before session starts. Session starts at ' + format(sessionStart, 'hh:mm a'));
              setSubmitting(false);
              return;
            }
            
            // Determine status and track timing:
            // 1. Before session start = on time (track early_minutes)
            // 2. Before grace period end = on time
            // 3. After grace period but before session end = late
            // 4. After session end = absent
            if (now > sessionEnd) {
              attendanceStatus = 'absent';
              checkInAfterSession = true;
            } else if (now > graceEnd) {
              attendanceStatus = 'late';
              // Calculate how many minutes late (after grace period ended)
              lateMinutes = Math.ceil((now.getTime() - graceEnd.getTime()) / (1000 * 60));
            } else if (now < sessionStart) {
              // Student arrived early - track early minutes
              attendanceStatus = 'on time';
              earlyMinutes = Math.ceil((sessionStart.getTime() - now.getTime()) / (1000 * 60));
            } else {
              attendanceStatus = 'on time';
            }
          } else if (isFutureDate) {
            // For future dates, block check-in
            setError('You cannot check in before the session date.');
            setSubmitting(false);
            return;
          } else {
            // For past dates, mark as absent (retroactive check-in)
            attendanceStatus = 'absent';
            checkInAfterSession = true;
          }
        }
      }

      // Check if attendance record already exists (check all 3 constraint fields)
      const { data: existingRecord } = await checkinService
        .getExistingAttendanceByEnrollment(enrollment.enrollment_id, checkInData.session_id, checkInData.attendance_date);

      // If already checked in (not absent), reject
      if (existingRecord && existingRecord.status !== 'absent') {
        throw new Error('You have already checked in for this session. Your attendance has been recorded.');
      }

      const checkInTime = new Date().toISOString();
      
      const attendanceData = {
        enrollment_id: enrollment.enrollment_id,
        session_id: checkInData.session_id,
        student_id: studentInfo.student_id,
        attendance_date: checkInData.attendance_date,
        status: attendanceStatus,
        check_in_time: checkInTime,
        host_address: addressOnly,
        late_minutes: lateMinutes, // Track how late for tiered scoring
        early_minutes: earlyMinutes, // Track how early for analytics
        check_in_method: 'qr_code' as const, // Track check-in method
        distance_from_host: distanceFromHost, // Track distance from host location
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: `${studentInfo.email} - self check-in`,
        marked_at: new Date().toISOString(),
      };

      // Use upsert to handle race conditions - if record exists, update it
      // This prevents duplicate key errors when two requests happen simultaneously
      const { error: attendanceError } = await checkinService
        .upsertAttendance(attendanceData);

      if (attendanceError) {
        throw attendanceError;
      }

      // Audit log the QR check-in
      try { await logInsert('attendance', `${enrollment.enrollment_id}_${checkInData.attendance_date}`, attendanceData as Record<string, unknown>, 'QR code check-in'); } catch { /* audit non-critical */ }

      setWasLate(attendanceStatus !== 'on time');
      setCheckedInAfterSession(checkInAfterSession);
      setSuccess(true);

      // Check if session has feedback enabled
      const { enabled } = await feedbackService.isEnabled(checkInData.session_id);
      const feedbackAllowedForAttendance = attendanceStatus !== 'absent';
      if (enabled && feedbackAllowedForAttendance) {
        setFeedbackEnabled(true);
        // Show feedback after a short delay so student sees success first
        setTimeout(() => setShowFeedback(true), 1200);
      } else {
        successTimerRef.current = setTimeout(() => {
          navigate('/');
        }, 3000);
      }
    } catch (err: unknown) {
      console.error('Check-in error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to check in. Please try again.';
      setError(errorMessage);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-300">Validating...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <span className="text-3xl">Ã¢Å¡Â Ã¯Â¸Â</span>
              <span>Check-In Error</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 whitespace-pre-line break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">{error}</p>
            <Button onClick={() => navigate('/')} className="w-full">
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${wasLate ? 'bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-gray-900 dark:to-gray-800' : 'bg-gradient-to-br from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800'}`}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${wasLate ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
              <span className="text-5xl">{wasLate ? 'Ã¢ÂÂ°' : 'Ã¢Å“â€¦'}</span>
              <span>Check-In Successful!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Welcome, {studentInfo?.name}!
              </p>
              {(wasLate || checkedInAfterSession) && (
                <div className={`${checkedInAfterSession ? 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700' : 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700'} border rounded-lg p-3 mb-3`}>
                  <p className={`text-sm font-semibold ${checkedInAfterSession ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'} flex items-center justify-center gap-2`}>
                    <span>{checkedInAfterSession ? 'Ã°Å¸Å¡Â«' : 'Ã¢Å¡Â Ã¯Â¸Â'}</span>
                    <span>
                      {checkedInAfterSession 
                        ? 'You checked in AFTER the session ended' 
                        : `You were marked as LATE (arrived after ${checkInData?.session?.grace_period_minutes ?? 15}-minute grace period)`}
                    </span>
                  </p>
                </div>
              )}
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Your attendance has been recorded for {checkInData?.session?.course?.course_name}
              </p>
              <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-left">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">What happens next</p>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">Feedback appears below only when this session has post check-in feedback enabled, this attendance date has saved questions, and your attendance is not absent.</p>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">Replay links, when staff publish them for this attendance date, appear in Sessions under Recordings.</p>
              </div>
              {!feedbackEnabled && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Redirecting to home page...
                </p>
              )}
            </div>

            {/* Feedback Form */}
            {feedbackEnabled && showFeedback && checkInData && studentInfo && (
              <Suspense fallback={<div className="text-center p-4 text-sm text-gray-500">Loading...</div>}>
                <SessionFeedbackForm
                  sessionId={checkInData.session_id}
                  studentId={studentInfo.student_id}
                  attendanceDate={checkInData.attendance_date}
                  checkInMethod="qr_code"
                  onComplete={() => navigate('/')}
                  onSkip={() => navigate('/')}
                />
              </Suspense>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-3xl">Ã°Å¸â€œÂ</span>
            <span>Check-In</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Session Info */}
          <div className="bg-blue-50 dark:bg-blue-900/40 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">Ã°Å¸â€œÅ¡</span>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Course</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {checkInData?.session?.course?.course_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">Ã°Å¸â€œâ€¦</span>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Date</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {checkInData?.attendance_date && format(new Date(checkInData.attendance_date), 'EEEE, MMMM dd, yyyy')}
                </p>
              </div>
            </div>
            {checkInData?.session?.time && (
              <div className="flex items-center gap-2">
                <span className="text-2xl">Ã¢ÂÂ°</span>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Time</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {checkInData.session.time}
                  </p>
                </div>
              </div>
            )}
            {checkInData?.session?.location && (
              <div className="flex items-center gap-2">
                <span className="text-2xl">Ã°Å¸â€œÂ</span>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Location</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {checkInData.session.location}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Student Info */}
          <div className="bg-green-50 dark:bg-green-900/40 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">Ã°Å¸â€˜Â¤</span>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Student</p>
                <p className="font-semibold text-gray-900 dark:text-white">{studentInfo?.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{studentInfo?.email}</p>
              </div>
            </div>
          </div>

          {/* Host Address Selection */}
          {hostAddresses.length > 0 && selectedAddress && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Ã°Å¸ÂÂ  Session Location
              </label>
              <div className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                Ã°Å¸â€œÂ {selectedAddress.split('|||')[1] || selectedAddress}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Location set by teacher. Your GPS will be checked against this address.
              </p>
            </div>
          )}

          {/* GPS Info */}
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded p-3">
            <p className="flex items-center gap-1 font-medium text-blue-700 dark:text-blue-300">
              <span>Ã°Å¸â€œÂ</span>
              <span>GPS Location Required</span>
            </p>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Your browser will ask for location permission. Please allow it to verify your attendance location.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Ã°Å¸â€™Â¡ If GPS fails, check-in will continue but location won't be recorded.
            </p>
          </div>

          {/* Check-In Button */}
          <Button
            onClick={handleCheckIn}
            disabled={submitting}
            className="w-full py-6 text-lg font-bold"
            size="lg"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Checking In...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span>Ã¢Å“â€œ</span>
                <span>I'm Present</span>
              </span>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
