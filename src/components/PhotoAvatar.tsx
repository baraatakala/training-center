import { useState, useEffect } from 'react';
import { getSignedPhotoUrl } from './PhotoUpload';

interface PhotoAvatarProps {
  photoPath: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-16 h-16'
};

export function PhotoAvatar({ photoPath, name, size = 'md', className = '' }: PhotoAvatarProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadUrl = async () => {
      if (!photoPath) {
        setSignedUrl(null);
        return;
      }

      setLoading(true);
      setError(false);

      try {
        const url = await getSignedPhotoUrl(photoPath);
        setSignedUrl(url);
        if (!url) setError(true);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadUrl();
  }, [photoPath]);

  const sizeClass = sizeClasses[size];

  if (!photoPath || error) {
    return (
      <div 
        className={`${sizeClass} rounded-full bg-gray-200 flex items-center justify-center text-gray-400 ${className}`}
        title="No photo"
      >
        👤
      </div>
    );
  }

  if (loading) {
    return (
      <div 
        className={`${sizeClass} rounded-full bg-gray-100 flex items-center justify-center animate-pulse ${className}`}
      >
        <span className="text-gray-300">...</span>
      </div>
    );
  }

  return (
    <img
      src={signedUrl || ''}
      alt={name}
      className={`${sizeClass} rounded-full object-cover border-2 border-green-400 ${className}`}
      title="Photo uploaded ✓"
      onError={() => setError(true)}
    />
  );
}
