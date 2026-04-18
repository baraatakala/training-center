import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authService } from '@/shared/services/authService';
import { checkinService } from '@/features/checkin/services/checkinService';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { getSignedPhotoUrl } from '@/shared/utils/photoUtils';
import { format } from 'date-fns';
import * as faceapi from 'face-api.js';
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
  const [actualLateMinutes, setActualLateMinutes] = useState<number | null>(null);
  const [checkInData, setCheckInData] = useState<CheckInData | null>(null);
  const [studentInfo, setStudentInfo] = useState<{ student_id: string; name: string; email: string; photo_url: string | null } | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null); // Signed URL for display/comparison
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  
  // Camera states
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [faceMatchResult, setFaceMatchResult] = useState<FaceMatchResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cachedRefDescriptor = useRef<{ url: string; descriptor: Float32Array; score: number } | null>(null);

  // Load face-api models (including TinyFaceDetector as fallback)
  useEffect(() => {
    const loadModels = async () => {
      try {
        setModelsLoading(true);
        const MODEL_URL = '/models';
        
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        
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
    return () => { clearTimeout(timer); if (successTimerRef.current) clearTimeout(successTimerRef.current); };
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
      const { data: { session: authSession }, error: authError } = await authService.getSession();
      
      if (authError || !authSession?.user) {
        // Redirect to login with return URL - user must log in first
        const returnUrl = encodeURIComponent(window.location.pathname);
        navigate(`/login?returnUrl=${returnUrl}`);
        return;
      }
      
      const user = authSession.user;

      // STEP 2: Validate photo check-in token (requires authentication)
      const { data: photoSession, error: tokenError } = await checkinService.validatePhotoToken(token);

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

      // STEP 3: Get student info with photo_url (user already authenticated in STEP 1)
      const { data: student, error: studentError } = await checkinService.getStudentByEmail(user.email || '');

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
      const { data: session, error: sessionError } = await checkinService.getSessionDetails(sessionId);

      if (sessionError || !session) {
        setError('Invalid session');
        setLoading(false);
        return;
      }

      // Verify student is enrolled
      const { data: enrollment, error: enrollmentError } = await checkinService.getEnrollment(sessionId, student.student_id);

      if (enrollmentError || !enrollment) {
        setError('You are not enrolled in this session');
        setLoading(false);
        return;
      }

      // Check if already checked in
      const { data: existingAttendance } = await checkinService.getExistingAttendance(sessionId, student.student_id, date);

      if (existingAttendance && existingAttendance.status !== 'absent') {
        setError('You have already checked in for this session');
        setLoading(false);
        return;
      }

      // Check if host is already set for this date in session_date_host table
      const { data: hostData } = await checkinService.getSessionDateHost(sessionId, date);

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

      const courseData = session.course ? (Array.isArray(session.course) ? session.course[0] : session.course) : undefined;
      
      // Resolve effective time (time change override or default session time)
      const effectiveTime = await checkinService.getEffectiveTimeForDate(sessionId, date);
      
      setCheckInData({
        session_id: sessionId,
        attendance_date: date,
        token: token!,
        session: {
          course: courseData,
          time: effectiveTime || session.time,
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

  // Start camera with optimized resolution for face recognition
  const startCamera = async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user',
          width: { ideal: 640, min: 480 },
          height: { ideal: 480, min: 360 }
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
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    setCapturedPhoto(dataUrl);
    stopCamera();
    
    // Automatically verify the face
    verifyFace(dataUrl);
  };

  /**
   * Enhanced face detection with fallback strategy:
   * 1. Try SSD MobileNet (most accurate) with lower confidence
   * 2. If fails, retry with even lower confidence
   * 3. If still fails, try TinyFaceDetector as fallback
   * Returns detection with landmarks and descriptor, or null
   */
  const detectFaceWithFallback = async (img: HTMLImageElement) => {
    // Attempt 1: SSD MobileNet with standard confidence
    let detection = await faceapi
      .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    if (detection) return detection;
    
    // Attempt 2: SSD MobileNet with lower confidence (catches harder cases)
    detection = await faceapi
      .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    if (detection) return detection;
    
    // Attempt 3: TinyFaceDetector fallback (faster, different architecture)
    detection = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    return detection || null;
  };

  /**
   * Preprocess image for better recognition:
   * Normalize brightness and contrast using canvas manipulation
   */
  const preprocessImage = async (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        
        // Calculate average brightness
        let sumBrightness = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          sumBrightness += (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
        }
        const avgBrightness = sumBrightness / (pixels.length / 4);
        
        // Auto-brightness correction: target brightness ~128
        const targetBrightness = 128;
        const brightnessDelta = targetBrightness - avgBrightness;
        
        // Only correct if significantly off (>25 points)
        if (Math.abs(brightnessDelta) > 25) {
          const factor = 1 + (brightnessDelta / 256) * 0.5; // gentle correction
          for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = Math.min(255, Math.max(0, pixels[i] * factor + brightnessDelta * 0.3));
            pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1] * factor + brightnessDelta * 0.3));
            pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2] * factor + brightnessDelta * 0.3));
          }
          ctx.putImageData(imageData, 0, 0);
        }
        
        // Light contrast enhancement
        const contrastFactor = 1.1;
        const intercept = 128 * (1 - contrastFactor);
        const contrastData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const contrastPixels = contrastData.data;
        for (let i = 0; i < contrastPixels.length; i += 4) {
          contrastPixels[i] = Math.min(255, Math.max(0, contrastPixels[i] * contrastFactor + intercept));
          contrastPixels[i + 1] = Math.min(255, Math.max(0, contrastPixels[i + 1] * contrastFactor + intercept));
          contrastPixels[i + 2] = Math.min(255, Math.max(0, contrastPixels[i + 2] * contrastFactor + intercept));
        }
        ctx.putImageData(contrastData, 0, 0);
        
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Enhanced face verification with preprocessing, multi-attempt detection, and adaptive thresholding
  const verifyFace = async (capturedDataUrl: string) => {
    if (!signedPhotoUrl) {
      setFaceMatchResult({ matched: false, confidence: 0, error: 'No reference photo found' });
      return;
    }

    setVerifying(true);
    setFaceMatchResult(null);

    try {
      // Preprocess captured image for better recognition
      const processedCapturedUrl = await preprocessImage(capturedDataUrl);
      
      // Use cached reference descriptor if same URL, otherwise detect and cache
      let refDescriptor: Float32Array;
      let refScore: number;
      if (cachedRefDescriptor.current && cachedRefDescriptor.current.url === signedPhotoUrl) {
        refDescriptor = cachedRefDescriptor.current.descriptor;
        refScore = cachedRefDescriptor.current.score;
      } else {
        const refImg = await faceapi.fetchImage(signedPhotoUrl);
        const refDetection = await detectFaceWithFallback(refImg);
        if (!refDetection) {
          setFaceMatchResult({ matched: false, confidence: 0, error: 'Could not detect face in your reference photo. Please update your profile photo.' });
          setVerifying(false);
          return;
        }
        refDescriptor = refDetection.descriptor;
        refScore = refDetection.detection.score;
        cachedRefDescriptor.current = { url: signedPhotoUrl, descriptor: refDescriptor, score: refScore };
      }

      // Load and detect on preprocessed captured image
      const capturedImg = await faceapi.fetchImage(processedCapturedUrl);
      let capturedDetection = await detectFaceWithFallback(capturedImg);

      // If preprocessing didn't help, try the original image
      if (!capturedDetection) {
        const originalImg = await faceapi.fetchImage(capturedDataUrl);
        capturedDetection = await detectFaceWithFallback(originalImg);
      }

      if (!capturedDetection) {
        setFaceMatchResult({ matched: false, confidence: 0, error: 'Could not detect your face. Please ensure good lighting and face the camera directly.' });
        setVerifying(false);
        return;
      }

      // Compare face descriptors using Euclidean distance
      const distance = faceapi.euclideanDistance(refDescriptor, capturedDetection.descriptor);
      
      // Adaptive confidence calculation:
      // Use a sigmoid-based mapping for smoother confidence values
      // distance 0.0 → ~100%, distance 0.4 → ~80%, distance 0.6 → ~50%, distance 1.0 → ~10%
      const confidence = Math.round(Math.max(0, Math.min(100, (1 - distance) * 120 - 5)));
      
      // Adaptive threshold based on detection quality:
      // - Both detections have high score → stricter threshold (0.60)
      // - Normal case → standard threshold (0.55)
      const capScore = capturedDetection.detection.score;
      const bothHighQuality = refScore > 0.85 && capScore > 0.85;
      const threshold = bothHighQuality ? 0.60 : 0.55;
      
      const matched = distance < threshold;

      setFaceMatchResult({ matched, confidence });
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
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
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

  // Submit check-in
  const handleCheckIn = async () => {
    if (!checkInData || !studentInfo || !faceMatchResult?.matched) return;

    setSubmitting(true);
    setError(null);

    try {
      // PROXIMITY VALIDATION: First check if host has coordinates set
      // Get host info from session_date_host
      const { data: hostData } = await checkinService.getSessionDateHost(checkInData.session_id, checkInData.attendance_date);

      // Load coordinates: prefer session_date_host overrides, fall back to student/teacher table
      let hostLat: number | null = null;
      let hostLon: number | null = null;
      
      if (hostData?.host_latitude && hostData?.host_longitude) {
        hostLat = Number(hostData.host_latitude);
        hostLon = Number(hostData.host_longitude);
      } else if (hostData?.host_id) {
        const isTeacher = hostData.host_type === 'teacher';
        
        const { data: coordData } = await checkinService.getHostCoordinates(hostData.host_id, isTeacher);
        
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
            `⚠️ You are too far from the session location!\n\n` +
            `Your distance: ${formatDistance(proximityResult.distance)}\n` +
            `Maximum allowed: ${formatDistance(checkInData.session!.proximity_radius!)}\n\n` +
            `Please move closer to ${hostData?.host_address || 'the host'} to check in.`
          );
          setSubmitting(false);
          return;
        }

      } else if (checkInData.session?.proximity_radius && !hostLat) {
        console.warn('📍 Proximity radius configured but no host coordinates set - validation skipped');
      }

      const { data: enrollment } = await checkinService.getEnrollmentId(checkInData.session_id, studentInfo.student_id);

      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      const addressOnly = selectedAddress ? selectedAddress.split('|||')[1] || selectedAddress : null;

      // Determine attendance status
      let attendanceStatus: 'on time' | 'late' | 'absent' = 'on time';
      let checkInAfterSession = false;
      let lateMinutes: number | null = null; // Track how many minutes late
      let earlyMinutes: number | null = null; // Track how many minutes early
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
          const sessionStart = new Date(checkInData.attendance_date + 'T00:00:00');
          sessionStart.setHours(startTime.hours, startTime.minutes, 0, 0);
          
          const sessionEnd = new Date(checkInData.attendance_date + 'T00:00:00');
          sessionEnd.setHours(endTime.hours, endTime.minutes, 0, 0);
          
          const graceEnd = new Date(sessionStart.getTime() + gracePeriodMinutes * 60 * 1000);
          
          const attendanceDate = new Date(checkInData.attendance_date + 'T00:00:00');
          attendanceDate.setHours(0, 0, 0, 0);
          
          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0);
          
          const isToday = attendanceDate.getTime() === todayDate.getTime();
          const isFutureDate = attendanceDate.getTime() > todayDate.getTime();
          
          if (isToday) {
            // Allow early check-in up to 30 minutes before session starts
            const earliestCheckIn = new Date(sessionStart.getTime() - 30 * 60 * 1000);
            
            if (now < earliestCheckIn) {
              setError('Cannot check in more than 30 minutes before session starts.');
              setSubmitting(false);
              return;
            }
            
            if (now > sessionEnd) {
              attendanceStatus = 'late';
              lateMinutes = Math.ceil((now.getTime() - sessionStart.getTime()) / (1000 * 60));
              checkInAfterSession = true;
            } else if (now > graceEnd) {
              attendanceStatus = 'late';
              // Calculate how many minutes late from session start (grace period only determines threshold)
              lateMinutes = Math.ceil((now.getTime() - sessionStart.getTime()) / (1000 * 60));
            } else if (now < sessionStart) {
              // Student arrived early - track early minutes
              attendanceStatus = 'on time';
              earlyMinutes = Math.ceil((sessionStart.getTime() - now.getTime()) / (1000 * 60));
            }
          } else if (isFutureDate) {
            setError('You cannot check in before the session date.');
            setSubmitting(false);
            return;
          } else {
            // For past dates, student is still actively checking in (QR/photo valid), mark as late
            attendanceStatus = 'late';
            lateMinutes = Math.ceil((now.getTime() - sessionStart.getTime()) / (1000 * 60));
            checkInAfterSession = true;
          }
        }
      }

      const { data: existingRecord } = await checkinService.getExistingAttendanceByEnrollment(enrollment.enrollment_id, checkInData.session_id, checkInData.attendance_date);

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
        late_minutes: lateMinutes, // Track how late for tiered scoring
        early_minutes: earlyMinutes, // Track how early for analytics
        check_in_method: 'photo' as const, // Track check-in method
        distance_from_host: distanceFromHost, // Track distance from host location
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: `${studentInfo.email} - face check-in (${faceMatchResult.confidence}% match)`,
        marked_at: new Date().toISOString(),
      };

      // Use upsert to handle race conditions - if record exists, update it
      // This prevents duplicate key errors when two requests happen simultaneously
      const { error: attendanceError } = await checkinService.upsertAttendance(attendanceData as Record<string, unknown>);

      if (attendanceError) {
        throw attendanceError;
      }

      // Audit log the photo check-in
      try { await logInsert('attendance', `${enrollment.enrollment_id}_${checkInData.attendance_date}`, attendanceData as Record<string, unknown>, 'Face recognition check-in'); } catch { /* audit non-critical */ }

      setWasLate(attendanceStatus !== 'on time');
      setCheckedInAfterSession(checkInAfterSession);
      setActualLateMinutes(lateMinutes);
      setSuccess(true);
      
      // Check if session has feedback enabled
      const { enabled } = await feedbackService.isEnabled(checkInData.session_id);

      if (enabled) {
        setFeedbackEnabled(true);
        setTimeout(() => setShowFeedback(true), 1200);
      } else {
        successTimerRef.current = setTimeout(() => navigate('/'), 3000);
      }
    } catch (err) {
      console.error('Check-in error:', err);
      setError(err instanceof Error ? err.message : 'Failed to check in. Please try again.');
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading || modelsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 dark:border-purple-400 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-300">
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <span className="text-3xl">⚠️</span>
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

  // Success state
  if (success) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${wasLate ? 'bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-gray-900 dark:to-gray-800' : 'bg-gradient-to-br from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800'}`}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${wasLate ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
              <span className="text-5xl">{wasLate ? '⏰' : '✅'}</span>
              <span>Face Check-In Successful!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Welcome, {studentInfo?.name}!
              </p>
              <p className="text-sm text-green-600 dark:text-green-400 mb-2">
                Face verified with {faceMatchResult?.confidence}% confidence
              </p>
              {(wasLate || checkedInAfterSession) && (
                <div className={`${checkedInAfterSession ? 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700' : 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700'} border rounded-lg p-3 mb-3`}>
                  <p className={`text-sm font-semibold ${checkedInAfterSession ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'}`}>
                    {checkedInAfterSession 
                      ? '🚫 You checked in AFTER the session ended' 
                      : `⚠️ You were marked as LATE — ${actualLateMinutes ?? '?'} min after session started`}
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
                  checkInMethod="photo"
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-3xl">📸</span>
            <span>Face Check-In</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Session Info */}
          <div className="bg-purple-50 dark:bg-purple-900/40 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">📚</span>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Course</p>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">
                  {checkInData?.session?.course?.course_name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📅</span>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Date</p>
                <p className="font-semibold text-gray-900 dark:text-white text-sm">
                  {checkInData?.attendance_date && format(new Date(checkInData.attendance_date + 'T00:00:00'), 'EEE, MMM dd, yyyy')}
                </p>
              </div>
            </div>
          </div>

          {/* Student Info with Reference Photo */}
          <div className="bg-blue-50 dark:bg-blue-900/40 rounded-lg p-4">
            <div className="flex items-center gap-3">
              {signedPhotoUrl ? (
                <img 
                  src={signedPhotoUrl} 
                  alt="Reference" 
                  loading="lazy"
                  className="w-16 h-16 rounded-full object-cover border-2 border-blue-300 dark:border-blue-600"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <span className="text-2xl">👤</span>
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{studentInfo?.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{studentInfo?.email}</p>
              </div>
            </div>
          </div>

          {/* Camera / Captured Photo */}
          <div className="relative aspect-video bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
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
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                <span className="text-5xl mb-2">📷</span>
                <p className="text-sm">Click "Open Camera" to start</p>
              </div>
            )}
          </div>

          {/* Face Match Result */}
          {verifying && (
            <div className="flex items-center justify-center gap-2 text-purple-600 dark:text-purple-400 py-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600 dark:border-purple-400"></div>
              <span>Verifying your face...</span>
            </div>
          )}

          {faceMatchResult && (
            <div className={`p-4 rounded-lg border ${faceMatchResult.matched 
              ? 'bg-green-50 dark:bg-green-900/40 border-green-300 dark:border-green-700' 
              : 'bg-red-50 dark:bg-red-900/40 border-red-300 dark:border-red-700'}`}
            >
              {faceMatchResult.error ? (
                <p className="text-red-600 dark:text-red-400 text-sm">❌ {faceMatchResult.error}</p>
              ) : faceMatchResult.matched ? (
                <div className="text-center">
                  <p className="text-green-700 dark:text-green-300 font-semibold text-lg">✅ Face Verified!</p>
                  <p className="text-green-600 dark:text-green-400 text-sm">{faceMatchResult.confidence}% confidence match</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-red-700 dark:text-red-300 font-semibold">❌ Face Not Matched</p>
                  <p className="text-red-600 dark:text-red-400 text-sm">Only {faceMatchResult.confidence}% match (need 40%+)</p>
                </div>
              )}
            </div>
          )}

          {/* Host Address Display (Read-only - set by teacher) */}
          {selectedAddress && faceMatchResult?.matched && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                🏠 Session Location
              </label>
              <div className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                📍 {selectedAddress.split('|||')[1] || selectedAddress}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Location set by teacher. Your GPS will be checked against this address.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && capturedPhoto && (
            <div className="p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-lg text-red-600 dark:text-red-400 text-sm">
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
                  disabled={submitting || !selectedAddress}
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
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Ensure good lighting and face the camera directly.
            <br />
            Your GPS location will be captured for verification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
