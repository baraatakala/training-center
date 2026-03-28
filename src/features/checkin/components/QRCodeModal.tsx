import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { authService } from '@/shared/services/authService';
import { checkinService } from '@/features/checkin/services/checkinService';

type QRCodeModalProps = {
  sessionId: string;
  date: string;
  courseName: string;
  onClose: () => void;
};

type CheckInMode = 'qr_code' | 'photo';

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

  // Unified mode state
  const [checkInMode, setCheckInMode] = useState<CheckInMode>('qr_code');
  const [faceToken, setFaceToken] = useState<string | null>(null);
  const [faceCheckInUrl, setFaceCheckInUrl] = useState<string>('');
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceCopied, setFaceCopied] = useState(false);

  const clearPhotoState = useCallback(() => {
    setFaceToken(null);
    setFaceCheckInUrl('');
    setFaceCopied(false);
  }, []);

  const createPhotoSession = useCallback(async (expiresAtIso: string) => {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const { error: insertError } = await checkinService
      .createPhotoSession({
        session_id: sessionId,
        attendance_date: date,
        token,
        expires_at: expiresAtIso,
        is_valid: true,
      });

    if (insertError) {
      console.error('Failed to create face session:', insertError);
      return null;
    }

    return {
      token,
      url: `${window.location.origin}/photo-checkin/${token}`,
    };
  }, [sessionId, date]);

  const invalidateFaceSession = useCallback(async (tokenToInvalidate?: string | null) => {
    const activeToken = tokenToInvalidate ?? faceToken;
    if (activeToken) {
      try {
        await checkinService.invalidatePhotoSession(activeToken);
      } catch (err) {
        console.error('Failed to invalidate face session:', err);
      }
    }
  }, [faceToken]);

  /* -------------------- QR CODE -------------------- */
  const generateQRCode = useCallback(async (mode: CheckInMode = checkInMode, isRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      setFaceLoading(mode === 'photo');

      // Step 1: Refresh session to ensure valid token (prevents 403 errors)
      const { data: { session }, error: refreshError } = await authService.refreshSession();
      
      if (refreshError || !session) {
        console.error('Session refresh failed:', refreshError);
        setError('Your session has expired. Please refresh the page and try again.');
        setLoading(false);
        return;
      }
      
      const userEmail = session.user.email || 'system';

      let linkedPhotoToken: string | null = null;
      let linkedPhotoUrl = '';
      let expirationOverride: string | null = null;

      if (mode === 'photo') {
        expirationOverride = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const photoSession = await createPhotoSession(expirationOverride);

        if (!photoSession) {
          clearPhotoState();
          setError('Failed to generate face check-in link. Please close and try again.');
          setLoading(false);
          return;
        }

        linkedPhotoToken = photoSession.token;
        linkedPhotoUrl = photoSession.url;
      } else {
        clearPhotoState();
      }

      // Step 2: Generate secure QR session token via Supabase function
      const { data: qrSession, error: qrError } = await checkinService
        .generateQrSession({
          p_session_id: sessionId,
          p_attendance_date: date,
          p_created_by: userEmail,
          p_check_in_mode: mode,
          p_linked_photo_token: linkedPhotoToken,
          p_expires_at: expirationOverride,
        });

      if (qrError || !qrSession) {
        if (linkedPhotoToken) {
          await invalidateFaceSession(linkedPhotoToken);
        }
        console.error('Failed to generate QR session:', qrError);
        setError('Failed to generate QR code. Please close and try again.');
        setLoading(false);
        return;
      }

      const token = qrSession.token;
      const expires = new Date(qrSession.expires_at);
      
      setQrToken(token);
      setExpiresAt(expires);
      setCheckInMode(mode);

      if (mode === 'photo' && linkedPhotoToken) {
        setFaceToken(linkedPhotoToken);
        setFaceCheckInUrl(linkedPhotoUrl);
      }

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
      
      if (isRefresh) {
        setRefreshCount(prev => prev + 1);
      }
    } catch (error) {
      console.error('QR code generation error:', error);
      setError('Failed to generate QR code. Please close and reopen the QR modal.');
    } finally {
      setLoading(false);
      setFaceLoading(false);
    }
  }, [sessionId, date, checkInMode, createPhotoSession, clearPhotoState, invalidateFaceSession]);

  /* -------------------- STATS -------------------- */
  const loadCheckInStats = useCallback(async () => {
    try {
      const { count: total } = await checkinService
        .getActiveEnrollmentCount(sessionId);

      setTotalStudents(total ?? 0);

      const { count: checkedIn } = await checkinService
        .getCheckInCount(sessionId, date);

      setCheckInCount(checkedIn ?? 0);
    } catch (error) {
      console.error('Stats loading error:', error);
    }
  }, [sessionId, date]);

  /* -------------------- REALTIME -------------------- */
  const setupRealtimeSubscription = useCallback(() => {
    const channel = checkinService
      .createChannel(`attendance-${sessionId}-${date}`)
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
      checkinService.removeChannel(channel);
    };
  }, [sessionId, date, loadCheckInStats]);

  /* -------------------- INVALIDATE ON CLOSE -------------------- */
  const invalidateQRSession = useCallback(async () => {
    if (qrToken) {
      try {
        await checkinService.invalidateQrSession(qrToken);
      } catch (error) {
        console.error('Failed to invalidate QR session:', error);
      }
    }
  }, [qrToken]);

  const handleModeChange = useCallback(async (nextMode: CheckInMode) => {
    if (nextMode === checkInMode) return;

    await invalidateQRSession();
    await invalidateFaceSession();
    clearPhotoState();
    setRefreshCount(0);
    setCheckInMode(nextMode);
    await generateQRCode(nextMode);
  }, [checkInMode, invalidateQRSession, invalidateFaceSession, clearPhotoState, generateQRCode]);

  const copyFaceLink = async () => {
    try {
      await navigator.clipboard.writeText(faceCheckInUrl);
      setFaceCopied(true);
      setTimeout(() => setFaceCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = faceCheckInUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setFaceCopied(true);
      setTimeout(() => setFaceCopied(false), 2000);
    }
  };

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
      await generateQRCode(checkInMode);
      await loadCheckInStats();
    })();

    const cleanupRealtime = setupRealtimeSubscription();

    return () => {
      mounted = false;
      cleanupRealtime();
      // Invalidate QR session on unmount
      invalidateQRSession();
      invalidateFaceSession();
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
      // Invalidate old QR session
      await invalidateQRSession();
      await invalidateFaceSession();
      clearPhotoState();
      // Generate new QR code
      await generateQRCode(checkInMode, true);
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(refreshTimer);
    };
  }, [checkInMode, clearPhotoState, generateQRCode, invalidateFaceSession, invalidateQRSession]);

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
              <span>ðŸ“±</span> QR Check-In
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
              <span className="text-3xl">âš ï¸</span>
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
              <p className="font-semibold dark:text-white">
                {checkInMode === 'photo' ? 'Scan for Face Check-In' : 'Scan to Check In'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {checkInMode === 'photo'
                  ? 'The same QR opens the face recognition flow.'
                  : 'Students scan this QR to mark attendance.'}
              </p>
              {refreshCount > 0 && (
                <div className="mt-3 inline-flex items-center gap-2 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-sm">
                  <span>ðŸ”„</span>
                  <span>Refreshed {refreshCount}x (every 3 min for security)</span>
                </div>
              )}
            </div>
          )}

          {/* Check-In Mode */}
          <div className="rounded-xl border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/20 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Check-In Mode</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Choose which student flow the QR should open.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleModeChange('qr_code')}
                    disabled={loading || faceLoading}
                    className={`rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                      checkInMode === 'qr_code'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                    }`}
                  >
                    QR Check-In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('photo')}
                    disabled={loading || faceLoading}
                    className={`rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                      checkInMode === 'photo'
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-purple-400'
                    }`}
                  >
                    Face Check-In
                  </button>
                </div>
              </div>

            {checkInMode === 'photo' && faceCheckInUrl && (
              <div className="mt-3 space-y-3 animate-fade-in">
                <div className="bg-white dark:bg-gray-700 rounded-lg p-3 border border-purple-200 dark:border-purple-600">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Face Check-In Link</p>
                  <p className="text-sm font-mono text-purple-700 dark:text-purple-300 break-all">{faceCheckInUrl}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyFaceLink}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      faceCopied
                        ? 'bg-green-500 text-white'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    {faceCopied ? 'âœ“ Copied!' : 'ðŸ“‹ Copy Link'}
                  </button>
                  {navigator.share && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.share({ title: `Face Check-In: ${courseName}`, text: `Check in with face for ${courseName}`, url: faceCheckInUrl });
                        } catch { /* share cancelled */ }
                      }}
                      className="px-3 py-2 bg-pink-600 text-white rounded-lg text-sm font-medium hover:bg-pink-700"
                    >
                      ðŸ“¤ Share
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-purple-600 dark:text-purple-400">
                  Students need a profile photo uploaded. This link matches the active QR session.
                </p>
              </div>
            )}
            {checkInMode === 'photo' && faceLoading && (
              <div className="mt-3 flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-500 border-t-transparent" />
                Generating face check-in mode...
              </div>
            )}
            </div>
          </div>

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
            <span className="text-3xl">â°</span>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">QR Expires In</p>
              <p className="text-xl font-mono font-bold dark:text-white">{timeLeft}</p>
            </div>
          </div>

          <button
            onClick={() => {
              invalidateQRSession();
              invalidateFaceSession();
              onClose();
            }}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
          >
            Close Check-In
          </button>
        </div>
      </div>
    </div>
  );
}
