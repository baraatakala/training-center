import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { authService } from '@/shared/services/authService';
import { format } from 'date-fns';
import { excuseRequestService } from '@/features/excuses/services/excuseRequestService';
import { dashboardService } from '@/features/dashboard/services/dashboardService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { toast } from '@/shared/components/ui/toastUtils';
import { HealthCheckPanel } from '../components/HealthCheckPanel';
import { StatsGrid } from '../components/StatsGrid';
import { OperationalPulse } from '../components/OperationalPulse';

export function Dashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    todaySessions: 0,
    totalCourses: 0,
    issuedCertificates: 0,
    loading: true,
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [pendingExcuses, setPendingExcuses] = useState(0);

  const loadStats = useCallback(async () => {
    try {
      const summary = await dashboardService.getStats();

      setStats({
        totalStudents: summary.totalStudents,
        totalTeachers: summary.totalTeachers,
        activeEnrollments: summary.activeEnrollments,
        totalSessions: summary.totalSessions,
        todaySessions: summary.todaySessions,
        totalCourses: summary.totalCourses,
        issuedCertificates: summary.issuedCertificates,
        loading: false,
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error loading stats:', err);
      setError('Failed to load dashboard statistics. Please try again.');
      toast.error('Failed to load dashboard statistics');
      setStats(prev => ({ ...prev, loading: false }));
    }
  }, []);

  // Load pending excuses count — uses service layer
  const loadPendingExcuses = async () => {
    try {
      const { count } = await excuseRequestService.getPendingCount();
      setPendingExcuses(count || 0);
    } catch {
      // table might not exist yet
    }
  };

  // Combined refresh function for useRefreshOnFocus
  const refreshAll = useCallback(() => {
    loadStats();
    loadPendingExcuses();
  }, [loadStats]);

  useRefreshOnFocus(refreshAll);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await authService.getCurrentUser();
        if (user?.email) {
          const role = await dashboardService.getUserRole(user.email);
          setIsTeacher(role.isTeacher || role.isAdmin);
        } else {
          setIsTeacher(false);
        }
      } catch {
        setIsTeacher(false);
      }
    };
    init();
    loadStats();
    loadPendingExcuses();
  }, [loadStats]);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header with last-refresh indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">Overview of your training center</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Last updated: {format(lastRefresh, 'HH:mm:ss')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refreshAll(); toast.success('Dashboard refreshed'); }}
            className="gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            <button 
              onClick={() => { setError(null); loadStats(); }} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}


      <StatsGrid stats={stats} pendingExcuses={pendingExcuses} isTeacher={isTeacher ?? false} />

      {/* Operational Pulse (Teachers/Admins Only) */}
      {isTeacher && <OperationalPulse />}

      {/* Data Integrity Health Panel (Teachers/Admins Only) */}
      {isTeacher && <HealthCheckPanel />}

      {/* Student-facing: Enhanced personal dashboard */}
      {isTeacher === false && (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-8 text-center">
              <div className="text-4xl mb-3">📚</div>
              <p className="text-gray-700 dark:text-gray-200 font-medium text-lg">Welcome to the Training Center</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Navigate to your courses, sessions, and attendance records using the menu above.</p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/attendance-records">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">📋</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Attendance</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View your attendance records</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/excuse-requests">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">📝</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">Excuse Requests</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Submit or track excuse requests</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/students?tab=certificates">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">🏆</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Certificates</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View and download certificates</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}


    </div>
  );
}
