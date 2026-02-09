import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  /* -------------------- QR CODE -------------------- */
  const generateQRCode = useCallback(async (isRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      // Step 1: Refresh session to ensure valid token (prevents 403 errors)
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError || !session) {
        console.error('Session refresh failed:', refreshError);
        setError('Your session has expired. Please refresh the page and try again.');
        setLoading(false);
        return;
      }
      
      const userEmail = session.user.email || 'system';
      console.log('✅ Session refreshed for QR generation');

      // Step 2: Generate secure QR session token via Supabase function
      const { data: qrSession, error: qrError } = await supabase
        .rpc('generate_qr_session', {
          p_session_id: sessionId,
          p_attendance_date: date,
          p_created_by: userEmail
        });

      if (qrError || !qrSession) {
        console.error('Failed to generate QR session:', qrError);
        setError('Failed to generate QR code. Please close and try again.');
        setLoading(false);
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
      setError('Failed to generate QR code. Please close and reopen the QR modal.');
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

  // Focus trap + Escape key + body scroll lock
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const first = modalRef.current.querySelector('button') as HTMLElement;
        first?.focus();
      }
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
      if (previousActiveElement.current instanceof HTMLElement) previousActiveElement.current.focus();
    };
  }, [onClose]);

  const percentage =
    totalStudents > 0
      ? Math.round((checkInCount / totalStudents) * 100)
      : 0;

  /* -------------------- UI -------------------- */
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="QR Check-In">
      <div ref={modalRef} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 sm:p-6 rounded-t-2xl flex justify-between items-start">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold flex gap-2">
              <span>📱</span> QR Check-In
            </h2>
            <p className="text-blue-100 text-sm mt-1">{courseName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-full transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6 dark:text-gray-200">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-4 flex items-start gap-3">
              <span className="text-3xl">⚠️</span>
              <div>
                <p className="font-semibold text-red-800 dark:text-red-300">Session Error</p>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    generateQRCode();
                  }}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* QR */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin h-16 w-16 border-b-2 border-blue-600 rounded-full" />
            </div>
          ) : !error && (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 rounded-xl p-4 sm:p-8 text-center">
              <img
                src={qrCodeUrl}
                alt="QR Code"
                className="mx-auto mb-4 w-56 sm:w-72 max-w-full"
              />
              <p className="font-semibold dark:text-white">Scan to Check In</p>
              {refreshCount > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-sm">
                  <span>🔄</span>
                  <span>Refreshed {refreshCount}x (every 3 min for security)</span>
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/30 dark:to-blue-900/30 rounded-xl p-4 sm:p-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg dark:text-white">Live Attendance</h3>
              <div className="text-2xl font-bold dark:text-white">
                {checkInCount}/{totalStudents}
              </div>
            </div>

            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{percentage}% Present</p>
          </div>

          {/* Timer */}
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 flex items-center gap-3">
            <span className="text-3xl">⏰</span>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">QR Expires In</p>
              <p className="text-xl font-mono font-bold dark:text-white">{timeLeft}</p>
            </div>
          </div>

          <button
            onClick={() => {
              invalidateQRSession();
              onClose();
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
          >
            Close QR Code
          </button>
        </div>
      </div>
    </div>
  );
}
