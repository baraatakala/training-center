import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';

interface PhotoUploadProps {
  studentId: string;
  currentPhotoUrl: string | null; // This is actually the file path stored in DB
  onPhotoUploaded: (url: string) => void;
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    await uploadPhoto(file);
  };

  // Upload photo to Supabase Storage
  const uploadPhoto = async (file: Blob | File) => {
    setUploading(true);
    setError(null);

    try {
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
                  onClick={deletePhoto}
                  disabled={uploading}
                  variant="outline"
                  className="w-full text-red-600 hover:bg-red-50"
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
          <div className="flex items-center justify-center gap-2 text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-sm">Processing...</span>
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
