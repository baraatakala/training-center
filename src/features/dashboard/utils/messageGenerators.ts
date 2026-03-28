import { format } from 'date-fns';
import type { AbsentStudent } from '@/shared/utils/attendanceAnalytics';
import type { MessageTemplate, MessageChannel } from '../constants/dashboardConstants';

export function generateEmailLink(student: AbsentStudent): string {
    const riskLevelText = student.riskLevel.toUpperCase();
    const subject = `[${riskLevelText} PRIORITY] Attendance Concern - ${student.student_name} | إشعار حضور - ${student.student_name}`;
    
    const trendText = {
      improving: 'showing improvement ✅',
      declining: 'declining ⬇️',
      stable: 'stable but concerning ⚠️'
    }[student.trend];

    const trendTextAr = {
      improving: 'في تحسّن ✅',
      declining: 'في تراجع ⬇️',
      stable: 'مستقر لكنه مقلق ⚠️'
    }[student.trend];

    const patternsText = student.patterns.length > 0 
      ? `\n\n🔍 Detected Patterns:\n${student.patterns.map(p => `  • ${p}`).join('\n')}`
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
      critical: `🚨 URGENT ACTION REQUIRED:\nYour attendance has dropped to a critical level (${student.attendanceRate}%). This may result in:\n  • Academic probation or course failure\n  • Loss of enrollment eligibility\n  • Impact on certification/completion\n\nPlease schedule an immediate meeting with the administration within 48 hours.\n\n🚨 إجراء عاجل مطلوب:\nلقد انخفض حضورك إلى مستوى حرج (${student.attendanceRate}%). قد يؤدي هذا إلى:\n  • الإنذار الأكاديمي أو الإخفاق\n  • فقدان أهلية التسجيل\n  • التأثير على الشهادة/الإتمام\n\nيرجى تحديد موعد اجتماع فوري مع الإدارة خلال 48 ساعة.`,
      high: `⚠️ HIGH PRIORITY:\nYour attendance pattern (${student.attendanceRate}%) shows significant risk. We recommend:\n  • Meeting with your instructor this week\n  • Setting up an attendance improvement plan\n  • Contacting us about any difficulties\n\n⚠️ أولوية عالية:\nنمط حضورك (${student.attendanceRate}%) يُظهر خطراً كبيراً. ننصحك بـ:\n  • الاجتماع مع معلمك هذا الأسبوع\n  • وضع خطة لتحسين الحضور\n  • التواصل معنا بشأن أي صعوبات`,
      medium: `⚡ ATTENTION NEEDED:\nYour attendance (${student.attendanceRate}%) is below our recommended minimum of 75%. To get back on track:\n  • Attend all upcoming sessions without exception\n  • ${daysToReach75 > 0 ? `You need ${daysToReach75} consecutive sessions to reach 75%` : 'Keep maintaining current attendance'}\n  • Reach out if you need schedule accommodation\n\n⚡ يحتاج انتباهك:\nحضورك (${student.attendanceRate}%) أقل من الحد الأدنى الموصى به 75%. للعودة إلى المسار:\n  • احضر جميع الجلسات القادمة بدون استثناء\n  • ${daysToReach75 > 0 ? `تحتاج ${daysToReach75} جلسات متتالية للوصول إلى 75%` : 'حافظ على حضورك الحالي'}\n  • تواصل معنا إذا احتجت ترتيباً خاصاً`,
      watch: `👁️ EARLY NOTICE:\nWe've noticed some attendance patterns that may affect your progress. Current rate: ${student.attendanceRate}%.\nThis is an early intervention — maintaining regular attendance ensures you get the most from the course.\n\n👁️ إشعار مبكر:\nلاحظنا بعض أنماط الحضور التي قد تؤثر على تقدمك. المعدل الحالي: ${student.attendanceRate}%.\nهذا تدخل مبكر — الحفاظ على الحضور المنتظم يضمن لك أقصى استفادة من الدورة.`
    }[student.riskLevel];

    // Formatted absence list with day names
    const absencesList = student.absentDates.slice(0, 15).map(d => {
      const dateObj = new Date(d);
      return `  • ${format(dateObj, 'EEEE, MMMM dd, yyyy')}`;
    }).join('\n');
    const moreAbsences = student.absentDates.length > 15 
      ? `\n  ... and ${student.absentDates.length - 15} additional absences` 
      : '';

    const body = `Dear ${student.student_name},
عزيزي/عزيزتي ${student.student_name}،

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ATTENDANCE REPORT / تقرير الحضور
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Priority Level / مستوى الأولوية: ${riskLevelText}
Course / الدورة: ${student.course_name}
Report Date / تاريخ التقرير: ${format(new Date(), 'EEEE, MMMM dd, yyyy')}

📈 DETAILED STATISTICS / إحصائيات مفصلة:
  • Attendance Rate / معدل الحضور: ${student.attendanceRate}%
  • Absence Rate / معدل الغياب: ${absencePercentage}%
  • Sessions Attended / الجلسات المحضورة: ${student.presentDays} / ${student.totalDays}
  • Sessions Missed / الجلسات الفائتة: ${student.totalDays - student.presentDays}
  • Consecutive Absences / غياب متتالي: ${student.consecutiveAbsences} sessions
  • Engagement Score / درجة المشاركة: ${student.engagementScore}/100
  • Current Trend / الاتجاه الحالي: ${trendText} / ${trendTextAr}
  • Projected Rate / المعدل المتوقع: ~${projectedEndRate}% (if trend continues)${student.lastAttendedDate ? `\n  • Last Attended / آخر حضور: ${format(new Date(student.lastAttendedDate), 'EEEE, MMMM dd, yyyy')}` : ''}
${patternsText}

📅 ABSENCE RECORD / سجل الغياب:
${absencesList}${moreAbsences}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 NEXT STEPS / الخطوات التالية:
  1. Please respond to this email within 3 business days / يرجى الرد خلال 3 أيام عمل
  2. Schedule a meeting if needed / حدد موعد اجتماع إذا لزم الأمر
  3. Provide documentation for any excused absences / قدّم وثائق لأي غياب بعذر
  4. Contact us at any time for support / تواصل معنا في أي وقت للدعم

Best regards / مع أطيب التحيات,
Training Center Management / إدارة مركز التدريب

---
This is an automated attendance report generated by the Training Center Management System.
هذا تقرير حضور آلي تم إنشاؤه بواسطة نظام إدارة مركز التدريب.`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function generateSMSLink(student: AbsentStudent): string {
    const riskEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      watch: '👁️'
    }[student.riskLevel];

    const riskTextAr = {
      critical: 'حرج',
      high: 'عالي',
      medium: 'متوسط',
      watch: 'مراقبة'
    }[student.riskLevel];

    const urgencyNote = {
      critical: 'IMMEDIATE response required / مطلوب رد فوري',
      high: 'Please respond within 24 hours / يرجى الرد خلال 24 ساعة',
      medium: 'Please respond within 3 days / يرجى الرد خلال 3 أيام',
      watch: 'For your information / للعلم'
    }[student.riskLevel];

    // Recent absences for SMS (compact)
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');
    const moreDates = student.absentDates.length > 3 ? ` +${student.absentDates.length - 3} more` : '';

    const message = `${riskEmoji} ATTENDANCE ALERT / إشعار حضور
${student.student_name}

Course/الدورة: ${student.course_name}
Rate/المعدل: ${student.attendanceRate}%
Attended/حضر: ${student.presentDays}/${student.totalDays} sessions
Consecutive Absences/غياب متتالي: ${student.consecutiveAbsences}
Trend/الاتجاه: ${student.trend}
Risk/المستوى: ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `Recent Absences/غياب حديث: ${recentDates}${moreDates}` : ''}

${urgencyNote}

Contact training center / تواصل مع مركز التدريب`;

    // SMS link format - works on most devices
    return `sms:${student.phone || ''}?body=${encodeURIComponent(message)}`;
}

export function generateWhatsAppLink(student: AbsentStudent): string {
    const riskEmoji = { critical: '🚨', high: '⚠️', medium: '⚡', watch: '👁️' }[student.riskLevel];
    const riskTextAr = { critical: 'حرج', high: 'عالي', medium: 'متوسط', watch: 'مراقبة' }[student.riskLevel];
    const recentDates = student.absentDates.slice(0, 3).map(d => format(new Date(d), 'MMM dd')).join(', ');

    const message = `${riskEmoji} *ATTENDANCE ALERT / إشعار حضور*

*Student/الطالب:* ${student.student_name}
*Course/الدورة:* ${student.course_name}
*Rate/المعدل:* ${student.attendanceRate}%
*Attended/حضر:* ${student.presentDays}/${student.totalDays} sessions
*Consecutive Absences/غياب متتالي:* ${student.consecutiveAbsences}
*Risk Level/المستوى:* ${student.riskLevel.toUpperCase()} (${riskTextAr})
${recentDates ? `*Recent/حديث:* ${recentDates}` : ''}

Please contact the training center.
يرجى التواصل مع مركز التدريب.`;

    const phone = (student.phone || '').replace(/[^0-9]/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function generateTemplateBody(template: MessageTemplate, student: AbsentStudent, channel: MessageChannel): { subject: string; body: string } {
    const isEmail = channel === 'email';
    
    switch (template) {
      case 'encouragement': {
        const subject = `Great Progress! Keep Going - ${student.student_name} | أحسنت! واصل التقدم`;
        const body = isEmail
          ? `Dear ${student.student_name},\nعزيزي/عزيزتي ${student.student_name}،\n\n` +
            `We want to acknowledge your efforts in "${student.course_name}".\n` +
            `نود أن نقدر جهودك في "${student.course_name}".\n\n` +
            `📊 Your Stats / إحصائياتك:\n` +
            `  • Attendance Rate / معدل الحضور: ${student.attendanceRate}%\n` +
            `  • Sessions Attended / الجلسات المحضورة: ${student.presentDays}/${student.totalDays}\n` +
            `  • Engagement / المشاركة: ${student.engagementScore}/100\n` +
            `  • Trend / الاتجاه: ${student.trend}\n\n` +
            (student.trend === 'improving' 
              ? `🌟 Your attendance trend is improving — keep up the great work!\nاتجاه حضورك في تحسّن — استمر في العمل الرائع!\n\n`
              : `💪 We believe in your ability to succeed. Every session counts!\nنحن نؤمن بقدرتك على النجاح. كل جلسة مهمة!\n\n`) +
            `Best regards / مع أطيب التحيات,\nTraining Center Management / إدارة مركز التدريب`
          : `🌟 ${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}% | ${student.presentDays}/${student.totalDays}\n` +
            `Keep up the great work! واصل التقدم!`;
        return { subject, body };
      }
      case 'reminder': {
        const subject = `Session Reminder - ${student.course_name} | تذكير بالجلسة - ${student.course_name}`;
        const body = isEmail
          ? `Dear ${student.student_name},\nعزيزي/عزيزتي ${student.student_name}،\n\n` +
            `This is a friendly reminder about your upcoming session.\nهذا تذكير ودي بجلستك القادمة.\n\n` +
            `📅 Course / الدورة: ${student.course_name}\n` +
            `📊 Current Attendance / الحضور الحالي: ${student.attendanceRate}%\n` +
            `📈 Sessions Completed / الجلسات المكتملة: ${student.presentDays}/${student.totalDays}\n\n` +
            (student.attendanceRate < 75 
              ? `⚠️ Your attendance is below 75%. Please make every effort to attend.\nحضورك أقل من 75%. يرجى بذل كل جهد للحضور.\n\n`
              : '') +
            `We look forward to seeing you!\nنتطلع لرؤيتك!\n\n` +
            `Training Center Management / إدارة مركز التدريب`
          : `📅 REMINDER / تذكير\n${student.student_name}\n` +
            `Course: ${student.course_name}\n` +
            `Rate: ${student.attendanceRate}%\n` +
            `Don't miss your next session! لا تفوت جلستك القادمة!`;
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

