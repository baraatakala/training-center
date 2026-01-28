import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

type PhotoCheckInModalProps = {
  sessionId: string;
  date: string;
  courseName: string;
  onClose: () => void;
};

export function PhotoCheckInModal({
  sessionId,
  date,
  courseName,
  onClose,
}: PhotoCheckInModalProps) {
  const [checkInCount, setCheckInCount] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('Loading...');
  const [loading, setLoading] = useState<boolean>(true);
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [checkInUrl, setCheckInUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  /* -------------------- GENERATE TOKEN -------------------- */
  const generatePhotoSession = useCallback(async () => {
    try {
      setLoading(true);

      // Get current user email for audit
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'system';

      // Generate unique token
      const token = `photo-${sessionId.slice(0, 8)}-${date}-${Date.now().toString(36)}`;
      const expires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

      // Insert into photo_checkin_sessions table
      const { error: insertError } = await supabase
        .from('photo_checkin_sessions')
        .insert({
          session_id: sessionId,
          attendance_date: date,
          token: token,
          expires_at: expires.toISOString(),
          is_valid: true
        });

      if (insertError) {
        console.error('Failed to create photo session:', insertError);
        alert('Failed to generate check-in link. Please try again.');
        return;
      }

      setPhotoToken(token);
      setExpiresAt(expires);

      // Create check-in URL
      const url = `${window.location.origin}/photo-checkin/${token}`;
      setCheckInUrl(url);

      console.log('✅ Photo check-in session created:', { token, expires, createdBy: userEmail });
    } catch (error) {
      console.error('Photo session generation error:', error);
      alert('Error generating check-in link. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, date]);

  /* -------------------- STATS -------------------- */
  const loadCheckInStats = useCallback(async () => {
    try {
      const { count: total } = await supabase
        .from('enrollment')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'active');

      setTotalStudents(total ?? 0);

      const { count: checkedIn } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .neq('status', 'absent');

      setCheckInCount(checkedIn ?? 0);
    } catch (error) {
      console.error('Stats loading error:', error);
    }
  }, [sessionId, date]);

  /* -------------------- REALTIME -------------------- */
  const setupRealtimeSubscription = useCallback(() => {
    const channel = supabase
      .channel(`attendance-photo-${sessionId}-${date}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          loadCheckInStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, date, loadCheckInStats]);

  /* -------------------- INVALIDATE ON CLOSE -------------------- */
  const invalidatePhotoSession = useCallback(async () => {
    if (photoToken) {
      try {
        await supabase
          .from('photo_checkin_sessions')
          .update({ is_valid: false })
          .eq('token', photoToken);
        console.log('✅ Photo session invalidated');
      } catch (error) {
        console.error('Failed to invalidate photo session:', error);
      }
    }
  }, [photoToken]);

  /* -------------------- TIMER -------------------- */
  const updateTimeLeft = useCallback((expiration: Date | null) => {
    if (!expiration) {
      setTimeLeft('Loading...');
      return;
    }

    const diff = expiration.getTime() - Date.now();

    if (diff <= 0) {
      setTimeLeft('Expired');
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
  }, []);

  /* -------------------- COPY LINK -------------------- */
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(checkInUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = checkInUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /* -------------------- SHARE -------------------- */
  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Face Check-In: ${courseName}`,
          text: `Check in with your face for ${courseName}`,
          url: checkInUrl
        });
      } catch (err) {
        console.log('Share cancelled or failed:', err);
      }
    } else {
      copyToClipboard();
    }
  };

  /* -------------------- EFFECT -------------------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await generatePhotoSession();
      await loadCheckInStats();
    })();

    const cleanupRealtime = setupRealtimeSubscription();

    return () => {
      mounted = false;
      cleanupRealtime();
      invalidatePhotoSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, date]);

  // Timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      updateTimeLeft(expiresAt);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [expiresAt, updateTimeLeft]);

  const percentage =
    totalStudents > 0
      ? Math.round((checkInCount / totalStudents) * 100)
      : 0;

  /* -------------------- UI -------------------- */
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6 rounded-t-2xl flex justify-between">
          <div>
            <h2 className="text-2xl font-bold flex gap-2">
              <span>📸</span> Face Check-In
            </h2>
            <p className="text-purple-100 text-sm mt-1">{courseName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl hover:bg-white/20 rounded-full px-3"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Link Section */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin h-16 w-16 border-b-2 border-purple-600 rounded-full" />
            </div>
          ) : (
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-6 text-center space-y-4">
              <div className="text-6xl">📸</div>
              <h3 className="text-lg font-bold text-gray-800">Face Recognition Check-In</h3>
              <p className="text-sm text-gray-600">
                Students can check in by verifying their face against their profile photo.
              </p>
              
              {/* URL Display */}
              <div className="bg-white rounded-lg p-3 border border-purple-200">
                <p className="text-xs text-gray-500 mb-1">Check-in Link:</p>
                <p className="text-sm font-mono text-purple-700 break-all">{checkInUrl}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={copyToClipboard}
                  className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                    copied 
                      ? 'bg-green-500 text-white' 
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  {copied ? '✓ Copied!' : '📋 Copy Link'}
                </button>
                <button
                  onClick={shareLink}
                  className="px-6 py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700"
                >
                  📤 Share
                </button>
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="bg-blue-50 rounded-xl p-4 space-y-2">
            <h4 className="font-bold text-gray-800 flex items-center gap-2">
              <span>ℹ️</span> How It Works
            </h4>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Share the link with students (copy or use Share button)</li>
              <li>Student opens link and logs in if needed</li>
              <li>Student opens camera and takes a live photo</li>
              <li>AI compares face with their profile photo</li>
              <li>If matched, attendance is recorded with GPS location</li>
            </ol>
          </div>

          {/* Requirements */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <h4 className="font-bold text-yellow-800 flex items-center gap-2 mb-2">
              <span>⚠️</span> Requirements
            </h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Students must have uploaded a profile photo</li>
              <li>• Good lighting required for face detection</li>
              <li>• Camera access must be allowed</li>
            </ul>
          </div>

          {/* Stats */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg">Live Attendance</h3>
              <div className="text-2xl font-bold">
                {checkInCount}/{totalStudents}
              </div>
            </div>

            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>

            <p className="text-sm text-gray-600 mt-2">{percentage}% Present</p>
          </div>

          {/* Timer */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-3xl">⏰</span>
            <div>
              <p className="text-sm text-gray-600">Link Expires In</p>
              <p className="text-xl font-mono font-bold">{timeLeft}</p>
            </div>
          </div>

          <button
            onClick={() => {
              invalidatePhotoSession();
              onClose();
            }}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-xl hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
