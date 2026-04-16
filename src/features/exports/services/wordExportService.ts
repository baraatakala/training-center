/**
 * Word Export Service with Full Arabic Support & Premium Enhancements
 * Export attendance analytics and records to Word (.docx) format
 * Features: RTL support, color themes, AI insights, progress bars, trend indicators
 * Version: 2.0 - Enhanced Edition
 */

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  HeadingLevel,
  convertInchesToTwip,
  Header,
  Footer,
  PageNumber,
  ShadingType,
  PageOrientation,
  ImageRun,
} from 'docx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

// ===== COLOR THEMES =====
export interface DocumentTheme {
  name: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  neutral: string;
  headerBg: string;
}

export const THEMES: Record<string, DocumentTheme> = {
  professional: {
    name: 'Professional',
    primary: '1e3a8a',
    secondary: '3b82f6',
    success: '10b981',
    warning: 'f59e0b',
    danger: 'ef4444',
    neutral: '6b7280',
    headerBg: 'd9e1f2',
  },
  modern: {
    name: 'Modern',
    primary: '7c3aed',
    secondary: 'a78bfa',
    success: '34d399',
    warning: 'fbbf24',
    danger: 'f87171',
    neutral: '9ca3af',
    headerBg: 'ede9fe',
  },
  academic: {
    name: 'Academic',
    primary: '0c4a6e',
    secondary: '0284c7',
    success: '059669',
    warning: 'd97706',
    danger: 'dc2626',
    neutral: '64748b',
    headerBg: 'dbeafe',
  },
};

// ===== AI INSIGHTS =====
export interface AnalyticsInsight {
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  icon: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  metric: string;
}

export interface AttendanceExportData {
  date: string;
  student_name: string;
  student_email: string;
  session_name: string;
  location: string;
  status: string;
  check_in_time: string | null;
  marked_at: string;
  marked_by: string | null;
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
}

export interface StudentSummaryData {
  rank: number;
  student_name: string;
  on_time: number;
  late: number;
  present_total: number;
  unexcused_absent: number;
  excused: number;
  effective_days: number;
  days_covered: number;
  attendance_rate: number;
  punctuality_rate: number;
  weighted_score: number;
}

export interface DateAnalyticsData {
  date: string;
  book_topic: string;
  book_pages: string;
  host_address: string;
  on_time: number;
  late: number;
  excused: number;
  absent: number;
  attendance_rate: number;
  on_time_names: string;
  late_names: string;
  excused_names: string;
  absent_names: string;
}

export interface HostRankingData {
  rank: number;
  host_name: string;
  total_hosted: number;
  dates: string;
  present: number;
  absent: number;
  excused: number;
  late: number;
  attendance_rate: number;
}

export interface ExportOptions {
  theme?: DocumentTheme;
  includeInsights?: boolean;
  includeExecutiveSummary?: boolean;
  includeProgressBars?: boolean;
  includeTrendIndicators?: boolean;
  enableConditionalColoring?: boolean;  // Whether to apply color-coding to percentage/score cells
  coloringTheme?: 'default' | 'traffic' | 'heatmap' | 'status';  // Color theme for conditional formatting
  // Per-type coloring overrides (when provided, override the global enableConditionalColoring/coloringTheme)
  perTypeColoring?: {
    studentAnalytics?: { enabled: boolean; theme: 'default' | 'traffic' | 'heatmap' | 'status'; colorColumns?: number[] };
    dateAnalytics?: { enabled: boolean; theme: 'default' | 'traffic' | 'heatmap' | 'status'; colorColumns?: number[] };
    hostAnalytics?: { enabled: boolean; theme: 'default' | 'traffic' | 'heatmap' | 'status'; colorColumns?: number[] };
    specializationAnalytics?: { enabled: boolean; theme: 'default' | 'traffic' | 'heatmap' | 'status'; colorColumns?: number[] };
  };
  // Cross-tab matrix data for Student × Date table
  crosstabData?: {
    headers: string[];
    rows: string[][];
  };
  // Specialization analytics data
  specializationData?: Record<string, unknown>[];
  specializationHeaders?: string[];
  // Chart images (base64 data URLs) and layout settings
  chartImages?: Record<string, string>;
  layoutSettings?: {
    tableFontSize?: number;
    sectionSpacing?: number;
    chartWidth?: number;
    pageBreakBetweenTables?: boolean;
    // AdvancedExportBuilder layout settings
    headerBgColor?: string;
    headerFontSizePt?: number;
    bodyFontSizePt?: number;
    showGridlines?: boolean;
    alternateRowColors?: boolean;
    rowDensity?: 'compact' | 'normal' | 'comfortable';
  };
}

export class WordExportService {
  private defaultTheme: DocumentTheme = THEMES.professional;

  /**
   * Generate AI-powered insights from student data
   */
  private generateInsights(data: StudentSummaryData[]): AnalyticsInsight[] {
    const insights: AnalyticsInsight[] = [];

    if (data.length === 0) return insights;

    // Insight 1: Top Performers
    const topPerformers = data.filter((s) => s.attendance_rate >= 95).length;
    if (topPerformers > 0) {
      insights.push({
        type: 'positive',
        icon: '🌟',
        title: `${topPerformers} Excellent ${topPerformers === 1 ? 'Performer' : 'Performers'}`,
        titleAr: `${topPerformers} أداء ممتاز`,
        description: `${topPerformers} ${topPerformers === 1 ? 'student' : 'students'} achieved 95%+ attendance rate. Outstanding commitment to learning!`,
        descriptionAr: `${topPerformers} طالب حققوا معدل حضور 95% أو أكثر. التزام متميز بالتعلم!`,
        metric: '≥95%',
      });
    }

    // Insight 2: Perfect Attendance
    const perfect = data.filter((s) => s.attendance_rate === 100).length;
    if (perfect > 0) {
      insights.push({
        type: 'positive',
        icon: '🏆',
        title: `${perfect} Perfect Attendance`,
        titleAr: `${perfect} حضور كامل`,
        description: `${perfect} ${perfect === 1 ? 'student' : 'students'} achieved 100% attendance. Exceptional dedication!`,
        descriptionAr: `${perfect} طلاب حققوا حضور 100%. تفاني استثنائي!`,
        metric: '100%',
      });
    }

    // Insight 3: At-Risk Students
    const atRisk = data.filter((s) => s.attendance_rate < 70).length;
    if (atRisk > 0) {
      insights.push({
        type: 'warning',
        icon: '⚠️',
        title: `${atRisk} ${atRisk === 1 ? 'Student Needs' : 'Students Need'} Attention`,
        titleAr: `${atRisk} طلاب بحاجة لاهتمام`,
        description: `${atRisk} ${atRisk === 1 ? 'student has' : 'students have'} attendance below 70%. Immediate intervention recommended.`,
        descriptionAr: `${atRisk} طلاب لديهم حضور أقل من 70%. يُنصح بالتدخل الفوري.`,
        metric: '<70%',
      });
    }

    // Insight 4: Punctuality Analysis
    const avgPunctuality =
      data.reduce((sum, s) => sum + s.punctuality_rate, 0) / data.length;
    if (avgPunctuality < 80) {
      insights.push({
        type: 'warning',
        icon: '⏰',
        title: 'Late Arrivals Issue',
        titleAr: 'مشكلة التأخير',
        description: `Average punctuality is ${avgPunctuality.toFixed(
          1
        )}%. Focus needed on on-time arrivals.`,
        descriptionAr: `متوسط الالتزام بالوقت ${avgPunctuality.toFixed(
          1
        )}%. يحتاج التركيز على الحضور في الوقت المحدد.`,
        metric: `${avgPunctuality.toFixed(1)}%`,
      });
    } else if (avgPunctuality >= 90) {
      insights.push({
        type: 'positive',
        icon: '⏱️',
        title: 'Excellent Punctuality',
        titleAr: 'التزام ممتاز بالوقت',
        description: `Average punctuality is ${avgPunctuality.toFixed(
          1
        )}%. Students demonstrate excellent time management.`,
        descriptionAr: `متوسط الالتزام بالوقت ${avgPunctuality.toFixed(
          1
        )}%. الطلاب يظهرون إدارة ممتازة للوقت.`,
        metric: `${avgPunctuality.toFixed(1)}%`,
      });
    }

    // Insight 5: Class Size Analysis
    if (data.length < 10) {
      insights.push({
        type: 'neutral',
        icon: '👥',
        title: 'Small Class Size',
        titleAr: 'حجم صف صغير',
        description: `Class has ${data.length} students. Ideal for personalized attention and engagement.`,
        descriptionAr: `الصف يحتوي على ${data.length} طلاب. مثالي للاهتمام الشخصي والمشاركة.`,
        metric: `${data.length} students`,
      });
    } else if (data.length > 30) {
      insights.push({
        type: 'neutral',
        icon: '👥',
        title: 'Large Class Size',
        titleAr: 'حجم صف كبير',
        description: `Class has ${data.length} students. Consider additional support for optimal engagement.`,
        descriptionAr: `الصف يحتوي على ${data.length} طلاب. النظر في دعم إضافي للمشاركة المثالية.`,
        metric: `${data.length} students`,
      });
    }

    // Insight 6: Overall Performance
    const avgAttendance =
      data.reduce((sum, s) => sum + s.attendance_rate, 0) / data.length;
    if (avgAttendance >= 85) {
      insights.push({
        type: 'positive',
        icon: '📊',
        title: 'Strong Class Performance',
        titleAr: 'أداء قوي للصف',
        description: `Class average attendance is ${avgAttendance.toFixed(
          1
        )}%. Excellent overall engagement.`,
        descriptionAr: `متوسط حضور الصف ${avgAttendance.toFixed(
          1
        )}%. مشاركة عامة ممتازة.`,
        metric: `${avgAttendance.toFixed(1)}%`,
      });
    } else if (avgAttendance < 70) {
      insights.push({
        type: 'negative',
        icon: '📉',
        title: 'Low Class Attendance',
        titleAr: 'حضور منخفض للصف',
        description: `Class average is ${avgAttendance.toFixed(
          1
        )}%. Urgent review of attendance policies needed.`,
        descriptionAr: `متوسط الصف ${avgAttendance.toFixed(
          1
        )}%. مراجعة عاجلة لسياسات الحضور مطلوبة.`,
        metric: `${avgAttendance.toFixed(1)}%`,
      });
    }

    return insights;
  }

  /**
   * Create insights section with colored backgrounds
   */
  private createInsightsSection(
    insights: AnalyticsInsight[],
    isArabic: boolean,
    theme: DocumentTheme
  ): (Paragraph | Table)[] {
    if (insights.length === 0) return [];

    const elements: (Paragraph | Table)[] = [];

    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: isArabic ? '💡 رؤى تحليلية ذكية' : '💡 Smart Insights',
            bold: true,
            size: 32,
            color: theme.primary,
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 400, after: 200 },
        bidirectional: isArabic,
        keepNext: true,
        keepLines: true,
      })
    );

    insights.forEach((insight) => {
      const bgColor = {
        positive: 'd1fae5',
        negative: 'fee2e2',
        warning: 'fef3c7',
        neutral: 'f3f4f6',
      }[insight.type];

      const borderColor = {
        positive: theme.success,
        negative: theme.danger,
        warning: theme.warning,
        neutral: theme.neutral,
      }[insight.type];

      // Title with icon
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${insight.icon} `,
              size: 28,
            }),
            new TextRun({
              text: isArabic ? insight.titleAr : insight.title,
              bold: true,
              size: 24,
              color: borderColor,
            }),
            new TextRun({
              text: ` [${insight.metric}]`,
              size: 22,
              color: '666666',
              italics: true,
            }),
          ],
          alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { before: 200, after: 100 },
          shading: {
            type: ShadingType.CLEAR,
            fill: bgColor,
            color: bgColor,
          },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 12,
              color: borderColor,
            },
          },
          bidirectional: isArabic,
        })
      );

      // Description
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: isArabic ? insight.descriptionAr : insight.description,
              size: 22,
            }),
          ],
          alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { after: 150, before: 50 },
          indent: { left: convertInchesToTwip(0.3) },
          bidirectional: isArabic,
        })
      );
    });

    elements.push(new Paragraph({ text: '', spacing: { after: 300 } }));

    return elements;
  }

  /**
   * Create progress bar visualization
   */
  private createProgressBar(
    percentage: number,
    label: string,
    labelAr: string,
    isArabic: boolean,
    theme: DocumentTheme
  ): Table {
    const barWidth = Math.min(Math.max(Math.round(percentage), 0), 100);
    const emptyWidth = 100 - barWidth;

    const color =
      percentage >= 90
        ? theme.success
        : percentage >= 75
        ? theme.secondary
        : percentage >= 60
        ? theme.warning
        : theme.danger;

    return new Table({
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: isArabic ? labelAr : label,
                      size: 22,
                      bold: true,
                    }),
                  ],
                  alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  bidirectional: isArabic,
                }),
              ],
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                right: { style: BorderStyle.NONE, size: 0 },
              },
            }),
            // Filled portion
            new TableCell({
              children: [new Paragraph({ text: '' })],
              width: { size: barWidth * 0.6, type: WidthType.PERCENTAGE },
              shading: {
                type: ShadingType.CLEAR,
                fill: color,
                color: color,
              },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                left: { style: BorderStyle.NONE, size: 0 },
                right: { style: BorderStyle.NONE, size: 0 },
              },
            }),
            // Empty portion
            new TableCell({
              children: [new Paragraph({ text: '' })],
              width: { size: emptyWidth * 0.6, type: WidthType.PERCENTAGE },
              shading: {
                type: ShadingType.CLEAR,
                fill: 'f3f4f6',
                color: 'f3f4f6',
              },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                left: { style: BorderStyle.NONE, size: 0 },
                right: { style: BorderStyle.NONE, size: 0 },
              },
            }),
            // Percentage
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `${percentage.toFixed(1)}%`,
                      size: 22,
                      bold: true,
                      color: color,
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: 15, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
                left: { style: BorderStyle.NONE, size: 0 },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
              },
            }),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      margins: {
        top: convertInchesToTwip(0.05),
        bottom: convertInchesToTwip(0.05),
      },
    });
  }

  /**
   * Create executive summary with key metrics
   */
  private createExecutiveSummary(
    studentData: StudentSummaryData[],
    isArabic: boolean,
    theme: DocumentTheme
  ): (Paragraph | Table)[] {
    if (studentData.length === 0) return [];

    const elements: (Paragraph | Table)[] = [];

    // Title
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: isArabic ? '📋 الملخص التنفيذي' : '📋 Executive Summary',
            bold: true,
            size: 36,
            color: theme.primary,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 300 },
        bidirectional: isArabic,
        keepNext: true,
        keepLines: true,
      })
    );

    // Calculate metrics
    const totalStudents = studentData.length;
    const avgAttendance =
      studentData.reduce((sum, s) => sum + s.attendance_rate, 0) /
      totalStudents;
    const avgPunctuality =
      studentData.reduce((sum, s) => sum + s.punctuality_rate, 0) /
      totalStudents;
    const topPerformer = studentData.sort(
      (a, b) => b.weighted_score - a.weighted_score
    )[0];
    const perfectAttendance = studentData.filter(
      (s) => s.attendance_rate === 100
    ).length;
    const atRisk = studentData.filter((s) => s.attendance_rate < 70).length;

    // Metrics grid
    const metricsTable = new Table({
      rows: [
        // Row 1
        new TableRow({
          cantSplit: true,
          children: [
            this.createMetricCell(
              '📊',
              totalStudents.toString(),
              'Total Students',
              'إجمالي الطلاب',
              isArabic,
              theme.secondary
            ),
            this.createMetricCell(
              '✅',
              `${avgAttendance.toFixed(1)}%`,
              'Avg Attendance',
              'متوسط الحضور',
              isArabic,
              avgAttendance >= 85 ? theme.success : theme.warning
            ),
          ],
        }),
        // Row 2
        new TableRow({
          cantSplit: true,
          children: [
            this.createMetricCell(
              '🏆',
              topPerformer?.student_name || 'N/A',
              'Top Performer',
              'الأفضل أداءً',
              isArabic,
              theme.primary
            ),
            this.createMetricCell(
              '⏱️',
              `${avgPunctuality.toFixed(1)}%`,
              'Avg Punctuality',
              'متوسط الالتزام',
              isArabic,
              avgPunctuality >= 85 ? theme.success : theme.warning
            ),
          ],
        }),
        // Row 3
        new TableRow({
          cantSplit: true,
          children: [
            this.createMetricCell(
              '⭐',
              perfectAttendance.toString(),
              'Perfect Attendance',
              'حضور كامل',
              isArabic,
              theme.success
            ),
            this.createMetricCell(
              '⚠️',
              atRisk.toString(),
              'At Risk',
              'في خطر',
              isArabic,
              theme.danger
            ),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    });

    elements.push(metricsTable);
    elements.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Progress bars
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: isArabic ? '📈 مؤشرات الأداء' : '📈 Performance Indicators',
            bold: true,
            size: 28,
            color: theme.primary,
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 200, after: 200 },
        bidirectional: isArabic,
        keepNext: true,
        keepLines: true,
      })
    );

    elements.push(
      this.createProgressBar(
        avgAttendance,
        'Overall Attendance',
        'الحضور العام',
        isArabic,
        theme
      )
    );
    elements.push(new Paragraph({ text: '', spacing: { after: 100 } }));

    elements.push(
      this.createProgressBar(
        avgPunctuality,
        'Punctuality Rate',
        'معدل الالتزام بالوقت',
        isArabic,
        theme
      )
    );
    elements.push(new Paragraph({ text: '', spacing: { after: 100 } }));

    const onTimeRate =
      (studentData.reduce((sum, s) => sum + s.on_time, 0) /
        studentData.reduce((sum, s) => sum + s.present_total, 0)) *
      100;
    elements.push(
      this.createProgressBar(
        onTimeRate,
        'On-Time Rate',
        'معدل الحضور في الوقت',
        isArabic,
        theme
      )
    );
    elements.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    return elements;
  }

  /**
   * Create metric cell for executive summary
   */
  private createMetricCell(
    icon: string,
    value: string,
    label: string,
    labelAr: string,
    isArabic: boolean,
    color: string
  ): TableCell {
    return new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: `${icon}  ${value}`,
              bold: true,
              size: 32,
              color: color,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 150, after: 80 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: isArabic ? labelAr : label,
              size: 20,
              color: '666666',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 150 },
          bidirectional: isArabic,
        }),
      ],
      shading: {
        type: ShadingType.CLEAR,
        fill: 'f9fafb',
        color: 'f9fafb',
      },
      margins: {
        top: convertInchesToTwip(0.3),
        bottom: convertInchesToTwip(0.3),
        left: convertInchesToTwip(0.2),
        right: convertInchesToTwip(0.2),
      },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'e5e7eb' },
      },
      width: { size: 50, type: WidthType.PERCENTAGE },
    });
  }
  /**
   * Create a styled heading paragraph
   */
  private createHeading(
    text: string,
    level: typeof HeadingLevel[keyof typeof HeadingLevel],
    isArabic: boolean = false,
    theme?: DocumentTheme
  ): Paragraph {
    return new Paragraph({
      text,
      heading: level,
      alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 200, before: 200 },
      bidirectional: isArabic,
      keepNext: true,  // Keep heading with the following table/content
      keepLines: true, // Keep all lines of heading together
      shading: theme
        ? {
            type: ShadingType.CLEAR,
            fill: theme.headerBg,
            color: theme.headerBg,
          }
        : undefined,
    });
  }

  /**
   * Create a normal paragraph with optional RTL support
   */
  private createParagraph(text: string, isArabic: boolean = false): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text,
          font: isArabic ? 'Arial' : 'Calibri',
          size: 22,
        }),
      ],
      alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 100 },
      bidirectional: isArabic,
    });
  }

  /**
   * Get cell background color based on percentage value
   */
  private getColorForPercentage(value: number, theme: DocumentTheme): string {
    if (value >= 90) return theme.success;      // Excellent (Green)
    if (value >= 75) return theme.secondary;    // Good (Blue)
    if (value >= 60) return theme.warning;      // Moderate (Yellow)
    return theme.danger;                        // Needs attention (Red)
  }

  /**
   * Create a color legend for conditional formatting
   */
  private createColorLegend(isArabic: boolean, theme: DocumentTheme): Table {
    const legendItems = isArabic ? [
      { label: '90%+ ممتاز', color: theme.success },
      { label: '75-89% جيد', color: theme.secondary },
      { label: '60-74% متوسط', color: theme.warning },
      { label: '<60% يحتاج تحسين', color: theme.danger },
    ] : [
      { label: '90%+ Excellent', color: theme.success },
      { label: '75-89% Good', color: theme.secondary },
      { label: '60-74% Moderate', color: theme.warning },
      { label: '<60% Needs Attention', color: theme.danger },
    ];

    return new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: isArabic ? '🎨 دليل الألوان:' : '🎨 Color Legend:',
                      bold: true,
                      size: 20,
                    }),
                  ],
                  alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  bidirectional: isArabic,
                }),
              ],
              borders: {
                top: { style: BorderStyle.NONE, size: 0 },
                bottom: { style: BorderStyle.NONE, size: 0 },
                left: { style: BorderStyle.NONE, size: 0 },
                right: { style: BorderStyle.NONE, size: 0 },
              },
            }),
            ...legendItems.map(item => new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item.label,
                      size: 18,
                      color: 'FFFFFF',
                      bold: true,
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              shading: {
                type: ShadingType.CLEAR,
                fill: item.color,
                color: item.color,
              },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: item.color },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: item.color },
                left: { style: BorderStyle.SINGLE, size: 1, color: item.color },
                right: { style: BorderStyle.SINGLE, size: 1, color: item.color },
              },
            })),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  /**
   * Create a table with proper styling, RTL support, and conditional formatting
   */
  private createTable(
    headers: string[],
    rows: string[][],
    isArabic: boolean = false,
    theme?: DocumentTheme,
    colorColumns?: number[],  // Column indices to apply percentage coloring
    tableFontSize?: number,   // Font size in pt (default: header 11, body 10)
    layoutOptions?: {
      headerFontSizePt?: number;
      headerBgColor?: string;
      showGridlines?: boolean;
      alternateRowColors?: boolean;
      rowDensity?: 'compact' | 'normal' | 'comfortable';
    }
  ): Table {
    const activeTheme = theme || this.defaultTheme;
    // Header font size: prefer layoutOptions.headerFontSizePt, then derive from tableFontSize
    const headerSizeHp = layoutOptions?.headerFontSizePt
      ? layoutOptions.headerFontSizePt * 2
      : tableFontSize ? tableFontSize * 2 + 2 : 22; // half-points
    const bodySizeHp = tableFontSize ? tableFontSize * 2 : 20;       // half-points

    // Header background: prefer layoutOptions.headerBgColor, then theme
    const headerBgColor = layoutOptions?.headerBgColor || activeTheme.primary;

    // Gridlines: default true
    const showGridlines = layoutOptions?.showGridlines !== false;
    const borderStyle = showGridlines
      ? { style: BorderStyle.SINGLE, size: 1, color: '000000' }
      : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

    // Alternate row colors: default true
    const useAlternateRows = layoutOptions?.alternateRowColors !== false;

    // Row density → cell margin in twips (1 twip = 1/1440 inch)
    const densityMarginMap = { compact: 20, normal: 60, comfortable: 120 };
    const cellMarginTwips = densityMarginMap[layoutOptions?.rowDensity || 'normal'];

    // Create header row with theme color
    const headerRow = new TableRow({
      cantSplit: true,
      tableHeader: true,
      children: headers.map(
        (header) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: header,
                    bold: true,
                    font: isArabic ? 'Arial' : 'Calibri',
                    size: headerSizeHp,
                    color: 'FFFFFF',
                  }),
                ],
                alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.CENTER,
                bidirectional: isArabic,
              }),
            ],
            shading: {
              type: ShadingType.CLEAR,
              fill: headerBgColor,
              color: headerBgColor,
            },
            borders: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
            margins: {
              top: cellMarginTwips,
              bottom: cellMarginTwips,
              left: cellMarginTwips + 30,
              right: cellMarginTwips + 30,
            },
          })
      ),
    });

    // Create data rows with conditional formatting
    const dataRows = rows.map((row, rowIndex) =>
      new TableRow({
        cantSplit: true,
        children: row.map(
          (cell, cellIndex) => {
            // Determine cell background color
            let cellBgColor: string;
            let textColor = '000000'; // Default black text
            
            // Check if this column should have percentage-based coloring
            if (colorColumns && colorColumns.includes(cellIndex)) {
              // Extract percentage value (remove % sign)
              const percentMatch = cell.match(/^(\d+\.?\d*)%?$/);
              if (percentMatch) {
                const percentValue = parseFloat(percentMatch[1]);
                cellBgColor = this.getColorForPercentage(percentValue, activeTheme);
                textColor = 'FFFFFF'; // White text for colored backgrounds
              } else {
                // Use zebra striping if not a percentage
                cellBgColor = useAlternateRows && rowIndex % 2 !== 0 ? 'F9FAFB' : 'FFFFFF';
              }
            } else {
              // Zebra striping (or plain white if disabled)
              cellBgColor = useAlternateRows && rowIndex % 2 !== 0 ? 'F9FAFB' : 'FFFFFF';
            }

            return new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      font: isArabic ? 'Arial' : 'Calibri',
                      size: bodySizeHp,
                      color: textColor,
                      bold: colorColumns && colorColumns.includes(cellIndex) && cell.includes('%'),
                    }),
                  ],
                  alignment:
                    isArabic || cellIndex === 0
                      ? isArabic
                        ? AlignmentType.RIGHT
                        : AlignmentType.LEFT
                      : AlignmentType.CENTER,
                  bidirectional: isArabic,
                }),
              ],
              shading: {
                type: ShadingType.CLEAR,
                fill: cellBgColor,
                color: cellBgColor,
              },
              borders: {
                top: borderStyle,
                bottom: borderStyle,
                left: borderStyle,
                right: borderStyle,
              },
              margins: {
                top: cellMarginTwips,
                bottom: cellMarginTwips,
                left: cellMarginTwips + 30,
                right: cellMarginTwips + 30,
              },
            });
          }
        ),
      })
    );

    return new Table({
      rows: [headerRow, ...dataRows],
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
    });
  }

  /**
   * Export attendance records to Word document
   */
  async exportAttendanceToWord(
    data: AttendanceExportData[],
    isArabic: boolean = false,
    filename?: string
  ): Promise<void> {
    const headers = isArabic
      ? [
          'التاريخ',
          'اسم الطالب',
          'البريد الإلكتروني',
          'الجلسة',
          'الموقع',
          'الحالة',
          'وقت الحضور',
          'ملاحظات',
        ]
      : [
          'Date',
          'Student Name',
          'Email',
          'Session',
          'Location',
          'Status',
          'Check-In Time',
          'Notes',
        ];

    const rows = data.map((record) => [
      record.date,
      record.student_name,
      record.student_email,
      record.session_name,
      record.location,
      record.status.toUpperCase(),
      record.check_in_time || 'N/A',
      record.notes || '',
    ]);

    const titleText = isArabic
      ? 'تقرير سجلات الحضور'
      : 'Attendance Records Report';
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd')}`
      : `Report Date: ${format(new Date(), 'yyyy-MM-dd')}`;
    const summaryText = isArabic
      ? `إجمالي السجلات: ${data.length}`
      : `Total Records: ${data.length}`;

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                right: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(0.75),
              },
            },
          },
          children: [
            this.createHeading(titleText, HeadingLevel.HEADING_1, isArabic),
            this.createParagraph(dateText, isArabic),
            this.createParagraph(summaryText, isArabic),
            new Paragraph({ text: '', spacing: { after: 200 } }),
            this.createTable(headers, rows, isArabic),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const fileName = filename || (isArabic
      ? `سجلات_الحضور_${format(new Date(), 'yyyy-MM-dd')}.docx`
      : `attendance-records-${format(new Date(), 'yyyy-MM-dd')}.docx`);
    saveAs(blob, fileName);
  }

  /**
   * Export analytics report to Word document with ALL fields from Excel/PDF
   */
  async exportAnalyticsToWord(
    studentData: StudentSummaryData[],
    dateData: DateAnalyticsData[],
    hostData: HostRankingData[],
    summaryStats: {
      totalStudents: number;
      totalSessions: number;
      classAvgRate: number;
      avgWeightedScore: number;
      avgAttendanceByDate: number;
      medianRateByDate: number;
      totalPresent: number;
      totalAbsent: number;
      totalExcused: number;
      totalLate: number;
    },
    isArabic: boolean = false,
    startDate?: string,
    endDate?: string,
    filename?: string,
    options?: ExportOptions
  ): Promise<void> {
    // Apply theme and options (default to false for cleaner reports)
    const theme = options?.theme || this.defaultTheme;
    const includeInsights = options?.includeInsights ?? false;
    const includeExecutiveSummary = options?.includeExecutiveSummary ?? false;
    const includeProgressBars = options?.includeProgressBars ?? false;

    const sections: (Paragraph | Table)[] = [];

    // Title and Date Info
    const titleText = isArabic ? 'تقرير تحليل الحضور الشامل' : 'Comprehensive Attendance Analytics Report';
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
      : `Report Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
    const dateRangeText = startDate && endDate
      ? (isArabic 
        ? `الفترة: ${format(new Date(startDate), 'yyyy-MM-dd')} - ${format(new Date(endDate), 'yyyy-MM-dd')}`
        : `Date Range: ${format(new Date(startDate), 'MMM dd, yyyy')} - ${format(new Date(endDate), 'MMM dd, yyyy')}`)
      : '';

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: titleText,
            bold: true,
            size: 40,
            color: theme.primary,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        bidirectional: isArabic,
        keepNext: true,
        keepLines: true,
      })
    );
    sections.push(this.createParagraph(dateText, isArabic));
    if (dateRangeText) {
      sections.push(this.createParagraph(dateRangeText, isArabic));
    }
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Executive Summary (NEW)
    if (includeExecutiveSummary && studentData.length > 0) {
      sections.push(...this.createExecutiveSummary(studentData, isArabic, theme));
    }

    // AI Insights (NEW)
    if (includeInsights && studentData.length > 0) {
      const insights = this.generateInsights(studentData);
      sections.push(...this.createInsightsSection(insights, isArabic, theme));
    }

    // Summary Statistics Section
    const summaryTitle = isArabic ? '📊 الإحصائيات العامة' : '📊 Summary Statistics';
    sections.push(
      this.createHeading(summaryTitle, HeadingLevel.HEADING_2, isArabic, theme)
    );

    // Progress Bars for Key Metrics (NEW)
    if (includeProgressBars) {
      sections.push(
        this.createProgressBar(
          summaryStats.classAvgRate,
          'Class Average Attendance',
          'متوسط حضور الصف',
          isArabic,
          theme
        )
      );
      sections.push(new Paragraph({ text: '', spacing: { after: 100 } }));

      sections.push(
        this.createProgressBar(
          summaryStats.avgAttendanceByDate,
          'Attendance by Date',
          'الحضور حسب التاريخ',
          isArabic,
          theme
        )
      );
      sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    const summaryHeaders = isArabic
      ? ['العنصر', 'القيمة']
      : ['Metric', 'Value'];
    const summaryRows = isArabic ? [
      ['عدد الطلاب', summaryStats.totalStudents.toString()],
      ['إجمالي الجلسات', summaryStats.totalSessions.toString()],
      ['معدل الصف', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['متوسط النقاط المرجحة', summaryStats.avgWeightedScore.toFixed(1)],
      ['متوسط الحضور حسب التاريخ', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['الوسيط لمعدل الحضور حسب التاريخ', `${summaryStats.medianRateByDate.toFixed(1)}%`],
      ['إجمالي الحاضرين', summaryStats.totalPresent.toString()],
      ['إجمالي الغياب', summaryStats.totalAbsent.toString()],
      ['إجمالي الأعذار', summaryStats.totalExcused.toString()],
      ['إجمالي المتأخرين', summaryStats.totalLate.toString()],
    ] : [
      ['Total Students', summaryStats.totalStudents.toString()],
      ['Total Sessions', summaryStats.totalSessions.toString()],
      ['Class Avg Rate', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['Avg Weighted Score', summaryStats.avgWeightedScore.toFixed(1)],
      ['Avg Attendance by Date', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['Median Rate by Date', `${summaryStats.medianRateByDate.toFixed(1)}%`],
      ['Total Present', summaryStats.totalPresent.toString()],
      ['Total Absent', summaryStats.totalAbsent.toString()],
      ['Total Excused', summaryStats.totalExcused.toString()],
      ['Total Late', summaryStats.totalLate.toString()],
    ];

    sections.push(this.createTable(summaryHeaders, summaryRows, isArabic, theme));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Student Performance Section
    const studentTitle = isArabic ? '👨‍🎓 أداء الطلاب' : '👨‍🎓 Student Performance';
    sections.push(
      this.createHeading(studentTitle, HeadingLevel.HEADING_2, isArabic, theme)
    );

    const studentHeaders = isArabic
      ? [
          'الترتيب',
          'اسم الطالب',
          'في الوقت',
          'متأخر',
          'حاضر',
          'غائب',
          'معذور',
          'الأيام الفعلية',
          'الأيام المغطاة',
          'معدل الحضور %',
          'معدل الالتزام %',
          'النقاط',
        ]
      : [
          'Rank',
          'Student Name',
          'On Time',
          'Late',
          'Present',
          'Absent',
          'Excused',
          'Effective Days',
          'Days Covered',
          'Attendance %',
          'Punctuality %',
          'Score',
        ];
    
    const studentRows = studentData.map((s) => [
      s.rank.toString(),
      s.student_name,
      s.on_time.toString(),
      s.late.toString(),
      s.present_total.toString(),
      s.unexcused_absent.toString(),
      s.excused.toString(),
      s.effective_days.toString(),
      s.days_covered.toString(),
      `${s.attendance_rate.toFixed(1)}%`,
      `${s.punctuality_rate.toFixed(1)}%`,
      s.weighted_score.toFixed(1),
    ]);

    // Apply color to columns: Attendance % (index 9), Punctuality % (index 10), and Score (index 11)
    sections.push(this.createTable(studentHeaders, studentRows, isArabic, theme, [9, 10, 11]));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Date-wise Attendance Section
    const dateTitle = isArabic
      ? '📅 الحضور حسب التاريخ'
      : '📅 Attendance by Date';
    sections.push(
      this.createHeading(dateTitle, HeadingLevel.HEADING_2, isArabic, theme)
    );

    // Split into two tables for better readability
    // Table 1: Statistics
    const dateStatsHeaders = isArabic
      ? [
          'التاريخ',
          'تقدم الكتاب',
          'عنوان المضيف',
          'في الوقت',
          'متأخر',
          'معذور',
          'غائب',
          'النسبة %',
        ]
      : [
          'Date',
          'Book Progress',
          'Host Address',
          'On Time',
          'Late',
          'Excused',
          'Absent',
          'Rate %',
        ];
    
    const dateStatsRows = dateData.map((d) => {
      // Combine topic and pages into one field
      const bookProgress = d.book_topic !== '-' && d.book_pages !== '-'
        ? `${d.book_topic} (p.${d.book_pages})`
        : d.book_topic !== '-'
        ? d.book_topic
        : '-';
      
      return [
        d.date,
        bookProgress,
        d.host_address,
        d.on_time.toString(),
        d.late.toString(),
        d.excused.toString(),
        d.absent.toString(),
        `${d.attendance_rate.toFixed(1)}%`,
      ];
    });

    // Apply color to Rate % column (index 7)
    sections.push(this.createTable(dateStatsHeaders, dateStatsRows, isArabic, theme, [7]));
    sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

    // Table 2: Student Names by Status
    const dateNamesTitle = isArabic 
      ? 'أسماء الطلاب حسب الحالة'
      : 'Student Names by Status';
    sections.push(
      this.createHeading(dateNamesTitle, HeadingLevel.HEADING_3, isArabic, theme)
    );

    const dateNamesHeaders = isArabic
      ? [
          'التاريخ',
          'في الوقت',
          'متأخر',
          'معذور',
          'غائب',
        ]
      : [
          'Date',
          'On Time',
          'Late',
          'Excused',
          'Absent',
        ];
    
    const dateNamesRows = dateData.map((d) => [
      d.date,
      d.on_time_names,
      d.late_names,
      d.excused_names,
      d.absent_names,
    ]);

    sections.push(this.createTable(dateNamesHeaders, dateNamesRows, isArabic, theme));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Host Rankings Section
    if (hostData.length > 0) {
      const hostTitle = isArabic
        ? '🏠 تصنيف المضيفين'
        : '🏠 Host Rankings';
      sections.push(
        this.createHeading(hostTitle, HeadingLevel.HEADING_2, isArabic, theme)
      );

      const hostHeaders = isArabic
        ? [
            'الرتبة',
            'عنوان المضيف',
            'عدد المرات',
            'في الوقت',
            'متأخر',
            'معذور',
            'غائب',
            'معدل الحضور %',
            'التواريخ',
          ]
        : [
            'Rank',
            'Host Address',
            'Times Hosted',
            'On Time',
            'Late',
            'Excused',
            'Absent',
            'Attendance %',
            'Dates',
          ];
      
      const hostRows = hostData.map((h) => [
        h.rank.toString(),
        h.host_name,
        h.total_hosted.toString(),
        h.present.toString(),
        h.late.toString(),
        h.excused.toString(),
        h.absent.toString(),
        `${h.attendance_rate.toFixed(1)}%`,
        h.dates,
      ]);

      // Apply color to Attendance % column (index 7)
      sections.push(this.createTable(hostHeaders, hostRows, isArabic, theme, [7]));
    }

    // Create document with header and footer
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1.25),
                right: convertInchesToTwip(0.5),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(0.5),
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: isArabic 
                        ? '📊 تقرير تحليل الحضور' 
                        : '📊 Attendance Analytics Report',
                      bold: true,
                      size: 24,
                      color: theme.primary,
                    }),
                  ],
                  alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  border: {
                    bottom: { 
                      style: BorderStyle.SINGLE, 
                      size: 6, 
                      color: theme.secondary 
                    },
                  },
                  spacing: { after: 100 },
                  bidirectional: isArabic,
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: isArabic 
                        ? `تم إنشاؤه في ${format(new Date(), 'yyyy-MM-dd')} • صفحة `
                        : `Generated on ${format(new Date(), 'MMM dd, yyyy')} • Page `,
                      size: 18,
                      color: '6b7280',
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 18,
                    }),
                    new TextRun({ 
                      text: isArabic ? ' من ' : ' of ', 
                      size: 18,
                      color: '6b7280',
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 18,
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  border: {
                    top: { 
                      style: BorderStyle.SINGLE, 
                      size: 6, 
                      color: 'e5e7eb' 
                    },
                  },
                  spacing: { before: 100 },
                }),
              ],
            }),
          },
          children: sections,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const fileName = filename || (isArabic
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.docx`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.docx`);
    saveAs(blob, fileName);
  }

  /**
   * Export student summary to Word document with all fields
   */
  async exportStudentSummaryToWord(
    data: StudentSummaryData[],
    isArabic: boolean = false,
    filename?: string
  ): Promise<void> {
    const titleText = isArabic
      ? 'ملخص أداء الطلاب'
      : 'Student Performance Summary';
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd')}`
      : `Report Date: ${format(new Date(), 'yyyy-MM-dd')}`;

    const headers = isArabic
      ? [
          'الترتيب',
          'اسم الطالب',
          'في الوقت',
          'متأخر',
          'حاضر',
          'غائب',
          'معذور',
          'معدل الحضور',
        ]
      : [
          'Rank',
          'Student Name',
          'On Time',
          'Late',
          'Present',
          'Absent',
          'Excused',
          'Attendance Rate',
        ];

    const rows = data.map((s) => [
      s.rank.toString(),
      s.student_name,
      s.on_time.toString(),
      s.late.toString(),
      s.present_total.toString(),
      s.unexcused_absent.toString(),
      s.excused.toString(),
      `${s.attendance_rate.toFixed(1)}%`,
    ]);

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                right: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(0.75),
              },
            },
          },
          children: [
            this.createHeading(titleText, HeadingLevel.HEADING_1, isArabic),
            this.createParagraph(dateText, isArabic),
            new Paragraph({ text: '', spacing: { after: 200 } }),
            this.createTable(headers, rows, isArabic),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const fileName = filename || (isArabic
      ? `ملخص_الطلاب_${format(new Date(), 'yyyy-MM-dd')}.docx`
      : `student-summary-${format(new Date(), 'yyyy-MM-dd')}.docx`);
    saveAs(blob, fileName);
  }

  /**
   * Export a generic table to Word document
   * Used by AdvancedExportBuilder for custom exports
   */
  async exportTableToWord(
    headers: string[],
    rows: string[][],
    title: string,
    subtitle: string = '',
    isArabic: boolean = false,
    filename?: string,
    colorColumns?: number[],  // Column indices to apply conditional coloring
    colorTheme?: 'default' | 'traffic' | 'heatmap' | 'status',  // Color theme for conditional formatting
    layoutOptions?: {
      headerFontSizePt?: number;
      bodyFontSizePt?: number;
      headerBgColor?: string;
      showGridlines?: boolean;
      alternateRowColors?: boolean;
      rowDensity?: 'compact' | 'normal' | 'comfortable';
    }
  ): Promise<void> {
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
      : `Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;

    // Select theme based on colorTheme parameter
    let theme = this.defaultTheme;
    if (colorTheme === 'traffic') {
      theme = { ...this.defaultTheme, success: '22c55e', warning: 'eab308', danger: 'ef4444' }; // Traffic light colors
    } else if (colorTheme === 'heatmap') {
      theme = { ...this.defaultTheme, success: '0ea5e9', secondary: '8b5cf6', warning: 'f97316', danger: 'dc2626' }; // Heatmap colors
    } else if (colorTheme === 'status') {
      theme = { ...this.defaultTheme, success: '16a34a', secondary: '2563eb', warning: 'd97706', danger: 'b91c1c' }; // Status colors
    }

    const sections: (Paragraph | Table)[] = [
      this.createHeading(title, HeadingLevel.HEADING_1, isArabic),
    ];

    if (subtitle) {
      sections.push(this.createParagraph(subtitle, isArabic));
    }
    
    sections.push(this.createParagraph(dateText, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

    // Add legend if conditional coloring is enabled
    if (colorColumns && colorColumns.length > 0) {
      sections.push(this.createColorLegend(isArabic, theme));
      sections.push(new Paragraph({ text: '', spacing: { after: 150 } }));
    }

    // Add the main data table
    sections.push(this.createTable(headers, rows, isArabic, theme, colorColumns, layoutOptions?.bodyFontSizePt, layoutOptions));

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(0.75),
                right: convertInchesToTwip(0.5),
                bottom: convertInchesToTwip(0.75),
                left: convertInchesToTwip(0.5),
              },
            },
          },
          children: sections,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '-');
    const fileName = filename || (isArabic
      ? `${sanitizedTitle}_${format(new Date(), 'yyyy-MM-dd')}.docx`
      : `${sanitizedTitle}-${format(new Date(), 'yyyy-MM-dd')}.docx`);
    saveAs(blob, fileName);
  }

  /**
   * Export analytics to Word with dynamic columns based on user selection
   * This method accepts pre-formatted data with headers for flexible field selection
   */
  async exportAnalyticsToWordDynamic(
    studentData: Record<string, unknown>[],
    studentHeaders: string[],
    dateData: Record<string, unknown>[],
    dateHeaders: string[],
    hostData: Record<string, unknown>[],
    hostHeaders: string[],
    summaryStats: {
      totalStudents: number;
      totalSessions: number;
      classAvgRate: number;
      avgWeightedScore: number;
      avgAttendanceByDate: number;
      medianRateByDate: number;
      totalPresent: number;
      totalAbsent: number;
      totalExcused: number;
      totalLate: number;
    },
    isArabic: boolean = false,
    startDate?: string,
    endDate?: string,
    filename?: string,
    options?: ExportOptions
  ): Promise<void> {
    const theme = options?.theme || this.defaultTheme;
    const enableConditionalColoring = options?.enableConditionalColoring ?? true;
    // Layout settings from user controls
    const sectionGap = Math.round((options?.layoutSettings?.sectionSpacing ?? 10) * 20); // mm → twips approx
    const shouldPageBreak = options?.layoutSettings?.pageBreakBetweenTables ?? false;
    const fontSize = options?.layoutSettings?.bodyFontSizePt ?? options?.layoutSettings?.tableFontSize;  // pt, passed to createTable
    // Build layoutOptions from AdvancedExportBuilder settings for createTable
    const tableLayoutOptions = {
      headerFontSizePt: options?.layoutSettings?.headerFontSizePt,
      headerBgColor: options?.layoutSettings?.headerBgColor,
      showGridlines: options?.layoutSettings?.showGridlines,
      alternateRowColors: options?.layoutSettings?.alternateRowColors,
      rowDensity: options?.layoutSettings?.rowDensity,
    };
    const sections: (Paragraph | Table)[] = [];

    // Title and Date Info
    const titleText = isArabic ? 'تقرير تحليل الحضور الشامل' : 'Comprehensive Attendance Analytics Report';
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
      : `Report Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
    const dateRangeText = startDate && endDate
      ? (isArabic 
        ? `الفترة: ${format(new Date(startDate), 'yyyy-MM-dd')} - ${format(new Date(endDate), 'yyyy-MM-dd')}`
        : `Date Range: ${format(new Date(startDate), 'MMM dd, yyyy')} - ${format(new Date(endDate), 'MMM dd, yyyy')}`)
      : '';

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: titleText,
            bold: true,
            size: 40,
            color: theme.primary,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        bidirectional: isArabic,
        keepNext: true,
        keepLines: true,
      })
    );
    sections.push(this.createParagraph(dateText, isArabic));
    if (dateRangeText) {
      sections.push(this.createParagraph(dateRangeText, isArabic));
    }
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Summary Statistics Section - only render if summary data is non-zero (excluded = zeroed-out stats)
    if (summaryStats.totalStudents > 0 || summaryStats.totalSessions > 0) {
    const summaryTitle = isArabic ? '📊 الإحصائيات العامة' : '📊 Summary Statistics';
    sections.push(
      this.createHeading(summaryTitle, HeadingLevel.HEADING_2, isArabic, theme)
    );

    const summaryTableHeaders = isArabic
      ? ['العنصر', 'القيمة']
      : ['Metric', 'Value'];
    const summaryRows = isArabic ? [
      ['عدد الطلاب', summaryStats.totalStudents.toString()],
      ['إجمالي الجلسات', summaryStats.totalSessions.toString()],
      ['معدل الصف', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['متوسط النقاط المرجحة', summaryStats.avgWeightedScore.toFixed(1)],
      ['متوسط الحضور حسب التاريخ', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['الوسيط لمعدل الحضور حسب التاريخ', `${summaryStats.medianRateByDate.toFixed(1)}%`],
    ] : [
      ['Total Students', summaryStats.totalStudents.toString()],
      ['Total Sessions', summaryStats.totalSessions.toString()],
      ['Class Avg Rate', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['Avg Weighted Score', summaryStats.avgWeightedScore.toFixed(1)],
      ['Avg Attendance by Date', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['Median Rate by Date', `${summaryStats.medianRateByDate.toFixed(1)}%`],
    ];

    sections.push(this.createTable(summaryTableHeaders, summaryRows, isArabic, theme, undefined, fontSize, tableLayoutOptions));
    sections.push(new Paragraph({ text: '', spacing: { after: sectionGap } }));
    }

    // Helper function to detect percentage columns for conditional coloring
    const detectPercentageColumns = (headers: string[]): number[] => {
      const percentagePatterns = [
        /rate/i, /percentage/i, /percent/i, /%/, /score/i, /weighted/i,
        /attendance/i, /punctuality/i, /consistency/i, /avg/i, /average/i,
        /معدل/, /نسبة/, /متوسط/ // Arabic patterns
      ];
      return headers
        .map((header, idx) => {
          const matchesPattern = percentagePatterns.some(pattern => pattern.test(header));
          return matchesPattern ? idx : -1;
        })
        .filter(idx => idx !== -1);
    };

    // Add color legend at the beginning - only if coloring is enabled
    if (enableConditionalColoring) {
      sections.push(this.createColorLegend(isArabic, theme));
      sections.push(new Paragraph({ text: '', spacing: { after: 300 } }));
    }

    // Student Performance Section (dynamic headers with conditional coloring)
    if (studentHeaders.length > 0 && studentData.length > 0) {
      if (shouldPageBreak) sections.push(new Paragraph({ pageBreakBefore: true, text: '' }));
      const studentTitle = isArabic ? '👨‍🎓 أداء الطلاب' : '👨‍🎓 Student Performance';
      sections.push(
        this.createHeading(studentTitle, HeadingLevel.HEADING_2, isArabic, theme)
      );

      // Detect percentage columns for coloring - use per-type override if available
      const studentPerType = options?.perTypeColoring?.studentAnalytics;
      const studentColorEnabled = studentPerType ? studentPerType.enabled : enableConditionalColoring;
      const studentColorColumns = studentColorEnabled
        ? (studentPerType?.colorColumns && studentPerType.colorColumns.length > 0
            ? studentPerType.colorColumns
            : detectPercentageColumns(studentHeaders))
        : [];

      // Build rows from the data using headers as keys
      const studentRows = studentData.map((row) => 
        studentHeaders.map((header) => {
          const value = row[header];
          if (value === undefined || value === null) return '-';
          if (typeof value === 'number') {
            return header.includes('%') || header.includes('Rate') || header.includes('معدل')
              ? `${value.toFixed(1)}%`
              : value.toString();
          }
          return String(value);
        })
      );

      sections.push(this.createTable(studentHeaders, studentRows, isArabic, theme, studentColorColumns, fontSize, tableLayoutOptions));
      sections.push(new Paragraph({ text: '', spacing: { after: sectionGap } }));
    }

    // Date Analytics Section (dynamic headers with conditional coloring)
    if (dateHeaders.length > 0 && dateData.length > 0) {
      if (shouldPageBreak) sections.push(new Paragraph({ pageBreakBefore: true, text: '' }));
      const dateTitle = isArabic
        ? '📅 الحضور حسب التاريخ'
        : '📅 Attendance by Date';
      sections.push(
        this.createHeading(dateTitle, HeadingLevel.HEADING_2, isArabic, theme)
      );

      // Detect percentage columns for coloring - use per-type override if available
      const datePerType = options?.perTypeColoring?.dateAnalytics;
      const dateColorEnabled = datePerType ? datePerType.enabled : enableConditionalColoring;
      const dateColorColumns = dateColorEnabled
        ? (datePerType?.colorColumns && datePerType.colorColumns.length > 0
            ? datePerType.colorColumns
            : detectPercentageColumns(dateHeaders))
        : [];

      // Build rows from the data using headers as keys
      const dateRows = dateData.map((row) =>
        dateHeaders.map((header) => {
          const value = row[header];
          if (value === undefined || value === null) return '-';
          if (typeof value === 'number') {
            return header.includes('%') || header.includes('Rate') || header.includes('معدل')
              ? `${value.toFixed(1)}%`
              : value.toString();
          }
          return String(value);
        })
      );

      sections.push(this.createTable(dateHeaders, dateRows, isArabic, theme, dateColorColumns, fontSize, tableLayoutOptions));
      sections.push(new Paragraph({ text: '', spacing: { after: sectionGap } }));
    }

    // Host Rankings Section (dynamic headers with conditional coloring)
    if (hostHeaders.length > 0 && hostData.length > 0) {
      if (shouldPageBreak) sections.push(new Paragraph({ pageBreakBefore: true, text: '' }));
      const hostTitle = isArabic
        ? '🏠 تصنيف المضيفين'
        : '🏠 Host Rankings';
      sections.push(
        this.createHeading(hostTitle, HeadingLevel.HEADING_2, isArabic, theme)
      );

      // Detect percentage columns for coloring - use per-type override if available
      const hostPerType = options?.perTypeColoring?.hostAnalytics;
      const hostColorEnabled = hostPerType ? hostPerType.enabled : enableConditionalColoring;
      const hostColorColumns = hostColorEnabled
        ? (hostPerType?.colorColumns && hostPerType.colorColumns.length > 0
            ? hostPerType.colorColumns
            : detectPercentageColumns(hostHeaders))
        : [];

      // Build rows from the data using headers as keys
      const hostRows = hostData.map((row) =>
        hostHeaders.map((header) => {
          const value = row[header];
          if (value === undefined || value === null) return '-';
          if (typeof value === 'number') {
            return header.includes('%') || header.includes('Rate') || header.includes('معدل')
              ? `${value.toFixed(1)}%`
              : value.toString();
          }
          return String(value);
        })
      );

      sections.push(this.createTable(hostHeaders, hostRows, isArabic, theme, hostColorColumns, fontSize, tableLayoutOptions));
    }

    // Specialization Analytics Section (dynamic headers with conditional coloring)
    const specHeaders = options?.specializationHeaders;
    const specData = options?.specializationData;
    if (specHeaders && specHeaders.length > 0 && specData && specData.length > 0) {
      if (shouldPageBreak) sections.push(new Paragraph({ pageBreakBefore: true, text: '' }));
      const specTitle = isArabic
        ? '🎓 تحليل التخصصات'
        : '🎓 Specialization Analytics';
      sections.push(
        this.createHeading(specTitle, HeadingLevel.HEADING_2, isArabic, theme)
      );

      const specPerType = options?.perTypeColoring?.specializationAnalytics;
      const specColorEnabled = specPerType ? specPerType.enabled : enableConditionalColoring;
      const specColorColumns = specColorEnabled
        ? (specPerType?.colorColumns && specPerType.colorColumns.length > 0
            ? specPerType.colorColumns
            : detectPercentageColumns(specHeaders))
        : [];

      const specRows = specData.map((row) =>
        specHeaders.map((header) => {
          const value = row[header];
          if (value === undefined || value === null) return '-';
          if (typeof value === 'number') {
            return header.includes('%') || header.includes('Rate') || header.includes('معدل')
              ? `${value.toFixed(1)}%`
              : value.toString();
          }
          return String(value);
        })
      );

      sections.push(this.createTable(specHeaders, specRows, isArabic, theme, specColorColumns, fontSize, tableLayoutOptions));
      sections.push(new Paragraph({ text: '', spacing: { after: sectionGap } }));
    }

    // ========== Chart Images Section ==========
    if (options?.chartImages && Object.keys(options.chartImages).length > 0) {
      const chartLabels: Record<string, string> = {
        trend: isArabic ? 'مسار الحضور' : 'Attendance Trend',
        specialization: isArabic ? 'تحليل التخصصات' : 'Specialization Analysis',
        distribution: isArabic ? 'توزيع الحالات' : 'Status Distribution',
        performance: isArabic ? 'أداء الطلاب' : 'Student Performance',
        radar: isArabic ? 'رادار الصف' : 'Class Radar',
        lateness: isArabic ? 'تحليل التأخر' : 'Lateness Analysis',
        comparison: isArabic ? 'المعدل مقابل الدرجة' : 'Rate vs Score',
      };

      sections.push(
        this.createHeading(
          isArabic ? '📊 الرسوم البيانية' : '📊 Charts',
          HeadingLevel.HEADING_2,
          isArabic,
          theme
        )
      );

      const chartWidthPct = options.layoutSettings?.chartWidth || 85;
      // A4 content area ≈ 620px at 96dpi; scale by user preference
      const displayWidth = Math.round(620 * (chartWidthPct / 100));
      const displayHeight = Math.round(displayWidth * 0.5); // ~2:1 aspect ratio

      for (const [tabId, dataUrl] of Object.entries(options.chartImages)) {
        // Add chart title
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `📈 ${chartLabels[tabId] || tabId}`,
                bold: true,
                size: 22,
                color: theme.primary,
              }),
            ],
            spacing: { before: 300, after: 100 },
          })
        );

        // Convert data URL to buffer for ImageRun
        try {
          const base64Data = dataUrl.split(',')[1];
          if (base64Data) {
            // Convert base64 to Uint8Array
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }

            sections.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: bytes,
                    transformation: {
                      width: displayWidth,
                      height: displayHeight,
                    },
                    type: 'png',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 300 },
              })
            );
          }
        } catch {
          // If image fails, add placeholder text
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `[Chart: ${chartLabels[tabId] || tabId} — image could not be embedded]`,
                  italics: true,
                  color: '999999',
                }),
              ],
              spacing: { after: 200 },
            })
          );
        }
      }
    }

    // Cross-Tab Matrix is rendered as a separate landscape section below
    // (crosstab data is passed through to the document builder)

    // Build document sections array
    const docSections: Array<{
      properties: Record<string, unknown>;
      headers?: Record<string, unknown>;
      footers?: Record<string, unknown>;
      children: (Paragraph | Table)[];
    }> = [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1.25),
              right: convertInchesToTwip(0.5),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(0.5),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: isArabic 
                      ? '📊 تقرير تحليل الحضور' 
                      : '📊 Attendance Analytics Report',
                    bold: true,
                    size: 24,
                    color: theme.primary,
                  }),
                ],
                alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                border: {
                  bottom: { 
                    style: BorderStyle.SINGLE, 
                    size: 6, 
                    color: theme.secondary 
                  },
                },
                spacing: { after: 100 },
                bidirectional: isArabic,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    children: [isArabic ? 'صفحة ' : 'Page ', PageNumber.CURRENT, isArabic ? ' من ' : ' of ', PageNumber.TOTAL_PAGES],
                    size: 20,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: sections,
      },
    ];

    // Cross-Tab Matrix — separate landscape section with compact formatting
    if (options?.crosstabData && options.crosstabData.headers.length > 0 && options.crosstabData.rows.length > 0) {
      const ctHeaders = options.crosstabData.headers;
      const ctRows = options.crosstabData.rows;
      const numCols = ctHeaders.length;
      const useLandscape = numCols > 8;

      // Compact font size for many columns
      const fontSize = numCols <= 10 ? 16 : numCols <= 18 ? 14 : numCols <= 25 ? 12 : 10;
      const headerFontSize = fontSize + 2;

      // Status-based cell color map
      const getStatusColor = (cell: string): string | null => {
        const c = cell.trim().toLowerCase();
        if (c === '✓' || c === 'حاضر') return '6EE7B7'; // emerald-300
        if (c.startsWith('l') || c.startsWith('متأخر')) return 'FDE68A'; // yellow-200
        if (c === '✗' || c === 'غائب') return 'FECACA'; // red-200
        if (c === 'e' || c === 'معذور') return 'BFDBFE'; // blue-200
        return null;
      };

      const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };

      // Build compact cross-tab table with color-coded cells
      const ctHeaderRow = new TableRow({
        cantSplit: true,
        tableHeader: true,
        children: ctHeaders.map((h: string) =>
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: h, bold: true, font: isArabic ? 'Arial' : 'Calibri', size: headerFontSize, color: 'FFFFFF' })],
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20 },
            })],
            shading: { type: ShadingType.CLEAR, fill: tableLayoutOptions.headerBgColor || '7C3AED', color: tableLayoutOptions.headerBgColor || '7C3AED' },
            borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
          })
        ),
      });

      const ctDataRows = ctRows.map((row: string[], rowIdx: number) =>
        new TableRow({
          cantSplit: true,
          children: row.map((cell: string, colIdx: number) => {
            const statusColor = colIdx > 0 ? getStatusColor(cell) : null;
            const bgColor = statusColor || (rowIdx % 2 === 0 ? 'FFFFFF' : 'F5F5F5');
            const textColor = statusColor ? '1F2937' : '000000';
            return new TableCell({
              children: [new Paragraph({
                children: [new TextRun({
                  text: cell,
                  font: isArabic ? 'Arial' : 'Calibri',
                  size: fontSize,
                  color: textColor,
                  bold: colIdx === 0,
                })],
                alignment: colIdx === 0 ? (isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT) : AlignmentType.CENTER,
                spacing: { before: 10, after: 10 },
              })],
              shading: { type: ShadingType.CLEAR, fill: bgColor, color: bgColor },
              borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
            });
          }),
        })
      );

      const ctTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [ctHeaderRow, ...ctDataRows],
      });

      const ctTitle = isArabic ? '🗓️ مصفوفة الطلاب × التواريخ' : '🗓️ Student × Date Matrix';
      const ctSubtitle = isArabic
        ? `${ctRows.length} طالب × ${ctHeaders.length - 1} تاريخ`
        : `${ctRows.length} students × ${ctHeaders.length - 1} dates`;

      docSections.push({
        properties: {
          page: {
            size: useLandscape ? { orientation: PageOrientation.LANDSCAPE } : undefined,
            margin: {
              top: convertInchesToTwip(0.5),
              right: convertInchesToTwip(0.3),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.3),
            },
          },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: ctTitle, bold: true, size: 28, color: theme.primary, font: isArabic ? 'Arial' : 'Calibri' })],
            alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
            spacing: { after: 60 },
            bidirectional: isArabic,
          }),
          new Paragraph({
            children: [new TextRun({ text: ctSubtitle, size: 18, color: '6B7280', font: isArabic ? 'Arial' : 'Calibri' })],
            alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
            spacing: { after: 120 },
            bidirectional: isArabic,
          }),
          ctTable,
          // Legend
          new Paragraph({
            children: [
              new TextRun({ text: isArabic ? 'المفتاح: ' : 'Legend: ', bold: true, size: 16, font: isArabic ? 'Arial' : 'Calibri' }),
              new TextRun({ text: isArabic ? '  ■ حاضر  ' : '  ■ On Time  ', size: 16, color: '059669' }),
              new TextRun({ text: isArabic ? '  ■ متأخر  ' : '  ■ Late  ', size: 16, color: 'D97706' }),
              new TextRun({ text: isArabic ? '  ■ غائب  ' : '  ■ Absent  ', size: 16, color: 'DC2626' }),
              new TextRun({ text: isArabic ? '  ■ معذور  ' : '  ■ Excused  ', size: 16, color: '2563EB' }),
            ],
            spacing: { before: 120 },
            alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
            bidirectional: isArabic,
          }),
        ],
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new Document({ sections: docSections as any });

    const blob = await Packer.toBlob(doc);
    const fileName = filename || (isArabic
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.docx`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.docx`);
    saveAs(blob, fileName);
  }
}

export const wordExportService = new WordExportService();
