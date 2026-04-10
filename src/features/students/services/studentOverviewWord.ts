/**
 * Student Overview Word Export
 * Generates a professional A4 Word document matching the frontend Overview tab design.
 * Supports Arabic text natively via docx library's built-in Unicode handling.
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
  arabicMode?: boolean;
}

function getScoreHex(score: number): string {
  if (score >= 80) return '10B981';
  if (score >= 60) return 'F59E0B';
  return 'EF4444';
}

const ar: Record<string, string> = {
  'Student Overview Report': 'تقرير نظرة عامة على الطالب',
  'Weighted Score': 'الدرجة المرجحة',
  'Trend': 'الاتجاه',
  'Key Metrics': 'المقاييس الرئيسية',
  'Attendance': 'الحضور',
  'Punctuality': 'الالتزام بالوقت',
  'Best Streak': 'أفضل سلسلة',
  'Session Distribution': 'توزيع الجلسات',
  'On Time': 'في الوقت',
  'Late': 'متأخر',
  'Absent': 'غائب',
  'Excused': 'معذور',
  'Performance DNA': 'تحليل الأداء',
  'Sessions Tracked': 'الجلسات المسجلة',
  'First Half Rate': 'معدل النصف الأول',
  'Second Half Rate': 'معدل النصف الثاني',
  'Avg Late Duration': 'متوسط مدة التأخر',
  'Late Quality Credit': 'رصيد جودة التأخر',
  'Coverage Factor': 'عامل التغطية',
  'Current Absence Streak': 'سلسلة الغياب الحالية',
  'sessions': 'جلسات',
  'consecutive': 'متتالي',
  'AI Insights': 'رؤى ذكية',
  'Active Enrollments': 'التسجيلات النشطة',
  'Total Present': 'إجمالي الحضور',
  'Total Absent': 'إجمالي الغياب',
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

export async function exportStudentOverviewWord(options: ExportOptions): Promise<void> {
  const { student, analytics, enrollments, riskLevel, arabicMode } = options;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
    BorderStyle, HeadingLevel, ShadingType } = await import('docx');

  const t = (key: string) => arabicMode ? (ar[key] || key) : key;
  const bidi = arabicMode;

  const riskLabels: Record<string, string> = { critical: 'CRITICAL', high: 'AT RISK', medium: 'NEEDS ATTENTION', good: 'GOOD STANDING', unknown: 'N/A' };
  const riskLabel = t(riskLabels[riskLevel] || 'N/A');

  // ── Helper: create a metric cell ──
  const metricCell = (label: string, value: string, color: string) =>
    new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: 'F9FAFB' },
      margins: { top: 80, bottom: 80, left: 60, right: 60 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [
          new TextRun({ text: label, size: 14, color: '6B7280', font: 'Calibri', bold: true }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: value, size: 28, bold: true, color, font: 'Calibri' }),
        ]}),
      ],
    });

  // ── Helper: DNA row ──
  const dnaRow = (label: string, value: string, valueColor = '1F2937') =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          children: [new Paragraph({ children: [new TextRun({ text: label, size: 18, color: '6B7280', font: 'Calibri' })] })],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: value, size: 18, bold: true, color: valueColor, font: 'Calibri' })] })],
        }),
      ],
    });

  const insightIcon: Record<string, string> = { positive: '[+]', danger: '[!]', warning: '[~]', info: '[i]' };
  const insightColor: Record<string, string> = { positive: '059669', danger: 'B91C1C', warning: 'B45309', info: '1D4ED8' };

  const sections: InstanceType<typeof Paragraph>[] = [];

  // ══════════════════════════════════════════════════════════════
  // HEADER
  // ══════════════════════════════════════════════════════════════
  sections.push(
    new Paragraph({ spacing: { after: 80 }, bidirectional: bidi, children: [
      new TextRun({ text: student.name || 'Unknown', size: 32, bold: true, color: '1F2937', font: 'Calibri' }),
    ]}),
    new Paragraph({ spacing: { after: 60 }, bidirectional: bidi, children: [
      new TextRun({ text: [student.email, student.phone].filter(Boolean).join('  ·  '), size: 16, color: '6B7280', font: 'Calibri' }),
    ]}),
  );

  const badges: InstanceType<typeof TextRun>[] = [];
  if (student.specialization) badges.push(new TextRun({ text: `[${student.specialization}]`, size: 16, color: '6D28D9', font: 'Calibri' }));
  if (student.nationality) badges.push(new TextRun({ text: `  [${student.nationality}]`, size: 16, color: '6B7280', font: 'Calibri' }));
  badges.push(new TextRun({ text: `  ${t('Risk Level')}: ${riskLabel}`, size: 16, bold: true, color: riskLevel === 'good' ? '10B981' : riskLevel === 'critical' ? 'EF4444' : riskLevel === 'high' ? 'F97316' : 'F59E0B', font: 'Calibri' }));
  sections.push(new Paragraph({ spacing: { after: 200 }, bidirectional: bidi, children: badges }));

  // ══════════════════════════════════════════════════════════════
  // WEIGHTED SCORE
  // ══════════════════════════════════════════════════════════════
  sections.push(
    new Paragraph({ spacing: { after: 60 }, bidirectional: bidi, children: [
      new TextRun({ text: `${t('Weighted Score')}: `, size: 24, bold: true, color: '1F2937', font: 'Calibri' }),
      new TextRun({ text: String(analytics.weightedScore), size: 32, bold: true, color: getScoreHex(analytics.weightedScore), font: 'Calibri' }),
    ]}),
    new Paragraph({ spacing: { after: 60 }, bidirectional: bidi, children: [
      new TextRun({ text: `Q${analytics.qualityRate}×${analytics.configWeights.q}% + A${analytics.attendanceRate}×${analytics.configWeights.a}% + P${analytics.punctuality}×${analytics.configWeights.p}%${analytics.coverageFactor < 1 ? ` × CF${analytics.coverageFactor}` : ''}`, size: 14, color: '9CA3AF', font: 'Courier New' }),
    ]}),
    new Paragraph({ spacing: { after: 200 }, bidirectional: bidi, children: [
      new TextRun({ text: `${t('Trend')}: ${t(analytics.trendClassification)}`, size: 16, bold: true, color: analytics.trendClassification === 'IMPROVING' ? '10B981' : analytics.trendClassification === 'DECLINING' ? 'EF4444' : '6B7280', font: 'Calibri' }),
      ...(analytics.weeklyChange !== 0 ? [new TextRun({ text: `  (${analytics.weeklyChange > 0 ? '+' : ''}${analytics.weeklyChange}%/wk)`, size: 16, color: analytics.weeklyChange > 0 ? '10B981' : 'EF4444', font: 'Calibri' })] : []),
    ]}),
  );

  // ══════════════════════════════════════════════════════════════
  // KEY METRICS TABLE (4 columns)
  // ══════════════════════════════════════════════════════════════
  sections.push(
    new Paragraph({ spacing: { after: 100 }, heading: HeadingLevel.HEADING_2, bidirectional: bidi, children: [
      new TextRun({ text: t('Key Metrics'), size: 22, bold: true, color: '1F2937', font: 'Calibri' }),
    ]}),
  );

  sections.push(new Paragraph({
    children: [], spacing: { after: 0 },
  }));

  const metricsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          metricCell(t('Attendance'), `${analytics.attendanceRate}%`, getScoreHex(analytics.attendanceRate)),
          metricCell(t('Total Present'), `${analytics.present}`, getScoreHex(analytics.attendanceRate)),
          metricCell(t('Punctuality'), `${analytics.punctuality}%`, getScoreHex(analytics.punctuality)),
          metricCell(t('Total Absent'), `${analytics.absent}`, analytics.absent === 0 ? '10B981' : analytics.absent <= 2 ? 'F59E0B' : 'EF4444'),
        ],
      }),
    ],
  });

  // ══════════════════════════════════════════════════════════════
  // SESSION DISTRIBUTION
  // ══════════════════════════════════════════════════════════════
  const distItems = [
    `${t('On Time')}: ${analytics.onTime} (${Math.round((analytics.onTime / analytics.total) * 100)}%)`,
    `${t('Late')}: ${analytics.late} (${Math.round((analytics.late / analytics.total) * 100)}%)`,
    `${t('Absent')}: ${analytics.absent} (${Math.round((analytics.absent / analytics.total) * 100)}%)`,
  ];
  if (analytics.excused > 0) distItems.push(`${t('Excused')}: ${analytics.excused} (${Math.round((analytics.excused / analytics.total) * 100)}%)`);

  // ══════════════════════════════════════════════════════════════
  // PERFORMANCE DNA
  // ══════════════════════════════════════════════════════════════
  const dnaRows: InstanceType<typeof TableRow>[] = [
    dnaRow(t('Sessions Tracked'), `${analytics.accountable} / ${analytics.total}`),
    dnaRow(t('Best Streak'), `${analytics.maxStreak} ${t('consecutive')}`, '10B981'),
    dnaRow(t('First Half Rate'), `${analytics.firstHalfRate}%`),
    dnaRow(t('Second Half Rate'), `${analytics.secondHalfRate}%`, analytics.secondHalfRate > analytics.firstHalfRate ? '10B981' : analytics.secondHalfRate < analytics.firstHalfRate ? 'EF4444' : '1F2937'),
  ];
  if (analytics.late > 0) {
    dnaRows.push(dnaRow(t('Avg Late Duration'), `${analytics.avgLateMinutes}min`, 'F59E0B'));
    dnaRows.push(dnaRow(t('Late Quality Credit'), `${Math.round(analytics.lateScoreAvg * 100)}%`));
  }
  if (analytics.coverageFactor < 1) {
    dnaRows.push(dnaRow(t('Coverage Factor'), `${analytics.coverageFactor}`, analytics.coverageFactor < 0.8 ? 'F97316' : '1F2937'));
  }
  if (analytics.consecutive > 0) {
    dnaRows.push(dnaRow(t('Current Absence Streak'), `${analytics.consecutive} ${t('sessions')}`, analytics.consecutive >= 3 ? 'EF4444' : 'F59E0B'));
  }

  const dnaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: dnaRows,
  });

  // ══════════════════════════════════════════════════════════════
  // AI INSIGHTS
  // ══════════════════════════════════════════════════════════════
  const insightParagraphs: InstanceType<typeof Paragraph>[] = [];
  if (analytics.insights.length > 0) {
    insightParagraphs.push(
      new Paragraph({ spacing: { before: 200, after: 100 }, heading: HeadingLevel.HEADING_2, bidirectional: bidi, children: [
        new TextRun({ text: `🧠 ${t('AI Insights')}`, size: 22, bold: true, color: '6D28D9', font: 'Calibri' }),
      ]}),
    );
    for (const ins of analytics.insights) {
      const icon = insightIcon[ins.type] || '[i]';
      const color = insightColor[ins.type] || '1D4ED8';
      insightParagraphs.push(
        new Paragraph({ spacing: { after: 60 }, indent: { left: 200 }, bidirectional: bidi, children: [
          new TextRun({ text: `${icon} `, size: 16, bold: true, color, font: 'Calibri' }),
          new TextRun({ text: ins.text, size: 16, color, font: 'Calibri' }),
        ]}),
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ACTIVE ENROLLMENTS
  // ══════════════════════════════════════════════════════════════
  const enrollmentParagraphs: InstanceType<typeof Paragraph>[] = [];
  if (enrollments.length > 0) {
    enrollmentParagraphs.push(
      new Paragraph({ spacing: { before: 200, after: 100 }, heading: HeadingLevel.HEADING_2, bidirectional: bidi, children: [
        new TextRun({ text: `${t('Active Enrollments')} (${enrollments.length})`, size: 22, bold: true, color: '1F2937', font: 'Calibri' }),
      ]}),
    );
    for (const e of enrollments) {
      enrollmentParagraphs.push(
        new Paragraph({ spacing: { after: 40 }, bidirectional: bidi, children: [
          new TextRun({ text: e.courseName, size: 18, color: '1F2937', font: 'Calibri' }),
          new TextRun({ text: `  —  ${e.teacherName}`, size: 18, color: '6B7280', font: 'Calibri' }),
        ]}),
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FOOTER
  // ══════════════════════════════════════════════════════════════
  const footerLine = new Paragraph({ spacing: { before: 300 }, bidirectional: bidi, children: [
    new TextRun({ text: `${t('Generated')}: ${new Date().toLocaleString(arabicMode ? 'ar' : 'en-US', { dateStyle: 'long', timeStyle: 'short' })}  —  ${t('Training Center')}`, size: 14, color: 'A0A0A0', font: 'Calibri' }),
  ]});

  // ══════════════════════════════════════════════════════════════
  // BUILD DOCUMENT
  // ══════════════════════════════════════════════════════════════
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 720, bottom: 720, left: 720, right: 720 },
        },
      },
      children: [
        // Title
        new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.CENTER, bidirectional: bidi, children: [
          new TextRun({ text: t('Student Overview Report'), size: 28, bold: true, color: '6D28D9', font: 'Calibri' }),
        ]}),
        ...sections,
        metricsTable,
        // Distribution
        new Paragraph({ spacing: { before: 200, after: 100 }, heading: HeadingLevel.HEADING_2, bidirectional: bidi, children: [
          new TextRun({ text: t('Session Distribution'), size: 22, bold: true, color: '1F2937', font: 'Calibri' }),
        ]}),
        new Paragraph({ spacing: { after: 100 }, bidirectional: bidi, children: distItems.map((item, i) =>
          new TextRun({ text: i > 0 ? `    ${item}` : item, size: 18, color: '374151', font: 'Calibri' }) as InstanceType<typeof TextRun>
        )}),
        // DNA
        new Paragraph({ spacing: { before: 200, after: 100 }, heading: HeadingLevel.HEADING_2, bidirectional: bidi, children: [
          new TextRun({ text: t('Performance DNA'), size: 22, bold: true, color: '1F2937', font: 'Calibri' }),
        ]}),
        dnaTable,
        ...insightParagraphs,
        ...enrollmentParagraphs,
        footerLine,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = (student.name || 'student').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}_Overview_Report.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
