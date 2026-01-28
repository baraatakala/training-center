import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';

type QRCodeModalProps = {
  sessionId: string;
  date: string;
  courseName: string;
  onClose: () => void;
};

export function QRCodeModal({
  sessionId,
  date,
  courseName,
  onClose,
}: QRCodeModalProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [checkInCount, setCheckInCount] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('Loading...');
  const [loading, setLoading] = useState<boolean>(true);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);

  /* -------------------- QR CODE -------------------- */
  const generateQRCode = useCallback(async (isRefresh = false) => {
    try {
      setLoading(true);

      // Get current user email for audit
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'system';

      // Generate secure QR session token via Supabase function
      const { data: qrSession, error: qrError } = await supabase
        .rpc('generate_qr_session', {
          p_session_id: sessionId,
          p_attendance_date: date,
          p_created_by: userEmail
        });

      if (qrError || !qrSession) {
        console.error('Failed to generate QR session:', qrError);
        alert('Failed to generate QR code. Please try again.');
        return;
      }

      const token = qrSession.token;
      const expires = new Date(qrSession.expires_at);
      
      setQrToken(token);
      setExpiresAt(expires);

      // Create check-in URL with secure token only
      const checkInUrl = `${window.location.origin}/checkin/${token}`;

      const qrDataUrl = await QRCode.toDataURL(checkInUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#1e3a8a',
          light: '#ffffff',
        },
      });

      setQrCodeUrl(qrDataUrl);
      console.log('✅ Secure QR session created:', { token, expires, isRefresh });
      
      if (isRefresh) {
        setRefreshCount(prev => prev + 1);
        console.log('🔄 QR code refreshed automatically');
      }
    } catch (error) {
      console.error('QR code generation error:', error);
      alert('Error generating QR code. Please try again.');
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
      .channel(`attendance-${sessionId}-${date}`)
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
  const invalidateQRSession = useCallback(async () => {
    if (qrToken) {
      try {
        await supabase.rpc('invalidate_qr_session', { p_token: qrToken });
        console.log('✅ QR session invalidated');
      } catch (error) {
        console.error('Failed to invalidate QR session:', error);
      }
    }
  }, [qrToken]);

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

  /* -------------------- EFFECT -------------------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await generateQRCode();
      await loadCheckInStats();
    })();

    const cleanupRealtime = setupRealtimeSubscription();

    return () => {
      mounted = false;
      cleanupRealtime();
      // Invalidate QR session on unmount
      invalidateQRSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, date]);

  // Separate effect for timer to avoid re-generating QR code
  useEffect(() => {
    const timer = setInterval(() => {
      updateTimeLeft(expiresAt);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [expiresAt, updateTimeLeft]);

  // Dynamic QR refresh every 3 minutes for enhanced security
  useEffect(() => {
    const REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes
    
    const refreshTimer = setInterval(async () => {
      console.log('🔄 Auto-refreshing QR code for security...');
      // Invalidate old QR session
      await invalidateQRSession();
      // Generate new QR code
      await generateQRCode(true);
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(refreshTimer);
    };
  }, [generateQRCode, invalidateQRSession]);

  const percentage =
    totalStudents > 0
      ? Math.round((checkInCount / totalStudents) * 100)
      : 0;

  /* -------------------- UI -------------------- */
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-2xl flex justify-between">
          <div>
            <h2 className="text-2xl font-bold flex gap-2">
              <span>📱</span> QR Check-In
            </h2>
            <p className="text-blue-100 text-sm mt-1">{courseName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl hover:bg-white/20 rounded-full px-3"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* QR */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin h-16 w-16 border-b-2 border-blue-600 rounded-full" />
            </div>
          ) : (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-8 text-center">
              <img
                src={qrCodeUrl}
                alt="QR Code"
                className="mx-auto mb-4 w-72"
              />
              <p className="font-semibold">Scan to Check In</p>
              {refreshCount > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm">
                  <span>🔄</span>
                  <span>Refreshed {refreshCount}x (every 3 min for security)</span>
                </div>
              )}
            </div>
          )}

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
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-3xl">⏰</span>
            <div>
              <p className="text-sm text-gray-600">QR Expires In</p>
              <p className="text-xl font-mono font-bold">{timeLeft}</p>
            </div>
          </div>

          <button
            onClick={() => {
              invalidateQRSession();
              onClose();
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:opacity-90"
          >
            Close QR Code
          </button>
        </div>
      </div>
    </div>
  );
}
