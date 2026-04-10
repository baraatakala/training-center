/**
 * Student Overview PDF Export
 * Generates a professional A4 PDF report matching the frontend Overview tab design.
 */

import type { Student } from '@/shared/types/database.types';

interface AnalyticsData {
  total: number;
  onTime: number;
  late: number;
  absent: number;
  excused: number;
  present: number;
  accountable: number;
  attendanceRate: number;
  qualityRate: number;
  weightedScore: number;
  punctuality: number;
  trendClassification: string;
  trendSlope: number;
  trendR2: number;
  weeklyChange: number;
  consecutive: number;
  maxStreak: number;
  firstHalfRate: number;
  secondHalfRate: number;
  consistencyIndex: number;
  avgLateMinutes: number;
  maxLateMinutes: number;
  totalLateMinutes: number;
  lateScoreAvg: number;
  coverageFactor: number;
  rawScore: number;
  insights: { text: string; type: 'positive' | 'warning' | 'danger' | 'info'; priority?: number }[];
  configWeights: { q: number; a: number; p: number };
}

interface EnrollmentInfo {
  courseName: string;
  teacherName: string;
  status: string;
}

interface ExportOptions {
  student: Student;
  analytics: AnalyticsData;
  enrollments: EnrollmentInfo[];
  riskLevel: string;
  photoDataUrl?: string | null;
  arabicMode?: boolean;
}

// Color constants (RGB tuples)
const COLORS = {
  emerald: [16, 185, 129] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  red: [239, 68, 68] as [number, number, number],
  purple: [139, 92, 246] as [number, number, number],
  blue: [59, 130, 246] as [number, number, number],
  gray: [107, 114, 128] as [number, number, number],
  darkGray: [31, 41, 55] as [number, number, number],
  lightBg: [249, 250, 251] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
};

function getScoreColor(score: number): [number, number, number] {
  if (score >= 80) return COLORS.emerald;
  if (score >= 60) return COLORS.amber;
  return COLORS.red;
}

/** Sanitize text for jsPDF — replaces non-Latin characters with readable fallback */
function sanitizeForPdf(text: string): string {
  if (!text) return '';
  // Test if text contains non-Latin characters (Arabic, Chinese, etc.)
  const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF]/.test(text);
  if (!hasNonLatin) return text;
  // Replace non-Latin chars with '?' but keep Latin parts
  const latinParts = text.replace(/[^\u0000-\u024F\u1E00-\u1EFF]+/g, '').trim();
  return latinParts || '(non-Latin text)';
}

export async function exportStudentOverviewPDF(options: ExportOptions): Promise<void> {
  // Arabic mode: use html-to-image capture for proper Arabic text rendering
  if (options.arabicMode) {
    return exportArabicPDF(options);
  }

  const { student, analytics, enrollments, riskLevel, photoDataUrl } = options;
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Helper Functions ──────────────────────────────────────────
  const drawRoundedRect = (x: number, yPos: number, w: number, h: number, r: number, fillColor?: [number, number, number], strokeColor?: [number, number, number]) => {
    if (fillColor) doc.setFillColor(...fillColor);
    if (strokeColor) { doc.setDrawColor(...strokeColor); doc.setLineWidth(0.3); }
    doc.roundedRect(x, yPos, w, h, r, r, fillColor && strokeColor ? 'FD' : fillColor ? 'F' : 'S');
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = margin;
    }
  };

  // ══════════════════════════════════════════════════════════════
  // HEADER: Student Identity
  // ══════════════════════════════════════════════════════════════
  drawRoundedRect(margin, y, contentW, 32, 3, [245, 243, 255], [200, 190, 240]);

  // Photo or initials circle
  const circleX = margin + 16;
  const circleY = y + 16;
  if (photoDataUrl) {
    try {
      doc.addImage(photoDataUrl, 'JPEG', circleX - 10, circleY - 10, 20, 20);
    } catch {
      doc.setFillColor(139, 92, 246);
      doc.circle(circleX, circleY, 10, 'F');
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      const initials = student.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
      doc.text(initials, circleX, circleY + 1, { align: 'center', baseline: 'middle' });
    }
  } else {
    doc.setFillColor(139, 92, 246);
    doc.circle(circleX, circleY, 10, 'F');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    const initials = student.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
    doc.text(initials, circleX, circleY + 1, { align: 'center', baseline: 'middle' });
  }

  // Name and details
  const textX = margin + 32;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.darkGray);
  doc.text(sanitizeForPdf(student.name || 'Unknown'), textX, y + 10);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  const details = [student.email, student.phone].filter(Boolean).join('  ·  ');
  doc.text(details, textX, y + 16);

  // Badges
  let badgeX = textX;
  const badgeY = y + 22;
  if (student.specialization) {
    const specText = sanitizeForPdf(student.specialization);
    const specW = doc.getTextWidth(specText) + 6;
    drawRoundedRect(badgeX, badgeY, specW, 5, 2, [237, 233, 254]);
    doc.setFontSize(7);
    doc.setTextColor(109, 40, 217);
    doc.text(specText, badgeX + 3, badgeY + 3.5);
    badgeX += specW + 3;
  }
  if (student.nationality) {
    const natText = sanitizeForPdf(student.nationality);
    const natW = doc.getTextWidth(natText) + 6;
    drawRoundedRect(badgeX, badgeY, natW, 5, 2, [229, 231, 235]);
    doc.setTextColor(...COLORS.gray);
    doc.text(natText, badgeX + 3, badgeY + 3.5);
    badgeX += natW + 3;
  }

  // Risk level badge (right side)
  const riskLabels: Record<string, string> = { critical: 'CRITICAL', high: 'AT RISK', medium: 'NEEDS ATTENTION', good: 'GOOD STANDING', unknown: 'N/A' };
  const riskColors: Record<string, [number, number, number]> = { critical: COLORS.red, high: [249, 115, 22], medium: COLORS.amber, good: COLORS.emerald, unknown: COLORS.gray };
  const riskLabel = riskLabels[riskLevel] || 'N/A';
  const riskColor = riskColors[riskLevel] || COLORS.gray;
  const riskBadgeW = doc.getTextWidth(riskLabel) + 8;
  drawRoundedRect(margin + contentW - riskBadgeW - 5, y + 5, riskBadgeW, 6, 2, riskColor);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(riskLabel, margin + contentW - 5 - riskBadgeW / 2, y + 9, { align: 'center' });

  y += 36;

  // ══════════════════════════════════════════════════════════════
  // WEIGHTED SCORE HERO
  // ══════════════════════════════════════════════════════════════
  checkPageBreak(28);
  drawRoundedRect(margin, y, contentW, 24, 3, COLORS.white, [220, 220, 220]);

  // Score circle
  const scoreColor = getScoreColor(analytics.weightedScore);
  doc.setFillColor(...scoreColor);
  doc.circle(margin + 15, y + 12, 9, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(String(analytics.weightedScore), margin + 15, y + 13, { align: 'center', baseline: 'middle' });

  // Score label and formula
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.darkGray);
  doc.text('Weighted Score', margin + 30, y + 8);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  const formula = `Q${analytics.qualityRate}x${analytics.configWeights.q}% + A${analytics.attendanceRate}x${analytics.configWeights.a}% + P${analytics.punctuality}x${analytics.configWeights.p}%` +
    (analytics.coverageFactor < 1 ? ` x CF${analytics.coverageFactor}` : '');
  doc.text(formula, margin + 30, y + 13);

  // Trend badge
  const trendLabel = `${analytics.trendClassification}`;
  const trendColor: [number, number, number] = analytics.trendClassification === 'IMPROVING' ? COLORS.emerald : analytics.trendClassification === 'DECLINING' ? COLORS.red : analytics.trendClassification === 'VOLATILE' ? COLORS.purple : COLORS.gray;
  const trendW = doc.getTextWidth(trendLabel) + 8;
  drawRoundedRect(margin + 30, y + 16, trendW, 5, 2, trendColor);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text(trendLabel, margin + 30 + trendW / 2, y + 19.3, { align: 'center' });

  if (analytics.weeklyChange !== 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(analytics.weeklyChange > 0 ? 16 : 239, analytics.weeklyChange > 0 ? 185 : 68, analytics.weeklyChange > 0 ? 129 : 68);
    doc.text(`${analytics.weeklyChange > 0 ? '+' : ''}${analytics.weeklyChange}%/wk`, margin + 30 + trendW + 4, y + 19.3);
  }

  y += 28;

  // ══════════════════════════════════════════════════════════════
  // KEY METRICS GRID (4 columns)
  // ══════════════════════════════════════════════════════════════
  checkPageBreak(22);
  const metricW = (contentW - 9) / 4;
  const metrics = [
    { label: 'ATTENDANCE', value: `${analytics.attendanceRate}%`, score: analytics.attendanceRate },
    { label: 'TOTAL PRESENT', value: `${analytics.present}`, score: analytics.attendanceRate },
    { label: 'PUNCTUALITY', value: `${analytics.punctuality}%`, score: analytics.punctuality },
    { label: 'TOTAL ABSENT', value: `${analytics.absent}`, score: analytics.absent === 0 ? 90 : analytics.absent <= 2 ? 70 : 40 },
  ];

  metrics.forEach((m, i) => {
    const mx = margin + i * (metricW + 3);
    drawRoundedRect(mx, y, metricW, 18, 2, COLORS.lightBg, [230, 230, 230]);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.gray);
    doc.text(m.label, mx + metricW / 2, y + 5, { align: 'center' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...getScoreColor(m.score));
    doc.text(m.value, mx + metricW / 2, y + 13, { align: 'center' });
  });

  y += 22;

  // ══════════════════════════════════════════════════════════════
  // SESSION DISTRIBUTION BAR
  // ══════════════════════════════════════════════════════════════
  checkPageBreak(22);
  drawRoundedRect(margin, y, contentW, 20, 2, COLORS.white, [230, 230, 230]);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.darkGray);
  doc.text('SESSION DISTRIBUTION', margin + 4, y + 5);

  // Stacked bar
  const barX = margin + 4;
  const barY = y + 8;
  const barW = contentW - 8;
  const barH = 3.5;
  drawRoundedRect(barX, barY, barW, barH, barH / 2, [230, 230, 230]);

  let bx = barX;
  const segments = [
    { count: analytics.onTime, color: COLORS.emerald },
    { count: analytics.late, color: COLORS.amber },
    { count: analytics.absent, color: COLORS.red },
    { count: analytics.excused, color: COLORS.purple },
  ];
  for (const seg of segments) {
    if (seg.count > 0) {
      const segW = (seg.count / analytics.total) * barW;
      doc.setFillColor(...seg.color);
      doc.rect(bx, barY, Math.max(segW, 1), barH, 'F');
      bx += segW;
    }
  }

  // Legend
  const legendY = barY + barH + 3;
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  let lx = barX;
  const legendItems = [
    { label: `On Time ${analytics.onTime} (${Math.round((analytics.onTime / analytics.total) * 100)}%)`, color: COLORS.emerald },
    { label: `Late ${analytics.late} (${Math.round((analytics.late / analytics.total) * 100)}%)`, color: COLORS.amber },
    { label: `Absent ${analytics.absent} (${Math.round((analytics.absent / analytics.total) * 100)}%)`, color: COLORS.red },
  ];
  if (analytics.excused > 0) legendItems.push({ label: `Excused ${analytics.excused} (${Math.round((analytics.excused / analytics.total) * 100)}%)`, color: COLORS.purple });
  for (const item of legendItems) {
    doc.setFillColor(...item.color);
    doc.circle(lx + 1.5, legendY, 1.2, 'F');
    doc.setTextColor(...COLORS.gray);
    doc.text(item.label, lx + 4, legendY + 0.8);
    lx += doc.getTextWidth(item.label) + 8;
  }

  y += 24;

  // ══════════════════════════════════════════════════════════════
  // PERFORMANCE DNA (2 columns of stats)
  // ══════════════════════════════════════════════════════════════
  checkPageBreak(36);
  const dnaEntries: { label: string; value: string; color?: [number, number, number] }[] = [
    { label: 'Sessions Tracked', value: `${analytics.accountable} / ${analytics.total} total` },
    { label: 'Best Streak', value: `${analytics.maxStreak} consecutive`, color: COLORS.emerald },
    { label: 'First Half Rate', value: `${analytics.firstHalfRate}%` },
    { label: 'Second Half Rate', value: `${analytics.secondHalfRate}%`, color: analytics.secondHalfRate > analytics.firstHalfRate ? COLORS.emerald : analytics.secondHalfRate < analytics.firstHalfRate ? COLORS.red : undefined },
  ];
  if (analytics.late > 0) {
    dnaEntries.push({ label: 'Avg Late Duration', value: `${analytics.avgLateMinutes}min`, color: COLORS.amber });
    dnaEntries.push({ label: 'Late Quality Credit', value: `${Math.round(analytics.lateScoreAvg * 100)}%` });
  }
  if (analytics.coverageFactor < 1) {
    dnaEntries.push({ label: 'Coverage Factor', value: `${analytics.coverageFactor}`, color: analytics.coverageFactor < 0.8 ? [249, 115, 22] : undefined });
  }
  if (analytics.consecutive > 0) {
    dnaEntries.push({ label: 'Current Absence Streak', value: `${analytics.consecutive} sessions`, color: analytics.consecutive >= 3 ? COLORS.red : COLORS.amber });
  }

  const dnaH = 8 + Math.ceil(dnaEntries.length / 2) * 6;
  drawRoundedRect(margin, y, contentW, dnaH, 2, COLORS.white, [230, 230, 230]);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.darkGray);
  doc.text('PERFORMANCE DNA', margin + 4, y + 5);

  const col1X = margin + 4;
  const col2X = margin + contentW / 2 + 2;
  doc.setFontSize(7);

  dnaEntries.forEach((entry, i) => {
    const ex = i % 2 === 0 ? col1X : col2X;
    const ey = y + 10 + Math.floor(i / 2) * 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.gray);
    doc.text(entry.label, ex, ey);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(entry.color || COLORS.darkGray));
    doc.text(entry.value, ex + (contentW / 2 - 10), ey, { align: 'right' });
  });

  y += dnaH + 4;

  // ══════════════════════════════════════════════════════════════
  // AI INSIGHTS (the crown jewel)
  // ══════════════════════════════════════════════════════════════
  const insightItems = analytics.insights;
  if (insightItems.length > 0) {
    // Pre-calculate per-insight heights (accounting for text wrapping)
    doc.setFontSize(6.5);
    const insightMeasurements = insightItems.map(ins => {
      const lines: string[] = doc.splitTextToSize(ins.text, contentW - 16);
      const lineH = lines.length > 1 ? 4 + (lines.length - 1) * 3 : 4;
      return { ins, lines, rowH: lineH + 3 };
    });
    const insightH = 10 + insightMeasurements.reduce((s, m) => s + m.rowH, 0);
    checkPageBreak(Math.min(insightH, 100)); // check for at least the header + some items

    // Section header
    drawRoundedRect(margin, y, contentW, 8, 3, [250, 245, 255], [200, 180, 240]);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(109, 40, 217);
    doc.text('AI INSIGHTS', margin + 4, y + 5.5);
    y += 9;

    for (const { ins, lines, rowH } of insightMeasurements) {
      checkPageBreak(rowH + 2);
      const iconColor: [number, number, number] = ins.type === 'positive' ? COLORS.emerald : ins.type === 'danger' ? COLORS.red : ins.type === 'warning' ? COLORS.amber : COLORS.blue;
      const icon = ins.type === 'positive' ? '+' : ins.type === 'danger' ? '!' : ins.type === 'warning' ? '~' : 'i';
      const bgColor: [number, number, number] = ins.type === 'positive' ? [236, 253, 245] : ins.type === 'danger' ? [254, 242, 242] : ins.type === 'warning' ? [255, 251, 235] : [239, 246, 255];

      drawRoundedRect(margin + 3, y, contentW - 6, rowH, 1.5, bgColor);

      // Icon circle
      doc.setFillColor(...iconColor);
      doc.circle(margin + 7, y + rowH / 2, 1.8, 'F');
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(icon, margin + 7, y + rowH / 2 + 0.5, { align: 'center', baseline: 'middle' });

      // Multi-line text
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      const textColor: [number, number, number] = ins.type === 'danger' ? [185, 28, 28] : ins.type === 'warning' ? [180, 83, 9] : ins.type === 'positive' ? [5, 150, 105] : [29, 78, 216];
      doc.setTextColor(...textColor);
      lines.forEach((line: string, li: number) => {
        doc.text(line, margin + 12, y + 3 + li * 3);
      });

      y += rowH + 1;
    }

    y += 3;
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIVE ENROLLMENTS
  // ══════════════════════════════════════════════════════════════
  if (enrollments.length > 0) {
    const enrH = 9 + enrollments.length * 5.5;
    checkPageBreak(enrH);
    drawRoundedRect(margin, y, contentW, enrH, 2, COLORS.white, [230, 230, 230]);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.darkGray);
    doc.text(`ACTIVE ENROLLMENTS (${enrollments.length})`, margin + 4, y + 5.5);

    let ey = y + 10;
    for (const e of enrollments) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.darkGray);
      doc.text(sanitizeForPdf(e.courseName), margin + 4, ey);
      doc.setTextColor(...COLORS.gray);
      doc.text(sanitizeForPdf(e.teacherName), margin + contentW - 4, ey, { align: 'right' });
      ey += 5.5;
    }

    y += enrH + 4;
  }

  // ══════════════════════════════════════════════════════════════
  // FOOTER
  // ══════════════════════════════════════════════════════════════
  const footerY = 287;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY, margin + contentW, footerY);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 160, 160);
  doc.text(`Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`, margin, footerY + 3);
  doc.text('Training Center — Student Overview Report', margin + contentW, footerY + 3, { align: 'right' });

  // Save
  const safeName = (student.name || 'student').replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeName}_Overview_Report.pdf`);
}

// ══════════════════════════════════════════════════════════════
// ARABIC PDF EXPORT (html-to-image capture)
// Uses browser rendering for proper Arabic text shaping & RTL
// ══════════════════════════════════════════════════════════════

const arLabels: Record<string, string> = {
  'Student Overview Report': 'تقرير نظرة عامة على الطالب',
  'Weighted Score': 'الدرجة المرجحة',
  'Trend': 'الاتجاه',
  'Key Metrics': 'المقاييس الرئيسية',
  'Attendance': 'الحضور',
  'Total Present': 'إجمالي الحضور',
  'Punctuality': 'الالتزام بالوقت',
  'Total Absent': 'إجمالي الغياب',
  'Session Distribution': 'توزيع الجلسات',
  'On Time': 'في الوقت',
  'Late': 'متأخر',
  'Absent': 'غائب',
  'Excused': 'معذور',
  'Performance DNA': 'تحليل الأداء',
  'Sessions Tracked': 'الجلسات المسجلة',
  'Best Streak': 'أفضل سلسلة',
  'First Half Rate': 'معدل النصف الأول',
  'Second Half Rate': 'معدل النصف الثاني',
  'Avg Late Duration': 'متوسط مدة التأخر',
  'Late Quality Credit': 'رصيد جودة التأخر',
  'Coverage Factor': 'عامل التغطية',
  'Current Absence Streak': 'سلسلة الغياب الحالية',
  'sessions': 'جلسات',
  'consecutive': 'متتالي',
  'total': 'المجموع',
  'AI Insights': 'رؤى ذكية',
  'Active Enrollments': 'التسجيلات النشطة',
  'IMPROVING': 'تحسّن',
  'DECLINING': 'تراجع',
  'STABLE': 'مستقر',
  'VOLATILE': 'متذبذب',
  'Risk Level': 'مستوى الخطورة',
  'CRITICAL': 'حرج',
  'AT RISK': 'في خطر',
  'NEEDS ATTENTION': 'يحتاج اهتمام',
  'GOOD STANDING': 'وضع جيد',
  'Generated': 'تم الإنشاء',
  'Training Center': 'مركز التدريب',
};

function scoreHex(score: number): string {
  if (score >= 80) return '#10B981';
  if (score >= 60) return '#F59E0B';
  return '#EF4444';
}

function buildArabicReportHTML(options: ExportOptions): string {
  const { student, analytics, enrollments, riskLevel } = options;
  const t = (key: string) => arLabels[key] || key;

  const riskLabels: Record<string, string> = { critical: 'CRITICAL', high: 'AT RISK', medium: 'NEEDS ATTENTION', good: 'GOOD STANDING', unknown: 'N/A' };
  const riskColors: Record<string, string> = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B', good: '#10B981', unknown: '#6B7280' };
  const riskLabel = t(riskLabels[riskLevel] || 'N/A');
  const riskColor = riskColors[riskLevel] || '#6B7280';

  const initials = student.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const scoreColor = scoreHex(analytics.weightedScore);
  const formula = `Q${analytics.qualityRate}×${analytics.configWeights.q}% + A${analytics.attendanceRate}×${analytics.configWeights.a}% + P${analytics.punctuality}×${analytics.configWeights.p}%${analytics.coverageFactor < 1 ? ` × CF${analytics.coverageFactor}` : ''}`;

  const trendColors: Record<string, string> = { IMPROVING: '#10B981', DECLINING: '#EF4444', VOLATILE: '#8B5CF6', STABLE: '#6B7280' };
  const trendColor = trendColors[analytics.trendClassification] || '#6B7280';

  // Metrics grid
  const absentScore = analytics.absent === 0 ? 90 : analytics.absent <= 2 ? 70 : 40;
  const metrics = [
    { label: t('Attendance'), value: `${analytics.attendanceRate}%`, color: scoreHex(analytics.attendanceRate) },
    { label: t('Total Present'), value: `${analytics.present}`, color: scoreHex(analytics.attendanceRate) },
    { label: t('Punctuality'), value: `${analytics.punctuality}%`, color: scoreHex(analytics.punctuality) },
    { label: t('Total Absent'), value: `${analytics.absent}`, color: scoreHex(absentScore) },
  ];

  // Distribution
  const onTimePct = Math.round((analytics.onTime / analytics.total) * 100);
  const latePct = Math.round((analytics.late / analytics.total) * 100);
  const absentPct = Math.round((analytics.absent / analytics.total) * 100);
  const excusedPct = analytics.excused > 0 ? Math.round((analytics.excused / analytics.total) * 100) : 0;

  // Performance DNA entries
  const dnaEntries: { label: string; value: string; color: string }[] = [
    { label: t('Sessions Tracked'), value: `${analytics.accountable} / ${analytics.total} ${t('total')}`, color: '#1F2937' },
    { label: t('Best Streak'), value: `${analytics.maxStreak} ${t('consecutive')}`, color: '#10B981' },
    { label: t('First Half Rate'), value: `${analytics.firstHalfRate}%`, color: '#1F2937' },
    { label: t('Second Half Rate'), value: `${analytics.secondHalfRate}%`, color: analytics.secondHalfRate > analytics.firstHalfRate ? '#10B981' : analytics.secondHalfRate < analytics.firstHalfRate ? '#EF4444' : '#1F2937' },
  ];
  if (analytics.late > 0) {
    dnaEntries.push({ label: t('Avg Late Duration'), value: `${analytics.avgLateMinutes}min`, color: '#F59E0B' });
    dnaEntries.push({ label: t('Late Quality Credit'), value: `${Math.round(analytics.lateScoreAvg * 100)}%`, color: '#1F2937' });
  }
  if (analytics.coverageFactor < 1) {
    dnaEntries.push({ label: t('Coverage Factor'), value: `${analytics.coverageFactor}`, color: analytics.coverageFactor < 0.8 ? '#F97316' : '#1F2937' });
  }
  if (analytics.consecutive > 0) {
    dnaEntries.push({ label: t('Current Absence Streak'), value: `${analytics.consecutive} ${t('sessions')}`, color: analytics.consecutive >= 3 ? '#EF4444' : '#F59E0B' });
  }

  // Insight styling
  const insightBg: Record<string, string> = { positive: '#ECFDF5', danger: '#FEF2F2', warning: '#FFFBEB', info: '#EFF6FF' };
  const insightFg: Record<string, string> = { positive: '#059669', danger: '#B91C1C', warning: '#B45309', info: '#1D4ED8' };
  const insightIcon: Record<string, string> = { positive: '✅', danger: '🚨', warning: '⚠️', info: 'ℹ️' };

  return `
    <!-- Title -->
    <div style="text-align:center;margin-bottom:16px;">
      <span style="font-size:18px;font-weight:bold;color:#6D28D9;">${t('Student Overview Report')}</span>
    </div>

    <!-- Header Card -->
    <div style="background:#F5F3FF;border:1px solid #C8BEF0;border-radius:8px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px;">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#8B5CF6,#6D28D9);display:flex;align-items:center;justify-content:center;color:white;font-size:15px;font-weight:bold;flex-shrink:0;">
        ${initials}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:17px;font-weight:bold;color:#1F2937;">${student.name || 'Unknown'}</div>
        <div style="font-size:9px;color:#6B7280;margin-top:2px;">${[student.email, student.phone].filter(Boolean).join('  ·  ')}</div>
        <div style="display:flex;gap:5px;margin-top:5px;flex-wrap:wrap;">
          ${student.specialization ? `<span style="font-size:8px;padding:2px 6px;border-radius:10px;background:#EDE9FE;color:#6D28D9;font-weight:600;">${student.specialization}</span>` : ''}
          ${student.nationality ? `<span style="font-size:8px;padding:2px 6px;border-radius:10px;background:#E5E7EB;color:#6B7280;">${student.nationality}</span>` : ''}
          <span style="font-size:8px;padding:2px 6px;border-radius:10px;background:${riskColor};color:white;font-weight:700;">${riskLabel}</span>
        </div>
      </div>
    </div>

    <!-- Weighted Score Hero -->
    <div style="border:1px solid #E0E0E0;border-radius:8px;padding:12px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px;">
      <div style="width:44px;height:44px;border-radius:50%;background:${scoreColor};display:flex;align-items:center;justify-content:center;color:white;font-size:16px;font-weight:bold;flex-shrink:0;">
        ${analytics.weightedScore}
      </div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:bold;color:#1F2937;">${t('Weighted Score')}</div>
        <div style="font-size:8px;color:#9CA3AF;font-family:'Courier New',monospace;margin-top:2px;">${formula}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
          <span style="font-size:8px;padding:2px 6px;border-radius:3px;background:${trendColor};color:white;font-weight:700;">${t(analytics.trendClassification)}</span>
          ${analytics.weeklyChange !== 0 ? `<span style="font-size:8px;color:${analytics.weeklyChange > 0 ? '#10B981' : '#EF4444'};">${analytics.weeklyChange > 0 ? '+' : ''}${analytics.weeklyChange}%/wk</span>` : ''}
        </div>
      </div>
    </div>

    <!-- Key Metrics Grid -->
    <table style="width:100%;border-collapse:separate;border-spacing:5px;margin-bottom:14px;">
      <tr>
        ${metrics.map(m => `
          <td style="width:25%;background:#F9FAFB;border:1px solid #E6E6E6;border-radius:6px;text-align:center;padding:8px 4px;">
            <div style="font-size:7px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:600;">${m.label}</div>
            <div style="font-size:16px;font-weight:900;color:${m.color};margin-top:3px;">${m.value}</div>
          </td>
        `).join('')}
      </tr>
    </table>

    <!-- Session Distribution -->
    <div style="border:1px solid #E6E6E6;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
      <div style="font-size:8px;font-weight:bold;color:#1F2937;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${t('Session Distribution')}</div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:#E5E7EB;">
        <div style="width:${onTimePct}%;background:#10B981;"></div>
        <div style="width:${latePct}%;background:#F59E0B;"></div>
        <div style="width:${absentPct}%;background:#EF4444;"></div>
        ${excusedPct > 0 ? `<div style="width:${excusedPct}%;background:#A78BFA;"></div>` : ''}
      </div>
      <div style="display:flex;gap:12px;margin-top:6px;font-size:7px;color:#6B7280;">
        <span>🟢 ${t('On Time')}: ${analytics.onTime} (${onTimePct}%)</span>
        <span>🟡 ${t('Late')}: ${analytics.late} (${latePct}%)</span>
        <span>🔴 ${t('Absent')}: ${analytics.absent} (${absentPct}%)</span>
        ${analytics.excused > 0 ? `<span>🟣 ${t('Excused')}: ${analytics.excused} (${excusedPct}%)</span>` : ''}
      </div>
    </div>

    <!-- Performance DNA -->
    <div style="border:1px solid #E6E6E6;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
      <div style="font-size:8px;font-weight:bold;color:#1F2937;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${t('Performance DNA')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;">
        ${dnaEntries.map(e => `
          <div style="display:flex;justify-content:space-between;font-size:8px;padding:3px 0;border-bottom:1px solid #F3F4F6;">
            <span style="color:#6B7280;">${e.label}</span>
            <span style="font-weight:700;color:${e.color};">${e.value}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- AI Insights -->
    ${analytics.insights.length > 0 ? `
      <div style="border:1px solid #DDD6FE;border-radius:8px;padding:10px 14px;margin-bottom:14px;background:linear-gradient(135deg,#FAF5FF,#F5F3FF);">
        <div style="font-size:8px;font-weight:bold;color:#6D28D9;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🧠 ${t('AI Insights')}</div>
        ${analytics.insights.map(ins => `
          <div style="display:flex;align-items:flex-start;gap:6px;font-size:8px;padding:4px 8px;margin-bottom:4px;border-radius:4px;background:${insightBg[ins.type] || '#EFF6FF'};color:${insightFg[ins.type] || '#1D4ED8'};">
            <span style="flex-shrink:0;">${insightIcon[ins.type] || 'ℹ️'}</span>
            <span>${ins.text}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Active Enrollments -->
    ${enrollments.length > 0 ? `
      <div style="border:1px solid #E6E6E6;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
        <div style="font-size:8px;font-weight:bold;color:#1F2937;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${t('Active Enrollments')} (${enrollments.length})</div>
        ${enrollments.map(e => `
          <div style="display:flex;justify-content:space-between;font-size:8px;padding:3px 0;border-bottom:1px solid #F3F4F6;">
            <span style="color:#1F2937;font-weight:500;">${e.courseName}</span>
            <span style="color:#6B7280;">${e.teacherName}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Footer -->
    <div style="border-top:1px solid #E5E7EB;padding-top:8px;margin-top:12px;display:flex;justify-content:space-between;font-size:7px;color:#A0A0A0;">
      <span>${t('Generated')}: ${new Date().toLocaleString('ar', { dateStyle: 'long', timeStyle: 'short' })}</span>
      <span>${t('Training Center')} — ${t('Student Overview Report')}</span>
    </div>
  `;
}

async function exportArabicPDF(options: ExportOptions): Promise<void> {
  const { toPng } = await import('html-to-image');
  const { default: jsPDF } = await import('jspdf');
  const { student } = options;

  // Create offscreen styled container
  const container = document.createElement('div');
  container.setAttribute('dir', 'rtl');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:750px;background:#ffffff;padding:30px;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1F2937;line-height:1.5;';
  container.innerHTML = buildArabicReportHTML(options);
  document.body.appendChild(container);

  try {
    // Small delay for font rendering
    await new Promise(resolve => setTimeout(resolve, 150));

    const dataUrl = await toPng(container, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
    });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 190; // 210 - 2*10 margins
    const pageH = 277; // 297 - 2*10 margins

    // Load image to get dimensions
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });

    const imgH = (img.height * pageW) / img.width;

    if (imgH <= pageH) {
      doc.addImage(dataUrl, 'PNG', 10, 10, pageW, imgH);
    } else {
      // Multi-page: split into page-sized chunks
      const scaleFactor = pageW / img.width;
      const pageImgH = pageH / scaleFactor;
      let offset = 0;
      let pageNum = 0;

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      const sourceCtx = sourceCanvas.getContext('2d')!;
      sourceCtx.drawImage(img, 0, 0);

      while (offset < img.height) {
        if (pageNum > 0) doc.addPage();

        const sliceH = Math.min(pageImgH, img.height - offset);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = img.width;
        sliceCanvas.height = sliceH;
        const ctx = sliceCanvas.getContext('2d')!;
        ctx.drawImage(sourceCanvas, 0, offset, img.width, sliceH, 0, 0, img.width, sliceH);

        doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 10, 10, pageW, sliceH * scaleFactor);
        offset += pageImgH;
        pageNum++;
      }
    }

    const safeName = (student.name || 'student').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
    doc.save(`${safeName}_Overview_Report.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
