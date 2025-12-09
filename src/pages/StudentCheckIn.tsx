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
  const [checkInData, setCheckInData] = useState<CheckInData | null>(null);
  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [hostAddresses, setHostAddresses] = useState<HostInfo[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');

  useEffect(() => {
    validateAndLoadCheckIn();
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
          .map((h: any) => ({
            student_id: h.student_id,
            student_name: h.student?.name || 'Unknown',
            address: h.student?.address || null,
            host_date: h.host_date,
          }))
          .filter(h => h.address);

        setHostAddresses(hostList);

        // Auto-select if this student is today's host
        const myHost = hostList.find(h => h.student_id === student.student_id && h.host_date === date);
        if (myHost && myHost.address) {
          setSelectedAddress(`${student.student_id}|||${myHost.address}`);
        }
      }

      setCheckInData({
        session_id: sessionId!,
        attendance_date: date!,
        token: token!,
        session: session as any,
      });

      setLoading(false);
    } catch (err: any) {
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
          console.error('GPS error:', error);
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

      // Check if attendance record already exists
      const { data: existingRecord } = await supabase
        .from('attendance')
        .select('attendance_id')
        .eq('enrollment_id', enrollment.enrollment_id)
        .eq('attendance_date', checkInData.attendance_date)
        .single();

      const attendanceData = {
        enrollment_id: enrollment.enrollment_id,
        session_id: checkInData.session_id,
        student_id: studentInfo.student_id,
        attendance_date: checkInData.attendance_date,
        status: 'on time' as const,
        check_in_time: new Date().toISOString(),
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

      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 3000);
    } catch (err: any) {
      console.error('Check-in error:', err);
      setError(err.message || 'Failed to check in. Please try again.');
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-green-600 flex items-center gap-2">
              <span className="text-5xl">✅</span>
              <span>Check-In Successful!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-gray-900 mb-2">
                Welcome, {studentInfo?.name}!
              </p>
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
          <div className="text-xs text-gray-500 bg-gray-50 rounded p-3">
            <p className="flex items-center gap-1">
              <span>📍</span>
              <span>Your location will be captured for verification</span>
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
