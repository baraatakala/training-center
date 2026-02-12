/**
 * Excel Export Service
 * Export comprehensive attendance data with notes to Excel
 */

import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { loadConfigSync } from './scoringConfigService';

export interface AttendanceExportData {
  date: string;
  student_name: string;
  student_email: string;
  session_name: string;
  location: string;
  status: string;
  late_minutes?: number | null;
  early_minutes?: number | null;
  check_in_method?: string | null;
  distance_from_host?: number | null;
  check_in_time: string | null;
  marked_at: string;
  marked_by: string | null;
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
}

// Late display brackets — reads from saved scoring config (dynamic)
const getLateBracketName = (lateMinutes: number | null | undefined): string => {
  if (!lateMinutes || lateMinutes <= 0) return '-';
  const config = loadConfigSync();
  const bracket = config.late_brackets.find(b => lateMinutes >= b.min && lateMinutes <= b.max);
  return bracket?.name || 'Very Late';
};

export class ExcelExportService {
  /**
   * Export attendance records to Excel
   */
  exportToExcel(
    data: AttendanceExportData[],
    filename?: string
  ): { success: boolean; error?: string } {
    if (!data || data.length === 0) {
      return { success: false, error: 'No data to export' };
    }

    try {
    // Prepare data for Excel
    const excelData = data.map((record) => ({
      'Date': record.date,
      'Student Name': record.student_name,
      'Email': record.student_email,
      'Session': record.session_name,
      'Location': record.location,
      'Status': record.status.toUpperCase(),
      'Late Duration (min)': record.status === 'late' && record.late_minutes ? record.late_minutes : '-',
      'Late Severity': record.status === 'late' ? getLateBracketName(record.late_minutes) : '-',
      'Early (min)': record.early_minutes ? record.early_minutes : '-',
      'Check-in Method': record.check_in_method ? 
        (record.check_in_method === 'qr_code' ? 'QR Code' :
         record.check_in_method === 'photo' ? 'Photo' :
         record.check_in_method === 'bulk' ? 'Bulk' :
         record.check_in_method === 'manual' ? 'Manual' :
         record.check_in_method) : '-',
      'Distance (m)': record.distance_from_host !== null && record.distance_from_host !== undefined 
        ? record.distance_from_host.toFixed(1) : '-',
      'Check-In Time': record.check_in_time || 'N/A',
      'Marked At': record.marked_at,
      'Marked By': record.marked_by || 'N/A',
      'Notes': record.notes || '',
      'GPS Latitude': record.gps_latitude !== null ? record.gps_latitude.toFixed(6) : 'N/A',
      'GPS Longitude': record.gps_longitude !== null ? record.gps_longitude.toFixed(6) : 'N/A',
      'GPS Accuracy (m)': record.gps_accuracy !== null ? `±${record.gps_accuracy.toFixed(1)}` : 'N/A'
    }));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const columnWidths = [
      { wch: 12 }, // Date
      { wch: 25 }, // Student Name
      { wch: 30 }, // Email
      { wch: 25 }, // Session
      { wch: 20 }, // Location
      { wch: 10 }, // Status
      { wch: 18 }, // Late Duration
      { wch: 12 }, // Late Severity
      { wch: 10 }, // Early
      { wch: 14 }, // Check-in Method
      { wch: 12 }, // Distance
      { wch: 18 }, // Check-In Time
      { wch: 18 }, // Marked At
      { wch: 20 }, // Marked By
      { wch: 40 }, // Notes
      { wch: 15 }, // GPS Latitude
      { wch: 15 }, // GPS Longitude
      { wch: 15 }  // GPS Accuracy
    ];
    worksheet['!cols'] = columnWidths;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Records');

    // Add summary sheet
    const summaryData = this.generateSummaryData(data);
    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryData);
    summaryWorksheet['!cols'] = [{ wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');

    // Generate filename
    const fileName = filename || `attendance_export_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.xlsx`;

    // Save file
    XLSX.writeFile(workbook, fileName);

    return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export file';
      return { success: false, error: message };
    }
  }

  /**
   * Generate summary statistics for summary sheet
   */
  private generateSummaryData(data: AttendanceExportData[]): Record<string, string | number>[] {
    const total = data.length;
    // Status values: 'on time', 'late', 'absent', 'excused', 'not enrolled'
    const presentCount = data.filter((r) => r.status === 'on time').length;
    const absentCount = data.filter((r) => r.status === 'absent').length;
    const lateCount = data.filter((r) => r.status === 'late').length;
    const excusedCount = data.filter((r) => r.status === 'excused').length;
    const notEnrolledCount = data.filter((r) => r.status === 'not enrolled').length;

    const uniqueStudents = new Set(data.map((r) => r.student_email)).size;
    const uniqueDates = new Set(data.map((r) => r.date)).size;
    const uniqueSessions = new Set(data.map((r) => r.session_name)).size;

    const withGPS = data.filter(
      (r) => r.gps_latitude !== null && r.gps_longitude !== null
    ).length;
    const withNotes = data.filter((r) => r.notes && r.notes.trim() !== '').length;

    const attendanceRate = total > 0 ? ((presentCount / total) * 100).toFixed(2) : '0.00';

    return [
      { 'Metric': 'Total Records', 'Value': total },
      { 'Metric': 'Unique Students', 'Value': uniqueStudents },
      { 'Metric': 'Unique Dates', 'Value': uniqueDates },
      { 'Metric': 'Unique Sessions', 'Value': uniqueSessions },
      { 'Metric': '', 'Value': '' },
      { 'Metric': 'On Time', 'Value': presentCount },
      { 'Metric': 'Absent', 'Value': absentCount },
      { 'Metric': 'Late', 'Value': lateCount },
      { 'Metric': 'Excused', 'Value': excusedCount },
      { 'Metric': 'Not Enrolled', 'Value': notEnrolledCount },
      { 'Metric': '', 'Value': '' },
      { 'Metric': 'Attendance Rate', 'Value': `${attendanceRate}%` },
      { 'Metric': 'Records with GPS', 'Value': withGPS },
      { 'Metric': 'Records with Notes', 'Value': withNotes },
      { 'Metric': '', 'Value': '' },
      { 'Metric': 'Export Date', 'Value': format(new Date(), 'PPpp') }
    ];
  }

  /**
   * Export student summary to Excel
   */
  exportStudentSummary(
    data: Array<{
      student_name: string;
      student_email: string;
      total_records: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
      attendance_rate: number;
    }>,
    filename?: string
  ): { success: boolean; error?: string } {
    if (!data || data.length === 0) {
      return { success: false, error: 'No data to export' };
    }

    try {
    const excelData = data.map((student) => ({
      'Student Name': student.student_name,
      'Email': student.student_email,
      'Total Records': student.total_records,
      'Present': student.present,
      'Absent': student.absent,
      'Late': student.late,
      'Excused': student.excused,
      'Attendance Rate': `${student.attendance_rate.toFixed(2)}%`
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    worksheet['!cols'] = [
      { wch: 25 },
      { wch: 30 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 15 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Student Summary');

    const fileName = filename || `student_summary_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export file';
      return { success: false, error: message };
    }
  }
}

export const excelExportService = new ExcelExportService();
