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
  student_name: string;
  total_sessions: number;
  present: number;
  absent: number;
  excused: number;
  late: number;
  attendance_rate: number;
}

export interface DateAnalyticsData {
  date: string;
  total_students: number;
  present: number;
  absent: number;
  excused: number;
  late: number;
}

export interface HostRankingData {
  host_name: string;
  total_hosted: number;
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
   * Export analytics report to Word document with multiple sheets/sections
   */
  async exportAnalyticsToWord(
    studentData: StudentSummaryData[],
    dateData: DateAnalyticsData[],
    hostData: HostRankingData[],
    summaryStats: {
      totalStudents: number;
      totalSessions: number;
      overallAttendanceRate: number;
      totalPresent: number;
      totalAbsent: number;
      totalExcused: number;
      totalLate: number;
    },
    isArabic: boolean = false,
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

    sections.push(this.createHeading(titleText, HeadingLevel.HEADING_1, isArabic));
    sections.push(this.createParagraph(dateText, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 300 } }));

    // Summary Statistics Section
    const summaryTitle = isArabic ? 'الإحصائيات العامة' : 'Summary Statistics';
    sections.push(
      this.createHeading(summaryTitle, HeadingLevel.HEADING_2, isArabic)
    );

    const summaryHeaders = isArabic
      ? ['المقياس', 'القيمة']
      : ['Metric', 'Value'];
    const summaryRows = [
      [
        isArabic ? 'إجمالي الطلاب' : 'Total Students',
        summaryStats.totalStudents.toString(),
      ],
      [
        isArabic ? 'إجمالي الجلسات' : 'Total Sessions',
        summaryStats.totalSessions.toString(),
      ],
      [
        isArabic ? 'معدل الحضور الإجمالي' : 'Overall Attendance Rate',
        `${summaryStats.overallAttendanceRate.toFixed(1)}%`,
      ],
      [
        isArabic ? 'إجمالي الحاضرين' : 'Total Present',
        summaryStats.totalPresent.toString(),
      ],
      [
        isArabic ? 'إجمالي الغياب' : 'Total Absent',
        summaryStats.totalAbsent.toString(),
      ],
      [
        isArabic ? 'إجمالي الأعذار' : 'Total Excused',
        summaryStats.totalExcused.toString(),
      ],
      [
        isArabic ? 'إجمالي المتأخرين' : 'Total Late',
        summaryStats.totalLate.toString(),
      ],
    ];

    sections.push(this.createTable(summaryHeaders, summaryRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Student Performance Section
    const studentTitle = isArabic ? 'أداء الطلاب' : 'Student Performance';
    sections.push(
      this.createHeading(studentTitle, HeadingLevel.HEADING_2, isArabic)
    );

    const studentHeaders = isArabic
      ? [
          'اسم الطالب',
          'إجمالي الجلسات',
          'حاضر',
          'غائب',
          'معذور',
          'متأخر',
          'معدل الحضور',
        ]
      : [
          'Student Name',
          'Total Sessions',
          'Present',
          'Absent',
          'Excused',
          'Late',
          'Attendance Rate',
        ];
    const studentRows = studentData.map((s) => [
      s.student_name,
      s.total_sessions.toString(),
      s.present.toString(),
      s.absent.toString(),
      s.excused.toString(),
      s.late.toString(),
      `${s.attendance_rate.toFixed(1)}%`,
    ]);

    sections.push(this.createTable(studentHeaders, studentRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Date-wise Attendance Section
    const dateTitle = isArabic
      ? 'الحضور حسب التاريخ'
      : 'Attendance by Date';
    sections.push(
      this.createHeading(dateTitle, HeadingLevel.HEADING_2, isArabic)
    );

    const dateHeaders = isArabic
      ? [
          'التاريخ',
          'إجمالي الطلاب',
          'حاضر',
          'غائب',
          'معذور',
          'متأخر',
        ]
      : ['Date', 'Total Students', 'Present', 'Absent', 'Excused', 'Late'];
    const dateRows = dateData.map((d) => [
      d.date,
      d.total_students.toString(),
      d.present.toString(),
      d.absent.toString(),
      d.excused.toString(),
      d.late.toString(),
    ]);

    sections.push(this.createTable(dateHeaders, dateRows, isArabic));
    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));

    // Host Rankings Section
    if (hostData.length > 0) {
      const hostTitle = isArabic
        ? 'تصنيف المضيفين'
        : 'Host Rankings';
      sections.push(
        this.createHeading(hostTitle, HeadingLevel.HEADING_2, isArabic)
      );

      const hostHeaders = isArabic
        ? [
            'اسم المضيف',
            'إجمالي الاستضافة',
            'حاضر',
            'غائب',
            'معذور',
            'متأخر',
            'معدل الحضور',
          ]
        : [
            'Host Name',
            'Total Hosted',
            'Present',
            'Absent',
            'Excused',
            'Late',
            'Attendance Rate',
          ];
      const hostRows = hostData.map((h) => [
        h.host_name,
        h.total_hosted.toString(),
        h.present.toString(),
        h.absent.toString(),
        h.excused.toString(),
        h.late.toString(),
        `${h.attendance_rate.toFixed(1)}%`,
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
                top: convertInchesToTwip(1),
                right: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(0.75),
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
   * Export student summary to Word document
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
          'اسم الطالب',
          'إجمالي الجلسات',
          'حاضر',
          'غائب',
          'معذور',
          'متأخر',
          'معدل الحضور',
        ]
      : [
          'Student Name',
          'Total Sessions',
          'Present',
          'Absent',
          'Excused',
          'Late',
          'Attendance Rate',
        ];

    const rows = data.map((s) => [
      s.student_name,
      s.total_sessions.toString(),
      s.present.toString(),
      s.absent.toString(),
      s.excused.toString(),
      s.late.toString(),
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
