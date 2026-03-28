import { format } from 'date-fns';
import type { AbsentStudent } from '@/shared/utils/attendanceAnalytics';
import type { MessageTemplate, MessageChannel } from '../constants/dashboardConstants';

export function generateEmailLink(student: AbsentStudent): string {
    const riskLevelText = student.riskLevel.toUpperCase();
    const subject = `[${riskLevelText} PRIORITY] Attendance Concern - ${student.student_name} | Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± - ${student.student_name}`;
    
    const trendText = {
      improving: 'showing improvement Ã¢Å“â€¦',
      declining: 'declining Ã¢Â¬â€¡Ã¯Â¸Â',
      stable: 'stable but concerning Ã¢Å¡Â Ã¯Â¸Â'
    }[student.trend];

    const trendTextAr = {
      improving: 'Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â­Ã˜Â³Ã™â€˜Ã™â€  Ã¢Å“â€¦',
      declining: 'Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹ Ã¢Â¬â€¡Ã¯Â¸Â',
      stable: 'Ã™â€¦Ã˜Â³Ã˜ÂªÃ™â€šÃ˜Â± Ã™â€žÃ™Æ’Ã™â€ Ã™â€¡ Ã™â€¦Ã™â€šÃ™â€žÃ™â€š Ã¢Å¡Â Ã¯Â¸Â'
    }[student.trend];

    const patternsText = student.patterns.length > 0 
      ? `\n\nÃ°Å¸â€Â Detected Patterns:\n${student.patterns.map(p => `  Ã¢â‚¬Â¢ ${p}`).join('\n')}`
      : '';

    // Calculate absence severity metrics
    const absencePercentage = student.totalDays > 0 ? Math.round(((student.totalDays - student.presentDays) / student.totalDays) * 100) : 0;
    const daysToReach75 = student.totalDays > 0 
      ? Math.max(0, Math.ceil((0.75 * student.totalDays - student.presentDays) / (1 - 0.75)))
      : 0;
    const projectedEndRate = student.trend === 'declining' 
      ? Math.max(0, student.attendanceRate - 5) 
      : student.trend === 'improving' 
        ? Math.min(100, student.attendanceRate + 5) 
        : student.attendanceRate;

    // Risk-specific recommendation
    const recommendation = {
      critical: `Ã°Å¸Å¡Â¨ URGENT ACTION REQUIRED:\nYour attendance has dropped to a critical level (${student.attendanceRate}%). This may result in:\n  Ã¢â‚¬Â¢ Academic probation or course failure\n  Ã¢â‚¬Â¢ Loss of enrollment eligibility\n  Ã¢â‚¬Â¢ Impact on certification/completion\n\nPlease schedule an immediate meeting with the administration within 48 hours.\n\nÃ°Å¸Å¡Â¨ Ã˜Â¥Ã˜Â¬Ã˜Â±Ã˜Â§Ã˜Â¡ Ã˜Â¹Ã˜Â§Ã˜Â¬Ã™â€ž Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨:\nÃ™â€žÃ™â€šÃ˜Â¯ Ã˜Â§Ã™â€ Ã˜Â®Ã™ÂÃ˜Â¶ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â¥Ã™â€žÃ™â€° Ã™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€° Ã˜Â­Ã˜Â±Ã˜Â¬ (${student.attendanceRate}%). Ã™â€šÃ˜Â¯ Ã™Å Ã˜Â¤Ã˜Â¯Ã™Å  Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜Â¥Ã™â€žÃ™â€°:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€ Ã˜Â°Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â£Ã™Æ’Ã˜Â§Ã˜Â¯Ã™Å Ã™â€¦Ã™Å  Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â®Ã™ÂÃ˜Â§Ã™â€š\n  Ã¢â‚¬Â¢ Ã™ÂÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€  Ã˜Â£Ã™â€¡Ã™â€žÃ™Å Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â³Ã˜Â¬Ã™Å Ã™â€ž\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â«Ã™Å Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â´Ã™â€¡Ã˜Â§Ã˜Â¯Ã˜Â©/Ã˜Â§Ã™â€žÃ˜Â¥Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€¦\n\nÃ™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã™ÂÃ™Ë†Ã˜Â±Ã™Å  Ã™â€¦Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 48 Ã˜Â³Ã˜Â§Ã˜Â¹Ã˜Â©.`,
      high: `Ã¢Å¡Â Ã¯Â¸Â HIGH PRIORITY:\nYour attendance pattern (${student.attendanceRate}%) shows significant risk. We recommend:\n  Ã¢â‚¬Â¢ Meeting with your instructor this week\n  Ã¢â‚¬Â¢ Setting up an attendance improvement plan\n  Ã¢â‚¬Â¢ Contacting us about any difficulties\n\nÃ¢Å¡Â Ã¯Â¸Â Ã˜Â£Ã™Ë†Ã™â€žÃ™Ë†Ã™Å Ã˜Â© Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å Ã˜Â©:\nÃ™â€ Ã™â€¦Ã˜Â· Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ (${student.attendanceRate}%) Ã™Å Ã™ÂÃ˜Â¸Ã™â€¡Ã˜Â± Ã˜Â®Ã˜Â·Ã˜Â±Ã˜Â§Ã™â€¹ Ã™Æ’Ã˜Â¨Ã™Å Ã˜Â±Ã˜Â§Ã™â€¹. Ã™â€ Ã™â€ Ã˜ÂµÃ˜Â­Ã™Æ’ Ã˜Â¨Ã™â‚¬:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â¹Ã™â€žÃ™â€¦Ã™Æ’ Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â¨Ã™Ë†Ã˜Â¹\n  Ã¢â‚¬Â¢ Ã™Ë†Ã˜Â¶Ã˜Â¹ Ã˜Â®Ã˜Â·Ã˜Â© Ã™â€žÃ˜ÂªÃ˜Â­Ã˜Â³Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±\n  Ã¢â‚¬Â¢ Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã˜Â¨Ã˜Â´Ã˜Â£Ã™â€  Ã˜Â£Ã™Å  Ã˜ÂµÃ˜Â¹Ã™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª`,
      medium: `Ã¢Å¡Â¡ ATTENTION NEEDED:\nYour attendance (${student.attendanceRate}%) is below our recommended minimum of 75%. To get back on track:\n  Ã¢â‚¬Â¢ Attend all upcoming sessions without exception\n  Ã¢â‚¬Â¢ ${daysToReach75 > 0 ? `You need ${daysToReach75} consecutive sessions to reach 75%` : 'Keep maintaining current attendance'}\n  Ã¢â‚¬Â¢ Reach out if you need schedule accommodation\n\nÃ¢Å¡Â¡ Ã™Å Ã˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ Ã˜Â§Ã™â€ Ã˜ÂªÃ˜Â¨Ã˜Â§Ã™â€¡Ã™Æ’:\nÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ (${student.attendanceRate}%) Ã˜Â£Ã™â€šÃ™â€ž Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜ÂµÃ™â€° Ã˜Â¨Ã™â€¡ 75%. Ã™â€žÃ™â€žÃ˜Â¹Ã™Ë†Ã˜Â¯Ã˜Â© Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜Â§Ã˜Â±:\n  Ã¢â‚¬Â¢ Ã˜Â§Ã˜Â­Ã˜Â¶Ã˜Â± Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â© Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â«Ã™â€ Ã˜Â§Ã˜Â¡\n  Ã¢â‚¬Â¢ ${daysToReach75 > 0 ? `Ã˜ÂªÃ˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ ${daysToReach75} Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å Ã˜Â© Ã™â€žÃ™â€žÃ™Ë†Ã˜ÂµÃ™Ë†Ã™â€ž Ã˜Â¥Ã™â€žÃ™â€° 75%` : 'Ã˜Â­Ã˜Â§Ã™ÂÃ˜Â¸ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å '}\n  Ã¢â‚¬Â¢ Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã˜Â¥Ã˜Â°Ã˜Â§ Ã˜Â§Ã˜Â­Ã˜ÂªÃ˜Â¬Ã˜Âª Ã˜ÂªÃ˜Â±Ã˜ÂªÃ™Å Ã˜Â¨Ã˜Â§Ã™â€¹ Ã˜Â®Ã˜Â§Ã˜ÂµÃ˜Â§Ã™â€¹`,
      watch: `Ã°Å¸â€˜ÂÃ¯Â¸Â EARLY NOTICE:\nWe've noticed some attendance patterns that may affect your progress. Current rate: ${student.attendanceRate}%.\nThis is an early intervention Ã¢â‚¬â€ maintaining regular attendance ensures you get the most from the course.\n\nÃ°Å¸â€˜ÂÃ¯Â¸Â Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã™â€¦Ã˜Â¨Ã™Æ’Ã˜Â±:\nÃ™â€žÃ˜Â§Ã˜Â­Ã˜Â¸Ã™â€ Ã˜Â§ Ã˜Â¨Ã˜Â¹Ã˜Â¶ Ã˜Â£Ã™â€ Ã™â€¦Ã˜Â§Ã˜Â· Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂªÃ™Å  Ã™â€šÃ˜Â¯ Ã˜ÂªÃ˜Â¤Ã˜Â«Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦Ã™Æ’. Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${student.attendanceRate}%.\nÃ™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜Â¯Ã˜Â®Ã™â€ž Ã™â€¦Ã˜Â¨Ã™Æ’Ã˜Â± Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â§Ã˜Â¸ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜ÂªÃ˜Â¸Ã™â€¦ Ã™Å Ã˜Â¶Ã™â€¦Ã™â€  Ã™â€žÃ™Æ’ Ã˜Â£Ã™â€šÃ˜ÂµÃ™â€° Ã˜Â§Ã˜Â³Ã˜ÂªÃ™ÂÃ˜Â§Ã˜Â¯Ã˜Â© Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©.`
    }[student.riskLevel];

    // Formatted absence list with day names
    const absencesList = student.absentDates.slice(0, 15).map(d => {
      const dateObj = new Date(d);
      return `  Ã¢â‚¬Â¢ ${format(dateObj, 'EEEE, MMMM dd, yyyy')}`;
    }).join('\n');
    const moreAbsences = student.absentDates.length > 15 
      ? `\n  ... and ${student.absentDates.length - 15} additional absences` 
      : '';

    const body = `Dear ${student.student_name},
Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’

Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
Ã°Å¸â€œÅ  ATTENDANCE REPORT / Ã˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±
Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
Priority Level / Ã™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€° Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€žÃ™Ë†Ã™Å Ã˜Â©: ${riskLevelText}
Course / Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}
Report Date / Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â±: ${format(new Date(), 'EEEE, MMMM dd, yyyy')}

Ã°Å¸â€œË† DETAILED STATISTICS / Ã˜Â¥Ã˜Â­Ã˜ÂµÃ˜Â§Ã˜Â¦Ã™Å Ã˜Â§Ã˜Âª Ã™â€¦Ã™ÂÃ˜ÂµÃ™â€žÃ˜Â©:
  Ã¢â‚¬Â¢ Attendance Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${student.attendanceRate}%
  Ã¢â‚¬Â¢ Absence Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨: ${absencePercentage}%
  Ã¢â‚¬Â¢ Sessions Attended / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã˜Â©: ${student.presentDays} / ${student.totalDays}
  Ã¢â‚¬Â¢ Sessions Missed / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™ÂÃ˜Â§Ã˜Â¦Ã˜ÂªÃ˜Â©: ${student.totalDays - student.presentDays}
  Ã¢â‚¬Â¢ Consecutive Absences / Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å : ${student.consecutiveAbsences} sessions
  Ã¢â‚¬Â¢ Engagement Score / Ã˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â§Ã˜Â±Ã™Æ’Ã˜Â©: ${student.engagementScore}/100
  Ã¢â‚¬Â¢ Current Trend / Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${trendText} / ${trendTextAr}
  Ã¢â‚¬Â¢ Projected Rate / Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ™Ë†Ã™â€šÃ˜Â¹: ~${projectedEndRate}% (if trend continues)${student.lastAttendedDate ? `\n  Ã¢â‚¬Â¢ Last Attended / Ã˜Â¢Ã˜Â®Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${format(new Date(student.lastAttendedDate), 'EEEE, MMMM dd, yyyy')}` : ''}
${patternsText}

Ã°Å¸â€œâ€¦ ABSENCE RECORD / Ã˜Â³Ã˜Â¬Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨:
${absencesList}${moreAbsences}

Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â
${recommendation}
Ã¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€ÂÃ¢â€Â

Ã°Å¸â€œÅ¾ NEXT STEPS / Ã˜Â§Ã™â€žÃ˜Â®Ã˜Â·Ã™Ë†Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å Ã˜Â©:
  1. Please respond to this email within 3 business days / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 3 Ã˜Â£Ã™Å Ã˜Â§Ã™â€¦ Ã˜Â¹Ã™â€¦Ã™â€ž
  2. Schedule a meeting if needed / Ã˜Â­Ã˜Â¯Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹ Ã˜Â¥Ã˜Â°Ã˜Â§ Ã™â€žÃ˜Â²Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â£Ã™â€¦Ã˜Â±
  3. Provide documentation for any excused absences / Ã™â€šÃ˜Â¯Ã™â€˜Ã™â€¦ Ã™Ë†Ã˜Â«Ã˜Â§Ã˜Â¦Ã™â€š Ã™â€žÃ˜Â£Ã™Å  Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â¹Ã˜Â°Ã˜Â±
  4. Contact us at any time for support / Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã™ÂÃ™Å  Ã˜Â£Ã™Å  Ã™Ë†Ã™â€šÃ˜Âª Ã™â€žÃ™â€žÃ˜Â¯Ã˜Â¹Ã™â€¦

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª,
Training Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨

---
This is an automated attendance report generated by the Training Center Management System.
Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â¢Ã™â€žÃ™Å  Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¤Ã™â€¡ Ã˜Â¨Ã™Ë†Ã˜Â§Ã˜Â³Ã˜Â·Ã˜Â© Ã™â€ Ã˜Â¸Ã˜Â§Ã™â€¦ Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨.`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function generateSMSLink(student: AbsentStudent): string {
    const riskEmoji = {
      critical: 'Ã°Å¸Å¡Â¨',
      high: 'Ã¢Å¡Â Ã¯Â¸Â',
      medium: 'Ã¢Å¡Â¡',
      watch: 'Ã°Å¸â€˜ÂÃ¯Â¸Â'
    }[student.riskLevel];

    const riskTextAr = {
      critical: 'Ã˜Â­Ã˜Â±Ã˜Â¬',
      high: 'Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å ',
      medium: 'Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â·',
      watch: 'Ã™â€¦Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨Ã˜Â©'
    }[student.riskLevel];

    const urgencyNote = {
      critical: 'IMMEDIATE response required / Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨ Ã˜Â±Ã˜Â¯ Ã™ÂÃ™Ë†Ã˜Â±Ã™Å ',
      high: 'Please respond within 24 hours / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 24 Ã˜Â³Ã˜Â§Ã˜Â¹Ã˜Â©',
      medium: 'Please respond within 3 days / Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¯ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž 3 Ã˜Â£Ã™Å Ã˜Â§Ã™â€¦',
      watch: 'For your information / Ã™â€žÃ™â€žÃ˜Â¹Ã™â€žÃ™â€¦'
    }[student.riskLevel];

    // Recent absences for SMS (compact)
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');
    const moreDates = student.absentDates.length > 3 ? ` +${student.absentDates.length - 3} more` : '';

    const message = `${riskEmoji} ATTENDANCE ALERT / Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±
${student.student_name}

Course/Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}
Rate/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž: ${student.attendanceRate}%
Attended/Ã˜Â­Ã˜Â¶Ã˜Â±: ${student.presentDays}/${student.totalDays} sessions
Consecutive Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å : ${student.consecutiveAbsences}
Trend/Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡: ${student.trend}
Risk/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€°: ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `Recent Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â­Ã˜Â¯Ã™Å Ã˜Â«: ${recentDates}${moreDates}` : ''}

${urgencyNote}

Contact training center / Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`;

    // SMS link format - works on most devices
    return `sms:${student.phone || ''}?body=${encodeURIComponent(message)}`;
}

export function generateWhatsAppLink(student: AbsentStudent): string {
    const riskEmoji = { critical: 'Ã°Å¸Å¡Â¨', high: 'Ã¢Å¡Â Ã¯Â¸Â', medium: 'Ã¢Å¡Â¡', watch: 'Ã°Å¸â€˜ÂÃ¯Â¸Â' }[student.riskLevel];
    const riskTextAr = { critical: 'Ã˜Â­Ã˜Â±Ã˜Â¬', high: 'Ã˜Â¹Ã˜Â§Ã™â€žÃ™Å ', medium: 'Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â³Ã˜Â·', watch: 'Ã™â€¦Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨Ã˜Â©' }[student.riskLevel];
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');

    const message = `${riskEmoji} *ATTENDANCE ALERT / Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±*

*Student/Ã˜Â§Ã™â€žÃ˜Â·Ã˜Â§Ã™â€žÃ˜Â¨:* ${student.student_name}
*Course/Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©:* ${student.course_name}
*Rate/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž:* ${student.attendanceRate}%
*Attended/Ã˜Â­Ã˜Â¶Ã˜Â±:* ${student.presentDays}/${student.totalDays} sessions
*Consecutive Absences/Ã˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å :* ${student.consecutiveAbsences}
*Risk Level/Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€°:* ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `*Recent/Ã˜Â­Ã˜Â¯Ã™Å Ã˜Â«:* ${recentDates}` : ''}

Please contact the training center.
Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹ Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨.`;

    const phone = (student.phone || '').replace(/[^0-9]/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function generateTemplateBody(template: MessageTemplate, student: AbsentStudent, channel: MessageChannel): { subject: string; body: string } {
    const isEmail = channel === 'email';
    
    switch (template) {
      case 'encouragement': {
        const subject = `Great Progress! Keep Going - ${student.student_name} | Ã˜Â£Ã˜Â­Ã˜Â³Ã™â€ Ã˜Âª! Ã™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦`;
        const body = isEmail
          ? `Dear ${student.student_name},\nÃ˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’\n\n` +
            `We want to acknowledge your efforts in "${student.course_name}".\n` +
            `Ã™â€ Ã™Ë†Ã˜Â¯ Ã˜Â£Ã™â€  Ã™â€ Ã™â€šÃ˜Â¯Ã˜Â± Ã˜Â¬Ã™â€¡Ã™Ë†Ã˜Â¯Ã™Æ’ Ã™ÂÃ™Å  "${student.course_name}".\n\n` +
            `Ã°Å¸â€œÅ  Your Stats / Ã˜Â¥Ã˜Â­Ã˜ÂµÃ˜Â§Ã˜Â¦Ã™Å Ã˜Â§Ã˜ÂªÃ™Æ’:\n` +
            `  Ã¢â‚¬Â¢ Attendance Rate / Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±: ${student.attendanceRate}%\n` +
            `  Ã¢â‚¬Â¢ Sessions Attended / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã˜Â©: ${student.presentDays}/${student.totalDays}\n` +
            `  Ã¢â‚¬Â¢ Engagement / Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â§Ã˜Â±Ã™Æ’Ã˜Â©: ${student.engagementScore}/100\n` +
            `  Ã¢â‚¬Â¢ Trend / Ã˜Â§Ã™â€žÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡: ${student.trend}\n\n` +
            (student.trend === 'improving' 
              ? `Ã°Å¸Å’Å¸ Your attendance trend is improving Ã¢â‚¬â€ keep up the great work!\nÃ˜Â§Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã™ÂÃ™Å  Ã˜ÂªÃ˜Â­Ã˜Â³Ã™â€˜Ã™â€  Ã¢â‚¬â€ Ã˜Â§Ã˜Â³Ã˜ÂªÃ™â€¦Ã˜Â± Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â§Ã˜Â¦Ã˜Â¹!\n\n`
              : `Ã°Å¸â€™Âª We believe in your ability to succeed. Every session counts!\nÃ™â€ Ã˜Â­Ã™â€  Ã™â€ Ã˜Â¤Ã™â€¦Ã™â€  Ã˜Â¨Ã™â€šÃ˜Â¯Ã˜Â±Ã˜ÂªÃ™Æ’ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ™â€ Ã˜Â¬Ã˜Â§Ã˜Â­. Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© Ã™â€¦Ã™â€¡Ã™â€¦Ã˜Â©!\n\n`) +
            `Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª,\nTraining Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`
          : `Ã°Å¸Å’Å¸ ${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}% | ${student.presentDays}/${student.totalDays}\n` +
            `Keep up the great work! Ã™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™â€¦!`;
        return { subject, body };
      }
      case 'reminder': {
        const subject = `Session Reminder - ${student.course_name} | Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â± Ã˜Â¨Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â© - ${student.course_name}`;
        const body = isEmail
          ? `Dear ${student.student_name},\nÃ˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã™Å /Ã˜Â¹Ã˜Â²Ã™Å Ã˜Â²Ã˜ÂªÃ™Å  ${student.student_name}Ã˜Å’\n\n` +
            `This is a friendly reminder about your upcoming session.\nÃ™â€¡Ã˜Â°Ã˜Â§ Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â± Ã™Ë†Ã˜Â¯Ã™Å  Ã˜Â¨Ã˜Â¬Ã™â€žÃ˜Â³Ã˜ÂªÃ™Æ’ Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â©.\n\n` +
            `Ã°Å¸â€œâ€¦ Course / Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã˜Â©: ${student.course_name}\n` +
            `Ã°Å¸â€œÅ  Current Attendance / Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å : ${student.attendanceRate}%\n` +
            `Ã°Å¸â€œË† Sessions Completed / Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜ÂªÃ™â€¦Ã™â€žÃ˜Â©: ${student.presentDays}/${student.totalDays}\n\n` +
            (student.attendanceRate < 75 
              ? `Ã¢Å¡Â Ã¯Â¸Â Your attendance is below 75%. Please make every effort to attend.\nÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã™Æ’ Ã˜Â£Ã™â€šÃ™â€ž Ã™â€¦Ã™â€  75%. Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â¨Ã˜Â°Ã™â€ž Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€¡Ã˜Â¯ Ã™â€žÃ™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±.\n\n`
              : '') +
            `We look forward to seeing you!\nÃ™â€ Ã˜ÂªÃ˜Â·Ã™â€žÃ˜Â¹ Ã™â€žÃ˜Â±Ã˜Â¤Ã™Å Ã˜ÂªÃ™Æ’!\n\n` +
            `Training Center Management / Ã˜Â¥Ã˜Â¯Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€¦Ã˜Â±Ã™Æ’Ã˜Â² Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¯Ã˜Â±Ã™Å Ã˜Â¨`
          : `Ã°Å¸â€œâ€¦ REMINDER / Ã˜ÂªÃ˜Â°Ã™Æ’Ã™Å Ã˜Â±\n${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}%\n` +
            `Don't miss your next session! Ã™â€žÃ˜Â§ Ã˜ÂªÃ™ÂÃ™Ë†Ã˜Âª Ã˜Â¬Ã™â€žÃ˜Â³Ã˜ÂªÃ™Æ’ Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¯Ã™â€¦Ã˜Â©!`;
        return { subject, body };
      }
      case 'custom':
        return { subject: `Re: ${student.student_name} - ${student.course_name}`, body: '' };
      case 'attendance_alert':
      default: {
        // Use existing generator logic but return as editable text
        if (isEmail) {
          const link = generateEmailLink(student);
          const params = new URL(link.replace('mailto:', 'https://x.com?to='));
          const subject = decodeURIComponent(params.searchParams.get('subject') || '');
          const body = decodeURIComponent(params.searchParams.get('body') || '');
          return { subject, body };
        } else {
          const smsLink = generateSMSLink(student);
          const body = decodeURIComponent(smsLink.split('body=')[1] || '');
          return { subject: '', body };
        }
      }
    }
}

