import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { format } from 'date-fns';

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
  };
};

type HostInfo = {
  student_id: string;
  student_name: string;
  address: string | null;
  host_date: string | null;
};

export function StudentCheckIn() {
  const { sessionId, date, token } = useParams<{ sessionId: string; date: string; token: string }>();
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
    validateAndLoadCheckIn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, date, token]);

  const validateAndLoadCheckIn = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        // Redirect to login with return URL
        const returnUrl = encodeURIComponent(window.location.pathname);
        navigate(`/login?returnUrl=${returnUrl}`);
        return;
      }

      // Get student info
      const { data: student, error: studentError } = await supabase
        .from('student')
        .select('student_id, name, email')
        .eq('email', user.email)
        .single();

      if (studentError || !student) {
        setError('Student account not found. Please contact administration.');
        setLoading(false);
        return;
      }

      setStudentInfo(student);

      // Validate session and date
      const { data: session, error: sessionError } = await supabase
        .from('session')
        .select(`
          session_id,
          time,
          location,
          course_id,
          grace_period_minutes,
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

      // Verify student is enrolled
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

      // Check if already checked in
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

      // Load host addresses if student can host
      if (enrollment.can_host) {
        const { data: hosts } = await supabase
          .from('enrollment')
          .select(`
            student_id,
            host_date,
            can_host,
            student:student_id(name, address)
          `)
          .eq('session_id', sessionId)
          .eq('can_host', true)
          .not('student.address', 'is', null);

        const hostList: HostInfo[] = (hosts || [])
          .map((h: { student_id: string; host_date: string | null; student?: { name: string; address: string | null } | { name: string; address: string | null }[] }) => {
            const student = h.student ? (Array.isArray(h.student) ? h.student[0] : h.student) : null;
            return {
              student_id: h.student_id,
              student_name: student?.name || 'Unknown',
              address: student?.address || null,
              host_date: h.host_date,
            };
          })
          .filter(h => h.address);

        setHostAddresses(hostList);

        // Auto-select if this student is today's host
        const myHost = hostList.find(h => h.student_id === student.student_id && h.host_date === date);
        if (myHost && myHost.address) {
          setSelectedAddress(`${student.student_id}|||${myHost.address}`);
        }
      }

      // Handle both single object and array from Supabase for course relation
      const courseData = session.course ? (Array.isArray(session.course) ? session.course[0] : session.course) : undefined;
      
      setCheckInData({
        session_id: sessionId!,
        attendance_date: date!,
        token: token!,
        session: {
          course: courseData,
          time: session.time,
          location: session.location,
          grace_period_minutes: session.grace_period_minutes,
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
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        console.warn('Geolocation not supported by browser');
        alert('⚠️ GPS not supported by your browser. Continuing without location data.');
        resolve(null);
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
          let errorMsg = '';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMsg = '⚠️ Location permission denied. Check-in will continue without GPS data.\n\nTo enable: Allow location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMsg = '⚠️ Location unavailable. Check-in will continue without GPS data.';
              break;
            case error.TIMEOUT:
              errorMsg = '⚠️ Location request timed out. Check-in will continue without GPS data.';
              break;
            default:
              errorMsg = '⚠️ Unable to get location. Check-in will continue without GPS data.';
          }
          alert(errorMsg);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const handleCheckIn = async () => {
    if (!checkInData || !studentInfo) return;

    setSubmitting(true);
    setError(null);

    try {
      // Capture GPS
      const gpsData = await captureGPSLocation();

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
        // Extract start and end times
        const timeMatches = checkInData.session.time.match(/(\d{1,2}):(\d{2})/g);
        if (timeMatches && timeMatches.length >= 2) {
          // Parse start time
          const startMatch = timeMatches[0].match(/(\d{1,2}):(\d{2})/);
          let startHour = parseInt(startMatch![1], 10);
          const startMinute = parseInt(startMatch![2], 10);
          
          // Parse end time
          const endMatch = timeMatches[1].match(/(\d{1,2}):(\d{2})/);
          let endHour = parseInt(endMatch![1], 10);
          const endMinute = parseInt(endMatch![2], 10);
          
          // Handle AM/PM
          const timeLower = checkInData.session.time.toLowerCase();
          if (timeLower.includes('pm')) {
            if (startHour !== 12) startHour += 12;
            if (endHour !== 12) endHour += 12;
          } else if (timeLower.includes('am')) {
            if (startHour === 12) startHour = 0;
            if (endHour === 12) endHour = 0;
          }
          
          // Create session start and end times using the ATTENDANCE DATE (not current date)
          const sessionStart = new Date(checkInData.attendance_date);
          sessionStart.setHours(startHour, startMinute, 0, 0);
          
          const sessionEnd = new Date(checkInData.attendance_date);
          sessionEnd.setHours(endHour, endMinute, 0, 0);
          
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
            // For future dates, allow check-in and mark as present (early check-in)
            // This allows students to check in before the session day
            attendanceStatus = 'on time';
          } else {
            // For past dates, mark as absent (retroactive check-in)
            attendanceStatus = 'absent';
            checkInAfterSession = true;
          }
        }
      }

      // Check if attendance record already exists
      const { data: existingRecord } = await supabase
        .from('attendance')
        .select('attendance_id')
        .eq('enrollment_id', enrollment.enrollment_id)
        .eq('attendance_date', checkInData.attendance_date)
        .single();

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
        // Update existing record
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
          {hostAddresses.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                🏠 Session Location (Required)
              </label>
              <select
                value={selectedAddress}
                onChange={(e) => setSelectedAddress(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                required
              >
                <option value="">Select location...</option>
                {hostAddresses.map((host) => (
                  <option key={host.student_id} value={`${host.student_id}|||${host.address}`}>
                    {host.student_name === studentInfo?.name ? '🏠 My Address' : host.student_name} - {host.address}
                  </option>
                ))}
              </select>
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
            disabled={submitting || (hostAddresses.length > 0 && !selectedAddress)}
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
