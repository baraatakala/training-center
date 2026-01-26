import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { studentService } from '../services/studentService';
import { enrollmentService } from '../services/enrollmentService';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { format } from 'date-fns';

interface AbsentStudent {
  student_id: string;
  student_name: string;
  email: string;
  phone?: string;
  consecutiveAbsences: number;
  lastAbsenceDate: string;
  absentDates: string[];
  course_name: string;
  course_id: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'watch';
  // Enhanced analytics
  attendanceRate: number;
  totalDays: number;
  presentDays: number;
  trend: 'improving' | 'declining' | 'stable';
  patterns: string[];
  engagementScore: number;
  lastAttendedDate?: string;
  daysAbsent: number;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    loading: true,
  });

  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const loadStats = async () => {
    const [studentsRes, enrollmentsRes, teachersRes, sessionsRes] = await Promise.all([
      studentService.getAll(),
      enrollmentService.getActive(),
      supabase.from(Tables.TEACHER).select('teacher_id'),
      supabase.from(Tables.SESSION).select('session_id'),
    ]);

    setStats({
      totalStudents: studentsRes.data?.length || 0,
      totalTeachers: teachersRes.data?.length || 0,
      activeEnrollments: enrollmentsRes.data?.length || 0,
      totalSessions: sessionsRes.data?.length || 0,
      loading: false,
    });
  };

  const loadAttendanceAlerts = async () => {
    setLoadingAlerts(true);
    try {
      // Get attendance records with session and course info, ordered by date descending
      let query = supabase
        .from('attendance')
        .select(`
          student_id,
          attendance_date,
          status,
          session_id,
          student:student_id(name, email, phone),
          session:session_id(course_id, course:course_id(course_name))
        `);
      
      // Apply date filters if set
      if (startDate) {
        query = query.gte('attendance_date', startDate);
      }
      if (endDate) {
        query = query.lte('attendance_date', endDate);
      }
      
      const { data: attendanceRecords } = await query.order('attendance_date', { ascending: false });

      if (!attendanceRecords || attendanceRecords.length === 0) {
        setAbsentStudents([]);
        setLoadingAlerts(false);
        return;
      }

      // Using ALL attendance records for comprehensive analysis (not just last 4 dates)

      // Load courses for filter
      const { data: coursesData } = await supabase
        .from('course')
        .select('course_id, course_name')
        .order('course_name');
      
      if (coursesData) {
        setCourses(coursesData.map(c => ({ id: c.course_id, name: c.course_name })));
      }

      // Group by student per course with FULL history
      const studentCourseData: { 
        [key: string]: { 
          name: string; 
          email: string; 
          phone: string;
          courses: {
            [courseId: string]: {
              course_name: string;
              dates: string[];
              statuses: string[];
            }
          }
        } 
      } = {};

      attendanceRecords.forEach((record: any) => {
        const sid = record.student_id;
        const courseId = record.session?.course_id;
        const courseName = record.session?.course?.course_name || 'Unknown';

        if (!studentCourseData[sid]) {
          studentCourseData[sid] = {
            name: record.student?.name || 'Unknown',
            email: record.student?.email || '',
            phone: record.student?.phone || '',
            courses: {},
          };
        }

        if (!studentCourseData[sid].courses[courseId]) {
          studentCourseData[sid].courses[courseId] = {
            course_name: courseName,
            dates: [],
            statuses: [],
          };
        }

        studentCourseData[sid].courses[courseId].dates.push(record.attendance_date);
        studentCourseData[sid].courses[courseId].statuses.push(record.status);
      });

      // 🎯 ADVANCED ANALYTICS: Multi-level risk assessment
      const alertStudents: AbsentStudent[] = [];

      Object.entries(studentCourseData).forEach(([studentId, studentInfo]) => {
        Object.entries(studentInfo.courses).forEach(([courseId, courseInfo]) => {
          // Sort dates chronologically (newest first)
          const uniqueDates = [...new Set(courseInfo.dates)].sort((a, b) => 
            new Date(b).getTime() - new Date(a).getTime()
          );
          const uniqueStatuses = uniqueDates.map(d => {
            const idx = courseInfo.dates.indexOf(d);
            return idx >= 0 ? courseInfo.statuses[idx] : 'absent';
          });

          // === CORE METRICS ===
          const totalDays = uniqueDates.length;
          // Count only 'on time' and 'late' as present; 'excused' is neutral
          const presentDays = uniqueStatuses.filter(s => s === 'on time' || s === 'late').length;
          const daysAbsent = uniqueStatuses.filter(s => s === 'absent').length;
          // Exclude 'excused' from denominator for attendance rate
          const effectiveDays = uniqueStatuses.filter(s => s !== 'excused').length;
          const attendanceRate = effectiveDays > 0 ? (presentDays / effectiveDays) * 100 : 0;

          // === CONSECUTIVE ABSENCE DETECTION ===
          let currentStreak = 0;
          let maxConsecutive = 0;
          let recentConsecutive = 0; // Consecutive absences in last 30 days or ongoing
          let lastAbsenceDate = '';
          const absentDates: string[] = [];
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          uniqueStatuses.forEach((status, idx) => {
            if (status === 'absent') {
              currentStreak++;
              lastAbsenceDate = uniqueDates[idx];
              maxConsecutive = Math.max(maxConsecutive, currentStreak);
              absentDates.push(uniqueDates[idx]);
              
              // Track recent consecutive absences (last 30 days or ongoing)
              if (idx === 0 || new Date(uniqueDates[idx]) >= thirtyDaysAgo) {
                recentConsecutive = currentStreak;
              }
            } else if (status === 'on time' || status === 'late') {
              // Only reset streak if they actually attended
              currentStreak = 0;
            }
            // If 'excused', do not change streak
          });

          // === TREND ANALYSIS ===
          const recentWindow = Math.min(7, Math.floor(totalDays / 2));
          
          let trend: 'improving' | 'declining' | 'stable' = 'stable';
          if (totalDays >= 6) {
            // Exclude 'excused' from trend windows
            const recentStatuses = uniqueStatuses.slice(0, recentWindow).filter(s => s !== 'excused');
            const oldStatuses = uniqueStatuses.slice(recentWindow).filter(s => s !== 'excused');
            const recentPresent = recentStatuses.filter(s => s === 'on time' || s === 'late').length;
            const oldPresent = oldStatuses.filter(s => s === 'on time' || s === 'late').length;
            const recentRate = recentStatuses.length > 0 ? recentPresent / recentStatuses.length : 0;
            const oldRate = oldStatuses.length > 0 ? oldPresent / oldStatuses.length : 0;
            if (recentRate > oldRate + 0.2) trend = 'improving';
            else if (recentRate < oldRate - 0.2) trend = 'declining';
          }

          // === PATTERN DETECTION ===
          const patterns: string[] = [];
          
          // Day of week pattern analysis
          if (totalDays >= 8) {
            const dateObjects = uniqueDates.map(d => new Date(d));
            const dayAbsences: { [key: number]: number } = {};
            const dayCounts: { [key: number]: number } = {};
            
            uniqueStatuses.forEach((status, idx) => {
              const dayOfWeek = dateObjects[idx].getDay();
              dayCounts[dayOfWeek] = (dayCounts[dayOfWeek] || 0) + 1;
              if (status === 'absent') {
                dayAbsences[dayOfWeek] = (dayAbsences[dayOfWeek] || 0) + 1;
              }
            });

            Object.entries(dayAbsences).forEach(([day, count]) => {
              const total = dayCounts[parseInt(day)] || 1;
              if (count >= 3 && count / total >= 0.75) {
                const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(day)];
                patterns.push(`Often absent on ${dayName}s`);
              }
            });
          }

          // Recent spike detection
          if (totalDays >= 10) {
            const last5 = uniqueStatuses.slice(0, 5);
            const absencesInLast5 = last5.filter(s => s === 'absent').length;
            if (absencesInLast5 >= 4) {
              patterns.push('Sudden increase in absences');
            }
          }

          // Long absence streak
          if (maxConsecutive >= 5) {
            patterns.push('Extended absence streak');
          }

          // === ENGAGEMENT SCORE (0-100) ===
          let engagementScore = attendanceRate;
          if (trend === 'improving') engagementScore += 10;
          if (trend === 'declining') engagementScore -= 15;
          if (maxConsecutive >= 3) engagementScore -= 10;
          if (patterns.length > 0) engagementScore -= 5;
          engagementScore = Math.max(0, Math.min(100, engagementScore));

          // === ADVANCED RISK ASSESSMENT ===
          let riskLevel: 'critical' | 'high' | 'medium' | 'watch' = 'watch';
          let shouldAlert = false;

          // Only alert if there's meaningful data to analyze (at least 3 sessions)
          if (totalDays < 3) {
            return;
          }

          // Don't alert if no absences at all
          if (daysAbsent === 0) {
            return;
          }

          // SMART FILTERING: Don't alert if performance is good
          // High attendance + improving/stable trend + good engagement = no alert
          if (attendanceRate >= 80 && engagementScore >= 85 && trend !== 'declining' && recentConsecutive < 2) {
            return;
          }

          // CRITICAL: Severe attendance issues (focus on RECENT consecutive or very low rate)
          if (recentConsecutive >= 4 || attendanceRate < 40 || (recentConsecutive >= 3 && attendanceRate < 50) || (daysAbsent >= 5 && attendanceRate < 50) || (maxConsecutive >= 5 && attendanceRate < 60)) {
            riskLevel = 'critical';
            shouldAlert = true;
          }
          // HIGH: Significant concerns (recent consecutive absences matter most)
          else if (recentConsecutive >= 3 || attendanceRate < 60 || (recentConsecutive >= 2 && trend === 'declining') || (daysAbsent >= 4 && attendanceRate < 60) || (maxConsecutive >= 4 && attendanceRate < 70)) {
            riskLevel = 'high';
            shouldAlert = true;
          }
          // MEDIUM: Moderate concerns (only if recent issues OR low rate)
          else if (recentConsecutive >= 2 || attendanceRate < 70 || (patterns.length > 0 && attendanceRate < 75 && trend === 'declining') || (maxConsecutive >= 3 && attendanceRate < 75 && trend === 'declining')) {
            riskLevel = 'medium';
            shouldAlert = true;
          }
          // WATCH: Early warning patterns (requires recent concern)
          else if ((patterns.length > 0 && attendanceRate < 85) || (trend === 'declining' && attendanceRate < 85 && daysAbsent >= 2) || (recentConsecutive >= 1 && attendanceRate < 80)) {
            riskLevel = 'watch';
            shouldAlert = true;
          }

          // Find last attended date (on time or late only)
          const lastAttendedIndex = uniqueStatuses.findIndex(s => s === 'on time' || s === 'late');
          const lastAttendedDate = lastAttendedIndex >= 0 ? uniqueDates[lastAttendedIndex] : undefined;

          if (shouldAlert) {
            alertStudents.push({
              student_id: studentId,
              student_name: studentInfo.name,
              email: studentInfo.email,
              phone: studentInfo.phone,
              consecutiveAbsences: maxConsecutive,
              lastAbsenceDate,
              absentDates,
              course_name: courseInfo.course_name,
              course_id: courseId,
              riskLevel,
              attendanceRate: Math.round(attendanceRate * 10) / 10,
              totalDays,
              presentDays,
              daysAbsent,
              trend,
              patterns,
              engagementScore: Math.round(engagementScore),
              lastAttendedDate,
            });
          }
        });
      });

      // Smart sorting: Critical first, then by engagement score
      alertStudents.sort((a, b) => {
        const riskOrder = { critical: 0, high: 1, medium: 2, watch: 3 };
        if (a.riskLevel !== b.riskLevel) {
          return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        }
        return a.engagementScore - b.engagementScore;
      });

      setAbsentStudents(alertStudents);
    } catch (error) {
      console.error('Error loading attendance alerts:', error);
    }
    setLoadingAlerts(false);
  };

  const generateEmailLink = (student: AbsentStudent): string => {
    const riskLevelText = student.riskLevel.toUpperCase();
    const subject = `[${riskLevelText} PRIORITY] Attendance Concern - ${student.student_name}`;
    
    const trendText = {
      improving: 'showing improvement',
      declining: 'declining',
      stable: 'stable but concerning'
    }[student.trend];

    const patternsText = student.patterns.length > 0 
      ? `\n\n🔍 Observed Patterns:\n${student.patterns.map(p => `  • ${p}`).join('\n')}`
      : '';

    const body = `Dear ${student.student_name},

📊 ATTENDANCE ALERT - ${riskLevelText} PRIORITY

We have conducted an analysis of your attendance in "${student.course_name}" and identified some concerns that need your attention.

📈 Current Statistics:
  • Attendance Rate: ${student.attendanceRate}%
  • Consecutive Absences: ${student.consecutiveAbsences} sessions
  • Total Sessions: ${student.presentDays} present out of ${student.totalDays}
  • Engagement Score: ${student.engagementScore}/100
  • Attendance Trend: ${trendText}${student.lastAttendedDate ? `\n  • Last Attended: ${format(new Date(student.lastAttendedDate), 'MMM dd, yyyy')}` : ''}
${patternsText}

📅 Recent Absences:
${student.absentDates.slice(0, 10).map(d => `  • ${format(new Date(d), 'EEEE, MMMM dd, yyyy')}`).join('\n')}${student.absentDates.length > 10 ? `\n  ... and ${student.absentDates.length - 10} more` : ''}

${student.riskLevel === 'critical' ? '🚨 CRITICAL: Your attendance has reached a critical level. Immediate action is required to prevent academic consequences.' : student.riskLevel === 'high' ? '⚠️ HIGH RISK: Your attendance pattern shows significant concerns. Please contact us urgently.' : student.riskLevel === 'medium' ? '⚡ ATTENTION NEEDED: Your attendance is below expected standards. Let\'s work together to improve.' : '👁️ EARLY WARNING: We\'ve noticed some patterns that may affect your success. Let\'s address them early.'}

Please contact us to discuss any challenges you're facing. We're here to support you.

Best regards,
Training Center Management`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const generateSMSLink = (student: AbsentStudent): string => {
    const riskEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      watch: '👁️'
    }[student.riskLevel];

    const message = `${riskEmoji} ATTENDANCE ALERT
${student.student_name}
Course: ${student.course_name}
Attendance: ${student.attendanceRate}%
Consecutive Absences: ${student.consecutiveAbsences}
Trend: ${student.trend}
Please contact the training center urgently.`;

    // SMS link format - works on most devices
    return `sms:${student.phone || ''}?body=${encodeURIComponent(message)}`;
  };

  useEffect(() => {
    loadStats();
    loadAttendanceAlerts();
  }, []);

  // Reload alerts when date filters change
  useEffect(() => {
    if (startDate || endDate) {
      loadAttendanceAlerts();
    }
  }, [startDate, endDate]);

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-0">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">Overview of your training center</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600">Total Students</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-blue-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-blue-700 mt-2">{stats.totalStudents}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-blue-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👨‍🎓</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">Active Enrollments</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-green-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-green-700 mt-2">{stats.activeEnrollments}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-green-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">📚</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600">Total Teachers</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-purple-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-purple-700 mt-2">{stats.totalTeachers}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-purple-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👩‍🏫</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-600">Total Sessions</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-orange-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-orange-700 mt-2">{stats.totalSessions}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-orange-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">📅</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/students">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">👥</span> Manage Students
              </Button>
            </Link>
            <Link to="/sessions">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">📚</span> View Sessions
              </Button>
            </Link>
            <Link to="/sessions">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">✓</span> Mark Attendance
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Attendance Alerts - Enhanced Analytics */}
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>🎯 Smart Attendance Analytics</CardTitle>
              <p className="text-sm text-gray-500 mt-1">AI-powered risk assessment with trend analysis</p>
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
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full md:w-auto"
            >
              <option value="all">All Courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-sm text-gray-600">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <label className="text-sm text-gray-600">To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
              <p className="text-gray-500">Analyzing attendance patterns...</p>
            </div>
          ) : (() => {
            const filtered = selectedCourse === 'all' 
              ? absentStudents 
              : absentStudents.filter(s => s.course_id === selectedCourse);
            
            // Count by risk level
            const criticalCount = filtered.filter(s => s.riskLevel === 'critical').length;
            const highCount = filtered.filter(s => s.riskLevel === 'high').length;
            const mediumCount = filtered.filter(s => s.riskLevel === 'medium').length;
            const watchCount = filtered.filter(s => s.riskLevel === 'watch').length;
            
            return filtered.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-3">✓</div>
                <p className="text-green-600 font-medium text-lg">Excellent! No attendance concerns</p>
                <p className="text-sm text-gray-500 mt-1">All students are maintaining healthy attendance patterns</p>
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
                    <div className="text-xs text-gray-600">Critical</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{highCount}</div>
                    <div className="text-xs text-gray-600">High Risk</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600">{mediumCount}</div>
                    <div className="text-xs text-gray-600">Medium</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{watchCount}</div>
                    <div className="text-xs text-gray-600">Watch</div>
                  </div>
                </div>

                {/* Alert Cards */}
                <div className="space-y-3">
                  {filtered.map((student) => {
                    // Risk level styling
                    const riskStyles = {
                      critical: {
                        bg: 'bg-red-50',
                        border: 'border-red-300',
                        hover: 'hover:bg-red-100 hover:border-red-400',
                        badge: 'bg-red-600 text-white',
                        icon: '🚨'
                      },
                      high: {
                        bg: 'bg-orange-50',
                        border: 'border-orange-300',
                        hover: 'hover:bg-orange-100 hover:border-orange-400',
                        badge: 'bg-orange-600 text-white',
                        icon: '⚠️'
                      },
                      medium: {
                        bg: 'bg-yellow-50',
                        border: 'border-yellow-300',
                        hover: 'hover:bg-yellow-100 hover:border-yellow-400',
                        badge: 'bg-yellow-600 text-white',
                        icon: '⚡'
                      },
                      watch: {
                        bg: 'bg-blue-50',
                        border: 'border-blue-300',
                        hover: 'hover:bg-blue-100 hover:border-blue-400',
                        badge: 'bg-blue-600 text-white',
                        icon: '👁️'
                      }
                    };

                    const style = riskStyles[student.riskLevel];

                    // Trend icon
                    const trendIcons = {
                      improving: { icon: '📈', text: 'Improving', color: 'text-green-600' },
                      declining: { icon: '📉', text: 'Declining', color: 'text-red-600' },
                      stable: { icon: '→', text: 'Stable', color: 'text-gray-600' }
                    };
                    const trendInfo = trendIcons[student.trend];

                    return (
                      <div
                        key={`${student.student_id}-${student.course_id}`}
                        className={`block p-4 rounded-lg border-2 ${style.bg} ${style.border} ${style.hover} transition-colors cursor-pointer`}
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
                        style={{ outline: 'none' }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-xl">{style.icon}</span>
                              <p className="font-semibold text-gray-900">{student.student_name}</p>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style.badge}`}>
                                {student.riskLevel.toUpperCase()}
                              </span>
                              <Badge variant="default" className="text-xs">
                                {student.course_name}
                              </Badge>
                            </div>

                            {/* Key Metrics */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                              <div className="bg-white bg-opacity-70 rounded px-2 py-1">
                                <div className="text-xs text-gray-600">Attendance</div>
                                <div className={`font-bold ${student.attendanceRate < 50 ? 'text-red-600' : student.attendanceRate < 75 ? 'text-orange-600' : 'text-green-600'}`}>
                                  {student.attendanceRate}%
                                </div>
                              </div>
                              <div className="bg-white bg-opacity-70 rounded px-2 py-1">
                                <div className="text-xs text-gray-600">Consecutive</div>
                                <div className="font-bold text-gray-900">{student.consecutiveAbsences} days</div>
                              </div>
                              <div className="bg-white bg-opacity-70 rounded px-2 py-1">
                                <div className="text-xs text-gray-600">Trend</div>
                                <div className={`font-bold ${trendInfo.color} text-xs flex items-center gap-1`}>
                                  <span>{trendInfo.icon}</span>
                                  <span>{trendInfo.text}</span>
                                </div>
                              </div>
                              <div className="bg-white bg-opacity-70 rounded px-2 py-1">
                                <div className="text-xs text-gray-600">Engagement</div>
                                <div className="font-bold text-gray-900">{student.engagementScore}/100</div>
                              </div>
                            </div>

                            {/* Patterns */}
                            {student.patterns.length > 0 && (
                              <div className="mb-2">
                                <div className="text-xs font-semibold text-gray-700 mb-1">🔍 Detected Patterns:</div>
                                <div className="flex flex-wrap gap-1">
                                  {student.patterns.map((pattern, idx) => (
                                    <span key={idx} className="text-xs bg-white bg-opacity-70 px-2 py-0.5 rounded border border-gray-300">
                                      {pattern}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Details */}
                            <div className="text-xs text-gray-600 space-y-1">
                              {student.absentDates.length > 0 && (
                                <div>
                                  <span className="font-semibold">Recent Absences:</span> {student.absentDates.slice(0, 5).map(d => format(new Date(d), 'MMM dd')).join(', ')}
                                  {student.absentDates.length > 5 && ` +${student.absentDates.length - 5} more`}
                                </div>
                              )}
                              <div>
                                <span className="font-semibold">History:</span> {student.presentDays} present / {student.totalDays} total sessions
                                {student.lastAttendedDate && ` • Last attended: ${format(new Date(student.lastAttendedDate), 'MMM dd')}`}
                              </div>
                              <div>
                                <span className="font-semibold">Email:</span> {student.email}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-col gap-2">
                            <a
                              href={generateEmailLink(student)}
                              onClick={e => e.stopPropagation()}
                              className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                              tabIndex={-1}
                            >
                              📧 Email
                            </a>
                            {student.phone && (
                              <a
                                href={generateSMSLink(student)}
                                onClick={e => e.stopPropagation()}
                                className="flex-shrink-0 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap text-sm font-medium text-center"
                                tabIndex={-1}
                              >
                                💬 SMS
                              </a>
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
    </div>
  );
}
