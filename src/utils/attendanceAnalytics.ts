/**
 * Attendance Analytics Engine
 * 
 * Pure computational module that analyzes attendance records
 * and produces risk assessments for students across courses.
 * Extracted from Dashboard.tsx for testability and separation of concerns.
 */

export interface AbsentStudent {
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
  attendanceRate: number;
  totalDays: number;
  presentDays: number;
  trend: 'improving' | 'declining' | 'stable';
  patterns: string[];
  engagementScore: number;
  lastAttendedDate?: string;
  daysAbsent: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function analyzeAttendanceRisk(attendanceRecords: any[]): AbsentStudent[] {
  if (!attendanceRecords || attendanceRecords.length === 0) return [];

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
        };
      };
    };
  } = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attendanceRecords.forEach((record: any) => {
    const sid = record.student_id;
    const courseId = record.session?.course_id;
    if (!courseId) return;
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

  // Multi-dimensional risk assessment
  const alertStudents: AbsentStudent[] = [];

  Object.entries(studentCourseData).forEach(([studentId, studentInfo]) => {
    Object.entries(studentInfo.courses).forEach(([courseId, courseInfo]) => {
      // Sort dates chronologically (newest first)
      const uniqueDates = [...new Set(courseInfo.dates)].sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );
      const uniqueStatuses = uniqueDates.map((d) => {
        const idx = courseInfo.dates.indexOf(d);
        return idx >= 0 ? courseInfo.statuses[idx] : 'absent';
      });

      // === CORE METRICS WITH CONTEXT AWARENESS ===
      const totalDays = uniqueDates.length;
      const presentDays = uniqueStatuses.filter(
        (s) => s === 'present' || s === 'on time' || s === 'late'
      ).length;
      const lateDays = uniqueStatuses.filter((s) => s === 'late').length;
      const daysAbsent = uniqueStatuses.filter((s) => s === 'absent').length;
      const effectiveDays = uniqueStatuses.filter(
        (s) => s !== 'excused' && s !== 'not enrolled'
      ).length;
      const attendanceRate = effectiveDays > 0 ? (presentDays / effectiveDays) * 100 : 0;

      // Quality score: late arrivals reduce quality slightly
      const qualityAdjustment = lateDays * 0.3;
      const qualityScore = Math.max(0, attendanceRate - qualityAdjustment);

      // === INTELLIGENT CONSECUTIVE ABSENCE DETECTION ===
      let currentStreak = 0;
      let maxConsecutive = 0;
      let recentConsecutive = 0;
      let ongoingStreak = 0;
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

          if (dateObj >= threeWeeksAgo) {
            recentConsecutive = Math.max(recentConsecutive, currentStreak);
          }
          if (idx === 0) {
            ongoingStreak = currentStreak;
          }
        } else if (status === 'present' || status === 'on time' || status === 'late') {
          currentStreak = 0;
        }
      });

      // === TIME-WEIGHTED RECENCY ANALYSIS ===
      let recencyScore = 0;
      const weeklyAbsences = absentDates.filter((d) => new Date(d) >= oneWeekAgo).length;

      absentDates.forEach((absDate) => {
        const daysAgo = Math.floor(
          (today.getTime() - new Date(absDate).getTime()) / (24 * 60 * 60 * 1000)
        );
        const weight = Math.exp(-daysAgo / 30);
        recencyScore += weight;
      });

      const normalizedRecency = Math.min(100, recencyScore * 10);

      // === ADVANCED TREND ANALYSIS WITH MOMENTUM ===
      const recentWindow = Math.max(4, Math.min(10, Math.floor(totalDays * 0.3)));
      const olderWindow = Math.max(4, Math.min(10, Math.floor(totalDays * 0.3)));

      let trend: 'improving' | 'declining' | 'stable' = 'stable';
      let trendStrength = 0;

      if (totalDays >= 8) {
        const recentStatuses = uniqueStatuses
          .slice(0, recentWindow)
          .filter((s) => s !== 'excused' && s !== 'not enrolled');
        const olderStatuses = uniqueStatuses
          .slice(recentWindow, recentWindow + olderWindow)
          .filter((s) => s !== 'excused' && s !== 'not enrolled');

        const recentPresent = recentStatuses.filter(
          (s) => s === 'present' || s === 'on time' || s === 'late'
        ).length;
        const olderPresent = olderStatuses.filter(
          (s) => s === 'present' || s === 'on time' || s === 'late'
        ).length;

        const recentRate = recentStatuses.length > 0 ? recentPresent / recentStatuses.length : 0;
        const olderRate = olderStatuses.length > 0 ? olderPresent / olderStatuses.length : 0;

        const trendDelta = recentRate - olderRate;
        trendStrength = trendDelta;

        const improvementThreshold = attendanceRate < 70 ? 0.15 : 0.25;
        const declineThreshold = attendanceRate > 80 ? -0.15 : -0.25;

        if (trendDelta > improvementThreshold) {
          trend = 'improving';
        } else if (trendDelta < declineThreshold) {
          trend = 'declining';
        }
      }

      // Momentum
      let momentum = 0;
      if (totalDays >= 12) {
        const veryRecentWindow = Math.min(4, Math.floor(recentWindow / 2));
        const veryRecentStatuses = uniqueStatuses
          .slice(0, veryRecentWindow)
          .filter((s) => s !== 'excused' && s !== 'not enrolled');
        const midRecentStatuses = uniqueStatuses
          .slice(veryRecentWindow, recentWindow)
          .filter((s) => s !== 'excused' && s !== 'not enrolled');

        const veryRecentRate =
          veryRecentStatuses.length > 0
            ? veryRecentStatuses.filter(
                (s) => s === 'present' || s === 'on time' || s === 'late'
              ).length / veryRecentStatuses.length
            : 0;
        const midRecentRate =
          midRecentStatuses.length > 0
            ? midRecentStatuses.filter(
                (s) => s === 'present' || s === 'on time' || s === 'late'
              ).length / midRecentStatuses.length
            : 0;

        momentum = veryRecentRate - midRecentRate;
      }

      // === INTELLIGENT PATTERN DETECTION ===
      const patterns: string[] = [];

      // 1. Day-of-week pattern
      if (totalDays >= 8) {
        const dateObjects = uniqueDates.map((d) => new Date(d));
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
          if (count >= 3 && absenceRate >= 0.7 && total >= 4) {
            const dayName = [
              'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
            ][parseInt(day)];
            patterns.push(`High ${dayName} absence rate (${Math.round(absenceRate * 100)}%)`);
          }
        });
      }

      // 2. Sudden spike detection
      if (totalDays >= 10) {
        const last5 = uniqueStatuses.slice(0, 5).filter((s) => s !== 'excused');
        const previous5 = uniqueStatuses.slice(5, 10).filter((s) => s !== 'excused');
        const absencesInLast5 = last5.filter((s) => s === 'absent').length;
        const absencesInPrevious5 = previous5.filter((s) => s === 'absent').length;

        if (absencesInLast5 >= 3 && absencesInLast5 >= absencesInPrevious5 + 2) {
          patterns.push('Recent absence spike detected');
        }
      }

      // 3. Extended absence pattern
      if (maxConsecutive >= 4) {
        patterns.push(`Extended ${maxConsecutive}-session absence streak`);
      }

      // 4. Intermittent pattern
      if (totalDays >= 10 && daysAbsent >= 5) {
        const avgAbsenceGap =
          daysAbsent > 1 ? (uniqueDates.length - 1) / (daysAbsent - 1) : 0;
        if (avgAbsenceGap < 3 && avgAbsenceGap > 0) {
          patterns.push('Frequent intermittent absences');
        }
      }

      // 5. Late arrival habit
      if (lateDays >= 3 && totalDays >= 8) {
        const lateRate = lateDays / totalDays;
        if (lateRate >= 0.3) {
          patterns.push(`Chronic lateness (${Math.round(lateRate * 100)}% of sessions)`);
        }
      }

      // 6. Recent disengagement
      if (trend === 'declining' && trendStrength < -0.3 && attendanceRate < 70) {
        patterns.push('Sharp recent decline in attendance');
      }

      // 7. Absence clustering
      if (absentDates.length >= 4) {
        const gaps = [];
        for (let i = 1; i < absentDates.length; i++) {
          const gap =
            Math.abs(
              new Date(absentDates[i - 1]).getTime() - new Date(absentDates[i]).getTime()
            ) /
            (24 * 60 * 60 * 1000);
          gaps.push(gap);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (avgGap <= 7) {
          patterns.push('Clustered absence pattern');
        }
      }

      // === MULTI-DIMENSIONAL ENGAGEMENT SCORE (0-100) ===
      let engagementScore = 0;

      engagementScore += qualityScore * 0.4;
      const recencyComponent = (100 - normalizedRecency) * 0.25;
      engagementScore += recencyComponent;

      let trendComponent = 0;
      if (trend === 'improving') {
        trendComponent = 20 + trendStrength * 20;
      } else if (trend === 'declining') {
        trendComponent = -Math.abs(trendStrength) * 30;
      } else {
        trendComponent = 10;
      }
      engagementScore += trendComponent;

      const consistencyPenalty = maxConsecutive * 3 + patterns.length * 5;
      const consistencyScore = Math.max(0, 15 - consistencyPenalty);
      engagementScore += consistencyScore;

      engagementScore += momentum * 10;

      engagementScore = Math.max(0, Math.min(100, engagementScore));

      // === RISK ASSESSMENT ===
      let riskLevel: 'critical' | 'high' | 'medium' | 'watch' = 'watch';
      let shouldAlert = false;

      if (totalDays < 3) return;
      if (daysAbsent === 0 && lateDays <= 1) return;

      // Composite risk score
      const absenceRate = daysAbsent / effectiveDays;
      let absenceRiskPoints = 0;
      if (absenceRate >= 0.5) absenceRiskPoints = 35;
      else if (absenceRate >= 0.4) absenceRiskPoints = 30;
      else if (absenceRate >= 0.3) absenceRiskPoints = 22;
      else if (absenceRate >= 0.2) absenceRiskPoints = 15;
      else absenceRiskPoints = absenceRate * 50;

      let recentRiskPoints = 0;
      if (ongoingStreak >= 4) recentRiskPoints = 30;
      else if (ongoingStreak >= 3) recentRiskPoints = 25;
      else if (ongoingStreak >= 2) recentRiskPoints = 18;
      else if (recentConsecutive >= 3) recentRiskPoints = 20;
      else if (recentConsecutive >= 2) recentRiskPoints = 12;
      else if (weeklyAbsences >= 2) recentRiskPoints = 10;
      else if (weeklyAbsences >= 1) recentRiskPoints = 5;
      recentRiskPoints += normalizedRecency * 0.15;

      let trendRiskPoints = 0;
      if (trend === 'declining') {
        trendRiskPoints = 15 + Math.abs(trendStrength) * 5;
        if (momentum < -0.2) trendRiskPoints += 5;
      } else if (trend === 'improving') {
        trendRiskPoints = Math.max(0, 5 - trendStrength * 10);
      } else {
        trendRiskPoints = 8;
      }

      const patternRiskPoints = Math.min(15, patterns.length * 4 + (lateDays >= 3 ? 3 : 0));
      const riskScore = absenceRiskPoints + recentRiskPoints + trendRiskPoints + patternRiskPoints;

      const isRecentlyConcerning = ongoingStreak >= 2 || weeklyAbsences >= 2;
      const hasSignificantAbsences = daysAbsent >= 3;

      // CRITICAL
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
      // HIGH
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
      // MEDIUM
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
      // WATCH
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

      // Smart filtering
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

      const lastAttendedIndex = uniqueStatuses.findIndex(
        (s) => s === 'on time' || s === 'late'
      );
      const lastAttendedDate =
        lastAttendedIndex >= 0 ? uniqueDates[lastAttendedIndex] : undefined;

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

  // Sort: Critical first, then by engagement score
  alertStudents.sort((a, b) => {
    const riskOrder = { critical: 0, high: 1, medium: 2, watch: 3 };
    if (a.riskLevel !== b.riskLevel) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return a.engagementScore - b.engagementScore;
  });

  return alertStudents;
}
