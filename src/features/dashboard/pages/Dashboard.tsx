import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { authService } from '@/shared/services/authService';
import { format } from 'date-fns';
import { analyzeAttendanceRisk } from '@/shared/utils/attendanceAnalytics';
import type { AbsentStudent } from '@/shared/utils/attendanceAnalytics';
import { excuseRequestService } from '@/features/excuses/services/excuseRequestService';
import { dashboardService } from '@/features/dashboard/services/dashboardService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { toast } from '@/shared/components/ui/toastUtils';
import type { MessageChannel, MessageTemplate } from '../constants/dashboardConstants';
import { RISK_STYLES, TREND_ICONS } from '../constants/dashboardConstants';
import { generateWhatsAppLink, generateTemplateBody } from '../utils/messageGenerators';
import { HealthCheckPanel } from '../components/HealthCheckPanel';
import { StatsGrid } from '../components/StatsGrid';
import { MessageComposerModal } from '../components/MessageComposerModal';

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    todaySessions: 0,
    totalCourses: 0,
    pendingFeedback: 0,
    issuedCertificates: 0,
    loading: true,
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Message Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStudent, setComposerStudent] = useState<AbsentStudent | null>(null);
  const [composerChannel, setComposerChannel] = useState<MessageChannel>('email');
  const [composerTemplate, setComposerTemplate] = useState<MessageTemplate>('attendance_alert');
  const [composerSubject, setComposerSubject] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [pendingExcuses, setPendingExcuses] = useState(0);

  // Memoized filtered students and risk counts to avoid recalculation on every render
  const filteredStudents = useMemo(() => {
    return selectedCourse === 'all'
      ? absentStudents
      : absentStudents.filter(s => s.course_id === selectedCourse);
  }, [absentStudents, selectedCourse]);

  const riskCounts = useMemo(() => ({
    critical: filteredStudents.filter(s => s.riskLevel === 'critical').length,
    high: filteredStudents.filter(s => s.riskLevel === 'high').length,
    medium: filteredStudents.filter(s => s.riskLevel === 'medium').length,
    watch: filteredStudents.filter(s => s.riskLevel === 'watch').length,
  }), [filteredStudents]);

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
        pendingFeedback: 0,
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

  const loadAttendanceAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const { attendanceResult, coursesResult } = await dashboardService.getAttendanceAlerts({ startDate, endDate });

      if (attendanceResult.error) {
        toast.error('Failed to load attendance data: ' + attendanceResult.error.message);
        setLoadingAlerts(false);
        return;
      }

      if (coursesResult.error) {
        console.error('Failed to load courses:', coursesResult.error);
      }

      const attendanceRecords = attendanceResult.data;
      const coursesData = coursesResult.data;

      if (coursesData) {
        setCourses(coursesData.map(c => ({ id: c.course_id, name: c.course_name })));
      }

      if (!attendanceRecords || attendanceRecords.length === 0) {
        setAbsentStudents([]);
        setLoadingAlerts(false);
        return;
      }

      // Run analytics engine (extracted to src/utils/attendanceAnalytics.ts)
      const alertStudents = analyzeAttendanceRisk(attendanceRecords);

      setAbsentStudents(alertStudents);
    } catch (error) {
      console.error('Error loading attendance alerts:', error);
      toast.error('Failed to load attendance analytics');
    }
    setLoadingAlerts(false);
  }, [startDate, endDate]);

  // Open composer for a single student
  const openComposer = useCallback((student: AbsentStudent, channel: MessageChannel = 'email') => {
    setComposerStudent(student);
    setComposerChannel(channel);
    setComposerTemplate('attendance_alert');
    setBulkMode(false);
    const { subject, body } = generateTemplateBody('attendance_alert', student, channel);
    setComposerSubject(subject);
    setComposerBody(body);
    setComposerOpen(true);
  }, [generateTemplateBody]);

  // Open bulk composer
  const openBulkComposer = useCallback((channel: MessageChannel = 'email') => {
    const first = filteredStudents[0];
    if (!first) return;
    setComposerStudent(first);
    setComposerChannel(channel);
    setComposerTemplate('attendance_alert');
    setBulkMode(true);
    setComposerSubject('[BULK] Attendance Alert / ÃƒËœÃ‚Â¥ÃƒËœÃ‚Â´ÃƒËœÃ‚Â¹ÃƒËœÃ‚Â§ÃƒËœÃ‚Â± ÃƒËœÃ‚Â­ÃƒËœÃ‚Â¶Ãƒâ„¢Ã‹â€ ÃƒËœÃ‚Â±');
    setComposerBody('Each student will receive a personalized message based on their attendance data.\nÃƒËœÃ‚Â³Ãƒâ„¢Ã…Â ÃƒËœÃ‚ÂªÃƒâ„¢Ã¢â‚¬Å¾Ãƒâ„¢Ã¢â‚¬Å¡Ãƒâ„¢Ã¢â‚¬Â° Ãƒâ„¢Ã†â€™Ãƒâ„¢Ã¢â‚¬Å¾ ÃƒËœÃ‚Â·ÃƒËœÃ‚Â§Ãƒâ„¢Ã¢â‚¬Å¾ÃƒËœÃ‚Â¨ ÃƒËœÃ‚Â±ÃƒËœÃ‚Â³ÃƒËœÃ‚Â§Ãƒâ„¢Ã¢â‚¬Å¾ÃƒËœÃ‚Â© Ãƒâ„¢Ã¢â‚¬Â¦ÃƒËœÃ‚Â®ÃƒËœÃ‚ÂµÃƒËœÃ‚ÂµÃƒËœÃ‚Â© ÃƒËœÃ‚Â¨Ãƒâ„¢Ã¢â‚¬Â ÃƒËœÃ‚Â§ÃƒËœÃ‚Â¡Ãƒâ„¢Ã¢â‚¬Â¹ ÃƒËœÃ‚Â¹Ãƒâ„¢Ã¢â‚¬Å¾Ãƒâ„¢Ã¢â‚¬Â° ÃƒËœÃ‚Â¨Ãƒâ„¢Ã…Â ÃƒËœÃ‚Â§Ãƒâ„¢Ã¢â‚¬Â ÃƒËœÃ‚Â§ÃƒËœÃ‚Âª ÃƒËœÃ‚Â­ÃƒËœÃ‚Â¶Ãƒâ„¢Ã‹â€ ÃƒËœÃ‚Â±Ãƒâ„¢Ã¢â‚¬Â¡.');
    setComposerOpen(true);
  }, [filteredStudents]);

  // Send message from composer
  const sendComposerMessage = useCallback(() => {
    if (bulkMode) {
      // Open all links for filtered students
      filteredStudents.forEach((student, index) => {
        setTimeout(() => {
          const { subject, body } = generateTemplateBody(composerTemplate, student, composerChannel);
          if (composerChannel === 'email') {
            window.open(`mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
          } else if (composerChannel === 'sms') {
            window.open(`sms:${student.phone || ''}?body=${encodeURIComponent(body)}`, '_blank');
          } else {
            const phone = (student.phone || '').replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, '_blank');
          }
        }, index * 500); // Stagger to avoid popup blocking
      });
    } else if (composerStudent) {
      if (composerChannel === 'email') {
        window.open(`mailto:${composerStudent.email}?subject=${encodeURIComponent(composerSubject)}&body=${encodeURIComponent(composerBody)}`, '_blank');
      } else if (composerChannel === 'sms') {
        window.open(`sms:${composerStudent.phone || ''}?body=${encodeURIComponent(composerBody)}`, '_blank');
      } else {
        const phone = (composerStudent.phone || '').replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(composerBody)}`, '_blank');
      }
    }
    setComposerOpen(false);
  }, [bulkMode, filteredStudents, composerStudent, composerChannel, composerTemplate, composerSubject, composerBody, generateTemplateBody]);

  // Load pending excuses count ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses service layer
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
    loadAttendanceAlerts();
  }, [loadStats, loadAttendanceAlerts]);

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

  // Reload alerts when date filters change (including when cleared)
  useEffect(() => {
    loadAttendanceAlerts();
  }, [loadAttendanceAlerts]);

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
              onClick={() => { setError(null); loadStats(); loadAttendanceAlerts(); }} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}


      <StatsGrid stats={stats} pendingExcuses={pendingExcuses} />

      {/* Data Integrity Health Panel (Teachers/Admins Only) */}
      {isTeacher && <HealthCheckPanel />}

      {/* Attendance Alerts - Enhanced Analytics (Teachers Only) */}
      {isTeacher && (
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¯ Smart Attendance Analytics</CardTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">AI-powered risk assessment with trend analysis</p>
            </div>
            <Button 
              size="sm" 
              variant="outline"
              onClick={loadAttendanceAlerts}
              disabled={loadingAlerts}
            >
              {loadingAlerts ? 'Analyzing...' : 'Refresh'}
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              aria-label="Filter by course"
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-full md:w-auto dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <div className="flex gap-2 items-center flex-wrap">
              <label htmlFor="dashboard-start-date" className="text-sm text-gray-600 dark:text-gray-400">From:</label>
              <input
                id="dashboard-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              />
              <label htmlFor="dashboard-end-date" className="text-sm text-gray-600 dark:text-gray-400">To:</label>
              <input
                id="dashboard-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              />
              {(startDate || endDate) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    loadAttendanceAlerts();
                  }}
                >
                  Clear Dates
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAlerts ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
              <p className="text-gray-500 dark:text-gray-400">Analyzing attendance patterns...</p>
            </div>
          ) : (() => {
            const filtered = filteredStudents;
            const criticalCount = riskCounts.critical;
            const highCount = riskCounts.high;
            const mediumCount = riskCounts.medium;
            const watchCount = riskCounts.watch;
            
            return filtered.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-3">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</div>
                <p className="text-green-600 dark:text-green-400 font-medium text-lg">Excellent! No attendance concerns</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">All students are maintaining healthy attendance patterns</p>
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">{criticalCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Critical</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{highCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">High Risk</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{mediumCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Medium</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{watchCount}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Watch</div>
                  </div>
                </div>

                {/* Bulk Messaging Toolbar */}
                <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¨ Bulk Message ({filtered.length} students):</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openBulkComposer('email')}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â§ Email All
                    </button>
                    <button
                      onClick={() => openBulkComposer('sms')}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¬ SMS All
                    </button>
                    <button
                      onClick={() => openBulkComposer('whatsapp')}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-xs font-medium flex items-center gap-1"
                    >
                      ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â± WhatsApp All
                    </button>
                  </div>
                </div>

                {/* Alert Cards */}
                <div className="space-y-3">
                  {filtered.map((student) => {
                    const style = RISK_STYLES[student.riskLevel];

                    // Trend icon
                    const trendInfo = TREND_ICONS[student.trend];

                    return (
                      <div
                        key={`${student.student_id}-${student.course_id}`}
                        className={`block p-4 rounded-lg border-2 ${style.bg} ${style.border} ${style.hover} transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500`}
                        onClick={() => {
                          const params = new URLSearchParams({
                            studentName: student.student_name,
                            status: 'absent',
                            course: student.course_id,
                            ...(startDate ? { startDate } : {}),
                            ...(endDate ? { endDate } : {})
                          });
                          navigate(`/attendance-records?${params.toString()}`);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            const params = new URLSearchParams({
                              studentName: student.student_name,
                              status: 'absent',
                              course: student.course_id,
                              ...(startDate ? { startDate } : {}),
                              ...(endDate ? { endDate } : {})
                            });
                            navigate(`/attendance-records?${params.toString()}`);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-xl">{style.icon}</span>
                              <p className="font-semibold text-gray-900 dark:text-white">{student.student_name}</p>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style.badge}`}>
                                {student.riskLevel.toUpperCase()}
                              </span>
                              <Badge variant="default" className="text-xs">
                                {student.course_name}
                              </Badge>
                            </div>

                            {/* Key Metrics */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Attendance</div>
                                <div className={`font-bold ${student.attendanceRate < 50 ? 'text-red-600 dark:text-red-400' : student.attendanceRate < 75 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {student.attendanceRate}%
                                </div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Consecutive</div>
                                <div className="font-bold text-gray-900 dark:text-white">{student.consecutiveAbsences} days</div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Trend</div>
                                <div className={`font-bold ${trendInfo.color} text-xs flex items-center gap-1`}>
                                  <span>{trendInfo.icon}</span>
                                  <span>{trendInfo.text}</span>
                                </div>
                              </div>
                              <div className="bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 rounded px-2 py-1">
                                <div className="text-xs text-gray-600 dark:text-gray-400">Engagement</div>
                                <div className="font-bold text-gray-900 dark:text-white">{student.engagementScore}/100</div>
                              </div>
                            </div>

                            {/* Patterns */}
                            {student.patterns.length > 0 && (
                              <div className="mb-2">
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Detected Patterns:</div>
                                <div className="flex flex-wrap gap-1">
                                  {student.patterns.map((pattern, idx) => (
                                    <span key={idx} className="text-xs bg-white dark:bg-gray-800 bg-opacity-70 dark:bg-opacity-50 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 dark:text-gray-300">
                                      {pattern}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Details */}
                            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                              {student.absentDates.length > 0 && (
                                <div>
                                  <span className="font-semibold">Recent Absences:</span> {student.absentDates.slice(0, 5).map(d => format(new Date(d), 'MMM dd')).join(', ')}
                                  {student.absentDates.length > 5 && ` +${student.absentDates.length - 5} more`}
                                </div>
                              )}
                              <div>
                                <span className="font-semibold">History:</span> {student.presentDays} present / {student.totalDays} total sessions
                                {student.lastAttendedDate && ` ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Last attended: ${format(new Date(student.lastAttendedDate), 'MMM dd')}`}
                              </div>
                              <div>
                                <span className="font-semibold">Email:</span> {student.email}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={e => { e.stopPropagation(); openComposer(student, 'email'); }}
                              className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                              title="Compose Email"
                            >
                              ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â§ Email
                            </button>
                            {student.phone && (
                              <>
                                <button
                                  onClick={e => { e.stopPropagation(); openComposer(student, 'sms'); }}
                                  className="flex-shrink-0 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                  title="Compose SMS"
                                >
                                  ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¬ SMS
                                </button>
                                <a
                                  href={generateWhatsAppLink(student)}
                                  onClick={e => e.stopPropagation()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                  title="Send WhatsApp"
                                  tabIndex={-1}
                                >
                                  ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â± WhatsApp
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>
      )}

      {/* Student-facing: Enhanced personal dashboard */}
      {isTeacher === false && (
        <div className="space-y-6">
          <Card>
            <CardContent className="py-8 text-center">
              <div className="text-4xl mb-3">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã…Â¡</div>
              <p className="text-gray-700 dark:text-gray-200 font-medium text-lg">Welcome to the Training Center</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Navigate to your courses, sessions, and attendance records using the menu above.</p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/attendance-records">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Â¹</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Attendance</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View your attendance records</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/excuse-requests">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â</div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">Excuse Requests</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Submit or track excuse requests</p>
                </CardContent>
              </Card>
            </Link>
            <Link to="/certificates">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="py-6 text-center">
                  <div className="text-3xl mb-2">ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬Â </div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">My Certificates</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">View and download certificates</p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}


      <MessageComposerModal
        composerOpen={composerOpen}
        composerStudent={composerStudent}
        composerChannel={composerChannel}
        composerTemplate={composerTemplate}
        composerSubject={composerSubject}
        composerBody={composerBody}
        bulkMode={bulkMode}
        filteredStudentsCount={filteredStudents.length}
        setComposerOpen={setComposerOpen}
        setComposerChannel={setComposerChannel}
        setComposerTemplate={setComposerTemplate}
        setComposerSubject={setComposerSubject}
        setComposerBody={setComposerBody}
        onSend={sendComposerMessage}
      />
    </div>
  );
}
