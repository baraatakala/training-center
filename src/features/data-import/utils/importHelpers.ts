import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import type { ImportRow } from '@/features/data-import/constants/importConstants';
import { TEMPLATE_HEADERS, EXAMPLE_ROWS } from '@/features/data-import/constants/importConstants';

/**
 * Normalises a date string to YYYY-MM-DD.
 * Accepted inputs:
 *   - YYYY-MM-DD  (pass-through)
 *   - DD/MM/YYYY or DD-MM-YYYY
 *   - Excel serial number (e.g. 46131)
 */
export const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const cleaned = dateStr.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Named month format: Apr 15, 2026 / April 15, 2026 / 15 Apr 2026
  const monthNames: Record<string, string> = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
    apr: '04', april: '04', may: '05', jun: '06', june: '06',
    jul: '07', july: '07', aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
  };
  // MMM dd, yyyy  or  MMMM dd, yyyy
  const mdyMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdyMatch) {
    const mon = monthNames[mdyMatch[1].toLowerCase()];
    if (mon) return `${mdyMatch[3]}-${mon}-${mdyMatch[2].padStart(2, '0')}`;
  }
  // dd MMM yyyy  or  dd MMMM yyyy
  const dmyMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmyMatch) {
    const mon = monthNames[dmyMatch[2].toLowerCase()];
    if (mon) return `${dmyMatch[3]}-${mon}-${dmyMatch[1].padStart(2, '0')}`;
  }

  // Excel serial number
  if (/^\d+$/.test(cleaned)) {
    const serial = parseInt(cleaned, 10);
    if (serial > 0 && serial < 2958466) { // valid range up to year 9999
      const epoch = new Date(1900, 0, 1);
      const date = new Date(epoch.getTime() + (serial - 2) * 86400000);
      return format(date, 'yyyy-MM-dd');
    }
  }

  return cleaned;
};

export const mapRowToImportRow = (row: Record<string, string>): ImportRow | null => {
  // Skip empty rows
  if (!row['student_name'] && !row['studentname'] && !row['student_email'] && !row['studentemail']) {
    return null;
  }

  return {
    studentName: row['student_name'] || row['studentname'] || '',
    studentEmail: row['student_email'] || row['studentemail'] || '',
    studentPhone: row['student_phone'] || row['studentphone'] || undefined,
    courseName: row['course_name'] || row['coursename'] || '',
    courseCategory: row['course_category'] || row['coursecategory'] || row['category'] || undefined,
    instructorName: row['instructor_name'] || row['instructorname'] || row['teacher_name'] || '',
    instructorEmail: row['instructor_email'] || row['instructoremail'] || row['teacher_email'] || '',
    instructorPhone: row['instructor_phone'] || row['instructorphone'] || row['teacher_phone'] || undefined,
    sessionStartDate: normalizeDate(row['session_start_date'] || row['start_date'] || row['startdate'] || ''),
    sessionEndDate: normalizeDate(row['session_end_date'] || row['end_date'] || row['enddate'] || ''),
    sessionDay: row['session_day'] || row['day'] || undefined,
    sessionTime: row['session_time'] || row['time'] || undefined,
    sessionLocation: row['session_location'] || row['location'] || undefined,
    attendanceDate: normalizeDate(row['attendance_date'] || row['date'] || ''),
    status: (row['status'] || 'present').toLowerCase() as 'present' | 'absent' | 'late' | 'excused',
    gpsLatitude: row['gps_latitude'] || row['latitude'] ? parseFloat(row['gps_latitude'] || row['latitude']) : undefined,
    gpsLongitude: row['gps_longitude'] || row['longitude'] ? parseFloat(row['gps_longitude'] || row['longitude']) : undefined,
    gpsAccuracy: row['gps_accuracy'] || row['accuracy'] ? parseFloat(row['gps_accuracy'] || row['accuracy']) : undefined,
    gpsTimestamp: row['gps_timestamp'] || row['timestamp'] || undefined,
    hostAddress: row['host_address'] || row['hostaddress'] || row['address'] || undefined,
    notes: row['notes'] || undefined,
    canHost: row['can_host'] || row['canhost'] || row['host'] || undefined,
    excuseReason: row['excuse_reason'] || row['excusereason'] || row['reason'] || undefined,
    hostDate: normalizeDate(row['host_date'] || row['hostdate'] || row['hosting_date'] || ''),
    lateMinutes: row['late_minutes'] || row['lateminutes'] || row['late_duration'] ? parseInt(row['late_minutes'] || row['lateminutes'] || row['late_duration'], 10) || undefined : undefined,
    earlyMinutes: row['early_minutes'] || row['earlyminutes'] || row['early_duration'] ? parseInt(row['early_minutes'] || row['earlyminutes'] || row['early_duration'], 10) || undefined : undefined,
    checkInMethod: row['check_in_method'] || row['checkinmethod'] || row['method'] || undefined,
  };
};

export const parseCSV = (text: string): ImportRow[] => {
  const lines = text.split('\n').filter(line => {
    const trimmed = line.trim();
    // Filter out empty lines and comment lines (starting with #)
    return trimmed && !trimmed.startsWith('#');
  });
  if (lines.length < 2) return [];

  // Detect delimiter: check if first line has tabs or commas
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // Parse CSV with proper quote handling
  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        // Handle escaped quotes ("")
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    const mappedRow = mapRowToImportRow(row);
    if (mappedRow) rows.push(mappedRow);
  }

  return rows;
};

export const parseExcel = (buffer: ArrayBuffer): ImportRow[] => {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { raw: false }) as Record<string, string>[];

    const rows: ImportRow[] = [];
    for (const row of jsonData) {
      // Normalize header names: convert to lowercase and replace spaces with underscores
      const normalizedRow: Record<string, string> = {};
      Object.keys(row).forEach(key => {
        const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
        normalizedRow[normalizedKey] = row[key] || '';
      });

      const mappedRow = mapRowToImportRow(normalizedRow);
      if (mappedRow) rows.push(mappedRow);
    }

    return rows;
  } catch (error) {
    console.error('Failed to parse Excel file:', error);
    throw new Error('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
  }
};

export const downloadTemplate = () => {
  // Build CSV content with proper escaping
  const csvRows: string[][] = [TEMPLATE_HEADERS];
  EXAMPLE_ROWS.forEach(row => {
    csvRows.push(row.map(cell => {
      // Escape cells containing commas, quotes, or newlines
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }));
  });

  const csvContent = csvRows.map(row => row.join(',')).join('\n');

  // Add BOM for proper UTF-8 encoding in Excel
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attendance_import_template.csv';
  a.click();
  window.URL.revokeObjectURL(url);
};
