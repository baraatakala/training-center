import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { getSignedPhotoUrl } from '../components/PhotoUpload';
import { format } from 'date-fns';
import * as faceapi from 'face-api.js';
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

type FaceMatchResult = {
  matched: boolean;
  confidence: number;
  error?: string;
};

export function PhotoCheckIn() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  // States
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [wasLate, setWasLate] = useState(false);
  const [checkedInAfterSession, setCheckedInAfterSession] = useState(false);
  const [checkInData, setCheckInData] = useState<CheckInData | null>(null);
  const [studentInfo, setStudentInfo] = useState<{ student_id: string; name: string; email: string; photo_url: string | null } | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null); // Signed URL for display/comparison
  const [hostAddresses, setHostAddresses] = useState<HostInfo[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  
  // Camera states
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [faceMatchResult, setFaceMatchResult] = useState<FaceMatchResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        setModelsLoading(true);
        const MODEL_URL = '/models';
        
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        
        console.log('✅ Face-api models loaded');
        setModelsLoading(false);
      } catch (err) {
        console.error('Failed to load face-api models:', err);
        setError('Failed to load face recognition. Please refresh the page.');
        setModelsLoading(false);
      }
    };

    loadModels();
  }, []);

  // Validate token and load check-in data
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
        setError('Invalid check-in link: No token provided');
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

      // STEP 2: Validate photo check-in token (requires authentication)
      const { data: photoSession, error: tokenError } = await supabase
        .from('photo_checkin_sessions')
        .select('session_id, attendance_date, expires_at, is_valid')
        .eq('token', token)
        .single();

      if (tokenError || !photoSession) {
        console.error('Token validation error:', tokenError);
        setError('Invalid check-in link. Please ask your teacher to generate a new one.');
        setLoading(false);
        return;
      }

      // Check if expired
      if (new Date(photoSession.expires_at) < new Date()) {
        setError(`Check-in link expired at ${format(new Date(photoSession.expires_at), 'HH:mm')}. Please ask your teacher to generate a new one.`);
        setLoading(false);
        return;
      }

      // Check if invalidated
      if (!photoSession.is_valid) {
        setError('Check-in link is no longer valid. Please ask your teacher to generate a new one.');
        setLoading(false);
        return;
      }

      const sessionId = photoSession.session_id;
      const date = photoSession.attendance_date;

      console.log('✅ Photo check-in token validated:', { sessionId, date });

      // STEP 3: Get student info with photo_url (user already authenticated in STEP 1)
      const { data: student, error: studentError } = await supabase
        .from('student')
        .select('student_id, name, email, photo_url')
        .ilike('email', user.email || '')
        .single();

      if (studentError || !student) {
        setError('Student account not found. Please contact administration.');
        setLoading(false);
        return;
      }

      // Check if student has uploaded a reference photo
      if (!student.photo_url) {
        setError('You need to upload a reference photo before using face check-in. Please go to your profile and upload a photo.');
        setLoading(false);
        return;
      }

      // Get signed URL for the reference photo
      const photoSignedUrl = await getSignedPhotoUrl(student.photo_url);
      if (!photoSignedUrl) {
        setError('Failed to load reference photo. Please try again or re-upload your photo.');
        setLoading(false);
        return;
      }

      setStudentInfo(student);
      setSignedPhotoUrl(photoSignedUrl);

      // Load session details
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

      if (sessionError || !session) {
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

      if (enrollmentError || !enrollment) {
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

      // Load ALL host addresses (students with addresses + teacher)
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

      // Check if host is already set for this date in session_date_host table
      const { data: hostData } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('host_id, host_type, host_address')
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .maybeSingle();

      if (hostData?.host_address && hostData.host_address !== 'SESSION_NOT_HELD') {
        // Auto-select the pre-saved host address
        if (hostData.host_id) {
          setSelectedAddress(`${hostData.host_id}|||${hostData.host_address}`);
        } else {
          // Find matching student by address
          const matchingHost = hostList.find(h => h.address === hostData.host_address);
          if (matchingHost) {
            setSelectedAddress(`${matchingHost.student_id}|||${matchingHost.address}`);
          }
        }
      }

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
    } catch (err) {
      console.error('Validation error:', err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Start camera
  const startCamera = async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      setStream(mediaStream);
      setShowCamera(true);
      setCapturedPhoto(null);
      setFaceMatchResult(null);
      
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (err) {
      console.error('Camera error:', err);
      setError('Could not access camera. Please check permissions.');
    }
  };

  // Stop camera
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  }, [stream]);

  // Cleanup camera stream on unmount to prevent camera staying on
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Capture photo from camera
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Mirror the image
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedPhoto(dataUrl);
    stopCamera();
    
    // Automatically verify the face
    verifyFace(dataUrl);
  };

  // Verify face against reference photo
  const verifyFace = async (capturedDataUrl: string) => {
    if (!signedPhotoUrl) {
      setFaceMatchResult({ matched: false, confidence: 0, error: 'No reference photo found' });
      return;
    }

    setVerifying(true);
    setFaceMatchResult(null);

    try {
      // Load reference image using signed URL
      const refImg = await faceapi.fetchImage(signedPhotoUrl);
      const refDetection = await faceapi
        .detectSingleFace(refImg)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!refDetection) {
        setFaceMatchResult({ matched: false, confidence: 0, error: 'Could not detect face in your reference photo. Please update your profile photo.' });
        setVerifying(false);
        return;
      }

      // Load captured image
      const capturedImg = await faceapi.fetchImage(capturedDataUrl);
      const capturedDetection = await faceapi
        .detectSingleFace(capturedImg)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!capturedDetection) {
        setFaceMatchResult({ matched: false, confidence: 0, error: 'Could not detect your face. Please ensure good lighting and face the camera directly.' });
        setVerifying(false);
        return;
      }

      // Compare face descriptors
      const distance = faceapi.euclideanDistance(refDetection.descriptor, capturedDetection.descriptor);
      const confidence = Math.round((1 - distance) * 100);
      
      // Threshold: distance < 0.6 is a match (60% confidence)
      const matched = distance < 0.6;

      setFaceMatchResult({ matched, confidence });

      console.log(`Face verification: distance=${distance.toFixed(3)}, confidence=${confidence}%, matched=${matched}`);
    } catch (err) {
      console.error('Face verification error:', err);
      setFaceMatchResult({ matched: false, confidence: 0, error: 'Face verification failed. Please try again.' });
    } finally {
      setVerifying(false);
    }
  };

  // Retry capture
  const retryCapture = () => {
    setCapturedPhoto(null);
    setFaceMatchResult(null);
    startCamera();
  };

  // GPS capture
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
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  // Submit check-in
  const handleCheckIn = async () => {
    if (!checkInData || !studentInfo || !faceMatchResult?.matched) return;

    setSubmitting(true);
    setError(null);

    try {
      const gpsData = await captureGPSLocation();

      // PROXIMITY VALIDATION: Check if student is within allowed radius
      const { data: hostData } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('host_latitude, host_longitude, host_address')
        .eq('session_id', checkInData.session_id)
        .eq('attendance_date', checkInData.attendance_date)
        .maybeSingle();

      if (gpsData && checkInData.session?.proximity_radius && hostData?.host_latitude && hostData?.host_longitude) {
        const proximityResult = isWithinProximity(
          gpsData.latitude,
          gpsData.longitude,
          hostData.host_latitude,
          hostData.host_longitude,
          checkInData.session.proximity_radius
        );

        if (!proximityResult.isWithinRadius) {
          setError(
            `⚠️ You are too far from the session location!\n\n` +
            `Your distance: ${formatDistance(proximityResult.distance)}\n` +
            `Maximum allowed: ${formatDistance(checkInData.session.proximity_radius)}\n\n` +
            `Please move closer to ${hostData.host_address} to check in.`
          );
          setSubmitting(false);
          return;
        }

        console.log('✅ Proximity validation passed:', formatDistance(proximityResult.distance), 'from host');
      }

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

      // Determine attendance status
      let attendanceStatus: 'on time' | 'late' | 'absent' = 'on time';
      let checkInAfterSession = false;
      const now = new Date();
      const gracePeriodMinutes = checkInData.session?.grace_period_minutes ?? 15;
      
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
          const sessionStart = new Date(checkInData.attendance_date);
          sessionStart.setHours(startTime.hours, startTime.minutes, 0, 0);
          
          const sessionEnd = new Date(checkInData.attendance_date);
          sessionEnd.setHours(endTime.hours, endTime.minutes, 0, 0);
          
          const graceEnd = new Date(sessionStart.getTime() + gracePeriodMinutes * 60 * 1000);
          
          const attendanceDate = new Date(checkInData.attendance_date);
          attendanceDate.setHours(0, 0, 0, 0);
          
          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0);
          
          const isToday = attendanceDate.getTime() === todayDate.getTime();
          const isFutureDate = attendanceDate.getTime() > todayDate.getTime();
          
          if (isToday) {
            if (now < sessionStart) {
              setError('Cannot check in before session starts.');
              setSubmitting(false);
              return;
            }
            
            if (now > sessionEnd) {
              attendanceStatus = 'absent';
              checkInAfterSession = true;
            } else if (now > graceEnd) {
              attendanceStatus = 'late';
            }
          } else if (isFutureDate) {
            setError('You cannot check in before the session date.');
            setSubmitting(false);
            return;
          } else {
            attendanceStatus = 'absent';
            checkInAfterSession = true;
          }
        }
      }

      const { data: existingRecord } = await supabase
        .from('attendance')
        .select('attendance_id, status')
        .eq('enrollment_id', enrollment.enrollment_id)
        .eq('session_id', checkInData.session_id)
        .eq('attendance_date', checkInData.attendance_date)
        .maybeSingle();

      if (existingRecord && existingRecord.status !== 'absent') {
        throw new Error('You have already checked in for this session.');
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
        marked_by: `${studentInfo.email} - face check-in (${faceMatchResult.confidence}% match)`,
        marked_at: new Date().toISOString(),
      };

      let attendanceError;
      
      if (existingRecord) {
        const { error } = await supabase
          .from('attendance')
          .update(attendanceData)
          .eq('attendance_id', existingRecord.attendance_id);
        attendanceError = error;
      } else {
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
      
      setTimeout(() => navigate('/'), 3000);
    } catch (err) {
      console.error('Check-in error:', err);
      setError(err instanceof Error ? err.message : 'Failed to check in. Please try again.');
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading || modelsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
              <p className="text-gray-600">
                {modelsLoading ? 'Loading face recognition...' : 'Validating...'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error && !capturedPhoto) {
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

  // Success state
  if (success) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${wasLate ? 'bg-gradient-to-br from-yellow-50 to-orange-50' : 'bg-gradient-to-br from-green-50 to-blue-50'}`}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${wasLate ? 'text-orange-600' : 'text-green-600'}`}>
              <span className="text-5xl">{wasLate ? '⏰' : '✅'}</span>
              <span>Face Check-In Successful!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-gray-900 mb-2">
                Welcome, {studentInfo?.name}!
              </p>
              <p className="text-sm text-green-600 mb-2">
                Face verified with {faceMatchResult?.confidence}% confidence
              </p>
              {wasLate && (
                <div className={`${checkedInAfterSession ? 'bg-red-100 border-red-300' : 'bg-yellow-100 border-yellow-300'} border rounded-lg p-3 mb-3`}>
                  <p className={`text-sm font-semibold ${checkedInAfterSession ? 'text-red-800' : 'text-yellow-800'}`}>
                    {checkedInAfterSession 
                      ? '🚫 You checked in AFTER the session ended' 
                      : `⚠️ You were marked as LATE`}
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-3xl">📸</span>
            <span>Face Check-In</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Session Info */}
          <div className="bg-purple-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">📚</span>
              <div>
                <p className="text-sm text-gray-600">Course</p>
                <p className="font-semibold text-gray-900 text-sm">
                  {checkInData?.session?.course?.course_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📅</span>
              <div>
                <p className="text-sm text-gray-600">Date</p>
                <p className="font-semibold text-gray-900 text-sm">
                  {checkInData?.attendance_date && format(new Date(checkInData.attendance_date), 'EEE, MMM dd, yyyy')}
                </p>
              </div>
            </div>
          </div>

          {/* Student Info with Reference Photo */}
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center gap-3">
              {signedPhotoUrl ? (
                <img 
                  src={signedPhotoUrl} 
                  alt="Reference" 
                  className="w-16 h-16 rounded-full object-cover border-2 border-blue-300"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-2xl">👤</span>
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-900">{studentInfo?.name}</p>
                <p className="text-sm text-gray-600">{studentInfo?.email}</p>
              </div>
            </div>
          </div>

          {/* Camera / Captured Photo */}
          <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
            {showCamera ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform scale-x-[-1]"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Face guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-40 h-52 border-4 border-dashed border-white/50 rounded-full"></div>
                </div>
              </>
            ) : capturedPhoto ? (
              <img
                src={capturedPhoto}
                alt="Captured"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                <span className="text-5xl mb-2">📷</span>
                <p className="text-sm">Click "Open Camera" to start</p>
              </div>
            )}
          </div>

          {/* Face Match Result */}
          {verifying && (
            <div className="flex items-center justify-center gap-2 text-purple-600 py-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
              <span>Verifying your face...</span>
            </div>
          )}

          {faceMatchResult && (
            <div className={`p-4 rounded-lg border ${faceMatchResult.matched 
              ? 'bg-green-50 border-green-300' 
              : 'bg-red-50 border-red-300'}`}
            >
              {faceMatchResult.error ? (
                <p className="text-red-600 text-sm">❌ {faceMatchResult.error}</p>
              ) : faceMatchResult.matched ? (
                <div className="text-center">
                  <p className="text-green-700 font-semibold text-lg">✅ Face Verified!</p>
                  <p className="text-green-600 text-sm">{faceMatchResult.confidence}% confidence match</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-red-700 font-semibold">❌ Face Not Matched</p>
                  <p className="text-red-600 text-sm">Only {faceMatchResult.confidence}% match (need 40%+)</p>
                </div>
              )}
            </div>
          )}

          {/* Host Address Selection */}
          {hostAddresses.length > 0 && faceMatchResult?.matched && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                🏠 Session Location
              </label>
              <select
                value={selectedAddress}
                onChange={(e) => setSelectedAddress(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:outline-none"
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

          {/* Error message */}
          {error && capturedPhoto && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            {showCamera ? (
              <div className="flex gap-2">
                <Button
                  onClick={capturePhoto}
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                >
                  📷 Capture
                </Button>
                <Button
                  onClick={stopCamera}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            ) : capturedPhoto ? (
              faceMatchResult?.matched ? (
                <Button
                  onClick={handleCheckIn}
                  disabled={submitting || (hostAddresses.length > 0 && !selectedAddress)}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-lg font-bold"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      Checking In...
                    </span>
                  ) : (
                    <span>✓ Confirm Check-In</span>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={retryCapture}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                >
                  🔄 Retry Photo
                </Button>
              )
            ) : (
              <Button
                onClick={startCamera}
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-lg"
              >
                📷 Open Camera
              </Button>
            )}
          </div>

          {/* Info */}
          <p className="text-xs text-gray-500 text-center">
            Ensure good lighting and face the camera directly.
            <br />
            Your GPS location will be captured for verification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
