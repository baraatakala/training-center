/**
 * PDF Export Service with AutoTable Pagination
 * Generates professional attendance reports with comprehensive statistics
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

export interface AttendanceReportData {
  student_name: string;
  student_email: string;
  total_records: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  vacation_count: number;
  raw_attendance_rate: number;
  effective_attendance_rate: number;
  effective_days: number;
  total_days: number;
  unexcused_absent: number;
  weighted_score: number;
}

export interface ReportSummary {
  total_records: number;
  total_students: number;
  total_present: number;
  total_absent: number;
  total_late: number;
  total_excused: number;
  total_vacation: number;
  raw_attendance_rate: number;
  effective_attendance_rate: number;
  class_average_rate: number;
  class_weighted_score: number;
  total_unexcused_absent: number;
  days_covered: number;
  date_range: string;
}

export class PDFExportService {
  /**
   * Calculate weighted score for a student
   * 70% based on attendance rate
   * 20% based on effective days percentage
   * 10% based on excuse usage (if applicable)
   */
  private calculateWeightedScore(data: AttendanceReportData): number {
    const attendanceWeight = 0.7;
    const effectiveDaysWeight = 0.2;
    const excuseWeight = 0.1;

    const attendanceScore = data.effective_attendance_rate * attendanceWeight;
    const effectiveDaysScore =
      (data.effective_days / data.total_days) * effectiveDaysWeight * 100;
    
    // Lower excuse usage is better (max 10 points if no excuses used)
    const excuseScore =
      data.total_records > 0
        ? (1 - data.excused_count / data.total_records) * excuseWeight * 100
        : excuseWeight * 100;

    return parseFloat(
      (attendanceScore + effectiveDaysScore + excuseScore).toFixed(2)
    );
  }

  /**
   * Calculate comprehensive statistics
   */
  private calculateStatistics(
    data: AttendanceReportData[]
  ): AttendanceReportData[] {
    return data.map((student) => {
      // Effective days = total days - vacation days
      const effectiveDays = student.total_days - (student.vacation_count || 0);

      // Raw attendance rate = present / total records
      const rawRate =
        student.total_records > 0
          ? (student.present_count / student.total_records) * 100
          : 0;

      // Effective attendance rate = present / effective days (excluding vacations/excused)
      const effectiveBase = student.total_records - (student.vacation_count || 0) - student.excused_count;
      const effectiveRate =
        effectiveBase > 0
          ? (student.present_count / effectiveBase) * 100
          : 0;

      // Unexcused absences = total absent - excused absences
      const unexcusedAbsent = student.absent_count - student.excused_count;

      const enrichedData: AttendanceReportData = {
        ...student,
        effective_days: effectiveDays,
        raw_attendance_rate: parseFloat(rawRate.toFixed(2)),
        effective_attendance_rate: parseFloat(effectiveRate.toFixed(2)),
        unexcused_absent: unexcusedAbsent,
        weighted_score: 0 // Will be calculated next
      };

      enrichedData.weighted_score = this.calculateWeightedScore(enrichedData);

      return enrichedData;
    });
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(
    data: AttendanceReportData[],
    dateRange: string
  ): ReportSummary {
    const totalRecords = data.reduce((sum, s) => sum + s.total_records, 0);
    const totalPresent = data.reduce((sum, s) => sum + s.present_count, 0);
    const totalAbsent = data.reduce((sum, s) => sum + s.absent_count, 0);
    const totalLate = data.reduce((sum, s) => sum + s.late_count, 0);
    const totalExcused = data.reduce((sum, s) => sum + s.excused_count, 0);
    const totalVacation = data.reduce((sum, s) => sum + (s.vacation_count || 0), 0);
    const totalUnexcusedAbsent = data.reduce((sum, s) => sum + s.unexcused_absent, 0);

    const rawRate = totalRecords > 0 ? (totalPresent / totalRecords) * 100 : 0;
    const effectiveBase = totalRecords - totalVacation - totalExcused;
    const effectiveRate = effectiveBase > 0 ? (totalPresent / effectiveBase) * 100 : 0;

    const classAvgRate =
      data.length > 0
        ? data.reduce((sum, s) => sum + s.effective_attendance_rate, 0) / data.length
        : 0;

    const classWeightedScore =
      data.length > 0
        ? data.reduce((sum, s) => sum + s.weighted_score, 0) / data.length
        : 0;

    const daysCovered = data.length > 0 ? Math.max(...data.map((s) => s.total_days)) : 0;

    return {
      total_records: totalRecords,
      total_students: data.length,
      total_present: totalPresent,
      total_absent: totalAbsent,
      total_late: totalLate,
      total_excused: totalExcused,
      total_vacation: totalVacation,
      raw_attendance_rate: parseFloat(rawRate.toFixed(2)),
      effective_attendance_rate: parseFloat(effectiveRate.toFixed(2)),
      class_average_rate: parseFloat(classAvgRate.toFixed(2)),
      class_weighted_score: parseFloat(classWeightedScore.toFixed(2)),
      total_unexcused_absent: totalUnexcusedAbsent,
      days_covered: daysCovered,
      date_range: dateRange
    };
  }

  /**
   * Get color for attendance rate
   */
  private getRateColor(rate: number): [number, number, number] {
    if (rate >= 90) return [34, 197, 94]; // Green
    if (rate >= 75) return [234, 179, 8]; // Yellow
    if (rate >= 60) return [249, 115, 22]; // Orange
    return [239, 68, 68]; // Red
  }

  /**
   * Generate comprehensive PDF report
   */
  async generateReport(
    data: AttendanceReportData[],
    dateRange: string,
    courseName?: string,
    sessionName?: string
  ): Promise<void> {
    // Calculate statistics
    const enrichedData = this.calculateStatistics(data);
    const summary = this.calculateSummary(enrichedData, dateRange);

    // Sort by weighted score descending
    enrichedData.sort((a, b) => b.weighted_score - a.weighted_score);

    // Create PDF
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for more columns
    const pageWidth = doc.internal.pageSize.width;
    
    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Attendance Analytics Report', pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    let yPos = 22;
    if (courseName) {
      doc.text(`Course: ${courseName}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;
    }
    if (sessionName) {
      doc.text(`Session: ${sessionName}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;
    }
    doc.text(`Period: ${dateRange}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 5;
    doc.text(`Generated: ${format(new Date(), 'PPpp')}`, pageWidth / 2, yPos, { align: 'center' });

    // Summary Statistics Box
    yPos += 10;
    doc.setFillColor(245, 245, 245);
    doc.rect(10, yPos, pageWidth - 20, 35, 'F');
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Summary Statistics', 15, yPos + 6);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    
    const col1X = 15;
    const col2X = pageWidth / 3;
    const col3X = (pageWidth / 3) * 2;
    
    const summaryY = yPos + 12;
    const lineHeight = 5;
    
    // Column 1
    doc.text(`Total Records: ${summary.total_records}`, col1X, summaryY);
    doc.text(`Total Students: ${summary.total_students}`, col1X, summaryY + lineHeight);
    doc.text(`Total Present: ${summary.total_present}`, col1X, summaryY + lineHeight * 2);
    doc.text(`Total Absent: ${summary.total_absent}`, col1X, summaryY + lineHeight * 3);
    
    // Column 2
    doc.text(`Total Late: ${summary.total_late}`, col2X, summaryY);
    doc.text(`Total Excused: ${summary.total_excused}`, col2X, summaryY + lineHeight);
    doc.text(`Total Vacation: ${summary.total_vacation}`, col2X, summaryY + lineHeight * 2);
    doc.text(`Unexcused Absent: ${summary.total_unexcused_absent}`, col2X, summaryY + lineHeight * 3);
    
    // Column 3
    doc.text(`Raw Attendance Rate: ${summary.raw_attendance_rate}%`, col3X, summaryY);
    doc.setTextColor(...this.getRateColor(summary.effective_attendance_rate));
    doc.setFont('helvetica', 'bold');
    doc.text(`Effective Attendance: ${summary.effective_attendance_rate}%`, col3X, summaryY + lineHeight);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(`Class Average Rate: ${summary.class_average_rate}%`, col3X, summaryY + lineHeight * 2);
    doc.text(`Class Weighted Score: ${summary.class_weighted_score}`, col3X, summaryY + lineHeight * 3);

    // Student Data Table with AutoTable (handles pagination automatically)
    autoTable(doc, {
      startY: yPos + 40,
      head: [[
        'Rank',
        'Student Name',
        'Email',
        'Present',
        'Absent',
        'Late',
        'Excused',
        'Total',
        'Raw Rate',
        'Effective Rate',
        'Weighted Score'
      ]],
      body: enrichedData.map((student, index) => [
        `#${index + 1}`,
        student.student_name,
        student.student_email,
        student.present_count.toString(),
        student.absent_count.toString(),
        student.late_count.toString(),
        student.excused_count.toString(),
        student.total_records.toString(),
        `${student.raw_attendance_rate}%`,
        `${student.effective_attendance_rate}%`,
        student.weighted_score.toString()
      ]),
      headStyles: {
        fillColor: [59, 130, 246],
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 15 },
        1: { cellWidth: 40 },
        2: { cellWidth: 45 },
        3: { halign: 'center', cellWidth: 18 },
        4: { halign: 'center', cellWidth: 18 },
        5: { halign: 'center', cellWidth: 15 },
        6: { halign: 'center', cellWidth: 18 },
        7: { halign: 'center', cellWidth: 15 },
        8: { halign: 'center', cellWidth: 20 },
        9: { halign: 'center', cellWidth: 25 },
        10: { halign: 'center', cellWidth: 25 }
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251]
      },
      didDrawCell: (data) => {
        // Color code the effective rate column
        if (data.column.index === 9 && data.section === 'body') {
          const rate = parseFloat(data.cell.text[0].replace('%', ''));
          const color = this.getRateColor(rate);
          doc.setTextColor(...color);
          doc.setFont('helvetica', 'bold');
        }
      },
      didDrawPage: (data) => {
        // Footer with page number
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.height - 10,
          { align: 'center' }
        );
      }
    });

    // Save PDF
    const fileName = `attendance_report_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.pdf`;
    doc.save(fileName);
  }
}

export const pdfExportService = new PDFExportService();
