import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';

type QRCodeModalProps = {
  sessionId: string;
  date: string;
  courseName: string;
  onClose: () => void;
};

export function QRCodeModal({ sessionId, date, courseName, onClose }: QRCodeModalProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [checkInCount, setCheckInCount] = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const generateQRCode = useCallback(async () => {
    try {
      const timestamp = Date.now();
      const token = `${sessionId}-${date}-${timestamp}`;
      
      // Use window.location.origin to construct the full URL
      const checkInUrl = `${window.location.origin}/checkin/${sessionId}/${date}/${token}`;
      
      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(checkInUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#1e3a8a',
          light: '#ffffff',
        },
      });

      setQrCodeUrl(qrDataUrl);
      setLoading(false);
    } catch (err) {
      console.error('QR code generation error:', err);
      setLoading(false);
    }
  }, [sessionId, date]);

  const loadCheckInStats = useCallback(async () => {
    try {
      // Get total enrolled students
      const { count: total } = await supabase
        .from('enrollment')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'active');

      setTotalStudents(total || 0);

      // Get checked-in students
      const { count: checkedIn } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .neq('status', 'absent');

      setCheckInCount(checkedIn || 0);
    } catch (err) {
      console.error('Stats loading error:', err);
    }
  }, [sessionId, date]);

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
        (payload) => {
          console.log('Attendance update:', payload);
          loadCheckInStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, date, loadCheckInStats]);

  const updateTimeLeft = (expiration: Date) => {
    const now = new Date();
    const diff = expiration.getTime() - now.getTime();

    if (diff <= 0) {
      setTimeLeft('Expired');
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
  };

  useEffect(() => {
    generateQRCode();
    loadCheckInStats();
    const cleanup = setupRealtimeSubscription();

    // Expiration time: 2 hours from now
    const expiration = new Date();
    expiration.setHours(expiration.getHours() + 2);

    // Update time left every second
    const timer = setInterval(() => {
      updateTimeLeft(expiration);
    }, 1000);

    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [sessionId, date, generateQRCode, loadCheckInStats, setupRealtimeSubscription]);

  const percentage = totalStudents > 0 ? Math.round((checkInCount / totalStudents) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <span>📱</span>
              <span>QR Check-In</span>
            </h2>
            <p className="text-blue-100 text-sm mt-1">{courseName}</p>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* QR Code */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-8 flex flex-col items-center">
              <div className="bg-white p-6 rounded-xl shadow-lg mb-4">
                <img src={qrCodeUrl} alt="Check-in QR Code" className="w-full h-auto" />
              </div>
              <p className="text-center text-gray-700 font-semibold text-lg">
                Scan to Check In
              </p>
              <p className="text-center text-gray-500 text-sm mt-1">
                Students can scan this code to mark their attendance
              </p>
            </div>
          )}

          {/* Live Stats */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 w-3 h-3 bg-green-500 rounded-full animate-ping opacity-75"></div>
                </div>
                <h3 className="text-xl font-bold text-gray-900">Live Check-Ins</h3>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-gray-900">
                  {checkInCount}
                  <span className="text-xl text-gray-500">/{totalStudents}</span>
                </div>
                <div className="text-sm text-gray-600">{percentage}% Present</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-green-500 to-blue-500 h-full transition-all duration-500 ease-out flex items-center justify-end px-2"
                style={{ width: `${percentage}%` }}
              >
                {percentage > 10 && (
                  <span className="text-xs font-bold text-white">{percentage}%</span>
                )}
              </div>
            </div>
          </div>

          {/* Expiration Info */}
          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">⏰</div>
              <div className="flex-1">
                <p className="text-sm text-gray-600 font-semibold">QR Code Expires In</p>
                <p className="text-2xl font-bold text-gray-900 font-mono">{timeLeft}</p>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <span>📋</span>
              <span>Instructions</span>
            </h4>
            <ul className="space-y-1 text-sm text-gray-700 ml-8">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">1.</span>
                <span>Students should scan the QR code with their phone camera or QR reader</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">2.</span>
                <span>They will be redirected to a check-in page</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">3.</span>
                <span>Select the session location and confirm attendance</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">4.</span>
                <span>Their location will be captured for verification</span>
              </li>
            </ul>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl"
          >
            Close QR Code
          </button>
        </div>
      </div>
    </div>
  );
}
