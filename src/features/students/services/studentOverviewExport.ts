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
  insights: { text: string; textAr?: string; type: 'positive' | 'warning' | 'danger' | 'info'; priority?: number }[];
  configWeights: { q: number; a: number; p: number };
}

interface EnrollmentInfo {
  courseName: string;
  teacherName: string;
  status: string;
}

interface AttendanceExportRecord {
  attendance_date: string;
  status: string;
  check_in_method?: string | null;
  late_minutes?: number | null;
  courseName: string;
}

interface CertificateExportRecord {
  certificate_number: string;
  courseName: string;
  status: 'draft' | 'issued' | 'revoked';
  final_score: number | null;
  attendance_rate: number | null;
  issued_at: string | null;
  signature_name: string | null;
  signature_title: string | null;
}

export type ExportSection = 'overview' | 'attendance' | 'certificates';

interface ExportOptions {
  student: Student;
  analytics: AnalyticsData;
  enrollments: EnrollmentInfo[];
  riskLevel: string;
  photoDataUrl?: string | null;
  sections: ExportSection[];
  attendanceRecords?: AttendanceExportRecord[];
  certificates?: CertificateExportRecord[];
  hostStats?: { hostCount: number; avgAttendance: number } | null;
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

/** Sanitize text for jsPDF — fix special characters, preserve Arabic if font loaded */
function sanitizeForPdf(text: string, arabicFontLoaded = false): string {
  if (!text) return '';
  // Replace em-dash, en-dash, smart quotes with ASCII equivalents
  const safe = text
    .replace(/\u2014/g, ' -- ')   // em-dash → --
    .replace(/\u2013/g, '-')      // en-dash → -
    .replace(/\u2192/g, '->')     // →
    .replace(/[\u2018\u2019]/g, "'")  // smart single quotes
    .replace(/[\u201C\u201D]/g, '"')  // smart double quotes
    .replace(/\u2026/g, '...')    // ellipsis
    .replace(/[\u00B2]/g, '2')    // superscript 2
    .replace(/\u00B0/g, 'deg');   // degree
  // If Arabic font is loaded, preserve Arabic characters
  if (arabicFontLoaded) {
    // Strip only emoji and control chars, keep Arabic + Latin
    return safe.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\uD800-\uDFFF]{2}|[\uD800-\uDFFF]/g, '').trim() || text;
  }
  // Fallback: strip non-Latin chars
  const hasNonLatin = /[^\u0020-\u024F\u1E00-\u1EFF]/.test(safe);
  if (!hasNonLatin) return safe;
  const latinParts = safe.replace(/[^\u0020-\u024F\u1E00-\u1EFF]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return latinParts || '(non-Latin text)';
}

/** Try to load an Arabic-capable font (Amiri) for jsPDF — returns base64 TTF */
let cachedArabicFont: string | null | 'failed' = null;
async function loadArabicFont(): Promise<string | null> {
  if (cachedArabicFont === 'failed') return null;
  if (cachedArabicFont) return cachedArabicFont;
  try {
    // Amiri Regular TTF from GitHub (lightweight Arabic font)
    const response = await fetch(
      'https://raw.githubusercontent.com/aliftype/amiri/main/Amiri-Regular.ttf'
    );
    if (!response.ok) { cachedArabicFont = 'failed'; return null; }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    cachedArabicFont = btoa(binary);
    return cachedArabicFont;
  } catch {
    cachedArabicFont = 'failed';
    return null;
  }
}

export async function exportStudentOverviewPDF(options: ExportOptions): Promise<void> {
  const { student, analytics, enrollments, riskLevel, photoDataUrl, sections, attendanceRecords, certificates, hostStats, arabicMode } = options;
  const { default: jsPDF } = await import('jspdf');

  // Load Arabic font if in Arabic mode
  let arabicFontLoaded = false;
  let arabicFontBase64: string | null = null;
  if (arabicMode) {
    arabicFontBase64 = await loadArabicFont();
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Register Arabic font if available
  if (arabicFontBase64) {
    doc.addFileToVFS('Amiri-Regular.ttf', arabicFontBase64);
    doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
    arabicFontLoaded = true;
  }

  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Helper Functions ──────────────────────────────────────────
  /** Sanitize and optionally set Arabic font for the given text */
  const s = (text: string) => sanitizeForPdf(text, arabicFontLoaded);

  /** Set font — use Amiri for Arabic text if available, otherwise helvetica */
  const setFont = (style: 'normal' | 'bold' = 'normal') => {
    if (arabicFontLoaded) {
      doc.setFont('Amiri', 'normal'); // Amiri only has normal weight loaded
    } else {
      doc.setFont('helvetica', style);
    }
  };

  const drawRoundedRect = (x: number, yPos: number, w: number, h: number, r: number, fillColor?: [number, number, number], strokeColor?: [number, number, number]) => {
    if (fillColor) doc.setFillColor(...fillColor);
    if (strokeColor) { doc.setDrawColor(...strokeColor); doc.setLineWidth(0.3); }
    doc.roundedRect(x, yPos, w, h, r, r, fillColor && strokeColor ? 'FD' : fillColor ? 'F' : 'S');
  };

  const addFooter = () => {
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      const footerY = 287;
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(margin, footerY, margin + contentW, footerY);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(160, 160, 160);
      doc.text(`Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`, margin, footerY + 3);
      doc.text(`Page ${p} of ${totalPages}`, margin + contentW / 2, footerY + 3, { align: 'center' });
      doc.text('Training Center — Student Report', margin + contentW, footerY + 3, { align: 'right' });
    }
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = margin;
    }
  };

  // ══════════════════════════════════════════════════════════════
  // HEADER: Student Identity (always rendered)
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
  setFont('bold');
  doc.setTextColor(...COLORS.darkGray);
  doc.text(s(student.name || 'Unknown'), textX, y + 10);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  const details = [student.email, student.phone].filter(Boolean).join('  ·  ');
  doc.text(details, textX, y + 16);

  // Badges
  let badgeX = textX;
  const badgeY = y + 22;
  if (student.specialization) {
    const specText = s(student.specialization);
    const specW = doc.getTextWidth(specText) + 6;
    drawRoundedRect(badgeX, badgeY, specW, 5, 2, [237, 233, 254]);
    doc.setFontSize(7);
    doc.setTextColor(109, 40, 217);
    doc.text(specText, badgeX + 3, badgeY + 3.5);
    badgeX += specW + 3;
  }
  if (student.nationality) {
    const natText = s(student.nationality);
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

  if (sections.includes('overview')) {
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
  const metricW = (contentW - 12) / 5;
  const metrics = [
    { label: 'ATTENDANCE', value: `${analytics.attendanceRate}%`, score: analytics.attendanceRate },
    { label: 'TOTAL PRESENT', value: `${analytics.present}`, score: analytics.attendanceRate },
    { label: 'PUNCTUALITY', value: `${analytics.punctuality}%`, score: analytics.punctuality },
    { label: 'ABSENT', value: `${analytics.absent}`, score: analytics.absent === 0 ? 90 : analytics.absent <= 2 ? 70 : 40 },
    { label: 'TOTAL ABSENT', value: `${analytics.absent + analytics.excused}`, score: (analytics.absent + analytics.excused) === 0 ? 90 : (analytics.absent + analytics.excused) <= 3 ? 70 : 40 },
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
  // HOST ACTIVITY (if student has hosted sessions)
  // ══════════════════════════════════════════════════════════════
  if (hostStats && hostStats.hostCount > 0) {
    checkPageBreak(22);
    const hostH = 18;
    drawRoundedRect(margin, y, contentW, hostH, 3, [236, 254, 255], [165, 243, 252]);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(14, 116, 144);
    doc.text('HOST ACTIVITY', margin + 4, y + 5.5);

    // Two stat boxes
    const boxW = (contentW - 16) / 2;
    const boxY = y + 8;

    // Times Hosted
    drawRoundedRect(margin + 4, boxY, boxW, 8, 2, COLORS.white);
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.gray);
    doc.text('TIMES HOSTED', margin + 4 + boxW / 2, boxY + 3, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(14, 116, 144);
    doc.text(String(hostStats.hostCount), margin + 4 + boxW / 2, boxY + 7, { align: 'center' });

    // Avg Attendance
    drawRoundedRect(margin + 4 + boxW + 8, boxY, boxW, 8, 2, COLORS.white);
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.gray);
    doc.text('AVG ATTENDANCE', margin + 4 + boxW + 8 + boxW / 2, boxY + 3, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const hostAttColor = getScoreColor(hostStats.avgAttendance);
    doc.setTextColor(...hostAttColor);
    doc.text(`${hostStats.avgAttendance}%`, margin + 4 + boxW + 8 + boxW / 2, boxY + 7, { align: 'center' });

    y += hostH + 4;
  }

  // ══════════════════════════════════════════════════════════════
  // AI INSIGHTS (the crown jewel)
  // ══════════════════════════════════════════════════════════════
  const insightItems = analytics.insights;
  if (insightItems.length > 0) {
    // Pre-calculate per-insight heights (accounting for text wrapping)
    doc.setFontSize(6.5);
    const insightMeasurements = insightItems.map(ins => {
      const sanitized = s(arabicMode && ins.textAr ? ins.textAr : ins.text);
      const lines: string[] = doc.splitTextToSize(sanitized, contentW - 16);
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
      setFont('normal');
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
      doc.text(s(e.courseName), margin + 4, ey);
      doc.setTextColor(...COLORS.gray);
      doc.text(s(e.teacherName), margin + contentW - 4, ey, { align: 'right' });
      ey += 5.5;
    }

    y += enrH + 4;
  }

  } // end sections.includes('overview')

  // ══════════════════════════════════════════════════════════════
  // ATTENDANCE RECORDS TABLE
  // ══════════════════════════════════════════════════════════════
  if (sections.includes('attendance') && attendanceRecords && attendanceRecords.length > 0) {
    // Section header on new page if overview was also included
    if (sections.includes('overview')) {
      doc.addPage();
      y = margin;
    }

    drawRoundedRect(margin, y, contentW, 8, 3, [240, 249, 255], [180, 220, 240]);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text(`ATTENDANCE RECORDS (${attendanceRecords.length})`, margin + 4, y + 5.5);
    y += 10;

    // Table header
    const colWidths = { date: 25, course: 52, status: 22, late: 18, method: contentW - 25 - 52 - 22 - 18 };
    checkPageBreak(10);
    drawRoundedRect(margin, y, contentW, 6, 1, [243, 244, 246]);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.gray);
    let hx = margin + 2;
    doc.text('DATE', hx, y + 4); hx += colWidths.date;
    doc.text('COURSE', hx, y + 4); hx += colWidths.course;
    doc.text('STATUS', hx, y + 4); hx += colWidths.status;
    doc.text('LATE', hx, y + 4); hx += colWidths.late;
    doc.text('METHOD', hx, y + 4);
    y += 7;

    // Table rows
    const statusColorMap: Record<string, [number, number, number]> = {
      'on time': COLORS.emerald,
      'late': COLORS.amber,
      'absent': COLORS.red,
      'excused': COLORS.purple,
      'not enrolled': COLORS.gray,
    };

    attendanceRecords.forEach((rec, i) => {
      checkPageBreak(6);
      // Alternate row background
      if (i % 2 === 0) {
        drawRoundedRect(margin, y, contentW, 5.5, 0, [250, 250, 252]);
      }

      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      let rx = margin + 2;

      // Date
      doc.setTextColor(...COLORS.darkGray);
      doc.text(rec.attendance_date, rx, y + 3.8); rx += colWidths.date;

      // Course
      doc.setTextColor(...COLORS.gray);
      const courseText = s(rec.courseName || '—');
      const truncCourse = courseText.length > 30 ? courseText.slice(0, 28) + '..' : courseText;
      doc.text(truncCourse, rx, y + 3.8); rx += colWidths.course;

      // Status
      const sColor = statusColorMap[rec.status] || COLORS.gray;
      doc.setTextColor(...sColor);
      doc.setFont('helvetica', 'bold');
      const statusLabel = rec.status === 'on time' ? 'On Time' : rec.status.charAt(0).toUpperCase() + rec.status.slice(1);
      doc.text(statusLabel, rx, y + 3.8); rx += colWidths.status;

      // Late minutes
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      doc.text(rec.status === 'late' && rec.late_minutes ? `${rec.late_minutes}m` : '—', rx, y + 3.8); rx += colWidths.late;

      // Method
      doc.text(rec.check_in_method || '—', rx, y + 3.8);

      y += 5.5;
    });

    y += 4;
  }

  // ══════════════════════════════════════════════════════════════
  // CERTIFICATES — Full-page professional certificate design
  // ══════════════════════════════════════════════════════════════
  if (sections.includes('certificates') && certificates && certificates.length > 0) {
    const validCerts = certificates.filter(c => c.status !== 'revoked');
    if (validCerts.length > 0) {
      if (sections.includes('overview') || sections.includes('attendance')) {
        doc.addPage();
        y = margin;
      }

      validCerts.forEach((cert, certIdx) => {
        if (certIdx > 0) { doc.addPage(); y = margin; }

        const certW = contentW;
        const certH = 250; // full page height
        const accentColor: [number, number, number] = cert.status === 'issued' ? [30, 64, 175] : [180, 83, 9];
        const accentLight: [number, number, number] = cert.status === 'issued' ? [239, 246, 255] : [255, 251, 235];
        const cx = margin + certW / 2;

        // ── Outer frame ──
        drawRoundedRect(margin, y, certW, certH, 4, COLORS.white, accentColor);
        // ── Inner border (double-border effect) ──
        doc.setDrawColor(...accentColor);
        doc.setLineWidth(0.2);
        doc.roundedRect(margin + 4, y + 4, certW - 8, certH - 8, 3, 3, 'S');

        // ── Corner decorations ──
        const cornerLen = 18;
        doc.setLineWidth(0.6);
        doc.setDrawColor(...accentColor);
        const corners = [
          { x: margin + 8, y: y + 8, dx: 1, dy: 1 },
          { x: margin + certW - 8, y: y + 8, dx: -1, dy: 1 },
          { x: margin + 8, y: y + certH - 8, dx: 1, dy: -1 },
          { x: margin + certW - 8, y: y + certH - 8, dx: -1, dy: -1 },
        ];
        for (const c of corners) {
          doc.line(c.x, c.y, c.x + cornerLen * c.dx, c.y);
          doc.line(c.x, c.y, c.x, c.y + cornerLen * c.dy);
        }

        // ── Status badge (top-right) ──
        const statusBg: [number, number, number] = cert.status === 'issued' ? [220, 252, 231] : [254, 249, 195];
        const statusFg: [number, number, number] = cert.status === 'issued' ? [5, 150, 105] : [180, 83, 9];
        const badgeW = 24;
        drawRoundedRect(margin + certW - badgeW - 12, y + 10, badgeW, 7, 3, statusBg);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...statusFg);
        doc.text(cert.status.toUpperCase(), margin + certW - 12 - badgeW / 2, y + 14.5, { align: 'center' });

        let cy = y + 40;

        // ── CERTIFICATE title ──
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...accentColor);
        doc.text('CERTIFICATE', cx, cy, { align: 'center' });
        cy += 10;

        // ── "of Completion" subtitle ──
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.gray);
        doc.text('of Completion', cx, cy, { align: 'center' });
        cy += 10;

        // ── Decorative divider with diamond ──
        const divW = 55;
        doc.setDrawColor(...accentColor);
        doc.setLineWidth(0.4);
        doc.line(cx - divW, cy, cx - 4, cy);
        doc.line(cx + 4, cy, cx + divW, cy);
        // Diamond shape
        doc.setFillColor(...accentColor);
        const dSize = 1.5;
        doc.triangle(cx, cy - dSize, cx + dSize, cy, cx, cy + dSize, 'F');
        doc.triangle(cx, cy - dSize, cx - dSize, cy, cx, cy + dSize, 'F');
        cy += 14;

        // ── Photo or initials circle ──
        if (photoDataUrl) {
          try {
            // Draw circular clip area approximation using rounded rect
            doc.addImage(photoDataUrl, 'JPEG', cx - 14, cy - 2, 28, 28);
          } catch { /* skip */ }
          cy += 30;
        } else {
          doc.setFillColor(...accentColor);
          doc.circle(cx, cy + 10, 12, 'F');
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          const initials = (student.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
          doc.text(initials, cx, cy + 11.5, { align: 'center', baseline: 'middle' });
          cy += 28;
        }

        // ── Student name ──
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.darkGray);
        doc.text(s(student.name || 'Unknown'), cx, cy, { align: 'center' });
        cy += 10;

        // ── Course name ──
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.gray);
        doc.text(s(cert.courseName), cx, cy, { align: 'center' });
        cy += 16;

        // ── Score & Attendance badges ──
        const badgeGap = 8;
        let bx = cx - 30 - badgeGap / 2;
        if (cert.final_score != null) {
          drawRoundedRect(bx, cy - 4, 30, 14, 3, accentLight);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...COLORS.gray);
          doc.text('Score', bx + 15, cy + 1, { align: 'center' });
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...getScoreColor(cert.final_score));
          doc.text(`${cert.final_score}%`, bx + 15, cy + 7, { align: 'center' });
          bx += 30 + badgeGap;
        }
        if (cert.attendance_rate != null) {
          drawRoundedRect(bx, cy - 4, 30, 14, 3, accentLight);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...COLORS.gray);
          doc.text('Attendance', bx + 15, cy + 1, { align: 'center' });
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...getScoreColor(cert.attendance_rate));
          doc.text(`${cert.attendance_rate}%`, bx + 15, cy + 7, { align: 'center' });
        }
        cy += 22;

        // ── Issued date ──
        if (cert.issued_at) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...COLORS.gray);
          doc.text(new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), cx, cy, { align: 'center' });
          cy += 14;
        }

        // ── Signature block ──
        if (cert.signature_name) {
          doc.setDrawColor(180, 180, 180);
          doc.setLineWidth(0.3);
          doc.line(cx - 35, cy, cx + 35, cy);
          cy += 5;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...COLORS.darkGray);
          doc.text(s(cert.signature_name), cx, cy, { align: 'center' });
          if (cert.signature_title) {
            cy += 5;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...COLORS.gray);
            doc.text(s(cert.signature_title), cx, cy, { align: 'center' });
          }
        }

        // ── Certificate number & generation date (bottom) ──
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(180, 180, 180);
        doc.text(`#${cert.certificate_number}`, margin + 10, y + certH - 10);
        doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, margin + certW - 10, y + certH - 10, { align: 'right' });
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FOOTER (all pages)
  // ══════════════════════════════════════════════════════════════
  addFooter();

  // Save
  const sectionNames = sections.filter(s => {
    if (s === 'certificates' && (!certificates || certificates.filter(c => c.status !== 'revoked').length === 0)) return false;
    if (s === 'attendance' && (!attendanceRecords || attendanceRecords.length === 0)) return false;
    return true;
  });
  const suffix = sectionNames.length === 1 ? sectionNames[0].charAt(0).toUpperCase() + sectionNames[0].slice(1) : 'Full';
  const safeName = (student.name || 'student').replace(/[^a-zA-Z0-9]/g, '_');
  doc.save(`${safeName}_${suffix}_Report.pdf`);
}
