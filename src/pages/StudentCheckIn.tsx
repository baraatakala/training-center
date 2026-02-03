import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { format } from 'date-fns';
import { isWithinProximity, formatDistance } from '../services/geocodingService';

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

  useEffect(() => {
    // Small delay to ensure auth state is fully propagated after login redirect
    const timer = setTimeout(() => {
      validateAndLoadCheckIn();
    }, 100);
    return () => clearTimeout(timer);
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
      const { data: { session: authSession }, error: authError } = await supabase.auth.getSession();
      
      if (authError || !authSession?.user) {
        // Redirect to login with return URL - user must log in first
        const returnUrl = encodeURIComponent(window.location.pathname);
        navigate(`/login?returnUrl=${returnUrl}`);
        return;
      }
      
      const user = authSession.user;

      // STEP 2: Validate QR token via database (requires authentication)
      const { data: qrSession, error: qrError } = await supabase
        .from('qr_sessions')
        .select('session_id, attendance_date, expires_at, is_valid')
        .eq('token', token)
        .single();

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

      // Extract session_id and date from validated QR session
      const sessionId = qrSession.session_id;
      const date = qrSession.attendance_date;

      console.log('✅ QR token validated:', { sessionId, date, expiresAt: qrSession.expires_at });

      // STEP 3: Get student info (case-insensitive email lookup)
      const { data: student, error: studentError } = await supabase
        .from('student')
        .select('student_id, name, email')
        .ilike('email', user.email || '')
        .single();

      if (studentError || !student) {
        setError('Student account not found. Please contact administration.');
        setLoading(false);
        return;
      }

      setStudentInfo(student);

      // STEP 4: Load session details
      const { data: session, error: sessionError } = await supabase
        .from('session')
        .select(`
          session_id,
          time,
          location,
          course_id,
          grace_period_minutes,
          proximity_radius,
          course:course_id (
            course_name
          )
        `)
        .eq('session_id', sessionId)
        .single();

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
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollment')
        .select('enrollment_id, can_host')
        .eq('session_id', sessionId)
        .eq('student_id', student.student_id)
        .eq('status', 'active')
        .single();

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
      const { data: existingAttendance } = await supabase
        .from('attendance')
        .select('attendance_id, status')
        .eq('session_id', sessionId)
        .eq('student_id', student.student_id)
        .eq('attendance_date', date)
        .single();

      if (existingAttendance && existingAttendance.status !== 'absent') {
        setError('You have already checked in for this session');
        setLoading(false);
        return;
      }

      // STEP 7: Load ALL host addresses (students with addresses + teacher)
      // First, get session's teacher info
      const { data: sessionData } = await supabase
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

      // Load ALL students with non-null addresses
      const { data: allStudentsWithAddress } = await supabase
        .from(Tables.STUDENT)
        .select('student_id, name, address')
        .not('address', 'is', null)
        .neq('address', '');

      const hostList: HostInfo[] = [];

      // Add teacher as first option if they have address
      const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
      if (teacher?.address && teacher.address.trim() !== '') {
        hostList.push({
          student_id: teacher.teacher_id,
          student_name: `🎓 ${teacher.name} (Teacher)`,
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
      const { data: hostData } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('host_id, host_type, host_address, host_latitude, host_longitude')
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .maybeSingle();

      // VALIDATION: Host address MUST be set by teacher
      if (!hostData?.host_address || hostData.host_address === 'SESSION_NOT_HELD') {
        setError('❌ Host address not set. Please ask your teacher to select a host address before check-in.');
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

      console.log('✅ Check-in page loaded successfully');
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
          console.log('GPS captured successfully:', position.coords.latitude, position.coords.longitude);
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
      const { data: hostData } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('host_id, host_type, host_address')
        .eq('session_id', checkInData.session_id)
        .eq('attendance_date', checkInData.attendance_date)
        .maybeSingle();

      // Load coordinates from student/teacher table (persistent storage)
      let hostLat: number | null = null;
      let hostLon: number | null = null;
      
      if (hostData?.host_id) {
        const isTeacher = hostData.host_type === 'teacher';
        const table = isTeacher ? Tables.TEACHER : Tables.STUDENT;
        const idField = isTeacher ? 'teacher_id' : 'student_id';
        
        const { data: coordData } = await supabase
          .from(table)
          .select('address_latitude, address_longitude')
          .eq(idField, hostData.host_id)
          .single();
        
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
            setError('❌ Location permission denied!\n\nGPS is required for check-in at this session.\n\nPlease enable location access in your browser settings and try again.');
          } else if (errorMessage === 'GPS_TIMEOUT') {
            setError('❌ Could not get your location (timeout).\n\nGPS is required for check-in. Please ensure you have a clear view of the sky and try again.');
          } else if (errorMessage === 'GPS_NOT_SUPPORTED') {
            setError('❌ Your browser does not support GPS.\n\nPlease use a modern browser with location services enabled.');
          } else {
            setError('❌ Could not get your location.\n\nGPS is required for check-in at this session. Please try again.');
          }
          setSubmitting(false);
          return;
        }
        // GPS failed but not required - continue without it
        console.warn('GPS failed but proximity not required, continuing:', errorMessage);
      }

      // Perform proximity validation if required
      if (proximityRequired && gpsData) {
        const proximityResult = isWithinProximity(
          gpsData.latitude,
          gpsData.longitude,
          hostLat!,
          hostLon!,
          checkInData.session!.proximity_radius!
        );

        console.log('📍 Proximity check:', {
          userLat: gpsData.latitude,
          userLon: gpsData.longitude,
          hostLat: hostLat,
          hostLon: hostLon,
          distance: proximityResult.distance,
          allowed: checkInData.session!.proximity_radius,
          isWithin: proximityResult.isWithinRadius
        });

        if (!proximityResult.isWithinRadius) {
          setError(
            `⚠️ You are too far from the session location!\n\n` +
            `Your distance: ${formatDistance(proximityResult.distance)}\n` +
            `Maximum allowed: ${formatDistance(checkInData.session!.proximity_radius!)}\n\n` +
            `Please move closer to ${hostData?.host_address || 'the host'} to check in.`
          );
          setSubmitting(false);
          return;
        }

        console.log('✅ Proximity validation passed:', formatDistance(proximityResult.distance), 'from host');
      } else if (checkInData.session?.proximity_radius && !hostLat) {
        console.warn('📍 Proximity radius configured but no host coordinates set - validation skipped');
      }

      // Get enrollment
      const { data: enrollment } = await supabase
        .from('enrollment')
        .select('enrollment_id')
        .eq('session_id', checkInData.session_id)
        .eq('student_id', studentInfo.student_id)
        .single();

      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;

      // Determine attendance status based on session time and grace period
      let attendanceStatus: 'on time' | 'late' | 'absent' = 'on time';
      let checkInAfterSession = false;
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
        const timeParts = checkInData.session.time.split(/[-–—]/);
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
            // Check if check-in is before session starts
            if (now < sessionStart) {
              setError('Cannot check in before session starts. Session starts at ' + sessionStart.toLocaleTimeString());
              setSubmitting(false);
              return;
            }
            
            // Determine status based on current time:
            // 1. Before grace period end = on time
            // 2. After grace period but before session end = late
            // 3. After session end = absent
            if (now > sessionEnd) {
              attendanceStatus = 'absent';
              checkInAfterSession = true;
            } else if (now > graceEnd) {
              attendanceStatus = 'late';
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
      const { data: existingRecord } = await supabase
        .from('attendance')
        .select('attendance_id, status')
        .eq('enrollment_id', enrollment.enrollment_id)
        .eq('session_id', checkInData.session_id)
        .eq('attendance_date', checkInData.attendance_date)
        .maybeSingle();

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
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: `${studentInfo.email} - self check-in`,
        marked_at: new Date().toISOString(),
      };

      let attendanceError;
      
      if (existingRecord) {
        // Update existing record (was absent, now checking in)
        const { error } = await supabase
          .from('attendance')
          .update(attendanceData)
          .eq('attendance_id', existingRecord.attendance_id);
        attendanceError = error;
      } else {
        // Insert new record
        const { error } = await supabase
          .from('attendance')
          .insert(attendanceData);
        attendanceError = error;
      }

      if (attendanceError) {
        throw attendanceError;
      }

      setWasLate(attendanceStatus === 'late');
      setCheckedInAfterSession(checkInAfterSession);
      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 3000);
    } catch (err: unknown) {
      console.error('Check-in error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to check in. Please try again.';
      setError(errorMessage);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600">Validating...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600 flex items-center gap-2">
              <span className="text-3xl">⚠️</span>
              <span>Check-In Error</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 mb-4">{error}</p>
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
      <div className={`min-h-screen flex items-center justify-center p-4 ${wasLate ? 'bg-gradient-to-br from-yellow-50 to-orange-50' : 'bg-gradient-to-br from-green-50 to-blue-50'}`}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${wasLate ? 'text-orange-600' : 'text-green-600'}`}>
              <span className="text-5xl">{wasLate ? '⏰' : '✅'}</span>
              <span>Check-In Successful!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-gray-900 mb-2">
                Welcome, {studentInfo?.name}!
              </p>
              {wasLate && (
                <div className={`${checkedInAfterSession ? 'bg-red-100 border-red-300' : 'bg-yellow-100 border-yellow-300'} border rounded-lg p-3 mb-3`}>
                  <p className={`text-sm font-semibold ${checkedInAfterSession ? 'text-red-800' : 'text-yellow-800'} flex items-center justify-center gap-2`}>
                    <span>{checkedInAfterSession ? '🚫' : '⚠️'}</span>
                    <span>
                      {checkedInAfterSession 
                        ? 'You checked in AFTER the session ended' 
                        : `You were marked as LATE (arrived after ${checkInData?.session?.grace_period_minutes ?? 15}-minute grace period)`}
                    </span>
                  </p>
                </div>
              )}
              <p className="text-gray-600 mb-4">
                Your attendance has been recorded for {checkInData?.session?.course?.course_name}
              </p>
              <p className="text-sm text-gray-500">
                Redirecting to home page...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-3xl">📝</span>
            <span>Check-In</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Session Info */}
          <div className="bg-blue-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📚</span>
              <div>
                <p className="text-sm text-gray-600">Course</p>
                <p className="font-semibold text-gray-900">
                  {checkInData?.session?.course?.course_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">📅</span>
              <div>
                <p className="text-sm text-gray-600">Date</p>
                <p className="font-semibold text-gray-900">
                  {checkInData?.attendance_date && format(new Date(checkInData.attendance_date), 'EEEE, MMMM dd, yyyy')}
                </p>
              </div>
            </div>
            {checkInData?.session?.time && (
              <div className="flex items-center gap-2">
                <span className="text-2xl">⏰</span>
                <div>
                  <p className="text-sm text-gray-600">Time</p>
                  <p className="font-semibold text-gray-900">
                    {checkInData.session.time}
                  </p>
                </div>
              </div>
            )}
            {checkInData?.session?.location && (
              <div className="flex items-center gap-2">
                <span className="text-2xl">📍</span>
                <div>
                  <p className="text-sm text-gray-600">Location</p>
                  <p className="font-semibold text-gray-900">
                    {checkInData.session.location}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Student Info */}
          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👤</span>
              <div>
                <p className="text-sm text-gray-600">Student</p>
                <p className="font-semibold text-gray-900">{studentInfo?.name}</p>
                <p className="text-sm text-gray-600">{studentInfo?.email}</p>
              </div>
            </div>
          </div>

          {/* Host Address Selection */}
          {hostAddresses.length > 0 && selectedAddress && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                🏠 Session Location
              </label>
              <div className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-700">
                📍 {selectedAddress.split('|||')[1] || selectedAddress}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Location set by teacher. Your GPS will be checked against this address.
              </p>
            </div>
          )}

          {/* GPS Info */}
          <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-3">
            <p className="flex items-center gap-1 font-medium text-blue-700">
              <span>📍</span>
              <span>GPS Location Required</span>
            </p>
            <p className="mt-1 text-gray-600">
              Your browser will ask for location permission. Please allow it to verify your attendance location.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              💡 If GPS fails, check-in will continue but location won't be recorded.
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
                <span>✓</span>
                <span>I'm Present</span>
              </span>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
