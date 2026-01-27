/**
 * Word Export Service with Full Arabic Support
 * Export attendance analytics and records to Word (.docx) format
 * Supports RTL (right-to-left) text, Arabic fonts, and advanced formatting
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
} from 'docx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

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
  consistency_index: number;
  avg_rate: number;
  min_rate: number;
  max_rate: number;
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

export class WordExportService {
  /**
   * Create a styled heading paragraph
   */
  private createHeading(
    text: string,
    level: typeof HeadingLevel[keyof typeof HeadingLevel],
    isArabic: boolean = false
  ): Paragraph {
    return new Paragraph({
      text,
      heading: level,
      alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 200, before: 200 },
      bidirectional: isArabic,
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
   * Create a table with proper styling and RTL support
   */
  private createTable(
    headers: string[],
    rows: string[][],
    isArabic: boolean = false
  ): Table {
    const borderStyle = {
      style: BorderStyle.SINGLE,
      size: 1,
      color: '000000',
    };

    // Create header row
    const headerRow = new TableRow({
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
                    size: 22,
                  }),
                ],
                alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.CENTER,
                bidirectional: isArabic,
              }),
            ],
            shading: { fill: 'D9E1F2' },
            borders: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          })
      ),
      cantSplit: true,
    });

    // Create data rows
    const dataRows = rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell,
                        font: isArabic ? 'Arial' : 'Calibri',
                        size: 20,
                      }),
                    ],
                    alignment: isArabic
                      ? AlignmentType.RIGHT
                      : AlignmentType.LEFT,
                    bidirectional: isArabic,
                  }),
                ],
                borders: {
                  top: borderStyle,
                  bottom: borderStyle,
                  left: borderStyle,
                  right: borderStyle,
                },
              })
          ),
        })
    );

    return new Table({
      rows: [headerRow, ...dataRows],
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
      margins: {
        top: convertInchesToTwip(0.05),
        bottom: convertInchesToTwip(0.05),
        left: convertInchesToTwip(0.05),
        right: convertInchesToTwip(0.05),
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
    const fileName =
      filename || `attendance-records-${format(new Date(), 'yyyy-MM-dd')}.docx`;
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
      avgAttendanceByAccruedDate: number;
      totalPresent: number;
      totalAbsent: number;
      totalExcused: number;
      totalLate: number;
    },
    isArabic: boolean = false,
    startDate?: string,
    endDate?: string,
    filename?: string
  ): Promise<void> {
    const sections: (Paragraph | Table)[] = [];

    // Title and Summary Section
    const titleText = isArabic
      ? 'تقرير تحليل الحضور الشامل'
      : 'Comprehensive Attendance Analytics Report';
    const dateText = isArabic
      ? `تاريخ التقرير: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
      : `Report Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
    const dateRangeText = startDate && endDate
      ? (isArabic 
        ? `الفترة: ${format(new Date(startDate), 'yyyy-MM-dd')} - ${format(new Date(endDate), 'yyyy-MM-dd')}`
        : `Date Range: ${format(new Date(startDate), 'MMM dd, yyyy')} - ${format(new Date(endDate), 'MMM dd, yyyy')}`)
      : '';

    sections.push(this.createHeading(titleText, HeadingLevel.HEADING_1, isArabic));
    sections.push(this.createParagraph(dateText, isArabic));
    if (dateRangeText) {
      sections.push(this.createParagraph(dateRangeText, isArabic));
    }
    sections.push(new Paragraph({ text: '', spacing: { after: 300 } }));

    // Summary Statistics Section - ALL fields from Excel
    const summaryTitle = isArabic ? 'الإحصائيات العامة' : 'Summary Statistics';
    sections.push(
      this.createHeading(summaryTitle, HeadingLevel.HEADING_2, isArabic)
    );

    const summaryHeaders = isArabic
      ? ['العنصر', 'القيمة']
      : ['Metric', 'Value'];
    const summaryRows = isArabic ? [
      ['عدد الطلاب', summaryStats.totalStudents.toString()],
      ['إجمالي الجلسات', summaryStats.totalSessions.toString()],
      ['معدل الحضور للصف (%)', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['متوسط النقاط المرجحة', summaryStats.avgWeightedScore.toFixed(1)],
      ['متوسط الحضور حسب التاريخ (%)', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['متوسط الحضور حسب التاريخ للحصص النشطة (%)', `${summaryStats.avgAttendanceByAccruedDate.toFixed(1)}%`],
      ['إجمالي الحاضرين', summaryStats.totalPresent.toString()],
      ['إجمالي الغياب', summaryStats.totalAbsent.toString()],
      ['إجمالي الأعذار', summaryStats.totalExcused.toString()],
      ['إجمالي المتأخرين', summaryStats.totalLate.toString()],
    ] : [
      ['Total Students', summaryStats.totalStudents.toString()],
      ['Total Sessions', summaryStats.totalSessions.toString()],
      ['Class Avg Rate (%)', `${summaryStats.classAvgRate.toFixed(1)}%`],
      ['Avg Weighted Score', summaryStats.avgWeightedScore.toFixed(1)],
      ['Avg Attendance by Date (%)', `${summaryStats.avgAttendanceByDate.toFixed(1)}%`],
      ['Avg Attendance by Accrued Date (%)', `${summaryStats.avgAttendanceByAccruedDate.toFixed(1)}%`],
      ['Total Present', summaryStats.totalPresent.toString()],
      ['Total Absent', summaryStats.totalAbsent.toString()],
      ['Total Excused', summaryStats.totalExcused.toString()],
      ['Total Late', summaryStats.totalLate.toString()],
    ];

    sections.push(this.createTable(summaryHeaders, summaryRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Student Performance Section - ALL fields matching Excel
    const studentTitle = isArabic ? 'أداء الطلاب' : 'Student Performance';
    sections.push(
      this.createHeading(studentTitle, HeadingLevel.HEADING_2, isArabic)
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
          'الانتظام',
          'متوسط %',
          'أدنى %',
          'أعلى %',
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
          'Consistency',
          'Avg %',
          'Min %',
          'Max %',
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
      s.consistency_index.toFixed(2),
      `${s.avg_rate.toFixed(1)}%`,
      `${s.min_rate.toFixed(1)}%`,
      `${s.max_rate.toFixed(1)}%`,
    ]);

    sections.push(this.createTable(studentHeaders, studentRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Date-wise Attendance Section - ALL fields including book info and student names
    const dateTitle = isArabic
      ? 'الحضور حسب التاريخ'
      : 'Attendance by Date';
    sections.push(
      this.createHeading(dateTitle, HeadingLevel.HEADING_2, isArabic)
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

    sections.push(this.createTable(dateStatsHeaders, dateStatsRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

    // Table 2: Student Names by Status
    const dateNamesTitle = isArabic 
      ? 'أسماء الطلاب حسب الحالة'
      : 'Student Names by Status';
    sections.push(
      this.createHeading(dateNamesTitle, HeadingLevel.HEADING_3, isArabic)
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

    sections.push(this.createTable(dateNamesHeaders, dateNamesRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Host Rankings Section - ALL fields
    if (hostData.length > 0) {
      const hostTitle = isArabic
        ? 'تصنيف المضيفين'
        : 'Host Rankings';
      sections.push(
        this.createHeading(hostTitle, HeadingLevel.HEADING_2, isArabic)
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

      sections.push(this.createTable(hostHeaders, hostRows, isArabic));
    }

    // Create document
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
    const fileName =
      filename || `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.docx`;
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
    const fileName =
      filename || `student-summary-${format(new Date(), 'yyyy-MM-dd')}.docx`;
    saveAs(blob, fileName);
  }
}

export const wordExportService = new WordExportService();
