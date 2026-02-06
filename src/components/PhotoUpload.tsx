import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import * as faceapi from 'face-api.js';

interface PhotoUploadProps {
  studentId: string;
  currentPhotoUrl: string | null; // This is actually the file path stored in DB
  onPhotoUploaded: (url: string) => void;
}

interface PhotoQualityResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  faceSize?: number;
  brightness?: number;
}

// Validate photo quality for face recognition
async function validatePhotoQuality(imageFile: File | Blob): Promise<PhotoQualityResult> {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(imageFile);
    
    img.onload = async () => {
      try {
        const issues: string[] = [];
        const warnings: string[] = [];

        // Detect face
        const detection = await faceapi
          .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
          .withFaceLandmarks();

        // Check 1: Face detected
        if (!detection) {
          issues.push('No face detected in photo');
          URL.revokeObjectURL(url);
          return resolve({ valid: false, issues, warnings });
        }

        // Check 2: Only one face
        const allDetections = await faceapi.detectAllFaces(img);
        if (allDetections.length > 1) {
          issues.push(`Multiple faces detected (${allDetections.length}). Please use a photo with only your face.`);
        }

        // Check 3: Face size (should be at least 20% of image)
        const faceBox = detection.detection.box;
        const faceArea = faceBox.width * faceBox.height;
        const imageArea = img.width * img.height;
        const faceRatio = faceArea / imageArea;

        if (faceRatio < 0.10) {
          issues.push('Face is too small. Please take a closer photo or crop the image.');
        } else if (faceRatio < 0.20) {
          warnings.push('Face could be larger for better recognition. Consider moving closer.');
        }

        // Check 4: Face too close (occupies > 80%)
        if (faceRatio > 0.80) {
          warnings.push('Face is very close. Ensure entire face including hair is visible.');
        }

        // Check 5: Brightness check (simple average of RGB)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = imageData.data;
          let sum = 0;
          
          for (let i = 0; i < pixels.length; i += 4) {
            sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          }
          
          const avgBrightness = sum / (pixels.length / 4) / 255; // 0-1 scale

          if (avgBrightness < 0.20) {
            issues.push('Photo is too dark. Use better lighting.');
          } else if (avgBrightness < 0.35) {
            warnings.push('Photo is dim. Better lighting will improve recognition.');
          } else if (avgBrightness > 0.85) {
            warnings.push('Photo is very bright. Avoid overexposure.');
          }
        }

        // Check 6: Face angle (landmarks can detect profile vs frontal)
        const landmarks = detection.landmarks;
        const nose = landmarks.getNose();
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        
        // Simple check: if nose is too far from center between eyes, face is angled
        const eyeCenterX = (leftEye[0].x + rightEye[0].x) / 2;
        const noseX = nose[3].x; // Nose tip
        const deviation = Math.abs(noseX - eyeCenterX) / faceBox.width;
        
        if (deviation > 0.25) {
          warnings.push('Face appears angled. A frontal view works best.');
        }

        URL.revokeObjectURL(url);
        
        resolve({
          valid: issues.length === 0,
          issues,
          warnings,
          faceSize: faceRatio,
          brightness: 0 // We can't calculate from here
        });
      } catch (error) {
        console.error('Photo validation error:', error);
        URL.revokeObjectURL(url);
        resolve({
          valid: false,
          issues: ['Failed to analyze photo. Please try again.'],
          warnings: []
        });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({
        valid: false,
        issues: ['Failed to load image. Please try a different photo.'],
        warnings: []
      });
    };

    img.src = url;
  });
}

// Helper function to get signed URL from file path
export async function getSignedPhotoUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  
  // If it's already a full URL (legacy), try to use it
  if (filePath.startsWith('http')) {
    return filePath;
  }
  
  const { data, error } = await supabase.storage
    .from('student-photos')
    .createSignedUrl(filePath, 60 * 60); // 1 hour validity
    
  if (error || !data?.signedUrl) {
    console.error('Failed to get signed URL:', error);
    return null;
  }
  
  return data.signedUrl;
}

export function PhotoUpload({ studentId, currentPhotoUrl, onPhotoUploaded }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [validating, setValidating] = useState(false);
  const [qualityResult, setQualityResult] = useState<PhotoQualityResult | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
        console.log('✅ Face detection models loaded for photo quality check');
      } catch (err) {
        console.error('Failed to load face detection models:', err);
      }
    };
    loadModels();
  }, []);

  // Load signed URL when component mounts or photo path changes
  useEffect(() => {
    const loadSignedUrl = async () => {
      if (currentPhotoUrl) {
        const signedUrl = await getSignedPhotoUrl(currentPhotoUrl);
        setPreviewUrl(signedUrl);
      } else {
        setPreviewUrl(null);
      }
    };
    loadSignedUrl();
  }, [currentPhotoUrl]);

  // Start camera for live capture
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
      
      // Wait for next render to attach stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (err) {
      console.error('Camera error:', err);
      setError('Could not access camera. Please check permissions or use file upload.');
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
  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Mirror the image for selfie camera
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    // Convert to blob
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError('Failed to capture photo');
        return;
      }
      
      stopCamera();
      await uploadPhoto(blob);
    }, 'image/jpeg', 0.8);
  };

  // Compress image if too large
  const compressImage = async (file: File, maxSizeMB: number = 5): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        // Calculate dimensions (max 1200px on longest side)
        let { width, height } = img;
        const maxDimension = 1200;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Start with high quality, reduce if needed
        let quality = 0.9;
        const tryCompress = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }
              
              // If still too large and quality can be reduced
              if (blob.size > maxSizeMB * 1024 * 1024 && quality > 0.3) {
                quality -= 0.1;
                tryCompress();
              } else {
                resolve(blob);
              }
            },
            'image/jpeg',
            quality
          );
        };
        
        tryCompress();
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for compression'));
      };
      
      img.src = url;
    });
  };

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type - be more lenient for mobile devices
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const isImage = file.type.startsWith('image/') || validTypes.some(t => file.name.toLowerCase().endsWith(t.split('/')[1]));
    
    if (!isImage) {
      setError('Please select an image file (JPG, PNG, or WEBP)');
      return;
    }

    // Check file size - if larger than 5MB, compress it
    if (file.size > 5 * 1024 * 1024) {
      try {
        setUploading(true);
        setError(null);
        const compressedBlob = await compressImage(file, 5);
        
        if (compressedBlob.size > 5 * 1024 * 1024) {
          setError('Image is too large. Please select a smaller image.');
          setUploading(false);
          return;
        }
        
        console.log(`✅ Image compressed from ${(file.size / 1024 / 1024).toFixed(2)}MB to ${(compressedBlob.size / 1024 / 1024).toFixed(2)}MB`);
        setUploading(false);
        await uploadPhoto(compressedBlob);
        return;
      } catch (err) {
        console.error('Compression error:', err);
        setError('Failed to process image. Please try a different image.');
        setUploading(false);
        return;
      }
    }

    await uploadPhoto(file);
  };

  // Upload photo to Supabase Storage
  const uploadPhoto = async (file: Blob | File) => {
    setUploading(true);
    setError(null);
    setQualityResult(null);

    try {
      // Validate photo quality if models are loaded
      if (modelsLoaded) {
        setValidating(true);
        const quality = await validatePhotoQuality(file);
        setQualityResult(quality);
        setValidating(false);

        if (!quality.valid) {
          setError(`Photo quality issues:\n${quality.issues.join('\n')}`);
          setUploading(false);
          return;
        }

        // Show warnings but allow upload
        if (quality.warnings.length > 0) {
          console.warn('Photo quality warnings:', quality.warnings);
        }
      }

      // Generate unique filename
      const timestamp = Date.now();
      const fileName = `${studentId}/${timestamp}.jpg`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('student-photos')
        .upload(fileName, file, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get signed URL for private bucket (valid for 1 year)
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('student-photos')
        .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw signedUrlError || new Error('Failed to get signed URL');
      }

      // Store the file path in database (not the signed URL, as it expires)
      // We'll generate fresh signed URLs when displaying
      const { error: updateError } = await supabase
        .from('student')
        .update({ photo_url: fileName }) // Store path, not URL
        .eq('student_id', studentId);

      if (updateError) {
        throw updateError;
      }

      setPreviewUrl(signedUrlData.signedUrl);
      onPhotoUploaded(fileName);

      console.log('✅ Photo uploaded successfully:', fileName);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  // Delete current photo
  const deletePhoto = async () => {
    if (!currentPhotoUrl) return;

    setUploading(true);
    setError(null);

    try {
      // currentPhotoUrl is now a file path like "studentId/timestamp.jpg"
      // Handle both old URLs and new paths
      let filePath = currentPhotoUrl;
      if (currentPhotoUrl.includes('/student-photos/')) {
        const urlParts = currentPhotoUrl.split('/student-photos/');
        filePath = urlParts[1] || currentPhotoUrl;
      }
      
      await supabase.storage
        .from('student-photos')
        .remove([filePath]);

      // Clear photo_url in database
      const { error: updateError } = await supabase
        .from('student')
        .update({ photo_url: null })
        .eq('student_id', studentId);

      if (updateError) {
        throw updateError;
      }

      setPreviewUrl(null);
      onPhotoUploaded('');

      console.log('✅ Photo deleted successfully');
    } catch (err) {
      console.error('Delete error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete photo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>📸</span>
          <span>Reference Photo</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview or Camera */}
        <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
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
            </>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt="Reference photo"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
              <span className="text-6xl mb-2">👤</span>
              <p className="text-sm">No photo uploaded</p>
              <p className="text-xs text-gray-300 mt-1">Required for face check-in</p>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {showCamera ? (
            <>
              <Button
                onClick={capturePhoto}
                disabled={uploading}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                📷 Capture
              </Button>
              <Button
                onClick={stopCamera}
                variant="outline"
                className="flex-1"
              >
                ✕ Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={startCamera}
                disabled={uploading}
                className="flex-1"
              >
                📷 Take Photo
              </Button>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                variant="outline"
                className="flex-1"
              >
                📁 Upload File
              </Button>
              {previewUrl && (
                <Button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this photo? This will disable face recognition check-in for this student.')) {
                      deletePhoto();
                    }
                  }}
                  disabled={uploading}
                  variant="outline"
                  className="w-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                  aria-label="Delete student photo"
                >
                  🗑️ Delete Photo
                </Button>
              )}
            </>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Upload progress */}
        {uploading && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-2 text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-sm">
                {validating ? 'Validating photo quality...' : 'Uploading...'}
              </span>
            </div>
          </div>
        )}

        {/* Quality validation results */}
        {qualityResult && !uploading && (
          <div className="space-y-2">
            {qualityResult.valid && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-green-800 font-medium flex items-center gap-2">
                  <span>✅</span>
                  <span>Photo quality: Excellent</span>
                </p>
                {qualityResult.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {qualityResult.warnings.map((warning, idx) => (
                      <p key={idx} className="text-yellow-700 text-sm flex items-start gap-2">
                        <span>⚠️</span>
                        <span>{warning}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!qualityResult.valid && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-800 font-medium mb-2">❌ Photo quality issues:</p>
                <ul className="list-disc list-inside space-y-1">
                  {qualityResult.issues.map((issue, idx) => (
                    <li key={idx} className="text-red-700 text-sm">{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Info text */}
        <p className="text-xs text-gray-500 text-center">
          This photo will be used for face recognition attendance check-in.
          <br />
          Ensure good lighting and face clearly visible.
        </p>
      </CardContent>
    </Card>
  );
}
