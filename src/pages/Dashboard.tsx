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
  const [isTeacher, setIsTeacher] = useState<boolean | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const loadStats = async () => {
    try {
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
    } catch (err) {
      console.error('Error loading stats:', err);
      setStats(prev => ({ ...prev, loading: false }));
    }
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attendanceRecords.forEach((record: any) => {
        const sid = record.student_id;
        const courseId = record.session?.course_id;
        if (!courseId) return; // Skip records without course info
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

      // 🎯 ADVANCED AI-POWERED ANALYTICS: Multi-dimensional risk assessment
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

          // === CORE METRICS WITH CONTEXT AWARENESS ===
          const totalDays = uniqueDates.length;
          const presentDays = uniqueStatuses.filter(s => s === 'present' || s === 'on time' || s === 'late').length;
          const lateDays = uniqueStatuses.filter(s => s === 'late').length;
          const daysAbsent = uniqueStatuses.filter(s => s === 'absent').length;
          // Effective days = days that "count" toward performance (exclude excused)
          const effectiveDays = uniqueStatuses.filter(s => s !== 'excused' && s !== 'not enrolled').length;
          const attendanceRate = effectiveDays > 0 ? (presentDays / effectiveDays) * 100 : 0;
          
          // Quality score: late arrivals reduce quality slightly
          const qualityAdjustment = lateDays * 0.3; // 0.3 penalty per late
          const qualityScore = Math.max(0, attendanceRate - qualityAdjustment);

          // === INTELLIGENT CONSECUTIVE ABSENCE DETECTION ===
          let currentStreak = 0;
          let maxConsecutive = 0;
          let recentConsecutive = 0; // Consecutive in last 21 days (3 weeks)
          let ongoingStreak = 0; // Current streak if latest status is absent
          let lastAbsenceDate = '';
          const absentDates: string[] = [];
          const today = new Date();
          const threeWeeksAgo = new Date(today.getTime() - 21 * 24 * 60 * 60 * 1000);
          const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

          uniqueStatuses.forEach((status, idx) => {
            const dateObj = new Date(uniqueDates[idx]);
            
            if (status === 'absent') {
              currentStreak++;
              lastAbsenceDate = uniqueDates[idx];
              maxConsecutive = Math.max(maxConsecutive, currentStreak);
              absentDates.push(uniqueDates[idx]);
              
              // Track recent consecutive (last 3 weeks)
              if (dateObj >= threeWeeksAgo) {
                recentConsecutive = Math.max(recentConsecutive, currentStreak);
              }
              
              // Ongoing streak if this is the most recent record
              if (idx === 0) {
                ongoingStreak = currentStreak;
              }
            } else if (status === 'present' || status === 'on time' || status === 'late') {
              // Reset streak on actual attendance
              currentStreak = 0;
            }
            // Excused absences don't break or extend streak (neutral)
          });

          // === TIME-WEIGHTED RECENCY ANALYSIS ===
          // Recent absences carry more weight using exponential decay
          let recencyScore = 0;
          const weeklyAbsences = absentDates.filter(d => new Date(d) >= oneWeekAgo).length;
          
          absentDates.forEach((absDate) => {
            const daysAgo = Math.floor((today.getTime() - new Date(absDate).getTime()) / (24 * 60 * 60 * 1000));
            // Exponential decay: recent absences have higher weight
            const weight = Math.exp(-daysAgo / 30); // 30-day half-life
            recencyScore += weight;
          });
          
          // Normalize recency score (0-100 scale)
          const normalizedRecency = Math.min(100, recencyScore * 10);

          // === ADVANCED TREND ANALYSIS WITH MOMENTUM ===
          const recentWindow = Math.max(4, Math.min(10, Math.floor(totalDays * 0.3))); // Adaptive window
          const olderWindow = Math.max(4, Math.min(10, Math.floor(totalDays * 0.3)));
          
          let trend: 'improving' | 'declining' | 'stable' = 'stable';
          let trendStrength = 0; // -1 to +1: how strong the trend is
          
          if (totalDays >= 8) {
            const recentStatuses = uniqueStatuses.slice(0, recentWindow).filter(s => s !== 'excused' && s !== 'not enrolled');
            const olderStatuses = uniqueStatuses.slice(recentWindow, recentWindow + olderWindow).filter(s => s !== 'excused' && s !== 'not enrolled');
            
            const recentPresent = recentStatuses.filter(s => s === 'present' || s === 'on time' || s === 'late').length;
            const olderPresent = olderStatuses.filter(s => s === 'present' || s === 'on time' || s === 'late').length;
            
            const recentRate = recentStatuses.length > 0 ? recentPresent / recentStatuses.length : 0;
            const olderRate = olderStatuses.length > 0 ? olderPresent / olderStatuses.length : 0;
            
            const trendDelta = recentRate - olderRate;
            trendStrength = trendDelta; // -1 to +1
            
            // Dynamic thresholds based on overall performance
            const improvementThreshold = attendanceRate < 70 ? 0.15 : 0.25;
            const declineThreshold = attendanceRate > 80 ? -0.15 : -0.25;
            
            if (trendDelta > improvementThreshold) {
              trend = 'improving';
            } else if (trendDelta < declineThreshold) {
              trend = 'declining';
            }
          }
          
          // Momentum: acceleration of the trend
          let momentum = 0;
          if (totalDays >= 12) {
            const veryRecentWindow = Math.min(4, Math.floor(recentWindow / 2));
            const veryRecentStatuses = uniqueStatuses.slice(0, veryRecentWindow).filter(s => s !== 'excused' && s !== 'not enrolled');
            const midRecentStatuses = uniqueStatuses.slice(veryRecentWindow, recentWindow).filter(s => s !== 'excused' && s !== 'not enrolled');
            
            const veryRecentRate = veryRecentStatuses.length > 0 
              ? veryRecentStatuses.filter(s => s === 'present' || s === 'on time' || s === 'late').length / veryRecentStatuses.length 
              : 0;
            const midRecentRate = midRecentStatuses.length > 0 
              ? midRecentStatuses.filter(s => s === 'present' || s === 'on time' || s === 'late').length / midRecentStatuses.length 
              : 0;
            
            momentum = veryRecentRate - midRecentRate; // Trend acceleration
          }

          // === INTELLIGENT PATTERN DETECTION ===
          const patterns: string[] = [];
          
          // 1. Day-of-week pattern analysis with statistical significance
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
              const absenceRate = count / total;
              // Require both frequency AND rate for pattern
              if (count >= 3 && absenceRate >= 0.7 && total >= 4) {
                const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(day)];
                patterns.push(`High ${dayName} absence rate (${Math.round(absenceRate * 100)}%)`);
              }
            });
          }

          // 2. Sudden spike detection with statistical variance
          if (totalDays >= 10) {
            const last5 = uniqueStatuses.slice(0, 5).filter(s => s !== 'excused');
            const previous5 = uniqueStatuses.slice(5, 10).filter(s => s !== 'excused');
            const absencesInLast5 = last5.filter(s => s === 'absent').length;
            const absencesInPrevious5 = previous5.filter(s => s === 'absent').length;
            
            // Spike if recent absences are 2+ more than previous period
            if (absencesInLast5 >= 3 && absencesInLast5 >= absencesInPrevious5 + 2) {
              patterns.push('Recent absence spike detected');
            }
          }

          // 3. Extended absence pattern
          if (maxConsecutive >= 4) {
            patterns.push(`Extended ${maxConsecutive}-session absence streak`);
          }
          
          // 4. Intermittent pattern (frequent short absences)
          if (totalDays >= 10 && daysAbsent >= 5) {
            const avgAbsenceGap = daysAbsent > 1 
              ? (uniqueDates.length - 1) / (daysAbsent - 1) 
              : 0;
            if (avgAbsenceGap < 3 && avgAbsenceGap > 0) {
              patterns.push('Frequent intermittent absences');
            }
          }
          
          // 5. Late arrival habit pattern
          if (lateDays >= 3 && totalDays >= 8) {
            const lateRate = lateDays / totalDays;
            if (lateRate >= 0.3) {
              patterns.push(`Chronic lateness (${Math.round(lateRate * 100)}% of sessions)`);
            }
          }
          
          // 6. Recent disengagement (was good, now declining)
          if (trend === 'declining' && trendStrength < -0.3 && attendanceRate < 70) {
            patterns.push('Sharp recent decline in attendance');
          }
          
          // 7. Absence clustering (absences grouped together)
          if (absentDates.length >= 4) {
            const gaps = [];
            for (let i = 1; i < absentDates.length; i++) {
              const gap = Math.abs(new Date(absentDates[i - 1]).getTime() - new Date(absentDates[i]).getTime()) / (24 * 60 * 60 * 1000);
              gaps.push(gap);
            }
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            if (avgGap <= 7) { // Absences within a week of each other
              patterns.push('Clustered absence pattern');
            }
          }

          // === MULTI-DIMENSIONAL ENGAGEMENT SCORE (0-100) ===
          // Weighted scoring system based on multiple factors
          let engagementScore = 0;
          
          // Base attendance (40% weight) - using quality score
          engagementScore += qualityScore * 0.4;
          
          // Recency impact (25% weight) - recent performance matters more
          const recencyComponent = (100 - normalizedRecency) * 0.25;
          engagementScore += recencyComponent;
          
          // Trend momentum (20% weight)
          let trendComponent = 0;
          if (trend === 'improving') {
            trendComponent = 20 + (trendStrength * 20); // 20-40 points
          } else if (trend === 'declining') {
            trendComponent = -Math.abs(trendStrength) * 30; // -30 to 0 points
          } else {
            trendComponent = 10; // Stable gets baseline
          }
          engagementScore += trendComponent;
          
          // Consistency (15% weight) - penalize streaks and patterns
          const consistencyPenalty = (maxConsecutive * 3) + (patterns.length * 5);
          const consistencyScore = Math.max(0, 15 - consistencyPenalty);
          engagementScore += consistencyScore;
          
          // Momentum bonus/penalty (small but important)
          engagementScore += momentum * 10;
          
          // Clamp to 0-100
          engagementScore = Math.max(0, Math.min(100, engagementScore));

          // === AI-POWERED RISK ASSESSMENT WITH DYNAMIC THRESHOLDS ===
          let riskLevel: 'critical' | 'high' | 'medium' | 'watch' = 'watch';
          let shouldAlert = false;
          let riskScore = 0; // Composite risk score

          // EARLY EXIT: Need meaningful data (at least 3 sessions)
          if (totalDays < 3) {
            return;
          }

          // EARLY EXIT: Perfect or near-perfect performance with no concerns
          if (daysAbsent === 0 && lateDays <= 1) {
            return;
          }

          // === CALCULATE COMPOSITE RISK SCORE (0-100, higher = more risk) ===
          
          // Factor 1: Absence rate severity (0-35 points)
          const absenceRate = daysAbsent / effectiveDays;
          let absenceRiskPoints = 0;
          if (absenceRate >= 0.5) absenceRiskPoints = 35;
          else if (absenceRate >= 0.4) absenceRiskPoints = 30;
          else if (absenceRate >= 0.3) absenceRiskPoints = 22;
          else if (absenceRate >= 0.2) absenceRiskPoints = 15;
          else absenceRiskPoints = absenceRate * 50; // Linear for low rates
          
          // Factor 2: Recent behavior (0-30 points) - weighted heavily
          let recentRiskPoints = 0;
          if (ongoingStreak >= 4) recentRiskPoints = 30;
          else if (ongoingStreak >= 3) recentRiskPoints = 25;
          else if (ongoingStreak >= 2) recentRiskPoints = 18;
          else if (recentConsecutive >= 3) recentRiskPoints = 20;
          else if (recentConsecutive >= 2) recentRiskPoints = 12;
          else if (weeklyAbsences >= 2) recentRiskPoints = 10;
          else if (weeklyAbsences >= 1) recentRiskPoints = 5;
          
          // Add recency weight
          recentRiskPoints += normalizedRecency * 0.15;
          
          // Factor 3: Trend direction (0-20 points)
          let trendRiskPoints = 0;
          if (trend === 'declining') {
            trendRiskPoints = 15 + Math.abs(trendStrength) * 5; // 15-20 points
            if (momentum < -0.2) trendRiskPoints += 5; // Accelerating decline
          } else if (trend === 'improving') {
            trendRiskPoints = Math.max(0, 5 - trendStrength * 10); // 0-5 points
          } else {
            trendRiskPoints = 8; // Stable but not improving
          }
          
          // Factor 4: Pattern complexity (0-15 points)
          const patternRiskPoints = Math.min(15, patterns.length * 4 + (lateDays >= 3 ? 3 : 0));
          
          // Calculate total risk score
          riskScore = absenceRiskPoints + recentRiskPoints + trendRiskPoints + patternRiskPoints;
          
          // === INTELLIGENT RISK LEVEL CLASSIFICATION ===
          // Dynamic thresholds that adapt to overall attendance
          const isRecentlyConcerning = ongoingStreak >= 2 || weeklyAbsences >= 2;
          const hasSignificantAbsences = daysAbsent >= 3;
          
          // CRITICAL: Immediate intervention required (risk score 70+)
          if (
            riskScore >= 70 ||
            ongoingStreak >= 5 ||
            (ongoingStreak >= 4 && attendanceRate < 50) ||
            (recentConsecutive >= 5 && attendanceRate < 60) ||
            attendanceRate < 35 ||
            (weeklyAbsences >= 3 && trend === 'declining')
          ) {
            riskLevel = 'critical';
            shouldAlert = true;
          }
          // HIGH: Urgent attention needed (risk score 50-69)
          else if (
            riskScore >= 50 ||
            ongoingStreak >= 3 ||
            recentConsecutive >= 4 ||
            attendanceRate < 50 ||
            (ongoingStreak >= 2 && attendanceRate < 60 && trend === 'declining') ||
            (weeklyAbsences >= 2 && attendanceRate < 65) ||
            (patterns.length >= 2 && attendanceRate < 60)
          ) {
            riskLevel = 'high';
            shouldAlert = true;
          }
          // MEDIUM: Monitor closely (risk score 30-49)
          else if (
            riskScore >= 30 ||
            ongoingStreak >= 2 ||
            recentConsecutive >= 3 ||
            attendanceRate < 65 ||
            (isRecentlyConcerning && attendanceRate < 75) ||
            (trend === 'declining' && trendStrength < -0.3 && attendanceRate < 75) ||
            (patterns.length >= 2 && attendanceRate < 75)
          ) {
            riskLevel = 'medium';
            shouldAlert = true;
          }
          // WATCH: Early warning (risk score 15-29)
          else if (
            riskScore >= 15 ||
            hasSignificantAbsences ||
            (patterns.length >= 1 && attendanceRate < 85) ||
            (trend === 'declining' && attendanceRate < 80) ||
            (isRecentlyConcerning && attendanceRate < 85) ||
            (lateDays >= 4 && attendanceRate < 85) ||
            engagementScore < 70
          ) {
            riskLevel = 'watch';
            shouldAlert = true;
          }
          
          // SMART FILTERING: Don't alert if performance is genuinely good
          // High engagement + good attendance + positive trend = no alert
          if (
            engagementScore >= 85 &&
            attendanceRate >= 85 &&
            trend !== 'declining' &&
            ongoingStreak === 0 &&
            recentConsecutive <= 1 &&
            patterns.length === 0
          ) {
            shouldAlert = false;
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
    const init = async () => {
      // Check if current user is a teacher
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          const { data: teacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .ilike('email', user.email)
            .single();
          setIsTeacher(!!teacher);
        } else {
          setIsTeacher(false);
        }
      } catch {
        setIsTeacher(false);
      }
    };
    init();
    loadStats();
    loadAttendanceAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload alerts when date filters change
  useEffect(() => {
    if (startDate || endDate) {
      loadAttendanceAlerts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">Overview of your training center</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blue-100">Total Students</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalStudents}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700 rounded-2xl p-6 text-white shadow-lg shadow-emerald-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-100">Active Enrollments</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.activeEnrollments}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 rounded-2xl p-6 text-white shadow-lg shadow-purple-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-purple-100">Total Teachers</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalTeachers}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 rounded-2xl p-6 text-white shadow-lg shadow-amber-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-amber-100">Total Sessions</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalSessions}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/students">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                Manage Students
              </Button>
            </Link>
            <Link to="/sessions">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                View Sessions
              </Button>
            </Link>
            <Link to="/attendance-records">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                Attendance Records
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Attendance Alerts - Enhanced Analytics (Teachers Only) */}
      {isTeacher && (
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>🎯 Smart Attendance Analytics</CardTitle>
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
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-full md:w-auto dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-sm text-gray-600 dark:text-gray-400">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              />
              <label className="text-sm text-gray-600 dark:text-gray-400">To:</label>
              <input
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

                {/* Alert Cards */}
                <div className="space-y-3">
                  {filtered.map((student) => {
                    // Risk level styling
                    const riskStyles = {
                      critical: {
                        bg: 'bg-red-50 dark:bg-red-900/30',
                        border: 'border-red-300 dark:border-red-700',
                        hover: 'hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/50',
                        badge: 'bg-red-600 text-white',
                        icon: '🚨'
                      },
                      high: {
                        bg: 'bg-orange-50 dark:bg-orange-900/30',
                        border: 'border-orange-300 dark:border-orange-700',
                        hover: 'hover:bg-orange-100 hover:border-orange-400 dark:hover:bg-orange-900/50',
                        badge: 'bg-orange-600 text-white',
                        icon: '⚠️'
                      },
                      medium: {
                        bg: 'bg-yellow-50 dark:bg-yellow-900/30',
                        border: 'border-yellow-300 dark:border-yellow-700',
                        hover: 'hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/50',
                        badge: 'bg-yellow-600 text-white',
                        icon: '⚡'
                      },
                      watch: {
                        bg: 'bg-blue-50 dark:bg-blue-900/30',
                        border: 'border-blue-300 dark:border-blue-700',
                        hover: 'hover:bg-blue-100 hover:border-blue-400 dark:hover:bg-blue-900/50',
                        badge: 'bg-blue-600 text-white',
                        icon: '👁️'
                      }
                    };

                    const style = riskStyles[student.riskLevel];

                    // Trend icon
                    const trendIcons = {
                      improving: { icon: '📈', text: 'Improving', color: 'text-green-600 dark:text-green-400' },
                      declining: { icon: '📉', text: 'Declining', color: 'text-red-600 dark:text-red-400' },
                      stable: { icon: '→', text: 'Stable', color: 'text-gray-600 dark:text-gray-400' }
                    };
                    const trendInfo = trendIcons[student.trend];

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
                        style={{ outline: 'none' }}
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
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">🔍 Detected Patterns:</div>
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
      )}

      {/* Student-facing: Simple personal message */}
      {isTeacher === false && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="text-4xl mb-3">📚</div>
            <p className="text-gray-700 dark:text-gray-200 font-medium text-lg">Welcome to the Training Center</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Navigate to your courses, sessions, and attendance records using the menu above.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
