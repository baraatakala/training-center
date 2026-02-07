import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format, subDays } from 'date-fns';
import { Select } from '../components/ui/Select';
import { BulkImport } from '../components/BulkImport';
import { Pagination } from '../components/ui/Pagination';
import { AdvancedExportBuilder } from '../components/AdvancedExportBuilder';
import type { ExportCategory, ExportSettings } from '../components/AdvancedExportBuilder';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { wordExportService } from '../services/wordExportService';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/ToastContainer';

interface AttendanceRecord {
  attendance_id: string;
  student_id: string;
  session_id: string;
  attendance_date: string;
  status: 'on time' | 'absent' | 'late' | 'excused' | 'not enrolled';
  excuse_reason?: string | null;
  late_minutes?: number | null; // How many minutes late (for tiered scoring)
  early_minutes?: number | null; // How many minutes early
  check_in_method?: string | null; // qr_code, photo, manual, bulk
  distance_from_host?: number | null; // Distance in meters from host location
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  gps_timestamp: string | null;
  marked_by: string | null;
  marked_at: string | null;
  student_name: string;
  course_id: string;
  course_name: string;
  teacher_id: string;
  instructor_name: string;
  session_location: string | null;
  host_address: string | null;
  book_topic?: string | null;
  book_start_page?: number | null;
  book_end_page?: number | null;
}

interface StudentAnalytics {
  student_id: string;
  student_name: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  unexcusedAbsent: number;
  daysCovered: number;
  effectiveDays: number;
  attendanceRate: number;
  weightedScore: number;
  consistencyIndex: number;
  trend: {
    slope: number;
    rSquared: number;
    classification: string;
  };
  weeklyChange: number;
  avgRate: number;
  minRate: number;
  maxRate: number;
  // Score transparency fields
  qualityAdjustedRate: number;
  rawWeightedScore: number;
  coverageFactor: number;
  punctualityRate: number;
  // Late duration fields
  totalLateMinutes: number;
  avgLateMinutes: number;
  maxLateMinutes: number;
  lateScoreAvg: number;  // Average late score weight (0-1)
}

interface DateAnalytics {
  date: string;
  presentCount: number;
  unexcusedAbsentCount: number;
  excusedAbsentCount: number;
  lateCount: number;
  attendanceRate: number;
  presentNames: string[];
  lateNames: string[];
  excusedNames: string[];
  absentNames: string[];
  hostAddress: string | null;
  bookTopic?: string | null;
  bookStartPage?: number | null;
  bookEndPage?: number | null;
  // Late duration fields
  totalLateMinutes: number;
  avgLateMinutes: number;
}

interface FilterOptions {
  student_id: string;
  course_id: string;
  teacher_id: string;
  status: string;
  startDate: string;
  endDate: string;
}

// ==================== TIERED LATE SCORING ====================
// Default late brackets (matching database defaults)
// ============================================================================
// WEIGHTED SCORE SYSTEM - STABLE IMPLEMENTATION
// ============================================================================
// This uses smooth exponential decay for late scoring (no cliff edges)
// and balanced component weights for fair evaluation.
//
// LATE SCORING: Exponential decay with half-life of ~30 minutes
//   - 5 min late  = 90% credit
//   - 15 min late = 72% credit  
//   - 30 min late = 50% credit
//   - 60 min late = 25% credit
//   - 90 min late = 12% credit
//
// WEIGHTED SCORE COMPONENTS:
//   50% Quality-Adjusted Rate (attendance with late penalties applied)
//   25% Simple Attendance Rate (showed up regardless of lateness)
//   15% Consistency Index (regular attendance patterns)
//   10% Punctuality Bonus (on-time vs late ratio)
// ============================================================================

// Display brackets (for UI only - scoring uses smooth decay)
const LATE_DISPLAY_BRACKETS = [
  { min: 1, max: 5, name: 'Minor', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  { min: 6, max: 15, name: 'Moderate', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  { min: 16, max: 30, name: 'Significant', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  { min: 31, max: 60, name: 'Severe', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  { min: 61, max: Infinity, name: 'Very Late', color: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200' },
];

/**
 * Calculate late score using smooth exponential decay
 * Formula: e^(-lateMinutes / 43.3) gives 50% credit at 30 minutes
 * This avoids "cliff edges" between brackets and provides fair, continuous penalties
 * 
 * @param lateMinutes - Number of minutes late
 * @returns Score between 0 and 1
 */
const getLateScoreWeight = (lateMinutes: number | null | undefined): number => {
  // If late_minutes not tracked, use conservative middle estimate (~20 min late equivalent)
  if (lateMinutes === null || lateMinutes === undefined) {
    return 0.60; // ~20 min late equivalent
  }
  
  // If not actually late (edge case)
  if (lateMinutes <= 0) {
    return 1.0;
  }
  
  // Exponential decay: score = e^(-t/τ) where τ = 43.3 gives 50% at 30 min
  // Minimum score is 0.05 (5%) to give some credit for showing up
  const decayConstant = 43.3;
  const score = Math.exp(-lateMinutes / decayConstant);
  return Math.max(0.05, score);
};

/**
 * Get bracket info for display (visual categorization only)
 */
const getLateBracketInfo = (lateMinutes: number | null | undefined): { name: string; color: string } => {
  if (lateMinutes === null || lateMinutes === undefined) {
    return { name: 'Unknown', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' };
  }
  if (lateMinutes <= 0) {
    return { name: 'On Time', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' };
  }
  
  const bracket = LATE_DISPLAY_BRACKETS.find(b => lateMinutes >= b.min && lateMinutes <= b.max);
  return bracket 
    ? { name: bracket.name, color: bracket.color }
    : { name: 'Very Late', color: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200' };
};

const AttendanceRecords = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toasts, success, error: showError, warning, removeToast } = useToast();

  // Advanced Export Builder state
  const [showAdvancedExport, setShowAdvancedExport] = useState(false);
  const [exportDataType, setExportDataType] = useState<'records' | 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'>('records');
  
  // Load saved field selections from localStorage
  const [savedFieldSelections, setSavedFieldSelections] = useState<{
    records: string[];
    studentAnalytics: string[];
    dateAnalytics: string[];
    hostAnalytics: string[];
  }>(() => {
    try {
      const saved = localStorage.getItem('exportFieldSelections');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { records: [], studentAnalytics: [], dateAnalytics: [], hostAnalytics: [] };
  });
  
  // Load saved export settings from localStorage (includes sort, coloring options)
  const [savedExportSettings, setSavedExportSettings] = useState<{
    records: ExportSettings;
    studentAnalytics: ExportSettings;
    dateAnalytics: ExportSettings;
    hostAnalytics: ExportSettings;
  }>(() => {
    try {
      const saved = localStorage.getItem('exportSettings');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    const defaultSettings: ExportSettings = { fields: [], enableConditionalColoring: true, coloringTheme: 'default' };
    return { records: defaultSettings, studentAnalytics: defaultSettings, dateAnalytics: defaultSettings, hostAnalytics: defaultSettings };
  });
  
  // Persist field selections to localStorage
  useEffect(() => {
    localStorage.setItem('exportFieldSelections', JSON.stringify(savedFieldSelections));
  }, [savedFieldSelections]);
  
  // Persist export settings to localStorage
  useEffect(() => {
    localStorage.setItem('exportSettings', JSON.stringify(savedExportSettings));
  }, [savedExportSettings]);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics[]>([]);
  const [dateAnalytics, setDateAnalytics] = useState<DateAnalytics[]>([]);
  const [reportLanguage, setReportLanguage] = useState<'en' | 'ar'>('en');

  // Collapse state for analytics sections
  const [collapseStudentTable, setCollapseStudentTable] = useState(false);
  const [collapseDateTable, setCollapseDateTable] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Earliest attendance date state
  const [earliestDate, setEarliestDate] = useState<string>('');

  // Filter state
  const [filters, setFilters] = useState<FilterOptions>({
    student_id: '',
    course_id: '',
    teacher_id: '',
    status: '',
    startDate: '',
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // Dropdown options
  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [courses, setCourses] = useState<{ value: string; label: string }[]>([]);
  const [instructors, setInstructors] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    // Initialize: fetch earliest attendance date and then load filters + records
    const init = async () => {
      try {
        // get earliest attendance_date by ordering ascending and taking first row
        const { data: earliestData, error: earliestError } = await supabase
          .from('attendance')
          .select('attendance_date')
          .order('attendance_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (earliestError) {
          console.warn('Failed to fetch earliest attendance date, falling back to 1 year ago', earliestError);
          const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
          setEarliestDate(fallback);
          setFilters((f) => ({ ...f, startDate: fallback }));
        } else if (earliestData && earliestData.attendance_date) {
          const earliest = format(new Date(earliestData.attendance_date), 'yyyy-MM-dd');
          setEarliestDate(earliest);
          setFilters((f) => ({ ...f, startDate: earliest }));
        } else {
          const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
          setEarliestDate(fallback);
          setFilters((f) => ({ ...f, startDate: fallback }));
        }
      } catch (err) {
        console.warn('Error initializing filters, using fallback dates', err);
        const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
        setEarliestDate(fallback);
        setFilters((f) => ({ ...f, startDate: fallback }));
      }

      // load dropdown options and records after filters initialized
      await loadFilterOptions();
      await loadRecords();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply URL query parameters as filters
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const studentName = params.get('studentName');
    const status = params.get('status');
    const course = params.get('course');
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');

    if (studentName || status || course || startDate || endDate) {
      // Find student_id by name if studentName is provided
      if (studentName && students.length > 0) {
        const student = students.find(s => s.label === studentName);
        if (student) {
          setFilters(f => ({ ...f, student_id: student.value }));
        }
      }

      // Apply status filter
      if (status) {
        setFilters(f => ({ ...f, status }));
      }

      // Apply course filter
      if (course) {
        setFilters(f => ({ ...f, course_id: course }));
      }

      // Apply date filters
      if (startDate) {
        setFilters(f => ({ ...f, startDate }));
      }
      if (endDate) {
        setFilters(f => ({ ...f, endDate }));
      }
    }
  }, [location.search, students]);

  // Memoize filtered records to avoid recalculation on every render
  const applyFilters = useCallback(() => {
    let filtered = [...records];

    // Filter by student
    if (filters.student_id) {
      filtered = filtered.filter(r => r.student_id === filters.student_id);
    }

    // Filter by course (only if not already filtered at DB level)
    if (filters.course_id) {
      filtered = filtered.filter(r => r.course_id === filters.course_id);
    }

    // Filter by instructor (only if not already filtered at DB level)
    if (filters.teacher_id) {
      filtered = filtered.filter(r => r.teacher_id === filters.teacher_id);
    }

    // Filter by status (only if not already filtered at DB level)
    if (filters.status) {
      filtered = filtered.filter(r => r.status === filters.status);
    }

    // Filter by startDate and endDate (inclusive)
    if (filters.startDate) {
      filtered = filtered.filter(r => {
        if (!r.attendance_date) return false;
        return new Date(r.attendance_date) >= new Date(filters.startDate);
      });
    }
    if (filters.endDate) {
      filtered = filtered.filter(r => {
        if (!r.attendance_date) return false;
        return new Date(r.attendance_date) <= new Date(filters.endDate);
      });
    }

    setFilteredRecords(filtered);
  }, [records, filters]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  useEffect(() => {
    if (filteredRecords.length > 0 && showAnalytics) {
      // Only calculate analytics when explicitly shown
      calculateAnalytics();
    } else {
      setStudentAnalytics([]);
      setDateAnalytics([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRecords, showAnalytics]);

  const loadFilterOptions = async () => {
    try {
      // Load all filter options in parallel for better performance
      const [studentsRes, coursesRes, teachersRes] = await Promise.all([
        supabase
          .from('student')
          .select('student_id, name')
          .order('name'),
        supabase
          .from('course')
          .select('course_id, course_name')
          .order('course_name'),
        supabase
          .from('teacher')
          .select('teacher_id, name')
          .order('name')
      ]);

      if (studentsRes.data) {
        setStudents(studentsRes.data.map(s => ({ value: s.student_id, label: s.name })));
      }
      if (studentsRes.error) {
        console.error('Error loading students:', studentsRes.error);
      }

      if (coursesRes.data) {
        setCourses(coursesRes.data.map(c => ({ value: c.course_id, label: c.course_name })));
      }
      if (coursesRes.error) {
        console.error('Error loading courses:', coursesRes.error);
      }

      if (teachersRes.data) {
        setInstructors(teachersRes.data.map(t => ({ value: t.teacher_id, label: t.name })));
      }
      if (teachersRes.error) {
        console.error('Error loading teachers:', teachersRes.error);
      }

      // Show warning if any filter options failed to load
      if (studentsRes.error || coursesRes.error || teachersRes.error) {
        showError('Some filter options failed to load. Please refresh the page.');
      }
    } catch (error) {
      console.error('Error loading filter options:', error);
      showError('Failed to load filter options. Please refresh the page.');
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      // Build query with filters at database level for better performance
      let query = supabase
        .from('attendance')
        .select(`
          attendance_id,
          student_id,
          session_id,
          enrollment_id,
          attendance_date,
          status,
          excuse_reason,
          late_minutes,
          early_minutes,
          check_in_method,
          distance_from_host,
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          gps_timestamp,
          marked_by,
          marked_at,
          host_address,
          student:student_id (name),
          enrollment:enrollment_id (enrollment_date),
          session:session_id (
            location,
            course_id,
            teacher_id,
            course:course_id (course_name),
            teacher:teacher_id (name)
          )
        `)
        .not('status', 'is', null);
      
      // Apply filters at database level to reduce data transfer
      if (filters.student_id) {
        query = query.eq('student_id', filters.student_id);
      }
      
      if (filters.startDate) {
        query = query.gte('attendance_date', filters.startDate);
      }
      
      if (filters.endDate) {
        query = query.lte('attendance_date', filters.endDate);
      }
      
      // Order and limit
      query = query
        .order('attendance_date', { ascending: false })
        .order('marked_at', { ascending: false })
        .limit(5000); // Safety limit to prevent loading too much data

      const { data, error } = await query;

      if (error) throw error;

      // Get unique session IDs and dates to load book coverage and host addresses
      const sessionDatePairs = [...new Set(data?.map(r => `${r.session_id}|${r.attendance_date}`) || [])];
      
      // Load book coverage and host addresses in parallel
      const [coverageRes, hostRes] = await Promise.all([
        sessionDatePairs.length > 0 
          ? supabase
              .from('session_book_coverage')
              .select(`
                session_id,
                attendance_date,
                course_book_reference!inner (
                  topic,
                  start_page,
                  end_page
                )
              `)
          : Promise.resolve({ data: null, error: null }),
        sessionDatePairs.length > 0
          ? supabase
              .from('session_date_host')
              .select('session_id, attendance_date, host_address')
          : Promise.resolve({ data: null, error: null })
      ]);

      // Log errors from parallel queries (non-blocking)
      if (coverageRes.error) {
        console.warn('Failed to load book coverage data:', coverageRes.error);
      }
      if (hostRes.error) {
        console.warn('Failed to load host address data:', hostRes.error);
      }

      // Create lookup maps for O(1) access
      const bookCoverageMap = new Map<string, { topic: string; start_page: number; end_page: number }>();
      const hostAddressMap = new Map<string, string>();
      
      if (coverageRes.data) {
        coverageRes.data.forEach((cov: { session_id: string; attendance_date: string; course_book_reference: Array<{ topic: string; start_page: number; end_page: number }> }) => {
          const key = `${cov.session_id}|${cov.attendance_date}`;
          const ref = Array.isArray(cov.course_book_reference) ? cov.course_book_reference[0] : cov.course_book_reference;
          if (ref) {
            bookCoverageMap.set(key, {
              topic: ref.topic,
              start_page: ref.start_page,
              end_page: ref.end_page
            });
          }
        });
      }

      if (hostRes.data) {
        hostRes.data.forEach((h: { session_id: string; attendance_date: string; host_address: string }) => {
          const key = `${h.session_id}|${h.attendance_date}`;
          hostAddressMap.set(key, h.host_address);
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedRecords: AttendanceRecord[] = (data || []).map((record: any) => {
        const bookKey = `${record.session_id}|${record.attendance_date}`;
        const bookInfo = bookCoverageMap.get(bookKey);
        // Use host address from session_date_host (new), fallback to attendance.host_address (old)
        const hostAddress = hostAddressMap.get(bookKey) || record.host_address || null;
        const session = record.session || {};
        const student = record.student || {};
        const course = session.course || {};
        const teacher = session.teacher || {};
        
        // Handle enrollment - could be object, array, or null from Supabase
        let enrollmentDate: string | null = null;
        if (record.enrollment) {
          if (Array.isArray(record.enrollment) && record.enrollment.length > 0) {
            enrollmentDate = record.enrollment[0].enrollment_date;
          } else if (typeof record.enrollment === 'object') {
            enrollmentDate = record.enrollment.enrollment_date;
          }
        }
        
        // Auto-detect 'not enrolled' status: if attendance_date is before enrollment_date
        let finalStatus = record.status;
        if (enrollmentDate && record.attendance_date < enrollmentDate) {
          finalStatus = 'not enrolled';
        }
        
        // If enrollment_date is missing but status is not already 'not enrolled', 
        // keep the original status (assume it's valid)
        // Log warning for debugging if needed
        if (!enrollmentDate && finalStatus === 'not enrolled') {
          console.warn(`⚠️ Attendance record ${record.attendance_id} marked as 'not enrolled' but enrollment_date is missing`);
        }
        
        return {
          attendance_id: record.attendance_id,
          student_id: record.student_id,
          session_id: record.session_id,
          attendance_date: record.attendance_date,
          status: finalStatus,
          excuse_reason: record.excuse_reason || null,
          late_minutes: record.late_minutes || null,
          early_minutes: record.early_minutes || null,
          check_in_method: record.check_in_method || null,
          distance_from_host: record.distance_from_host || null,
          gps_latitude: record.gps_latitude,
          gps_longitude: record.gps_longitude,
          gps_accuracy: record.gps_accuracy,
          gps_timestamp: record.gps_timestamp,
          marked_by: record.marked_by,
          marked_at: record.marked_at,
          host_address: hostAddress, // Use host from session_date_host table (new) or attendance (fallback)
          student_name: student.name || 'Unknown',
          course_id: session.course_id || '',
          course_name: course.course_name || 'Unknown',
          teacher_id: session.teacher_id || '',
          instructor_name: teacher.name || 'Unknown',
          session_location: session.location || null,
          book_topic: bookInfo?.topic || null,
          book_start_page: bookInfo?.start_page || null,
          book_end_page: bookInfo?.end_page || null,
          _enrollmentDate: enrollmentDate, // For debugging
        };
      });

      // Debug: Log summary of enrollment data availability
      const withEnrollment = formattedRecords.filter((r) => (r as AttendanceRecord & { _enrollmentDate?: string })._enrollmentDate).length;
      const withoutEnrollment = formattedRecords.length - withEnrollment;
      const markedNotEnrolled = formattedRecords.filter(r => r.status === 'not enrolled').length;
      
      console.log(`📊 Attendance Records Loaded:`, {
        total: formattedRecords.length,
        withEnrollmentDate: withEnrollment,
        withoutEnrollmentDate: withoutEnrollment,
        markedAsNotEnrolled: markedNotEnrolled
      });
      
      if (withoutEnrollment > 0) {
        console.warn(`⚠️ ${withoutEnrollment} attendance records missing enrollment_date - these cannot be auto-detected as 'not enrolled'`);
        // Log first few examples
        const examples = formattedRecords.filter((r) => !(r as AttendanceRecord & { _enrollmentDate?: string })._enrollmentDate).slice(0, 3);
        console.log('Examples:', examples.map(r => ({
          student: r.student_name,
          date: r.attendance_date,
          status: r.status,
          attendance_id: r.attendance_id
        })));
      }

      setRecords(formattedRecords);
    } catch (error) {
      console.error('Error loading records:', error);
      showError('Failed to load attendance records. Please try again.');
      setRecords([]);
    }
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on time': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'absent': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'late': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
      case 'excused': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'not enrolled': return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'on time': return 'On Time';
      case 'absent': return 'Absent';
      case 'late': return 'Late';
      case 'excused': return 'Excused';
      case 'not enrolled': return 'Not Enrolled';
      default: return status;
    }
  };

  const openMapLocation = (record: AttendanceRecord) => {
    if (record.gps_latitude && record.gps_longitude) {
      const url = `https://www.openstreetmap.org/#map=18/${record.gps_latitude}/${record.gps_longitude}`;
      window.open(url, '_blank');
    }
  };

  const exportAnalyticsToExcel = () => {
    if (!showAnalytics || studentAnalytics.length === 0) {
      warning('Please show analytics first to export analytics data');
      return;
    }

    const isArabic = reportLanguage === 'ar';

    // Summary Statistics Sheet (always included)
    const summaryHeaders = isArabic
      ? ['العنصر', 'القيمة']
      : ['Metric', 'Value'];

    // Calculate summary values
    const totalStudents = studentAnalytics.length;
    const totalSessions = dateAnalytics.length;
    const totalPresent = studentAnalytics.reduce((sum, s) => sum + s.presentCount, 0);
    const totalLate = studentAnalytics.reduce((sum, s) => sum + s.lateCount, 0);
    const totalAbsent = studentAnalytics.reduce((sum, s) => sum + s.unexcusedAbsent, 0);
    const totalExcused = studentAnalytics.reduce((sum, s) => sum + s.excusedCount, 0);
    const classAvgRate = studentAnalytics.length > 0
      ? Math.round(studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) / studentAnalytics.length)
      : 0;
    const avgWeightedScore = studentAnalytics.length > 0
      ? Math.round(studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) / studentAnalytics.length)
      : 0;
    const avgConsistency = studentAnalytics.length > 0
      ? Math.round(studentAnalytics.reduce((sum, s) => sum + s.consistencyIndex, 0) / studentAnalytics.length * 100) / 100
      : 0;
    const avgAttendanceByDate = dateAnalytics.length > 0
      ? Math.round(dateAnalytics.reduce((sum, d) => sum + d.attendanceRate, 0) / dateAnalytics.length)
      : 0;
    const avgAttendanceByAccruedDate = (() => {
      const accruedDates = dateAnalytics.filter(d => (d.presentCount + d.lateCount) > 0);
      if (accruedDates.length === 0) return 0;
      return Math.round(
        accruedDates.reduce((sum, d) => sum + d.attendanceRate, 0) / accruedDates.length
      );
    })();

    const summaryRows = isArabic
      ? [
          ['عدد الطلاب', totalStudents],
          ['عدد الجلسات', totalSessions],
          ['إجمالي الحضور في الوقت', totalPresent],
          ['إجمالي المتأخرين', totalLate],
          ['إجمالي الغياب بدون عذر', totalAbsent],
          ['إجمالي الغياب بعذر', totalExcused],
          ['معدل الحضور للصف (%)', `${classAvgRate}%`],
          ['متوسط النقاط المرجحة', avgWeightedScore],
          ['متوسط مؤشر الانتظام', avgConsistency],
          ['متوسط الحضور حسب التاريخ (%)', `${avgAttendanceByDate}%`],
          ['متوسط الحضور حسب التاريخ للحصص النشطة (%)', `${avgAttendanceByAccruedDate}%`],
        ]
      : [
          ['Total Students', totalStudents],
          ['Total Sessions', totalSessions],
          ['Total On Time', totalPresent],
          ['Total Late', totalLate],
          ['Total Unexcused Absent', totalAbsent],
          ['Total Excused', totalExcused],
          ['Class Avg Rate (%)', `${classAvgRate}%`],
          ['Avg Weighted Score', avgWeightedScore],
          ['Avg Consistency Index', avgConsistency],
          ['Avg Attendance by Date (%)', `${avgAttendanceByDate}%`],
          ['Avg Attendance by Accrued Date (%)', `${avgAttendanceByAccruedDate}%`],
        ];

    // ========== STUDENT PERFORMANCE SHEET - Uses saved field selections ==========
    const studentConfig = filterDataByFields('studentAnalytics', isArabic);
    
    // Prepare student data objects with all possible fields
    const studentDataObjectsUnsorted = studentAnalytics.map((student, index) => {
      const totalPres = student.presentCount + student.lateCount;
      const punctRate = totalPres > 0 
        ? Math.round(student.presentCount / totalPres * 100)
        : 0;

      return {
        rank: index + 1,
        student_id: student.student_id,
        student_name: student.student_name,
        presentCount: student.presentCount,
        lateCount: student.lateCount,
        totalPresent: totalPres,
        absentCount: student.absentCount,
        unexcusedAbsent: student.unexcusedAbsent,
        excusedCount: student.excusedCount,
        totalRecords: student.totalRecords,
        effectiveDays: student.effectiveDays,
        daysCovered: student.daysCovered,
        attendanceRate: student.attendanceRate,
        punctualityRate: punctRate,
        weightedScore: student.weightedScore,
        consistencyIndex: Math.round(student.consistencyIndex * 100) / 100,
        trendSlope: student.trend?.slope || 0,
        trendClassification: student.trend?.classification || '-',
        trendRSquared: student.trend?.rSquared || 0,
        weeklyChange: student.weeklyChange || 0,
        avgRate: student.avgRate || student.attendanceRate,
        minRate: student.minRate || student.attendanceRate,
        maxRate: student.maxRate || student.attendanceRate,
        // Score Breakdown
        qualityAdjustedRate: Math.round((student.qualityAdjustedRate || 0) * 100) / 100,
        rawWeightedScore: Math.round((student.rawWeightedScore || 0) * 100) / 100,
        coverageFactor: Math.round((student.coverageFactor || 0) * 1000) / 1000,
        scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} × ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
        // Late Duration
        totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: Math.round((student.lateScoreAvg || 0) * 1000) / 1000,
      };
    });
    
    // Apply sorting from saved settings
    const studentDataObjects = sortDataBySettings(studentDataObjectsUnsorted, 'studentAnalytics');
    // Re-assign ranks after sorting
    studentDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    const studentRows = studentDataObjects.map((data, index) => 
      studentConfig.getData(data as Record<string, unknown>, index)
    );

    // ========== ATTENDANCE BY DATE SHEET - Uses saved field selections ==========
    const dateConfig = filterDataByFields('dateAnalytics', isArabic);
    
    // Prepare date data objects with all possible fields
    const dateDataObjectsUnsorted = dateAnalytics.map((dateData) => {
      let excusedLabel = dateData.excusedNames.join(', ') || '-';
      if (
        dateData.hostAddress === 'SESSION_NOT_HELD' ||
        (dateData.hostAddress && dateData.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
      ) {
        excusedLabel = reportLanguage === 'ar' ? 'جميع الطلاب' : 'All Students';
      }
      
      const bookPages = dateData.bookStartPage && dateData.bookEndPage 
        ? `${dateData.bookStartPage}-${dateData.bookEndPage}` 
        : '-';
      const pagesCount = dateData.bookStartPage && dateData.bookEndPage
        ? dateData.bookEndPage - dateData.bookStartPage + 1
        : 0;
      const totalPresent = dateData.presentCount + dateData.lateCount;
      const totalStudents = totalPresent + dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
      // Attendance Rate: (Total Present / Total Students) * 100
      const attendanceRate = totalStudents > 0 ? Math.round((totalPresent / totalStudents) * 100) : 0;
      // Absence Rate: (Unexcused Absent / (Unexcused Absent + Present)) * 100
      const absentRate = (dateData.unexcusedAbsentCount + totalPresent) > 0 ? Math.round((dateData.unexcusedAbsentCount / (dateData.unexcusedAbsentCount + totalPresent)) * 100) : 0;
      const punctRate = totalPresent > 0 
        ? Math.round(dateData.presentCount / totalPresent * 100)
        : 0;
      const dateObj = new Date(dateData.date);
      
      return {
        date: format(dateObj, 'MMM dd, yyyy'),
        dayOfWeek: format(dateObj, 'EEEE'),
        hostAddress: dateData.hostAddress || '-',
        bookTopic: dateData.bookTopic || '-',
        bookPages,
        bookStartPage: dateData.bookStartPage || '-',
        bookEndPage: dateData.bookEndPage || '-',
        pagesCount: pagesCount > 0 ? pagesCount : '-',
        presentCount: dateData.presentCount,
        lateCount: dateData.lateCount,
        totalPresent,
        excusedAbsentCount: dateData.excusedAbsentCount,
        unexcusedAbsentCount: dateData.unexcusedAbsentCount,
        totalAbsent: dateData.excusedAbsentCount + dateData.unexcusedAbsentCount,
        totalStudents,
        attendanceRate,
        punctualityRate: punctRate,
        absentRate,
        // Late Duration
        totalLateMinutes: Math.round((dateData.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((dateData.avgLateMinutes || 0) * 10) / 10,
        presentNames: dateData.presentNames.join(', ') || '-',
        lateNames: dateData.lateNames.join(', ') || '-',
        excusedNames: excusedLabel,
        absentNames: dateData.absentNames.join(', ') || '-',
      };
    });
    
    // Apply sorting and row filtering from saved settings for date analytics
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    const dateRows = dateDataObjects.map((data, index) => 
      dateConfig.getData(data as Record<string, unknown>, index)
    );

    // ========== HOST RANKINGS SHEET - Uses saved field selections ==========
    const hostConfig = filterDataByFields('hostAnalytics', isArabic);
    
    // Build host data
    const hostMap = new Map<string, { count: number; dates: string[]; rawDates: Date[]; present: number; late: number; absent: number; excused: number }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || { count: 0, dates: [], rawDates: [], present: 0, late: 0, absent: 0, excused: 0 };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    const hostRankings = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count);

    // Prepare host data objects with all possible fields
    const hostDataObjectsUnsorted = hostRankings.map((host, index) => {
      const totalPresent = host.present + host.late;
      const totalStudents = totalPresent + host.absent + host.excused;
      // Fair calculation: Exclude excused from denominator - they had valid reasons
      const expectedAttendees = totalPresent + host.absent;
      const attendanceRate = expectedAttendees > 0 ? Math.round(totalPresent / expectedAttendees * 100) : 0;
      const firstDateTimestamp = host.rawDates.length > 0 ? Math.min(...host.rawDates.map(d => d.getTime())) : 0;
      const lastDateTimestamp = host.rawDates.length > 0 ? Math.max(...host.rawDates.map(d => d.getTime())) : 0;
      
      return {
        rank: index + 1,
        address: host.address,
        count: host.count,
        percentage: totalHostings > 0 ? Math.round(host.count / totalHostings * 100) : 0,
        attendanceRate,
        firstHostDate: firstDateTimestamp > 0 ? format(new Date(firstDateTimestamp), 'MMM dd, yyyy') : '-',
        firstHostDateRaw: firstDateTimestamp, // Raw timestamp for sorting
        lastHostDate: lastDateTimestamp > 0 ? format(new Date(lastDateTimestamp), 'MMM dd, yyyy') : '-',
        lastHostDateRaw: lastDateTimestamp, // Raw timestamp for sorting
        totalOnTime: host.present,
        totalLate: host.late,
        totalPresent,
        totalAbsent: host.absent,
        totalExcused: host.excused,
        totalStudents,
        dates: host.dates.join(', '),
      };
    });
    
    // Apply sorting from saved settings for host analytics
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    // Re-assign ranks after sorting
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    const hostRows = hostDataObjects.map((data, index) => 
      hostConfig.getData(data as Record<string, unknown>, index)
    );

    // Create workbook with sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary Statistics
    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, wsSummary, isArabic ? 'إحصائيات عامة' : 'Summary Statistics');

    // Sheet 2: Student Performance (filtered by saved selection)
    const ws1 = XLSX.utils.aoa_to_sheet([studentConfig.headers, ...studentRows]);
    XLSX.utils.book_append_sheet(wb, ws1, isArabic ? 'أداء الطلاب' : 'Student Performance');

    // Sheet 3: Attendance by Date (filtered by saved selection)
    const ws2 = XLSX.utils.aoa_to_sheet([dateConfig.headers, ...dateRows]);
    XLSX.utils.book_append_sheet(wb, ws2, isArabic ? 'الحضور بالتاريخ' : 'Attendance by Date');

    // Sheet 4: Host Rankings (filtered by saved selection)
    const ws3 = XLSX.utils.aoa_to_sheet([hostConfig.headers, ...hostRows]);
    XLSX.utils.book_append_sheet(wb, ws3, isArabic ? 'تصنيف المضيفين' : 'Host Rankings');

    // Export to file
    const excelFileName = isArabic 
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, excelFileName);
  };

  // ========== ANALYTICS CSV EXPORT - Uses saved field selections and sorting ==========
  const exportAnalyticsToCSV = () => {
    if (!showAnalytics || studentAnalytics.length === 0) {
      warning('Please show analytics first to export CSV report');
      return;
    }

    const isArabic = reportLanguage === 'ar';
    
    // Escape CSV fields and add proper quoting
    const escapeCSV = (field: unknown): string => {
      const str = String(field ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Get configurations for all three data types
    const studentConfig = filterDataByFields('studentAnalytics', isArabic);
    const dateConfig = filterDataByFields('dateAnalytics', isArabic);
    const hostConfig = filterDataByFields('hostAnalytics', isArabic);

    // Prepare student data with all possible fields
    const studentDataObjectsUnsorted = studentAnalytics.map((student, index) => {
      const totalPres = student.presentCount + student.lateCount;
      const punctRate = totalPres > 0 ? Math.round(student.presentCount / totalPres * 100) : 0;
      return {
        rank: index + 1,
        student_id: student.student_id,
        student_name: student.student_name,
        presentCount: student.presentCount,
        lateCount: student.lateCount,
        totalPresent: totalPres,
        absentCount: student.absentCount,
        unexcusedAbsent: student.unexcusedAbsent,
        excusedCount: student.excusedCount,
        totalRecords: student.totalRecords,
        effectiveDays: student.effectiveDays,
        daysCovered: student.daysCovered,
        attendanceRate: student.attendanceRate,
        punctualityRate: punctRate,
        weightedScore: student.weightedScore,
        consistencyIndex: Math.round(student.consistencyIndex * 100) / 100,
        trendSlope: student.trend?.slope || 0,
        trendClassification: student.trend?.classification || '-',
        trendRSquared: student.trend?.rSquared || 0,
        weeklyChange: student.weeklyChange || 0,
        avgRate: student.avgRate || student.attendanceRate,
        minRate: student.minRate || student.attendanceRate,
        maxRate: student.maxRate || student.attendanceRate,
        // Score Breakdown
        qualityAdjustedRate: Math.round((student.qualityAdjustedRate || 0) * 100) / 100,
        rawWeightedScore: Math.round((student.rawWeightedScore || 0) * 100) / 100,
        coverageFactor: Math.round((student.coverageFactor || 0) * 1000) / 1000,
        scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} × ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
        // Late Duration
        totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: Math.round((student.lateScoreAvg || 0) * 1000) / 1000,
      };
    });
    const studentDataObjects = sortDataBySettings(studentDataObjectsUnsorted, 'studentAnalytics');
    studentDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Prepare date data with all possible fields
    const dateDataObjectsUnsorted = dateAnalytics.map((d) => {
      const totalPres = d.presentCount + d.lateCount;
      const totalAbs = d.excusedAbsentCount + d.unexcusedAbsentCount;
      const totalStud = totalPres + totalAbs;
      const punctRate = totalPres > 0 ? Math.round(d.presentCount / totalPres * 100) : 0;
      const absRate = totalStud > 0 ? Math.round(totalAbs / totalStud * 100) : 0;
      const bookPages = d.bookStartPage && d.bookEndPage ? `${d.bookStartPage}-${d.bookEndPage}` : '-';
      const pagesCount = d.bookStartPage && d.bookEndPage ? d.bookEndPage - d.bookStartPage + 1 : 0;
      const dateObj = new Date(d.date);
      return {
        date: format(dateObj, 'MMM dd, yyyy'),
        dayOfWeek: format(dateObj, 'EEEE'),
        hostAddress: d.hostAddress || '-',
        bookTopic: d.bookTopic || '-',
        bookPages,
        bookStartPage: d.bookStartPage || '-',
        bookEndPage: d.bookEndPage || '-',
        pagesCount: pagesCount > 0 ? pagesCount : '-',
        presentCount: d.presentCount,
        lateCount: d.lateCount,
        totalPresent: totalPres,
        excusedAbsentCount: d.excusedAbsentCount,
        unexcusedAbsentCount: d.unexcusedAbsentCount,
        totalAbsent: totalAbs,
        totalStudents: totalStud,
        attendanceRate: d.attendanceRate,
        punctualityRate: punctRate,
        absentRate: absRate,
        // Late Duration
        totalLateMinutes: Math.round((d.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((d.avgLateMinutes || 0) * 10) / 10,
        presentNames: d.presentNames.join(', ') || '-',
        lateNames: d.lateNames.join(', ') || '-',
        excusedNames: d.excusedNames.join(', ') || '-',
        absentNames: d.absentNames.join(', ') || '-',
      };
    });
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Prepare host data with all possible fields
    const hostMap = new Map<string, { count: number; dates: string[]; rawDates: Date[]; present: number; late: number; absent: number; excused: number }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || { count: 0, dates: [], rawDates: [], present: 0, late: 0, absent: 0, excused: 0 };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });
    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    const hostDataObjectsUnsorted = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count)
      .map((host, index) => {
        const totalPresent = host.present + host.late;
        const totalStudents = totalPresent + host.absent + host.excused;
        // Fair calculation: Exclude excused from denominator - they had valid reasons
        const expectedAttendees = totalPresent + host.absent;
        const attendanceRate = expectedAttendees > 0 ? Math.round(totalPresent / expectedAttendees * 100) : 0;
        const firstDateTimestamp = host.rawDates.length > 0 ? Math.min(...host.rawDates.map(d => d.getTime())) : 0;
        const lastDateTimestamp = host.rawDates.length > 0 ? Math.max(...host.rawDates.map(d => d.getTime())) : 0;
        
        return {
          rank: index + 1,
          address: host.address,
          count: host.count,
          percentage: totalHostings > 0 ? Math.round(host.count / totalHostings * 100) : 0,
          attendanceRate,
          firstHostDate: firstDateTimestamp > 0 ? format(new Date(firstDateTimestamp), 'MMM dd, yyyy') : '-',
          firstHostDateRaw: firstDateTimestamp,
          lastHostDate: lastDateTimestamp > 0 ? format(new Date(lastDateTimestamp), 'MMM dd, yyyy') : '-',
          lastHostDateRaw: lastDateTimestamp,
          totalOnTime: host.present,
          totalLate: host.late,
          totalPresent,
          totalAbsent: host.absent,
          totalExcused: host.excused,
          totalStudents,
          dates: host.dates.join(', '),
        };
      });
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Build CSV content with all three sections
    const sections: string[] = [];
    
    // Section 1: Student Performance
    const studentTitle = isArabic ? '# أداء الطلاب' : '# Student Performance';
    const studentHeaderRow = studentConfig.headers.map(escapeCSV).join(',');
    const studentRows = studentDataObjects.map((data, index) => 
      studentConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
    );
    sections.push(studentTitle);
    sections.push(studentHeaderRow);
    sections.push(...studentRows);
    sections.push(''); // Empty line between sections

    // Section 2: Attendance by Date
    const dateTitle = isArabic ? '# الحضور حسب التاريخ' : '# Attendance by Date';
    const dateHeaderRow = dateConfig.headers.map(escapeCSV).join(',');
    const dateRows = dateDataObjects.map((data, index) => 
      dateConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
    );
    sections.push(dateTitle);
    sections.push(dateHeaderRow);
    sections.push(...dateRows);
    sections.push(''); // Empty line between sections

    // Section 3: Host Rankings
    if (hostDataObjects.length > 0) {
      const hostTitle = isArabic ? '# تصنيف المضيفين' : '# Host Rankings';
      const hostHeaderRow = hostConfig.headers.map(escapeCSV).join(',');
      const hostRows = hostDataObjects.map((data, index) => 
        hostConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
      );
      sections.push(hostTitle);
      sections.push(hostHeaderRow);
      sections.push(...hostRows);
    }

    // Add BOM for UTF-8 and create blob
    const BOM = '\uFEFF';
    const csvContent = BOM + sections.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const csvFileName = isArabic 
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.csv`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.setAttribute('download', csvFileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportAnalyticsToPDF = () => {
    if (!showAnalytics || studentAnalytics.length === 0 || dateAnalytics.length === 0) {
      warning('Please show analytics first to export PDF report');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const isArabic = reportLanguage === 'ar';
    
    // For Arabic, we'll use a workaround: render text as images or use simple transliteration
    // Since jsPDF doesn't support Arabic fonts out of the box, we keep English for PDF
    // and recommend CSV for full Arabic support
    if (isArabic) {
      const confirmExport = window.confirm(
        'PDF export works best in English.\n\n' +
        'For full Arabic support with proper formatting, please use CSV Export.\n\n' +
        'Continue with English PDF?'
      );
      if (!confirmExport) return;
    }
    
    // Title (Always English for PDF)
    doc.setFontSize(18);
    doc.text('Attendance Analytics Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, 22, { align: 'center' });
    doc.text(`Date Range: ${format(new Date(filters.startDate), 'MMM dd, yyyy')} - ${format(new Date(filters.endDate), 'MMM dd, yyyy')}`, pageWidth / 2, 28, { align: 'center' });

    // Summary Statistics Section (Compact Format)
    doc.setFontSize(10);
    
    const totalStudents = studentAnalytics.length;
    const classAvgRate = studentAnalytics.length > 0 
      ? Math.round(studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) / studentAnalytics.length)
      : 0;
    const avgWeightedScore = studentAnalytics.length > 0
      ? Math.round(studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) / studentAnalytics.length)
      : 0;
    const avgAttendanceByDate = dateAnalytics.length > 0
      ? Math.round(dateAnalytics.reduce((sum, d) => sum + d.attendanceRate, 0) / dateAnalytics.length)
      : 0;
    const avgAttendanceByAccruedDate = (() => {
      const accruedDates = dateAnalytics.filter(d => (d.presentCount + d.lateCount) > 0);
      if (accruedDates.length === 0) return 0;
      return Math.round(
        accruedDates.reduce((sum, d) => sum + d.attendanceRate, 0) / accruedDates.length
      );
    })();

    // Compact inline stats display (Always English for PDF)
    const statsText = `Total Students: ${totalStudents} Students | class Avg Rate: ${classAvgRate}% | Avg weighted Score: ${avgWeightedScore} | Avg attendance by Date: ${avgAttendanceByDate}% | Avg attendance by Accrued Date: ${avgAttendanceByAccruedDate}%`;
    doc.setFontSize(8);
    doc.text(statsText, 8, 35);
    doc.setFontSize(10); // Restore font size for following content

    // ========== Use saved field selections for PDF ==========
    const studentConfig = filterDataByFields('studentAnalytics', false); // Always English for PDF
    const dateConfig = filterDataByFields('dateAnalytics', false);
    const hostConfig = filterDataByFields('hostAnalytics', false);
    
    // Prepare student data objects
    const studentDataObjectsUnsorted = studentAnalytics.map((student, index) => {
      const totalPres = student.presentCount + student.lateCount;
      const punctRate = totalPres > 0 ? Math.round(student.presentCount / totalPres * 100) : 0;
      return {
        rank: index + 1,
        student_id: student.student_id,
        student_name: student.student_name,
        presentCount: student.presentCount,
        lateCount: student.lateCount,
        totalPresent: totalPres,
        absentCount: student.absentCount,
        unexcusedAbsent: student.unexcusedAbsent,
        excusedCount: student.excusedCount,
        totalRecords: student.totalRecords,
        effectiveDays: student.effectiveDays,
        daysCovered: student.daysCovered,
        attendanceRate: `${student.attendanceRate}%`,
        punctualityRate: `${punctRate}%`,
        weightedScore: student.weightedScore.toFixed(1),
        consistencyIndex: (student.consistencyIndex * 100).toFixed(0),
        trendSlope: student.trend?.slope || 0,
        trendClassification: student.trend?.classification || '-',
        trendRSquared: student.trend?.rSquared || 0,
        weeklyChange: `${student.weeklyChange || 0}%`,
        avgRate: `${student.avgRate || student.attendanceRate}%`,
        minRate: `${student.minRate || student.attendanceRate}%`,
        maxRate: `${student.maxRate || student.attendanceRate}%`,
        // Score Breakdown
        qualityAdjustedRate: `${Math.round((student.qualityAdjustedRate || 0) * 100) / 100}%`,
        rawWeightedScore: (student.rawWeightedScore || 0).toFixed(1),
        coverageFactor: (student.coverageFactor || 0).toFixed(3),
        scoreFormula: `(${(student.rawWeightedScore || 0).toFixed(1)} × ${(student.coverageFactor || 0).toFixed(3)}) = ${student.weightedScore.toFixed(1)}`,
        // Late Duration
        totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: (student.lateScoreAvg || 0).toFixed(3),
      };
    });
    
    // Apply sorting from saved settings
    const studentDataObjects = sortDataBySettings(studentDataObjectsUnsorted, 'studentAnalytics');
    studentDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Student Performance Table using saved fields
    doc.setFontSize(12);
    doc.text('Student Performance Summary', 14, 42);
    
    // Helper function to detect percentage columns for conditional coloring
    const detectPercentageColumns = (headers: string[]): number[] => {
      const percentagePatterns = [
        /rate/i, /percentage/i, /percent/i, /%/, /score/i, /weighted/i,
        /attendance/i, /punctuality/i, /consistency/i, /avg/i, /average/i,
      ];
      return headers
        .map((header, idx) => {
          const matchesPattern = percentagePatterns.some(pattern => pattern.test(header));
          return matchesPattern ? idx : -1;
        })
        .filter(idx => idx !== -1);
    };

    // Helper to resolve color columns for a specific data type using saved settings
    const resolveColorColumns = (
      dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics',
      headers: string[]
    ): { colorColumns: number[]; theme: 'default' | 'traffic' | 'heatmap' | 'status'; enabled: boolean } => {
      const settings = getColoringSettingsForType(dataType);
      if (!settings.enableConditionalColoring) return { colorColumns: [], theme: settings.coloringTheme, enabled: false };
      
      if (settings.coloringFields.length > 0) {
        // User explicitly selected fields to color — map field keys to column indices
        const selectedKeys = getSelectedFieldsForType(dataType);
        const colorColumns = settings.coloringFields
          .map(fieldKey => selectedKeys.indexOf(fieldKey))
          .filter(idx => idx !== -1);
        return { colorColumns, theme: settings.coloringTheme, enabled: true };
      }
      
      // Auto-detect from headers
      return { colorColumns: detectPercentageColumns(headers), theme: settings.coloringTheme, enabled: true };
    };

    // Color function for PDF conditional coloring - uses theme
    const getColorForValuePDF = (value: number, theme: 'default' | 'traffic' | 'heatmap' | 'status'): [number, number, number] => {
      return getColorForPercentage(value, theme).rgb;
    };

    // Resolve per-type coloring settings
    const studentColoring = resolveColorColumns('studentAnalytics', studentConfig.headers);
    const dateColoring = resolveColorColumns('dateAnalytics', dateConfig.headers);
    const hostColoring = resolveColorColumns('hostAnalytics', hostConfig.headers);

    // Detect percentage columns for student table
    const studentColorColumns = studentColoring.colorColumns;
    
    autoTable(doc, {
      startY: 46,
      head: [studentConfig.headers],
      body: studentDataObjects.slice(0, 20).map((data, index) => studentConfig.getData(data as Record<string, unknown>, index)) as (string | number)[][],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      rowPageBreak: 'avoid',
      didParseCell: (hookData) => {
        if (studentColoring.enabled && hookData.section === 'body' && studentColorColumns.includes(hookData.column.index)) {
          const cellText = hookData.cell.text.join('');
          const numMatch = cellText.match(/(\d+\.?\d*)/);
          if (numMatch) {
            const value = parseFloat(numMatch[1]);
            if (!isNaN(value) && value >= 0 && value <= 100) {
              hookData.cell.styles.fillColor = getColorForValuePDF(value, studentColoring.theme);
              hookData.cell.styles.textColor = [255, 255, 255];
              hookData.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });

    // Date Analytics Table using saved fields
    const performanceTableY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 46;
    doc.setFontSize(12);
    doc.text('Attendance by Date', 14, performanceTableY + 10);
    
    // Prepare date data objects
    const dateDataObjectsUnsorted = dateAnalytics.map((dateData) => {
      let excusedLabel = dateData.excusedNames.join(', ') || '-';
      const totalStudents = dateData.presentCount + dateData.lateCount + dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
      const totalPresent = dateData.presentCount + dateData.lateCount;
      const totalAbsent = dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
      
      if (
        dateData.hostAddress === 'SESSION_NOT_HELD' ||
        (dateData.hostAddress && dateData.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
      ) {
        excusedLabel = 'All Students';
      }
      
      const bookPages = dateData.bookStartPage && dateData.bookEndPage 
        ? `${dateData.bookStartPage}-${dateData.bookEndPage}` 
        : '-';
      const pagesCount = dateData.bookStartPage && dateData.bookEndPage
        ? dateData.bookEndPage - dateData.bookStartPage + 1
        : 0;
      const punctualityRate = totalPresent > 0 
        ? Math.round(dateData.presentCount / totalPresent * 100)
        : 0;
      const absentRate = (dateData.unexcusedAbsentCount + totalPresent) > 0
        ? Math.round((dateData.unexcusedAbsentCount / (dateData.unexcusedAbsentCount + totalPresent)) * 100)
        : 0;
      const dateObj = new Date(dateData.date);
      
      return {
        date: format(dateObj, 'MMM dd, yyyy'),
        dayOfWeek: format(dateObj, 'EEEE'),
        hostAddress: dateData.hostAddress || '-',
        bookTopic: dateData.bookTopic || '-',
        bookPages,
        bookStartPage: dateData.bookStartPage || '-',
        bookEndPage: dateData.bookEndPage || '-',
        pagesCount: pagesCount > 0 ? pagesCount : '-',
        presentCount: dateData.presentCount,
        lateCount: dateData.lateCount,
        totalPresent,
        excusedAbsentCount: dateData.excusedAbsentCount,
        unexcusedAbsentCount: dateData.unexcusedAbsentCount,
        totalAbsent,
        totalStudents,
        attendanceRate: `${dateData.attendanceRate}%`,
        punctualityRate: `${punctualityRate}%`,
        absentRate: `${absentRate}%`,
        // Late Duration
        totalLateMinutes: Math.round((dateData.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((dateData.avgLateMinutes || 0) * 10) / 10,
        presentNames: dateData.presentNames.join(', ') || '-',
        lateNames: dateData.lateNames.join(', ') || '-',
        excusedNames: excusedLabel,
        absentNames: dateData.absentNames.join(', ') || '-',
      };
    });
    
    // Apply sorting and row filtering from saved settings
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Detect percentage columns for date table - use per-type settings
    const dateColorColumns = dateColoring.colorColumns;

    autoTable(doc, {
      startY: performanceTableY + 14,
      head: [dateConfig.headers],
      body: dateDataObjects.map((data, index) => dateConfig.getData(data as Record<string, unknown>, index)) as (string | number)[][],
      styles: { fontSize: 6, cellPadding: 1.5 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 6 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      rowPageBreak: 'avoid',
      didParseCell: (hookData) => {
        if (dateColoring.enabled && hookData.section === 'body' && dateColorColumns.includes(hookData.column.index)) {
          const cellText = hookData.cell.text.join('');
          const numMatch = cellText.match(/(\d+\.?\d*)/);
          if (numMatch) {
            const value = parseFloat(numMatch[1]);
            if (!isNaN(value) && value >= 0 && value <= 100) {
              hookData.cell.styles.fillColor = getColorForValuePDF(value, dateColoring.theme);
              hookData.cell.styles.textColor = [255, 255, 255];
              hookData.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });

    // Host Rankings Table using saved fields
    const dateTableY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || performanceTableY + 14;
    
    // Calculate host rankings
    const hostMap = new Map<string, { 
      count: number; 
      dates: string[]; 
      rawDates: Date[];
      present: number;
      late: number;
      absent: number;
      excused: number;
    }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || { 
          count: 0, 
          dates: [], 
          rawDates: [],
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
        };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    
    const hostDataObjectsUnsorted = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count)
      .map((host, index) => {
        const totalStudents = host.present + host.late + host.absent + host.excused;
        const totalPresent = host.present + host.late;
        // Fair calculation: Exclude excused from denominator - they had valid reasons
        const expectedAttendees = totalPresent + host.absent;
        const attendanceRate = expectedAttendees > 0 ? Math.round(totalPresent / expectedAttendees * 100) : 0;
        const firstRaw = host.rawDates.length > 0 ? Math.min(...host.rawDates.map(d => d.getTime())) : 0;
        const lastRaw = host.rawDates.length > 0 ? Math.max(...host.rawDates.map(d => d.getTime())) : 0;
        return {
          rank: index + 1,
          address: host.address,
          count: host.count,
          percentage: totalHostings > 0 ? Math.round(host.count / totalHostings * 100) : 0,
          attendanceRate,
          firstHostDate: host.rawDates.length > 0 ? format(new Date(firstRaw), 'MMM dd, yyyy') : '-',
          firstHostDateRaw: firstRaw,
          lastHostDate: host.rawDates.length > 0 ? format(new Date(lastRaw), 'MMM dd, yyyy') : '-',
          lastHostDateRaw: lastRaw,
          totalOnTime: host.present,
          totalLate: host.late,
          totalPresent,
          totalAbsent: host.absent,
          totalExcused: host.excused,
          totalStudents,
          dates: host.dates.join(', '),
        };
      });
    
    // Apply sorting from saved settings
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    if (hostDataObjects.length > 0) {
      doc.setFontSize(12);
      doc.text('Host Rankings', 14, dateTableY + 10);

      // Detect percentage columns for host table - use per-type settings
      const hostColorColumns = hostColoring.colorColumns;

      autoTable(doc, {
        startY: dateTableY + 14,
        head: [hostConfig.headers],
        body: hostDataObjects.map((data, index) => hostConfig.getData(data as Record<string, unknown>, index)) as (string | number)[][],
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        didParseCell: (hookData) => {
          if (hostColoring.enabled && hookData.section === 'body' && hostColorColumns.includes(hookData.column.index)) {
            const cellText = hookData.cell.text.join('');
            const numMatch = cellText.match(/(\d+\.?\d*)/);
            if (numMatch) {
              const value = parseFloat(numMatch[1]);
              if (!isNaN(value) && value >= 0 && value <= 100) {
                hookData.cell.styles.fillColor = getColorForValuePDF(value, hostColoring.theme);
                hookData.cell.styles.textColor = [255, 255, 255];
                hookData.cell.styles.fontStyle = 'bold';
              }
            }
          }
        },
      });
    }

    // Add color legend at the end of the PDF - only if any coloring was applied
    const anyColoringEnabled = studentColoring.enabled || dateColoring.enabled || hostColoring.enabled;
    if (anyColoringEnabled) {
      // Use the theme from whichever section has coloring enabled (prefer student)
      const legendTheme = studentColoring.enabled ? studentColoring.theme
        : dateColoring.enabled ? dateColoring.theme : hostColoring.theme;
      const finalY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 200;
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Color Legend (${legendTheme} theme):`, 14, finalY + 8);
      
      // Draw legend boxes based on theme
      const legendItems = legendTheme === 'traffic' 
        ? [
            { label: '80%+ Good', color: [34, 197, 94] as [number, number, number] },
            { label: '60-79% Warning', color: [234, 179, 8] as [number, number, number] },
            { label: '<60% Needs Attention', color: [239, 68, 68] as [number, number, number] },
          ]
        : legendTheme === 'heatmap'
        ? [
            { label: '90%+ Excellent', color: [30, 64, 175] as [number, number, number] },
            { label: '75-89% Good', color: [59, 130, 246] as [number, number, number] },
            { label: '60-74% Moderate', color: [147, 197, 253] as [number, number, number] },
            { label: '<60% Low', color: [219, 234, 254] as [number, number, number] },
          ]
        : [
            { label: '90%+ Excellent', color: [16, 185, 129] as [number, number, number] },
            { label: '75-89% Good', color: [59, 130, 246] as [number, number, number] },
            { label: '60-74% Moderate', color: [245, 158, 11] as [number, number, number] },
            { label: '<60% Needs Attention', color: [239, 68, 68] as [number, number, number] },
          ];
      
      let legendX = 55;
      legendItems.forEach(item => {
        doc.setFillColor(item.color[0], item.color[1], item.color[2]);
        doc.rect(legendX, finalY + 5, 6, 3, 'F');
        doc.setTextColor(60, 60, 60);
        doc.text(item.label, legendX + 8, finalY + 7.5);
        legendX += 42;
      });
      
      doc.setTextColor(0, 0, 0);
    }

    const pdfFileName = isArabic 
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.pdf`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(pdfFileName);
  };

  const exportAnalyticsToWord = async () => {
    if (!showAnalytics || studentAnalytics.length === 0 || dateAnalytics.length === 0) {
      warning('Please show analytics first to export Word report');
      return;
    }

    if (exportingWord) return; // Prevent double-clicks

    setExportingWord(true);
    const isArabic = reportLanguage === 'ar';

    // ========== Use saved field selections for Word export ==========
    const studentConfig = filterDataByFields('studentAnalytics', isArabic);
    const dateConfig = filterDataByFields('dateAnalytics', isArabic);
    const hostConfig = filterDataByFields('hostAnalytics', isArabic);

    // Prepare comprehensive summary statistics matching Excel/PDF
    const totalStudents = studentAnalytics.length;
    const totalSessions = dateAnalytics.length;
    const classAvgRate = studentAnalytics.length > 0
      ? studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) / studentAnalytics.length
      : 0;
    const avgWeightedScore = studentAnalytics.length > 0
      ? studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) / studentAnalytics.length
      : 0;
    const avgAttendanceByDate = dateAnalytics.length > 0
      ? dateAnalytics.reduce((sum, d) => sum + d.attendanceRate, 0) / dateAnalytics.length
      : 0;
    const avgAttendanceByAccruedDate = (() => {
      const accruedDates = dateAnalytics.filter(d => (d.presentCount + d.lateCount) > 0);
      if (accruedDates.length === 0) return 0;
      return accruedDates.reduce((sum, d) => sum + d.attendanceRate, 0) / accruedDates.length;
    })();
    
    const totalPresent = studentAnalytics.reduce((sum, s) => sum + s.presentCount, 0);
    const totalLate = studentAnalytics.reduce((sum, s) => sum + s.lateCount, 0);
    const totalAbsent = studentAnalytics.reduce((sum, s) => sum + s.unexcusedAbsent, 0);
    const totalExcused = studentAnalytics.reduce((sum, s) => sum + s.excusedCount, 0);

    const summaryStats = {
      totalStudents,
      totalSessions,
      classAvgRate,
      avgWeightedScore,
      avgAttendanceByDate,
      avgAttendanceByAccruedDate,
      totalPresent,
      totalAbsent,
      totalExcused,
      totalLate,
    };

    // Prepare student data with all possible fields
    const studentDataObjectsUnsorted = studentAnalytics.map((s, index) => {
      const totalPres = s.presentCount + s.lateCount;
      const punctualityRate = totalPres > 0 ? (s.presentCount / totalPres * 100) : 0;

      return {
        rank: index + 1,
        student_id: s.student_id,
        student_name: s.student_name,
        presentCount: s.presentCount,
        lateCount: s.lateCount,
        totalPresent: totalPres,
        absentCount: s.absentCount,
        unexcusedAbsent: s.unexcusedAbsent,
        excusedCount: s.excusedCount,
        totalRecords: s.totalRecords,
        effectiveDays: s.effectiveDays,
        daysCovered: s.daysCovered,
        attendanceRate: `${s.attendanceRate}%`,
        punctualityRate: `${Math.round(punctualityRate)}%`,
        weightedScore: s.weightedScore.toFixed(1),
        consistencyIndex: Math.round(s.consistencyIndex * 100) / 100,
        trendSlope: s.trend?.slope || 0,
        trendClassification: s.trend?.classification || '-',
        trendRSquared: s.trend?.rSquared || 0,
        weeklyChange: `${s.weeklyChange || 0}%`,
        avgRate: `${s.avgRate || s.attendanceRate}%`,
        minRate: `${s.minRate || s.attendanceRate}%`,
        maxRate: `${s.maxRate || s.attendanceRate}%`,
        // Score Breakdown
        qualityAdjustedRate: `${Math.round((s.qualityAdjustedRate || 0) * 100) / 100}%`,
        rawWeightedScore: (s.rawWeightedScore || 0).toFixed(1),
        coverageFactor: (s.coverageFactor || 0).toFixed(3),
        scoreFormula: `(${(s.rawWeightedScore || 0).toFixed(1)} × ${(s.coverageFactor || 0).toFixed(3)}) = ${s.weightedScore.toFixed(1)}`,
        // Late Duration
        totalLateMinutes: Math.round((s.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((s.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((s.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: (s.lateScoreAvg || 0).toFixed(3),
      };
    });
    
    // Apply sorting from saved settings
    const studentDataObjects = sortDataBySettings(studentDataObjectsUnsorted, 'studentAnalytics');
    studentDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Prepare date data with all possible fields
    const dateDataObjectsUnsorted = dateAnalytics.map(d => {
      let excusedNames = d.excusedNames.join(', ') || '-';
      const totalStud = d.presentCount + d.lateCount + d.excusedAbsentCount + d.unexcusedAbsentCount;
      const totalPres = d.presentCount + d.lateCount;
      const totalAbs = d.excusedAbsentCount + d.unexcusedAbsentCount;
      
      if (d.hostAddress === 'SESSION_NOT_HELD' || (d.hostAddress && d.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')) {
        excusedNames = isArabic ? 'جميع الطلاب' : 'All Students';
      }
      
      const bookPages = d.bookStartPage && d.bookEndPage ? `${d.bookStartPage}-${d.bookEndPage}` : '-';
      const pagesCount = d.bookStartPage && d.bookEndPage ? d.bookEndPage - d.bookStartPage + 1 : 0;
      const punctualityRate = totalPres > 0 ? Math.round(d.presentCount / totalPres * 100) : 0;
      const absentRate = (d.unexcusedAbsentCount + totalPres) > 0 ? Math.round((d.unexcusedAbsentCount / (d.unexcusedAbsentCount + totalPres)) * 100) : 0;
      const dateObj = new Date(d.date);
      
      return {
        date: format(dateObj, 'MMM dd, yyyy'),
        dayOfWeek: format(dateObj, 'EEEE'),
        hostAddress: d.hostAddress || '-',
        bookTopic: d.bookTopic || '-',
        bookPages,
        bookStartPage: d.bookStartPage || '-',
        bookEndPage: d.bookEndPage || '-',
        pagesCount: pagesCount > 0 ? pagesCount : '-',
        presentCount: d.presentCount,
        lateCount: d.lateCount,
        totalPresent: totalPres,
        excusedAbsentCount: d.excusedAbsentCount,
        unexcusedAbsentCount: d.unexcusedAbsentCount,
        totalAbsent: totalAbs,
        totalStudents: totalStud,
        attendanceRate: `${d.attendanceRate}%`,
        punctualityRate: `${punctualityRate}%`,
        absentRate: `${absentRate}%`,
        // Late Duration
        totalLateMinutes: Math.round((d.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((d.avgLateMinutes || 0) * 10) / 10,
        presentNames: d.presentNames.join(', ') || '-',
        lateNames: d.lateNames.join(', ') || '-',
        excusedNames,
        absentNames: d.absentNames.join(', ') || '-',
      };
    });
    
    // Apply sorting and row filtering from saved settings
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Prepare host data with all possible fields
    const hostMap = new Map<string, {
      count: number;
      dates: string[];
      rawDates: Date[];
      present: number;
      late: number;
      absent: number;
      excused: number;
    }>();
    
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || {
          count: 0, dates: [], rawDates: [], present: 0, late: 0, absent: 0, excused: 0,
        };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);

    const hostDataObjectsUnsorted = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count)
      .map((host, index) => {
        const totalStudents = host.present + host.late + host.absent + host.excused;
        const totalPresent = host.present + host.late;
        // Fair calculation: Exclude excused from denominator - they had valid reasons
        const expectedAttendees = totalPresent + host.absent;
        const attendanceRate = expectedAttendees > 0 ? Math.round(totalPresent / expectedAttendees * 100) : 0;
        const firstRaw = host.rawDates.length > 0 ? Math.min(...host.rawDates.map(d => d.getTime())) : 0;
        const lastRaw = host.rawDates.length > 0 ? Math.max(...host.rawDates.map(d => d.getTime())) : 0;
        return {
          rank: index + 1,
          address: host.address,
          count: host.count,
          percentage: totalHostings > 0 ? Math.round(host.count / totalHostings * 100) : 0,
          attendanceRate,
          firstHostDate: host.rawDates.length > 0 ? format(new Date(firstRaw), 'MMM dd, yyyy') : '-',
          firstHostDateRaw: firstRaw,
          lastHostDate: host.rawDates.length > 0 ? format(new Date(lastRaw), 'MMM dd, yyyy') : '-',
          lastHostDateRaw: lastRaw,
          totalOnTime: host.present,
          totalLate: host.late,
          totalPresent,
          totalAbsent: host.absent,
          totalExcused: host.excused,
          totalStudents,
          dates: host.dates.join(', '),
        };
      });
    
    // Apply sorting from saved settings
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Convert data objects to the format expected by wordExportService using saved field selections
    const studentDataForExport = studentDataObjects.map((data, index) => {
      const row: Record<string, unknown> = {};
      studentConfig.headers.forEach((header, i) => {
        const values = studentConfig.getData(data as Record<string, unknown>, index);
        row[header] = values[i];
      });
      return row;
    });

    const dateDataForExport = dateDataObjects.map((data, index) => {
      const row: Record<string, unknown> = {};
      dateConfig.headers.forEach((header, i) => {
        const values = dateConfig.getData(data as Record<string, unknown>, index);
        row[header] = values[i];
      });
      return row;
    });

    const hostDataForExport = hostDataObjects.map((data, index) => {
      const row: Record<string, unknown> = {};
      hostConfig.headers.forEach((header, i) => {
        const values = hostConfig.getData(data as Record<string, unknown>, index);
        row[header] = values[i];
      });
      return row;
    });

    // Get per-type coloring settings for Word export
    const wordStudentColoring = (() => {
      const s = getColoringSettingsForType('studentAnalytics');
      const selectedKeys = getSelectedFieldsForType('studentAnalytics');
      const colorCols = s.coloringFields.length > 0
        ? s.coloringFields.map(fk => selectedKeys.indexOf(fk)).filter(i => i !== -1)
        : [];
      return { enabled: s.enableConditionalColoring, theme: s.coloringTheme, colorColumns: colorCols };
    })();
    const wordDateColoring = (() => {
      const s = getColoringSettingsForType('dateAnalytics');
      const selectedKeys = getSelectedFieldsForType('dateAnalytics');
      const colorCols = s.coloringFields.length > 0
        ? s.coloringFields.map(fk => selectedKeys.indexOf(fk)).filter(i => i !== -1)
        : [];
      return { enabled: s.enableConditionalColoring, theme: s.coloringTheme, colorColumns: colorCols };
    })();
    const wordHostColoring = (() => {
      const s = getColoringSettingsForType('hostAnalytics');
      const selectedKeys = getSelectedFieldsForType('hostAnalytics');
      const colorCols = s.coloringFields.length > 0
        ? s.coloringFields.map(fk => selectedKeys.indexOf(fk)).filter(i => i !== -1)
        : [];
      return { enabled: s.enableConditionalColoring, theme: s.coloringTheme, colorColumns: colorCols };
    })();
    const wordAnyEnabled = wordStudentColoring.enabled || wordDateColoring.enabled || wordHostColoring.enabled;

    try {
      await wordExportService.exportAnalyticsToWordDynamic(
        studentDataForExport,
        studentConfig.headers,
        dateDataForExport,
        dateConfig.headers,
        hostDataForExport,
        hostConfig.headers,
        summaryStats,
        isArabic,
        filters.startDate,
        filters.endDate,
        undefined, // filename
        {
          enableConditionalColoring: wordAnyEnabled,
          coloringTheme: wordStudentColoring.theme,
          perTypeColoring: {
            studentAnalytics: wordStudentColoring,
            dateAnalytics: wordDateColoring,
            hostAnalytics: wordHostColoring,
          },
        }
      );
      success('Word document exported successfully!');
    } catch (err) {
      console.error('Error exporting to Word:', err);
      showError('Failed to export Word document. Please try again.');
    } finally {
      setExportingWord(false);
    }
  };

  const resetFilters = () => {
    setFilters({
      student_id: '',
      course_id: '',
      teacher_id: '',
      status: '',
      startDate: earliestDate || format(subDays(new Date(), 365), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  const quickFilterLastWeek = () => {
    setFilters({
      ...filters,
      startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  const quickFilterLastMonth = () => {
    setFilters({
      ...filters,
      startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  const quickFilterAbsentOnly = () => {
    setFilters({
      ...filters,
      status: 'absent',
    });
  };

  // Sorting function
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle sort direction if clicking the same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get sorted records
  const getSortedRecords = () => {
    if (!sortColumn) return filteredRecords;

    const sorted = [...filteredRecords].sort((a, b) => {
      let aVal: string | number | null | undefined = a[sortColumn as keyof AttendanceRecord];
      let bVal: string | number | null | undefined = b[sortColumn as keyof AttendanceRecord];

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === 'asc' ? 1 : -1;
      if (bVal == null) return sortDirection === 'asc' ? -1 : 1;

      // Convert to lowercase for string comparison
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  // Calculate advanced analytics - memoized for performance
  const calculateAnalytics = useCallback(() => {
    // Filter out 'not enrolled' records from analytics
    const analyticsRecords = filteredRecords.filter(r => r.status !== 'not enrolled');
    
    // Get unique dates for session-wide analytics (attendance by date)
    const uniqueDates = [...new Set(analyticsRecords.map(r => r.attendance_date))].sort();
    
    // Get unique students from filtered records
    const uniqueStudents = [...new Set(analyticsRecords.map(r => r.student_id))];

    // Calculate student analytics
    const studentStats: StudentAnalytics[] = uniqueStudents.map(studentId => {
      const studentRecords = analyticsRecords.filter(r => r.student_id === studentId);
      const studentName = studentRecords[0]?.student_name || 'Unknown';

      // Calculate days covered FOR THIS SPECIFIC STUDENT (not all session dates)
      // Only count dates where the student has records (i.e., dates after enrollment)
      const studentUniqueDates = [...new Set(studentRecords.map(r => r.attendance_date))].sort();
      const studentDaysCovered = studentUniqueDates.length;

      const presentCount = studentRecords.filter(r => r.status === 'on time').length;
      const absentCount = studentRecords.filter(r => r.status === 'absent').length;
      const excusedCount = studentRecords.filter(r => r.status === 'excused').length;
      const lateCount = studentRecords.filter(r => r.status === 'late').length;
      const lateRecords = studentRecords.filter(r => r.status === 'late');

      // Calculate rates (no vacation status in AttendanceRecords)
      // Effective base: Student's covered dates minus excused days (only accountable for dates after enrollment)
      const effectiveBase = studentDaysCovered - excusedCount;
      // Attendance rate: Present (On Time + Late) / Effective Days
      const totalPresent = presentCount + lateCount;
      const attendanceRate = effectiveBase > 0 ? (totalPresent / effectiveBase) * 100 : 0;

      // Unexcused absences should be calculated as: Effective Days - Present
      // (i.e. accountable days minus days the student was present/on-time or late)
      const unexcusedAbsent = effectiveBase > 0 ? Math.max(0, effectiveBase - totalPresent) : 0;

      // ==================== LATE DURATION AGGREGATION ====================
      const lateMinutesArray = lateRecords
        .map(r => r.late_minutes)
        .filter((m): m is number => m != null && m > 0);
      const totalLateMinutes = lateMinutesArray.reduce((sum, m) => sum + m, 0);
      const avgLateMinutes = lateMinutesArray.length > 0 ? totalLateMinutes / lateMinutesArray.length : 0;
      const maxLateMinutes = lateMinutesArray.length > 0 ? Math.max(...lateMinutesArray) : 0;

      // ==================== QUALITY-ADJUSTED SCORING ====================
      // Calculate quality-adjusted attendance where late arrivals get partial credit
      // On Time = 100% credit, Late = exponential decay based on minutes late
      
      // Calculate late score contributions (each late record gets weighted credit via exponential decay)
      const lateScoreSum = lateRecords.reduce((sum, record) => {
        return sum + getLateScoreWeight(record.late_minutes);
      }, 0);
      
      // Quality-adjusted attendance: On Time (full credit) + Late (partial credit based on lateness)
      const qualityScore = presentCount + lateScoreSum;
      const qualityAdjustedRate = effectiveBase > 0 ? (qualityScore / effectiveBase) * 100 : 0;

      // ==================== WEIGHTED SCORE CALCULATION ====================
      // Balanced component weights for fair, stable evaluation:
      //   50% Quality-Adjusted Rate - Main factor, includes late penalties
      //   25% Simple Attendance Rate - Credit for showing up
      //   15% Consistency Index - Rewards regular attendance patterns
      //   10% Punctuality Bonus - On-time vs late ratio
      const punctualityPercentage = totalPresent > 0 ? (presentCount / totalPresent) * 100 : 0;
      
      // Calculate consistency before using it in weighted score
      const dailyPattern = studentUniqueDates.map(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (!record || record.status === 'excused') return -1; // Exclude excused
        return (record.status === 'on time' || record.status === 'late') ? 1 : 0;
      }).filter(v => v !== -1);
      
      const consistencyIndex = calculateConsistencyIndex(dailyPattern);
      const consistencyPercentage = consistencyIndex * 100; // Convert 0-1 to 0-100
      
      const rawWeightedScore = 
        (0.50 * qualityAdjustedRate) +    // 50% Quality (with late penalties)
        (0.25 * attendanceRate) +          // 25% Attendance (showed up)
        (0.15 * consistencyPercentage) +   // 15% Consistency (regular patterns)
        (0.10 * punctualityPercentage);    // 10% Punctuality (on-time ratio)

      // ==================== COVERAGE FACTOR ====================
      // Penalize students with very few effective days relative to total sessions.
      // Uses square root scaling: coverageFactor = sqrt(effectiveDays / totalSessionDays)
      // This ensures students who only attended 1-2 days don't outrank
      // students who maintained good attendance over 20+ sessions.
      //
      // Examples (with 27 total sessions):
      //   1 day  → factor = 0.19  (heavy penalty)
      //   2 days → factor = 0.27  (heavy penalty)
      //   8 days → factor = 0.54  (moderate penalty)
      //  15 days → factor = 0.75  (mild penalty)
      //  24 days → factor = 0.94  (almost full credit)
      //  27 days → factor = 1.00  (full credit)
      const totalSessionDays = uniqueDates.length;
      const coverageFactor = totalSessionDays > 0 
        ? Math.sqrt(effectiveBase / totalSessionDays) 
        : 1;
      const weightedScore = rawWeightedScore * Math.min(coverageFactor, 1);
      // Calculate trend using student-specific dates (not all session dates)
      const cumulativeRates = calculateCumulativeRates(studentId, studentUniqueDates, analyticsRecords);
      const trend = calculateTrend(cumulativeRates.slice(-6)); // Last 6 samples

      // Calculate rate change between previous and last cumulative rate
      // Only if there are at least 3 records to make meaningful comparison
      const rateChange = cumulativeRates.length >= 3 
        ? cumulativeRates[cumulativeRates.length - 1] - cumulativeRates[cumulativeRates.length - 2]
        : 0;

      // Calculate cumulative daily attendance rates for min/max/avg
      // This shows how the attendance rate progressed over time
      const cumulativeRatesByDay: number[] = [];
      let totalPresentToDate = 0;
      let totalDaysToDate = 0;
      
      studentUniqueDates.forEach(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (record && record.status !== 'excused') {
          totalDaysToDate++;
          if (record.status === 'on time' || record.status === 'late') {
            totalPresentToDate++;
          }
          const dailyRate = (totalPresentToDate / totalDaysToDate) * 100;
          cumulativeRatesByDay.push(dailyRate);
        }
      });

      return {
        student_id: studentId,
        student_name: studentName,
        totalRecords: studentRecords.length,
        presentCount,
        absentCount,
        excusedCount,
        lateCount,
        unexcusedAbsent,
        daysCovered: studentDaysCovered,
        effectiveDays: effectiveBase,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        weightedScore: Math.round(weightedScore * 10) / 10,
        consistencyIndex: Math.round(consistencyIndex * 100) / 100,
        trend,
        weeklyChange: Math.round(rateChange * 10) / 10,
        avgRate: cumulativeRatesByDay.length > 0 ? 
          Math.round((cumulativeRatesByDay.reduce((a, b) => a + b, 0) / cumulativeRatesByDay.length) * 10) / 10 : 0,
        minRate: cumulativeRatesByDay.length > 0 ? Math.round(Math.min(...cumulativeRatesByDay) * 10) / 10 : 0,
        maxRate: cumulativeRatesByDay.length > 0 ? Math.round(Math.max(...cumulativeRatesByDay) * 10) / 10 : 0,
        // Score transparency
        qualityAdjustedRate: Math.round(qualityAdjustedRate * 10) / 10,
        rawWeightedScore: Math.round(rawWeightedScore * 10) / 10,
        coverageFactor: Math.round(coverageFactor * 100) / 100,
        punctualityRate: Math.round(punctualityPercentage * 10) / 10,
        // Late duration stats
        totalLateMinutes: Math.round(totalLateMinutes),
        avgLateMinutes: Math.round(avgLateMinutes * 10) / 10,
        maxLateMinutes: Math.round(maxLateMinutes),
        lateScoreAvg: lateRecords.length > 0 ? Math.round((lateScoreSum / lateRecords.length) * 100) / 100 : 0,
      };
    }).sort((a, b) => b.weightedScore - a.weightedScore);

    setStudentAnalytics(studentStats);

    // Calculate date analytics (exclude 'not enrolled' records)
    const dateStats: DateAnalytics[] = uniqueDates.map(date => {
      const dateRecords = analyticsRecords.filter(r => r.attendance_date === date);
      const presentRecords = dateRecords.filter(r => r.status === 'on time');
      const absentRecords = dateRecords.filter(r => r.status === 'absent');
      const excusedRecords = dateRecords.filter(r => r.status === 'excused');
      const lateRecords = dateRecords.filter(r => r.status === 'late');
      
      const presentCount = presentRecords.length;
      const absentCount = absentRecords.length;
      const excusedCount = excusedRecords.length;
      const lateCount = lateRecords.length;
      
      // Only consider students who were enrolled on or before this date
      // Get students who have any record (enrolled) on or before this date
      const enrolledStudentsByDate = new Set(
        analyticsRecords
          .filter(r => r.attendance_date <= date)
          .map(r => r.student_id)
      );
      
      // Calculate unmarked students (students enrolled by this date but with no record for this specific date)
      const studentsWithRecords = new Set(dateRecords.map(r => r.student_id));
      const unmarkedStudents = Array.from(enrolledStudentsByDate).filter(sid => !studentsWithRecords.has(sid));
      const unmarkedCount = unmarkedStudents.length;
      
      // Get names of unmarked students
      const unmarkedNames = unmarkedStudents.map(sid => {
        const record = analyticsRecords.find(r => r.student_id === sid);
        return record?.student_name || 'Unknown';
      });
      
      // Unexcused absents = explicitly marked absent + unmarked students
      const unexcusedAbsentCount = absentCount + unmarkedCount;
      // Total accountable = students enrolled by this date minus excused
      const totalStudentsOnDate = enrolledStudentsByDate.size;
      const totalAccountable = totalStudentsOnDate - excusedCount;
      // Attendance rate: (Present + Late) / Total Accountable
      const attendanceRate = totalAccountable > 0 ? ((presentCount + lateCount) / totalAccountable) * 100 : 0;

      // Find host address for this date (from any record with host_address)
      const hostRecord = dateRecords.find(r => r.host_address);
      const hostAddress = hostRecord?.host_address || null;

      // If session not held, show 'All Students' in excusedNames
      let excusedNames: string[];
      if (hostAddress === 'SESSION_NOT_HELD') {
        excusedNames = ['All Students']; // or use abbreviation like 'ALL'
      } else {
        excusedNames = excusedRecords.map(r => r.student_name);
      }
      
      // Aggregate late minutes for this date
      const dateLateMinutes = lateRecords
        .map(r => r.late_minutes)
        .filter((m): m is number => m != null && m > 0);
      const dateTotalLateMin = dateLateMinutes.reduce((sum, m) => sum + m, 0);
      const dateAvgLateMin = dateLateMinutes.length > 0 ? dateTotalLateMin / dateLateMinutes.length : 0;

      return {
        date,
        presentCount,
        unexcusedAbsentCount,
        excusedAbsentCount: excusedCount,
        lateCount,
        attendanceRate: Math.round(attendanceRate * 10) / 10,
        presentNames: presentRecords.map(r => r.student_name),
        lateNames: lateRecords.map(r => r.student_name),
        excusedNames,
        absentNames: [...absentRecords.map(r => r.student_name), ...unmarkedNames],
        hostAddress,
        bookTopic: dateRecords[0]?.book_topic || null,
        bookStartPage: dateRecords[0]?.book_start_page || null,
        bookEndPage: dateRecords[0]?.book_end_page || null,
        totalLateMinutes: Math.round(dateTotalLateMin),
        avgLateMinutes: Math.round(dateAvgLateMin * 10) / 10,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDateAnalytics(dateStats);
  }, [filteredRecords]); // Memoize with filteredRecords dependency

  const calculateConsistencyIndex = (pattern: number[]): number => {
    // Consistency Index: measures how REGULARLY a student attends
    // Independent from attendance rate — focuses on whether absences
    // are scattered (consistent) or clustered in streaks (inconsistent)
    //
    // Examples:
    //   [1,0,1,0,1,0,1,0] → ~1.0 (absences perfectly scattered)
    //   [1,1,1,1,0,0,0,0] → ~0.2 (all absences clustered)
    //   [1,1,0,1,1,0,1,1] → 1.0  (single-day absences spread out)
    //   Perfect attendance  → 1.0
    //   All absent          → 0.0
    if (pattern.length <= 1) return pattern.length === 1 ? pattern[0] : 0;

    const presentDays = pattern.filter(v => v === 1).length;
    if (presentDays === 0) return 0;
    if (presentDays === pattern.length) return 1;

    const totalAbsent = pattern.length - presentDays;

    // Find all consecutive absence streaks
    const absenceStreaks: number[] = [];
    let currentStreak = 0;
    for (const day of pattern) {
      if (day === 0) {
        currentStreak++;
      } else {
        if (currentStreak > 0) absenceStreaks.push(currentStreak);
        currentStreak = 0;
      }
    }
    if (currentStreak > 0) absenceStreaks.push(currentStreak);

    if (absenceStreaks.length === 0) return 1;

    const longestStreak = Math.max(...absenceStreaks);

    // Component 1: Scatter ratio — are absences fragmented into many small streaks?
    // Best: each absence is its own streak (ratio = 1). Worst: one big block (ratio = 1/n).
    const scatterRatio = absenceStreaks.length / totalAbsent;
    const normalizedScatter = totalAbsent > 1
      ? (scatterRatio - 1 / totalAbsent) / (1 - 1 / totalAbsent)
      : 1;

    // Component 2: Longest streak penalty — is there one dominant absence block?
    const streakPenalty = totalAbsent > 1
      ? 1 - (longestStreak - 1) / (totalAbsent - 1)
      : 1;

    // Raw consistency from average of both components
    const rawConsistency = 0.5 * normalizedScatter + 0.5 * streakPenalty;

    // Dampening: soften the effect when there are very few absences
    // With only 1-2 absences, clustering matters much less
    const dampeningFactor = Math.min(totalAbsent / 5, 1);
    const consistency = rawConsistency * dampeningFactor + (1 - dampeningFactor);

    return Math.round(Math.min(1, consistency) * 100) / 100;
  };

  const calculateCumulativeRates = (studentId: string, dates: string[], allRecords: AttendanceRecord[]): number[] => {
    const rates: number[] = [];
    let cumulativePresent = 0;
    let cumulativeTotal = 0;

    dates.forEach(date => {
      const record = allRecords.find(r => r.student_id === studentId && r.attendance_date === date);
      
      // Exclude excused and 'not enrolled' from trend calculation
      if (record && record.status !== 'excused' && record.status !== 'not enrolled') {
        cumulativeTotal++;
        // Count both on time and late as present
        if (record.status === 'on time' || record.status === 'late') {
          cumulativePresent++;
        }
        const rate = (cumulativePresent / cumulativeTotal) * 100;
        rates.push(rate);
      }
    });

    return rates;
  };

  const calculateTrend = (rates: number[]) => {
    const n = rates.length;
    if (n < 2) return { slope: 0, rSquared: 1, classification: 'STABLE' };

    const days = rates.map((_, i) => i + 1);
    const daysMean = days.reduce((a, b) => a + b, 0) / n;
    const ratesMean = rates.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (days[i] - daysMean) * (rates[i] - ratesMean);
      denominator += Math.pow(days[i] - daysMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = ratesMean - (slope * daysMean);

    const fitted = days.map(d => slope * d + intercept);
    const SSres = rates.reduce((sum, r, i) => sum + Math.pow(r - fitted[i], 2), 0);
    const SStot = rates.reduce((sum, r) => sum + Math.pow(r - ratesMean, 2), 0);
    const rSquared = SStot !== 0 ? 1 - (SSres / SStot) : 1;

    let classification = 'STABLE';
    if (rSquared < 0.3) {
      classification = 'VOLATILE';
    } else if (slope > 2) {
      classification = 'IMPROVING';
    } else if (slope < -2) {
      classification = 'DECLINING';
    }

    return {
      slope: Math.round(slope * 10) / 10,
      rSquared: Math.round(rSquared * 100) / 100,
      classification,
    };
  };

  // ==================== ADVANCED EXPORT BUILDER FUNCTIONS ====================
  
  // Get export categories based on current data type
  const getExportCategories = (): ExportCategory[] => {
    if (exportDataType === 'studentAnalytics') {
      return [
        {
          id: 'basic',
          label: 'Basic Info',
          labelAr: 'المعلومات الأساسية',
          icon: '👤',
          fields: [
            { key: 'rank', label: 'Rank', labelAr: 'الرتبة', category: 'basic', defaultSelected: true },
            { key: 'student_id', label: 'Student ID', labelAr: 'رقم الطالب', category: 'basic', defaultSelected: false },
            { key: 'student_name', label: 'Student Name', labelAr: 'اسم الطالب', category: 'basic', defaultSelected: true },
          ]
        },
        {
          id: 'attendance',
          label: 'Attendance Stats',
          labelAr: 'إحصائيات الحضور',
          icon: '📊',
          fields: [
            { key: 'presentCount', label: 'On Time', labelAr: 'في الوقت', category: 'attendance', defaultSelected: true },
            { key: 'lateCount', label: 'Late', labelAr: 'متأخر', category: 'attendance', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'إجمالي الحضور', category: 'attendance', defaultSelected: true },
            { key: 'absentCount', label: 'Total Absent', labelAr: 'إجمالي الغياب', category: 'attendance', defaultSelected: false },
            { key: 'unexcusedAbsent', label: 'Unexcused Absent', labelAr: 'غياب بدون عذر', category: 'attendance', defaultSelected: true },
            { key: 'excusedCount', label: 'Excused', labelAr: 'معذور', category: 'attendance', defaultSelected: true },
            { key: 'totalRecords', label: 'Total Records', labelAr: 'إجمالي السجلات', category: 'attendance', defaultSelected: false },
          ]
        },
        {
          id: 'metrics',
          label: 'Performance Metrics',
          labelAr: 'مقاييس الأداء',
          icon: '📈',
          fields: [
            { key: 'effectiveDays', label: 'Effective Days', labelAr: 'الأيام الفعلية', category: 'metrics', defaultSelected: true },
            { key: 'daysCovered', label: 'Days Covered', labelAr: 'الأيام المغطاة', category: 'metrics', defaultSelected: true },
            { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'نسبة الحضور', category: 'metrics', defaultSelected: true },
            { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'نسبة الالتزام', category: 'metrics', defaultSelected: true },
            { key: 'weightedScore', label: 'Weighted Score', labelAr: 'الدرجة الموزونة', category: 'metrics', defaultSelected: true },
            { key: 'consistencyIndex', label: 'Consistency Index', labelAr: 'مؤشر الانتظام', category: 'metrics', defaultSelected: false },
          ]
        },
        {
          id: 'trend',
          label: 'Trend Analysis',
          labelAr: 'تحليل الاتجاه',
          icon: '📉',
          fields: [
            { key: 'trendSlope', label: 'Trend Slope', labelAr: 'ميل الاتجاه', category: 'trend', defaultSelected: false },
            { key: 'trendClassification', label: 'Trend Classification', labelAr: 'تصنيف الاتجاه', category: 'trend', defaultSelected: false },
            { key: 'trendRSquared', label: 'Trend R² Value', labelAr: 'قيمة R²', category: 'trend', defaultSelected: false },
            { key: 'weeklyChange', label: 'Weekly Change %', labelAr: 'التغير الأسبوعي', category: 'trend', defaultSelected: false },
          ]
        },
        {
          id: 'rates',
          label: 'Rate Statistics',
          labelAr: 'إحصائيات المعدلات',
          icon: '📏',
          fields: [
            { key: 'avgRate', label: 'Average Rate', labelAr: 'المعدل المتوسط', category: 'rates', defaultSelected: false },
            { key: 'minRate', label: 'Minimum Rate', labelAr: 'أدنى معدل', category: 'rates', defaultSelected: false },
            { key: 'maxRate', label: 'Maximum Rate', labelAr: 'أعلى معدل', category: 'rates', defaultSelected: false },
          ]
        },
        {
          id: 'scoreBreakdown',
          label: '🔍 Score Breakdown',
          labelAr: '🔍 تفصيل الدرجة',
          icon: '🧮',
          fields: [
            { key: 'qualityAdjustedRate', label: 'Quality-Adjusted Rate %', labelAr: 'معدل الجودة المعدل', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'rawWeightedScore', label: 'Raw Score (before coverage)', labelAr: 'الدرجة الخام', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'coverageFactor', label: 'Coverage Factor', labelAr: 'عامل التغطية', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'scoreFormula', label: 'Score Formula', labelAr: 'معادلة الدرجة', category: 'scoreBreakdown', defaultSelected: false },
          ]
        },
        {
          id: 'lateDuration',
          label: '⏱️ Late Duration',
          labelAr: '⏱️ مدة التأخير',
          icon: '⏰',
          fields: [
            { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'مجموع التأخير (دقيقة)', category: 'lateDuration', defaultSelected: false },
            { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'متوسط التأخير', category: 'lateDuration', defaultSelected: false },
            { key: 'maxLateMinutes', label: 'Max Late (min)', labelAr: 'أقصى تأخير', category: 'lateDuration', defaultSelected: false },
            { key: 'lateScoreAvg', label: 'Avg Late Credit (0-1)', labelAr: 'متوسط رصيد التأخير', category: 'lateDuration', defaultSelected: false },
          ]
        }
      ];
    } else if (exportDataType === 'dateAnalytics') {
      return [
        {
          id: 'session',
          label: 'Session Info',
          labelAr: 'معلومات الجلسة',
          icon: '📅',
          fields: [
            { key: 'date', label: 'Date', labelAr: 'التاريخ', category: 'session', defaultSelected: true },
            { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'يوم الأسبوع', category: 'session', defaultSelected: false },
            { key: 'hostAddress', label: 'Host Address', labelAr: 'عنوان المضيف', category: 'session', defaultSelected: true },
          ]
        },
        {
          id: 'book',
          label: 'Book Coverage',
          labelAr: 'تغطية الكتاب',
          icon: '📚',
          fields: [
            { key: 'bookTopic', label: 'Book Topic', labelAr: 'موضوع الكتاب', category: 'book', defaultSelected: true },
            { key: 'bookPages', label: 'Pages', labelAr: 'الصفحات', category: 'book', defaultSelected: true },
            { key: 'bookStartPage', label: 'Start Page', labelAr: 'صفحة البداية', category: 'book', defaultSelected: false },
            { key: 'bookEndPage', label: 'End Page', labelAr: 'صفحة النهاية', category: 'book', defaultSelected: false },
            { key: 'pagesCount', label: 'Pages Count', labelAr: 'عدد الصفحات', category: 'book', defaultSelected: false },
          ]
        },
        {
          id: 'counts',
          label: 'Attendance Counts',
          labelAr: 'أعداد الحضور',
          icon: '🔢',
          fields: [
            { key: 'presentCount', label: 'On Time', labelAr: 'في الوقت', category: 'counts', defaultSelected: true },
            { key: 'lateCount', label: 'Late', labelAr: 'متأخر', category: 'counts', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'إجمالي الحضور', category: 'counts', defaultSelected: false },
            { key: 'excusedAbsentCount', label: 'Excused', labelAr: 'معذور', category: 'counts', defaultSelected: true },
            { key: 'unexcusedAbsentCount', label: 'Absent', labelAr: 'غائب', category: 'counts', defaultSelected: true },
            { key: 'totalAbsent', label: 'Total Absent', labelAr: 'إجمالي الغياب', category: 'counts', defaultSelected: false },
            { key: 'totalStudents', label: 'Total Students', labelAr: 'إجمالي الطلاب', category: 'counts', defaultSelected: false },
          ]
        },
        {
          id: 'rates',
          label: 'Rates & Percentages',
          labelAr: 'النسب والمعدلات',
          icon: '📊',
          fields: [
            { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'نسبة الحضور', category: 'rates', defaultSelected: true },
            { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'نسبة الالتزام', category: 'rates', defaultSelected: false },
            { key: 'absentRate', label: 'Absence Rate %', labelAr: 'نسبة الغياب', category: 'rates', defaultSelected: false },
          ]
        },
        {
          id: 'lateDuration',
          label: '⏱️ Late Duration',
          labelAr: '⏱️ مدة التأخير',
          icon: '⏰',
          fields: [
            { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'مجموع التأخير (دقيقة)', category: 'lateDuration', defaultSelected: false },
            { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'متوسط التأخير', category: 'lateDuration', defaultSelected: false },
          ]
        },
        {
          id: 'names',
          label: 'Student Names',
          labelAr: 'أسماء الطلاب',
          icon: '👥',
          fields: [
            { key: 'presentNames', label: 'On Time Names', labelAr: 'أسماء الحاضرين', category: 'names', defaultSelected: false },
            { key: 'lateNames', label: 'Late Names', labelAr: 'أسماء المتأخرين', category: 'names', defaultSelected: false },
            { key: 'excusedNames', label: 'Excused Names', labelAr: 'أسماء المعذورين', category: 'names', defaultSelected: false },
            { key: 'absentNames', label: 'Absent Names', labelAr: 'أسماء الغائبين', category: 'names', defaultSelected: false },
          ]
        }
      ];
    } else if (exportDataType === 'hostAnalytics') {
      return [
        {
          id: 'host',
          label: 'Host Info',
          labelAr: 'معلومات المضيف',
          icon: '🏠',
          fields: [
            { key: 'rank', label: 'Rank', labelAr: 'الرتبة', category: 'host', defaultSelected: true },
            { key: 'address', label: 'Host Address', labelAr: 'عنوان المضيف', category: 'host', defaultSelected: true },
          ]
        },
        {
          id: 'stats',
          label: 'Hosting Statistics',
          labelAr: 'إحصائيات الاستضافة',
          icon: '📊',
          fields: [
            { key: 'count', label: 'Times Hosted', labelAr: 'عدد مرات الاستضافة', category: 'stats', defaultSelected: true },
            { key: 'percentage', label: 'Hosting Percentage %', labelAr: 'نسبة الاستضافة', category: 'stats', defaultSelected: false },
            { key: 'firstHostDate', label: 'First Host Date', labelAr: 'أول تاريخ استضافة', category: 'stats', defaultSelected: false },
            { key: 'lastHostDate', label: 'Last Host Date', labelAr: 'آخر تاريخ استضافة', category: 'stats', defaultSelected: false },
          ]
        },
        {
          id: 'attendance',
          label: 'Attendance Stats',
          labelAr: 'إحصائيات الحضور',
          icon: '✅',
          fields: [
            { key: 'attendanceRate', label: 'Avg Attendance Rate %', labelAr: 'معدل الحضور', category: 'attendance', defaultSelected: true },
            { key: 'totalOnTime', label: 'Total On Time', labelAr: 'إجمالي في الوقت', category: 'attendance', defaultSelected: true },
            { key: 'totalLate', label: 'Total Late', labelAr: 'إجمالي المتأخرين', category: 'attendance', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'إجمالي الحضور', category: 'attendance', defaultSelected: true },
            { key: 'totalAbsent', label: 'Total Absent', labelAr: 'إجمالي الغياب', category: 'attendance', defaultSelected: true },
            { key: 'totalExcused', label: 'Total Excused', labelAr: 'إجمالي المعذورين', category: 'attendance', defaultSelected: true },
            { key: 'totalStudents', label: 'Total Students', labelAr: 'إجمالي الطلاب', category: 'attendance', defaultSelected: false },
          ]
        },
        {
          id: 'dates',
          label: 'Hosting Dates',
          labelAr: 'تواريخ الاستضافة',
          icon: '📅',
          fields: [
            { key: 'dates', label: 'All Dates', labelAr: 'جميع التواريخ', category: 'dates', defaultSelected: true },
            { key: 'datesList', label: 'Dates List (separate rows)', labelAr: 'قائمة التواريخ', category: 'dates', defaultSelected: false },
          ]
        }
      ];
    }
    // Default: records - Full field list for detailed record exports
    return [
      {
        id: 'basic',
        label: 'Basic Info',
        labelAr: 'المعلومات الأساسية',
        icon: '📋',
        fields: [
          { key: 'date', label: 'Date', labelAr: 'التاريخ', category: 'basic', defaultSelected: true },
          { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'يوم الأسبوع', category: 'basic', defaultSelected: false },
          { key: 'attendance_id', label: 'Record ID', labelAr: 'رقم السجل', category: 'basic', defaultSelected: false },
        ]
      },
      {
        id: 'student',
        label: 'Student Info',
        labelAr: 'معلومات الطالب',
        icon: '👤',
        fields: [
          { key: 'student_name', label: 'Student Name', labelAr: 'اسم الطالب', category: 'student', defaultSelected: true },
          { key: 'student_id', label: 'Student ID', labelAr: 'رقم الطالب', category: 'student', defaultSelected: false },
        ]
      },
      {
        id: 'course',
        label: 'Course Info',
        labelAr: 'معلومات الدورة',
        icon: '📚',
        fields: [
          { key: 'course_name', label: 'Course Name', labelAr: 'اسم الدورة', category: 'course', defaultSelected: true },
          { key: 'course_id', label: 'Course ID', labelAr: 'رقم الدورة', category: 'course', defaultSelected: false },
          { key: 'instructor_name', label: 'Instructor', labelAr: 'المدرب', category: 'course', defaultSelected: true },
          { key: 'session_location', label: 'Session Location', labelAr: 'موقع الجلسة', category: 'course', defaultSelected: false },
        ]
      },
      {
        id: 'book',
        label: 'Book Coverage',
        labelAr: 'تغطية الكتاب',
        icon: '📖',
        fields: [
          { key: 'book_topic', label: 'Book Topic', labelAr: 'موضوع الكتاب', category: 'book', defaultSelected: false },
          { key: 'book_pages', label: 'Book Pages', labelAr: 'صفحات الكتاب', category: 'book', defaultSelected: false },
          { key: 'book_start_page', label: 'Start Page', labelAr: 'صفحة البداية', category: 'book', defaultSelected: false },
          { key: 'book_end_page', label: 'End Page', labelAr: 'صفحة النهاية', category: 'book', defaultSelected: false },
        ]
      },
      {
        id: 'attendance',
        label: 'Attendance Details',
        labelAr: 'تفاصيل الحضور',
        icon: '✅',
        fields: [
          { key: 'status', label: 'Status', labelAr: 'الحالة', category: 'attendance', defaultSelected: true },
          { key: 'status_display', label: 'Status (Display)', labelAr: 'الحالة (عرض)', category: 'attendance', defaultSelected: false },
          { key: 'is_present', label: 'Is Present', labelAr: 'حاضر', category: 'attendance', defaultSelected: false },
          { key: 'is_late', label: 'Is Late', labelAr: 'متأخر', category: 'attendance', defaultSelected: false },
          { key: 'is_excused', label: 'Is Excused', labelAr: 'معذور', category: 'attendance', defaultSelected: false },
          { key: 'is_absent', label: 'Is Absent', labelAr: 'غائب', category: 'attendance', defaultSelected: false },
        ]
      },
      {
        id: 'timing',
        label: 'Timing Details',
        labelAr: 'تفاصيل التوقيت',
        icon: '⏰',
        fields: [
          { key: 'late_minutes', label: 'Late Duration (min)', labelAr: 'مدة التأخر', category: 'timing', defaultSelected: true },
          { key: 'late_bracket', label: 'Late Bracket', labelAr: 'فئة التأخر', category: 'timing', defaultSelected: false },
          { key: 'early_minutes', label: 'Early (min)', labelAr: 'مبكر', category: 'timing', defaultSelected: false },
          { key: 'check_in_time', label: 'Check-in Time', labelAr: 'وقت الدخول', category: 'timing', defaultSelected: false },
          { key: 'gps_timestamp', label: 'GPS Timestamp', labelAr: 'وقت GPS', category: 'timing', defaultSelected: false },
        ]
      },
      {
        id: 'excuse',
        label: 'Excuse Info',
        labelAr: 'معلومات العذر',
        icon: '📝',
        fields: [
          { key: 'excuse_reason', label: 'Excuse Reason', labelAr: 'سبب العذر', category: 'excuse', defaultSelected: true },
          { key: 'check_in_method', label: 'Check-in Method', labelAr: 'طريقة التسجيل', category: 'excuse', defaultSelected: false },
        ]
      },
      {
        id: 'location',
        label: 'Location Info',
        labelAr: 'معلومات الموقع',
        icon: '📍',
        fields: [
          { key: 'host_address', label: 'Host Address', labelAr: 'عنوان المضيف', category: 'location', defaultSelected: true },
          { key: 'gps_latitude', label: 'GPS Latitude', labelAr: 'خط العرض', category: 'location', defaultSelected: false },
          { key: 'gps_longitude', label: 'GPS Longitude', labelAr: 'خط الطول', category: 'location', defaultSelected: false },
          { key: 'gps_coordinates', label: 'GPS Coordinates', labelAr: 'إحداثيات GPS', category: 'location', defaultSelected: false },
          { key: 'gps_accuracy', label: 'GPS Accuracy (m)', labelAr: 'دقة GPS', category: 'location', defaultSelected: false },
          { key: 'distance_from_host', label: 'Distance from Host (m)', labelAr: 'المسافة من المضيف', category: 'location', defaultSelected: false },
        ]
      },
      {
        id: 'metadata',
        label: 'Metadata',
        labelAr: 'البيانات الوصفية',
        icon: '🔖',
        fields: [
          { key: 'marked_by', label: 'Marked By', labelAr: 'سجل بواسطة', category: 'metadata', defaultSelected: false },
          { key: 'marked_at', label: 'Marked At', labelAr: 'وقت التسجيل', category: 'metadata', defaultSelected: true },
          { key: 'session_id', label: 'Session ID', labelAr: 'رقم الجلسة', category: 'metadata', defaultSelected: false },
          { key: 'teacher_id', label: 'Teacher ID', labelAr: 'رقم المدرب', category: 'metadata', defaultSelected: false },
        ]
      }
    ];
  };

  // Helper: Get all field definitions for a data type (flattened from categories)
  const getAllFieldsForType = (dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics') => {
    // Build map of all available fields for each data type
    const allFields: { key: string; label: string; labelAr: string }[] = [];
    
    // Get categories for specific type by parsing the function logic
    if (dataType === 'studentAnalytics') {
      // Student fields
      allFields.push(
        { key: 'rank', label: 'Rank', labelAr: 'الترتيب' },
        { key: 'student_id', label: 'Student ID', labelAr: 'رقم الطالب' },
        { key: 'student_name', label: 'Student Name', labelAr: 'اسم الطالب' },
        { key: 'presentCount', label: 'On Time', labelAr: 'في الوقت' },
        { key: 'lateCount', label: 'Late', labelAr: 'متأخر' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'حاضر' },
        { key: 'absentCount', label: 'Total Absent', labelAr: 'إجمالي الغياب' },
        { key: 'unexcusedAbsent', label: 'Unexcused Absent', labelAr: 'غائب بدون عذر' },
        { key: 'excusedCount', label: 'Excused', labelAr: 'غائب بعذر' },
        { key: 'totalRecords', label: 'Total Records', labelAr: 'إجمالي السجلات' },
        { key: 'effectiveDays', label: 'Effective Days', labelAr: 'الأيام الفعلية' },
        { key: 'daysCovered', label: 'Days Covered', labelAr: 'الأيام المغطاة' },
        { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'معدل الحضور (%)' },
        { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'معدل الالتزام بالوقت (%)' },
        { key: 'weightedScore', label: 'Weighted Score', labelAr: 'النقاط المرجحة' },
        { key: 'consistencyIndex', label: 'Consistency Index', labelAr: 'مؤشر الانتظام' },
        { key: 'trendSlope', label: 'Trend Slope', labelAr: 'ميل الاتجاه' },
        { key: 'trendClassification', label: 'Trend Classification', labelAr: 'تصنيف الاتجاه' },
        { key: 'trendRSquared', label: 'Trend R² Value', labelAr: 'قيمة R²' },
        { key: 'weeklyChange', label: 'Weekly Change %', labelAr: 'التغير الأسبوعي (%)' },
        { key: 'avgRate', label: 'Average Rate', labelAr: 'المعدل المتوسط' },
        { key: 'minRate', label: 'Minimum Rate', labelAr: 'أدنى معدل' },
        { key: 'maxRate', label: 'Maximum Rate', labelAr: 'أعلى معدل' },
        // Score Breakdown
        { key: 'qualityAdjustedRate', label: 'Quality-Adjusted Rate %', labelAr: 'معدل الجودة المعدل' },
        { key: 'rawWeightedScore', label: 'Raw Score (before coverage)', labelAr: 'الدرجة الخام' },
        { key: 'coverageFactor', label: 'Coverage Factor', labelAr: 'عامل التغطية' },
        { key: 'scoreFormula', label: 'Score Formula', labelAr: 'معادلة الدرجة' },
        // Late Duration
        { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'مجموع التأخير (دقيقة)' },
        { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'متوسط التأخير' },
        { key: 'maxLateMinutes', label: 'Max Late (min)', labelAr: 'أقصى تأخير' },
        { key: 'lateScoreAvg', label: 'Avg Late Credit (0-1)', labelAr: 'متوسط رصيد التأخير' },
      );
    } else if (dataType === 'dateAnalytics') {
      // Date fields
      allFields.push(
        { key: 'date', label: 'Date', labelAr: 'التاريخ' },
        { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'يوم الأسبوع' },
        { key: 'hostAddress', label: 'Host Address', labelAr: 'عنوان المضيف' },
        { key: 'bookTopic', label: 'Book Topic', labelAr: 'الموضوع' },
        { key: 'bookPages', label: 'Pages', labelAr: 'الصفحات' },
        { key: 'bookStartPage', label: 'Start Page', labelAr: 'صفحة البداية' },
        { key: 'bookEndPage', label: 'End Page', labelAr: 'صفحة النهاية' },
        { key: 'pagesCount', label: 'Pages Count', labelAr: 'عدد الصفحات' },
        { key: 'presentCount', label: 'On Time', labelAr: 'في الوقت' },
        { key: 'lateCount', label: 'Late', labelAr: 'متأخر' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'إجمالي الحضور' },
        { key: 'excusedAbsentCount', label: 'Excused', labelAr: 'معذور' },
        { key: 'unexcusedAbsentCount', label: 'Absent', labelAr: 'غائب' },
        { key: 'totalAbsent', label: 'Total Absent', labelAr: 'إجمالي الغياب' },
        { key: 'totalStudents', label: 'Total Students', labelAr: 'إجمالي الطلاب' },
        { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'نسبة الحضور' },
        { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'نسبة الالتزام' },
        { key: 'absentRate', label: 'Absence Rate %', labelAr: 'نسبة الغياب' },
        { key: 'presentNames', label: 'On Time Names', labelAr: 'أسماء في الوقت' },
        { key: 'lateNames', label: 'Late Names', labelAr: 'أسماء المتأخرين' },
        { key: 'excusedNames', label: 'Excused Names', labelAr: 'أسماء المعذورين' },
        { key: 'absentNames', label: 'Absent Names', labelAr: 'أسماء الغائبين' },
        // Late Duration
        { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'مجموع التأخير (دقيقة)' },
        { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'متوسط التأخير' },
      );
    } else if (dataType === 'hostAnalytics') {
      // Host fields
      allFields.push(
        { key: 'rank', label: 'Rank', labelAr: 'الرتبة' },
        { key: 'address', label: 'Host Address', labelAr: 'عنوان المضيف' },
        { key: 'count', label: 'Times Hosted', labelAr: 'عدد مرات الاستضافة' },
        { key: 'percentage', label: 'Hosting Percentage %', labelAr: 'نسبة الاستضافة' },
        { key: 'attendanceRate', label: 'Avg Attendance Rate %', labelAr: 'متوسط نسبة الحضور' },
        { key: 'firstHostDate', label: 'First Host Date', labelAr: 'أول تاريخ استضافة' },
        { key: 'lastHostDate', label: 'Last Host Date', labelAr: 'آخر تاريخ استضافة' },
        { key: 'totalOnTime', label: 'Total On Time', labelAr: 'إجمالي الحضور' },
        { key: 'totalLate', label: 'Total Late', labelAr: 'إجمالي المتأخرين' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'إجمالي الحاضرين' },
        { key: 'totalAbsent', label: 'Total Absent', labelAr: 'إجمالي الغياب' },
        { key: 'totalExcused', label: 'Total Excused', labelAr: 'إجمالي المعذورين' },
        { key: 'totalStudents', label: 'Total Students', labelAr: 'إجمالي الطلاب' },
        { key: 'dates', label: 'All Dates', labelAr: 'جميع التواريخ' },
      );
    }
    
    return allFields;
  };

  // Helper: Get selected fields or default fields for a data type
  const getSelectedFieldsForType = (dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'): string[] => {
    const saved = savedFieldSelections[dataType];
    if (saved && saved.length > 0) {
      return saved;
    }
    // Return all field keys as default
    return getAllFieldsForType(dataType).map(f => f.key);
  };
  
  // Helper: Get sort settings for a data type
  const getSortSettingsForType = (dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'): { sortByField?: string; sortDirection: 'asc' | 'desc' } => {
    const settings = savedExportSettings[dataType];
    return {
      sortByField: settings?.sortByField,
      sortDirection: settings?.sortDirection || 'asc',
    };
  };
  
  // Helper: Sort data array based on saved settings
  const sortDataBySettings = <T extends Record<string, unknown>>(
    data: T[],
    dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'
  ): T[] => {
    const { sortByField, sortDirection } = getSortSettingsForType(dataType);
    if (!sortByField) return data;
    
    const sortDir = sortDirection === 'desc' ? -1 : 1;
    
    // Check if this is a date field that needs special handling
    const isDateField = sortByField.toLowerCase().includes('date') || 
                        sortByField === 'firstHostDate' || 
                        sortByField === 'lastHostDate';
    
    // For date fields, use the raw timestamp field if available
    const getDateSortKey = (item: T): number => {
      // Try to use raw timestamp field first
      const rawKey = `${sortByField}Raw`;
      if (rawKey in item && typeof item[rawKey] === 'number') {
        return item[rawKey] as number;
      }
      // Otherwise parse the date string
      const dateVal = item[sortByField];
      if (dateVal && typeof dateVal === 'string') {
        const parsed = new Date(dateVal);
        if (!isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
      }
      return 0;
    };
    
    return [...data].sort((a, b) => {
      const aVal = a[sortByField];
      const bVal = b[sortByField];
      if (aVal == null) return sortDir;
      if (bVal == null) return -sortDir;
      
      // Handle date fields specially
      if (isDateField) {
        const aTime = getDateSortKey(a);
        const bTime = getDateSortKey(b);
        return (aTime - bTime) * sortDir;
      }
      
      // Handle numbers
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * sortDir;
      }
      
      // Handle strings
      return String(aVal).localeCompare(String(bVal)) * sortDir;
    });
  };

  // Helper: Get conditional coloring settings for a data type
  const getColoringSettingsForType = (dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'): { 
    enableConditionalColoring: boolean; 
    coloringFields: string[];
    coloringTheme: 'default' | 'traffic' | 'heatmap' | 'status';
  } => {
    const settings = savedExportSettings[dataType];
    return {
      enableConditionalColoring: settings?.enableConditionalColoring ?? true,
      coloringFields: settings?.coloringFields || [],
      coloringTheme: settings?.coloringTheme || 'default',
    };
  };
  
  // Helper: Filter out excluded date rows from data
  const filterExcludedDateRows = <T extends Record<string, unknown>>(
    data: T[],
    dateKey: string = 'date'
  ): T[] => {
    const excluded = savedExportSettings.dateAnalytics?.excludedRows;
    if (!excluded || excluded.length === 0) return data;
    const excludedSet = new Set(excluded);
    return data.filter(row => !excludedSet.has(String(row[dateKey] ?? '')));
  };
  
  // Helper: Get color for a percentage value based on theme
  const getColorForPercentage = (
    value: number, 
    theme: 'default' | 'traffic' | 'heatmap' | 'status'
  ): { rgb: [number, number, number]; hex: string } => {
    if (theme === 'traffic') {
      // Traffic light: Red -> Yellow -> Green
      if (value >= 80) return { rgb: [34, 197, 94], hex: '#22C55E' };   // Green
      if (value >= 60) return { rgb: [234, 179, 8], hex: '#EAB308' };   // Yellow  
      return { rgb: [239, 68, 68], hex: '#EF4444' };                     // Red
    } else if (theme === 'heatmap') {
      // Heatmap: Blue gradient
      if (value >= 90) return { rgb: [30, 64, 175], hex: '#1E40AF' };   // Dark blue
      if (value >= 75) return { rgb: [59, 130, 246], hex: '#3B82F6' };  // Medium blue
      if (value >= 60) return { rgb: [147, 197, 253], hex: '#93C5FD' }; // Light blue
      return { rgb: [219, 234, 254], hex: '#DBEAFE' };                   // Very light blue
    } else if (theme === 'status') {
      // Status: Success/Info/Warning/Error
      if (value >= 90) return { rgb: [16, 185, 129], hex: '#10B981' };  // Emerald (excellent)
      if (value >= 75) return { rgb: [59, 130, 246], hex: '#3B82F6' };  // Blue (good)
      if (value >= 60) return { rgb: [245, 158, 11], hex: '#F59E0B' };  // Amber (warning)
      return { rgb: [239, 68, 68], hex: '#EF4444' };                     // Red (needs attention)
    }
    // Default theme
    if (value >= 90) return { rgb: [16, 185, 129], hex: '#10B981' };    // Green
    if (value >= 75) return { rgb: [59, 130, 246], hex: '#3B82F6' };    // Blue
    if (value >= 60) return { rgb: [245, 158, 11], hex: '#F59E0B' };    // Yellow
    return { rgb: [239, 68, 68], hex: '#EF4444' };                       // Red
  };

  // Helper: Filter headers and data based on selected fields
  const filterDataByFields = (
    dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics',
    isArabic: boolean
  ): { headers: string[]; getData: (item: Record<string, unknown>, index: number) => unknown[] } => {
    const selectedKeys = getSelectedFieldsForType(dataType);
    const allFields = getAllFieldsForType(dataType);
    
    // Filter to only selected fields, maintaining order
    const selectedFields = selectedKeys
      .map(key => allFields.find(f => f.key === key))
      .filter((f): f is { key: string; label: string; labelAr: string } => f !== undefined);
    
    const headers = selectedFields.map(f => isArabic ? f.labelAr : f.label);
    
    const getData = (item: Record<string, unknown>, index: number): unknown[] => {
      return selectedFields.map(field => {
        if (field.key === 'rank') return index + 1;
        return item[field.key] ?? '-';
      });
    };
    
    return { headers, getData };
  };

  // Get export data based on current data type
  const getExportData = (): Record<string, unknown>[] => {
    if (exportDataType === 'studentAnalytics') {
      return studentAnalytics.map((student, index) => {
        const totalPresent = student.presentCount + student.lateCount;
        const punctualityRate = totalPresent > 0 
          ? Math.round(student.presentCount / totalPresent * 100)
          : 0;
        return {
          // Basic Info
          rank: index + 1,
          student_id: student.student_id,
          student_name: student.student_name,
          // Attendance Stats
          presentCount: student.presentCount,
          lateCount: student.lateCount,
          totalPresent,
          absentCount: student.absentCount,
          unexcusedAbsent: student.unexcusedAbsent,
          excusedCount: student.excusedCount,
          totalRecords: student.totalRecords,
          // Performance Metrics
          effectiveDays: student.effectiveDays,
          daysCovered: student.daysCovered,
          attendanceRate: student.attendanceRate,
          punctualityRate,
          weightedScore: student.weightedScore,
          consistencyIndex: Math.round(student.consistencyIndex * 100) / 100,
          // Trend Analysis
          trendSlope: student.trend?.slope || 0,
          trendClassification: student.trend?.classification || '-',
          trendRSquared: student.trend?.rSquared || 0,
          weeklyChange: student.weeklyChange || 0,
          // Rate Statistics
          avgRate: student.avgRate || student.attendanceRate,
          minRate: student.minRate || student.attendanceRate,
          maxRate: student.maxRate || student.attendanceRate,
          // Score Breakdown (transparency)
          qualityAdjustedRate: Math.round((student.qualityAdjustedRate || 0) * 100) / 100,
          rawWeightedScore: Math.round((student.rawWeightedScore || 0) * 100) / 100,
          coverageFactor: Math.round((student.coverageFactor || 0) * 1000) / 1000,
          scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} × ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
          // Late Duration
          totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
          avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
          maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
          lateScoreAvg: Math.round((student.lateScoreAvg || 0) * 1000) / 1000,
        };
      });
    } else if (exportDataType === 'dateAnalytics') {
      return dateAnalytics.map((dateData) => {
        const bookPages = dateData.bookStartPage && dateData.bookEndPage 
          ? `${dateData.bookStartPage}-${dateData.bookEndPage}` 
          : '-';
        const pagesCount = dateData.bookStartPage && dateData.bookEndPage
          ? dateData.bookEndPage - dateData.bookStartPage + 1
          : 0;
        const totalPresent = dateData.presentCount + dateData.lateCount;
        const totalStudents = totalPresent + dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
        // Attendance Rate: (Total Present / Total Students) * 100
        const attendanceRate = totalStudents > 0 ? Math.round((totalPresent / totalStudents) * 100) : 0;
        // Absence Rate: (Unexcused Absent / Total Students) * 100
        const absentRate = totalStudents > 0 ? Math.round((dateData.unexcusedAbsentCount / totalStudents) * 100) : 0;
        const punctualityRate = totalPresent > 0 
          ? Math.round(dateData.presentCount / totalPresent * 100)
          : 0;
        const dateObj = new Date(dateData.date);
        return {
          // Session Info
          date: format(dateObj, 'MMM dd, yyyy'),
          dayOfWeek: format(dateObj, 'EEEE'),
          hostAddress: dateData.hostAddress || '-',
          // Book Coverage
          bookTopic: dateData.bookTopic || '-',
          bookPages,
          bookStartPage: dateData.bookStartPage || '-',
          bookEndPage: dateData.bookEndPage || '-',
          pagesCount: pagesCount > 0 ? pagesCount : '-',
          // Attendance Counts
          presentCount: dateData.presentCount,
          lateCount: dateData.lateCount,
          totalPresent,
          excusedAbsentCount: dateData.excusedAbsentCount,
          unexcusedAbsentCount: dateData.unexcusedAbsentCount,
          totalAbsent: dateData.excusedAbsentCount + dateData.unexcusedAbsentCount,
          totalStudents,
          // Rates & Percentages
          attendanceRate,
          punctualityRate,
          absentRate,
          // Late Duration
          totalLateMinutes: Math.round((dateData.totalLateMinutes || 0) * 10) / 10,
          avgLateMinutes: Math.round((dateData.avgLateMinutes || 0) * 10) / 10,
          // Student Names
          presentNames: dateData.presentNames.join(', ') || '-',
          lateNames: dateData.lateNames.join(', ') || '-',
          excusedNames: dateData.excusedNames.join(', ') || '-',
          absentNames: dateData.absentNames.join(', ') || '-',
        };
      });
    } else if (exportDataType === 'hostAnalytics') {
      // Build host map with attendance stats per host
      const hostMap = new Map<string, { 
        count: number; 
        dates: string[]; 
        rawDates: Date[];
        present: number;
        late: number;
        absent: number;
        excused: number;
        totalStudents: number;
      }>();
      
      dateAnalytics.forEach((dateData) => {
        if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
          const existing = hostMap.get(dateData.hostAddress) || { 
            count: 0, 
            dates: [], 
            rawDates: [],
            present: 0,
            late: 0,
            absent: 0,
            excused: 0,
            totalStudents: 0
          };
          existing.count++;
          existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
          existing.rawDates.push(new Date(dateData.date));
          // Aggregate attendance stats
          existing.present += dateData.presentCount;
          existing.late += dateData.lateCount;
          existing.absent += dateData.unexcusedAbsentCount;
          existing.excused += dateData.excusedAbsentCount;
          existing.totalStudents += dateData.presentCount + dateData.lateCount + dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
          hostMap.set(dateData.hostAddress, existing);
        }
      });
      const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
      return Array.from(hostMap.entries())
        .map(([address, data]) => ({ address, ...data }))
        .sort((a, b) => b.count - a.count)
        .map((host, index) => {
          const totalPresent = host.present + host.late;
          // Fair calculation: Exclude excused from denominator
          // Attendance Rate = Present / (Present + Absent) - excused don't count against host
          const expectedAttendees = totalPresent + host.absent; // Those who should have attended
          const attendanceRate = expectedAttendees > 0 ? Math.round(totalPresent / expectedAttendees * 100) : 0;
          
          return {
            // Host Info
            rank: index + 1,
            address: host.address,
            // Hosting Statistics
            count: host.count,
            percentage: totalHostings > 0 ? Math.round(host.count / totalHostings * 100) : 0,
            firstHostDate: host.rawDates.length > 0 ? format(new Date(Math.min(...host.rawDates.map(d => d.getTime()))), 'MMM dd, yyyy') : '-',
            lastHostDate: host.rawDates.length > 0 ? format(new Date(Math.max(...host.rawDates.map(d => d.getTime()))), 'MMM dd, yyyy') : '-',
            // Attendance Stats
            attendanceRate,
            totalOnTime: host.present,
            totalLate: host.late,
            totalPresent,
            totalAbsent: host.absent,
            totalExcused: host.excused,
            totalStudents: host.totalStudents,
            // Hosting Dates
            dates: host.dates.join(', '),
            datesList: host.dates.join('\n'),
          };
        });
    }
    // Default: filtered records with all available fields
    return filteredRecords.map(r => {
      // Get late bracket name
      const lateBracketInfo = getLateBracketInfo(r.late_minutes);
      const dateObj = new Date(r.attendance_date);
      const bookPages = r.book_start_page && r.book_end_page 
        ? `${r.book_start_page}-${r.book_end_page}` 
        : '-';
      
      return {
        // Basic Info
        date: format(dateObj, 'MMM dd, yyyy'),
        dayOfWeek: format(dateObj, 'EEEE'),
        attendance_id: r.attendance_id,
        // Student Info
        student_name: r.student_name,
        student_id: r.student_id,
        // Course Info
        course_name: r.course_name,
        course_id: r.course_id,
        instructor_name: r.instructor_name,
        session_location: r.session_location || '-',
        // Book Coverage
        book_topic: r.book_topic || '-',
        book_pages: bookPages,
        book_start_page: r.book_start_page || '-',
        book_end_page: r.book_end_page || '-',
        // Attendance Details
        status: r.status,
        status_display: r.status === 'on time' ? 'On Time' : 
          r.status === 'late' ? 'Late' : 
          r.status === 'excused' ? 'Excused' :
          r.status === 'absent' ? 'Absent' : r.status,
        is_present: r.status === 'on time' ? 'Yes' : 'No',
        is_late: r.status === 'late' ? 'Yes' : 'No',
        is_excused: r.status === 'excused' ? 'Yes' : 'No',
        is_absent: r.status === 'absent' ? 'Yes' : 'No',
        // Timing Details
        late_minutes: r.status === 'late' && r.late_minutes ? r.late_minutes : '-',
        late_bracket: r.status === 'late' && r.late_minutes ? lateBracketInfo.name : '-',
        early_minutes: r.early_minutes || '-',
        check_in_time: r.gps_timestamp ? format(new Date(r.gps_timestamp), 'HH:mm:ss') : '-',
        gps_timestamp: r.gps_timestamp ? format(new Date(r.gps_timestamp), 'MMM dd, yyyy HH:mm:ss') : '-',
        // Excuse Info
        excuse_reason: r.excuse_reason || '-',
        check_in_method: r.check_in_method || '-',
        // Location Info
        host_address: r.host_address || '-',
        gps_latitude: r.gps_latitude ? r.gps_latitude.toFixed(6) : '-',
        gps_longitude: r.gps_longitude ? r.gps_longitude.toFixed(6) : '-',
        gps_coordinates: r.gps_latitude && r.gps_longitude 
          ? `${r.gps_latitude.toFixed(4)}°, ${r.gps_longitude.toFixed(4)}°` 
          : '-',
        gps_accuracy: r.gps_accuracy ? `±${Math.round(r.gps_accuracy)}m` : '-',
        distance_from_host: r.distance_from_host ? `${Math.round(r.distance_from_host)}m` : '-',
        // Metadata
        marked_by: r.marked_by || '-',
        marked_at: r.marked_at ? format(new Date(r.marked_at), 'MMM dd, HH:mm') : '-',
        session_id: r.session_id,
        teacher_id: r.teacher_id,
      };
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 pb-8">
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      {/* Advanced Export Builder Modal */}
      <AdvancedExportBuilder
        key={`export-${exportDataType}`}
        isOpen={showAdvancedExport}
        onClose={() => setShowAdvancedExport(false)}
        categories={getExportCategories()}
        data={getExportData()}
        defaultTitle={
          exportDataType === 'studentAnalytics' ? 'Student Performance Report' :
          exportDataType === 'dateAnalytics' ? 'Attendance by Date Report' :
          exportDataType === 'hostAnalytics' ? 'Host Rankings Report' :
          'Attendance Records'
        }
        savedFields={savedFieldSelections[exportDataType]}
        savedSettings={savedExportSettings[exportDataType]}
        onFieldSelectionChange={(fields) => {
          setSavedFieldSelections(prev => ({
            ...prev,
            [exportDataType]: fields
          }));
        }}
        onSettingsChange={(settings) => {
          setSavedExportSettings(prev => ({
            ...prev,
            [exportDataType]: settings
          }));
        }}
        rowFilterKey={exportDataType === 'dateAnalytics' ? 'date' : undefined}
        rowFilterLabel={exportDataType === 'dateAnalytics' ? '📅 Date Rows to Export' : undefined}
      />
      
      {/* Modern Header with Gradient */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Attendance Records</h1>
                  <p className="text-blue-100 text-sm sm:text-base mt-1">
                    📍 GPS-Tracked Attendance with Advanced Analytics
                  </p>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowAnalytics(!showAnalytics)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border border-white/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                {showAnalytics ? 'Hide' : 'Show'} Analytics
              </button>
              
              {showAnalytics && (
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/20">
                  <button
                    onClick={() => setReportLanguage('en')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                      reportLanguage === 'en' 
                        ? 'bg-white text-blue-700 shadow-md' 
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => setReportLanguage('ar')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                      reportLanguage === 'ar' 
                        ? 'bg-white text-blue-700 shadow-md' 
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    ع
                  </button>
                </div>
              )}
              
              <button
                onClick={() => setShowBulkImport(!showBulkImport)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border border-white/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {showBulkImport ? 'Hide' : 'Import'}
              </button>
              
              <button
                onClick={loadRecords}
                className="px-4 py-2 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-gray-700 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 space-y-6">

      {/* Bulk Import Section */}
      {showBulkImport && (
        <BulkImport onImportComplete={() => {
          loadRecords();
          setShowBulkImport(false);
        }} />
      )}

      {/* Advanced Analytics Dashboard */}
      {showAnalytics && (
        <div className="space-y-4 sm:space-y-6">
          {/* Summary Statistics */}
          <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow dark:shadow-gray-900/30">
            <h2 className="text-base sm:text-lg font-semibold mb-4 dark:text-white">📊 Summary Statistics</h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="border-l-4 border-blue-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Students</div>
                <div className="text-xl sm:text-2xl font-bold dark:text-white">{studentAnalytics.length}</div>
              </div>
              <div className="border-l-4 border-green-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Class Avg Rate</div>
                <div className="text-xl sm:text-2xl font-bold dark:text-white">
                  {studentAnalytics.length > 0
                    ? Math.round(
                        studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) /
                          studentAnalytics.length
                      )
                    : 0}
                  %
                </div>
              </div>
              <div className="border-l-4 border-purple-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Avg Weighted Score</div>
                <div className="text-xl sm:text-2xl font-bold dark:text-white">
                  {studentAnalytics.length > 0
                    ? Math.round(
                        studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) /
                          studentAnalytics.length
                      )
                    : 0}
                </div>
              </div>
              <div className="border-l-4 border-blue-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Avg Attendance by Date</div>
                <div className="text-xl sm:text-2xl font-bold dark:text-white">
                  {dateAnalytics.length > 0
                    ? Math.round(
                        dateAnalytics.reduce((sum, d) => sum + d.attendanceRate, 0) /
                          dateAnalytics.length
                      )
                    : 0}
                  %
                </div>
              </div>
              <div className="border-l-4 border-indigo-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Avg Attendance by Accrued Date</div>
                <div className="text-xl sm:text-2xl font-bold dark:text-white">
                  {(() => {
                    // Only consider dates where at least one present or late
                    const accruedDates = dateAnalytics.filter(d => (d.presentCount + d.lateCount) > 0);
                    if (accruedDates.length === 0) return 0;
                    return Math.round(
                      accruedDates.reduce((sum, d) => sum + d.attendanceRate, 0) / accruedDates.length
                    );
                  })()}
                  %
                </div>
              </div>
            </div>
          </div>

          {/* Export Analytics Bar - Right after summary, easy access */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-2xl shadow-lg p-4 border border-indigo-100 dark:border-indigo-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 dark:bg-indigo-900/40 p-2 rounded-lg">
                  <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Export Analytics</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Download reports or configure fields shown in tables below</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={exportAnalyticsToExcel} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Excel
                </button>
                <button onClick={exportAnalyticsToPDF} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  PDF
                </button>
                <button onClick={exportAnalyticsToWord} disabled={exportingWord} className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md ${exportingWord ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  {exportingWord ? 'Exporting...' : 'Word'}
                </button>
                <button onClick={exportAnalyticsToCSV} className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  CSV
                </button>
              </div>
            </div>
            {/* Field Selection Status */}
            <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700">
              <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold">📊 Student:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.studentAnalytics.length > 0 ? `${savedFieldSelections.studentAnalytics.length} fields` : 'All'}
                  </span>
                  {savedExportSettings.studentAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.studentAnalytics.sortByField} {savedExportSettings.studentAnalytics.sortDirection === 'desc' ? '↓' : '↑'})</span>
                  )}
                  {savedExportSettings.studentAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">🌈</span>}
                  <button onClick={() => { setExportDataType('studentAnalytics'); setShowAdvancedExport(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline text-xs ml-1">Edit</button>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-green-600 dark:text-green-400 font-semibold">📅 Date:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.dateAnalytics.length > 0 ? `${savedFieldSelections.dateAnalytics.length} fields` : 'All'}
                  </span>
                  {savedExportSettings.dateAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.dateAnalytics.sortByField} {savedExportSettings.dateAnalytics.sortDirection === 'desc' ? '↓' : '↑'})</span>
                  )}
                  {savedExportSettings.dateAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">🌈</span>}
                  <button onClick={() => { setExportDataType('dateAnalytics'); setShowAdvancedExport(true); }} className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 underline text-xs ml-1">Edit</button>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-orange-600 dark:text-orange-400 font-semibold">🏠 Host:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.hostAnalytics.length > 0 ? `${savedFieldSelections.hostAnalytics.length} fields` : 'All'}
                  </span>
                  {savedExportSettings.hostAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.hostAnalytics.sortByField} {savedExportSettings.hostAnalytics.sortDirection === 'desc' ? '↓' : '↑'})</span>
                  )}
                  {savedExportSettings.hostAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">🌈</span>}
                  <button onClick={() => { setExportDataType('hostAnalytics'); setShowAdvancedExport(true); }} className="text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300 underline text-xs ml-1">Edit</button>
                </div>
              </div>
            </div>
          </div>

          {/* Student Performance Table — Dynamic columns from field selections */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseStudentTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              <h2 className="text-base sm:text-lg font-semibold dark:text-white">🎓 Student Performance Analytics</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{studentAnalytics.length} students</span>
                <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${collapseStudentTable ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {!collapseStudentTable && (
              <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
                {(() => {
                  const isArabic = reportLanguage === 'ar';
                  const config = filterDataByFields('studentAnalytics', isArabic);
                  const dataObjects = studentAnalytics.map((student, index) => {
                    const totalPres = student.presentCount + student.lateCount;
                    const punctRate = totalPres > 0 ? Math.round(student.presentCount / totalPres * 100) : 0;
                    return {
                      rank: index + 1,
                      student_id: student.student_id,
                      student_name: student.student_name,
                      presentCount: student.presentCount,
                      lateCount: student.lateCount,
                      totalPresent: totalPres,
                      absentCount: student.absentCount,
                      unexcusedAbsent: student.unexcusedAbsent,
                      excusedCount: student.excusedCount,
                      totalRecords: student.totalRecords,
                      effectiveDays: student.effectiveDays,
                      daysCovered: student.daysCovered,
                      attendanceRate: `${student.attendanceRate}%`,
                      punctualityRate: `${punctRate}%`,
                      weightedScore: student.weightedScore.toFixed(1),
                      consistencyIndex: Math.round(student.consistencyIndex * 100) / 100,
                      trendSlope: student.trend?.slope || 0,
                      trendClassification: student.trend?.classification || '-',
                      trendRSquared: student.trend?.rSquared || 0,
                      weeklyChange: `${student.weeklyChange || 0}%`,
                      avgRate: `${student.avgRate || student.attendanceRate}%`,
                      minRate: `${student.minRate || student.attendanceRate}%`,
                      maxRate: `${student.maxRate || student.attendanceRate}%`,
                      qualityAdjustedRate: `${Math.round((student.qualityAdjustedRate || 0) * 100) / 100}%`,
                      rawWeightedScore: (student.rawWeightedScore || 0).toFixed(1),
                      coverageFactor: (student.coverageFactor || 0).toFixed(3),
                      scoreFormula: `(${(student.rawWeightedScore || 0).toFixed(1)} × ${(student.coverageFactor || 0).toFixed(3)}) = ${student.weightedScore.toFixed(1)}`,
                      totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
                      avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
                      maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
                      lateScoreAvg: (student.lateScoreAvg || 0).toFixed(3),
                    } as Record<string, unknown>;
                  });
                  const sorted = sortDataBySettings(dataObjects, 'studentAnalytics');
                  sorted.forEach((obj, idx) => { obj.rank = idx + 1; });
                  return (
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                        <tr>
                          {config.headers.map((header, i) => (
                            <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {sorted.map((data, index) => {
                          const row = config.getData(data, index);
                          return (
                            <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200 whitespace-nowrap">{String(cell ?? '-')}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Date Analytics Table — Dynamic columns from field selections */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseDateTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              <h2 className="text-base sm:text-lg font-semibold dark:text-white">📅 Attendance by Date</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{dateAnalytics.length} sessions</span>
                <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${collapseDateTable ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {!collapseDateTable && (
              <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
                {(() => {
                  const isArabic = reportLanguage === 'ar';
                  const config = filterDataByFields('dateAnalytics', isArabic);
                  const dataObjects = dateAnalytics.map((d) => {
                    const totalPres = d.presentCount + d.lateCount;
                    const totalAbs = d.excusedAbsentCount + d.unexcusedAbsentCount;
                    const totalStud = totalPres + totalAbs;
                    const punctRate = totalPres > 0 ? Math.round(d.presentCount / totalPres * 100) : 0;
                    const absRate = totalStud > 0 ? Math.round(totalAbs / totalStud * 100) : 0;
                    const bookPages = d.bookStartPage && d.bookEndPage ? `${d.bookStartPage}-${d.bookEndPage}` : '-';
                    const pagesCount = d.bookStartPage && d.bookEndPage ? d.bookEndPage - d.bookStartPage + 1 : 0;
                    const dateObj = new Date(d.date);
                    let excusedLabel = d.excusedNames.join(', ') || '-';
                    if (d.hostAddress === 'SESSION_NOT_HELD' || (d.hostAddress && d.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')) {
                      excusedLabel = isArabic ? 'جميع الطلاب' : 'All Students';
                    }
                    return {
                      date: format(dateObj, 'MMM dd, yyyy'),
                      dayOfWeek: format(dateObj, 'EEEE'),
                      hostAddress: d.hostAddress || '-',
                      bookTopic: d.bookTopic || '-',
                      bookPages,
                      bookStartPage: d.bookStartPage || '-',
                      bookEndPage: d.bookEndPage || '-',
                      pagesCount: pagesCount > 0 ? pagesCount : '-',
                      presentCount: d.presentCount,
                      lateCount: d.lateCount,
                      totalPresent: totalPres,
                      excusedAbsentCount: d.excusedAbsentCount,
                      unexcusedAbsentCount: d.unexcusedAbsentCount,
                      totalAbsent: totalAbs,
                      totalStudents: totalStud,
                      attendanceRate: `${d.attendanceRate}%`,
                      punctualityRate: `${punctRate}%`,
                      absentRate: `${absRate}%`,
                      totalLateMinutes: Math.round((d.totalLateMinutes || 0) * 10) / 10,
                      avgLateMinutes: Math.round((d.avgLateMinutes || 0) * 10) / 10,
                      presentNames: d.presentNames.join(', ') || '-',
                      lateNames: d.lateNames.join(', ') || '-',
                      excusedNames: excusedLabel,
                      absentNames: d.absentNames.join(', ') || '-',
                    } as Record<string, unknown>;
                  });
                  const sorted = sortDataBySettings(dataObjects, 'dateAnalytics');
                  return (
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                        <tr>
                          {config.headers.map((header, i) => (
                            <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {sorted.map((data, index) => {
                          const row = config.getData(data, index);
                          return (
                            <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200 whitespace-nowrap">{String(cell ?? '-')}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary Stats Cards - Enhanced Design */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 dark:border-gray-700 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Total Records</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{filteredRecords.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">All attendance entries</p>
            </div>
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-green-100 dark:border-green-800/50 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">On Time</p>
              <p className="text-3xl font-bold text-green-900 dark:text-green-100">{filteredRecords.filter(r => r.status === 'on time').length}</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'on time').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-200 to-emerald-300 dark:from-green-700 dark:to-emerald-600 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-green-700 dark:text-green-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/30 dark:to-rose-900/30 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-red-100 dark:border-red-800/50 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Absent</p>
              <p className="text-3xl font-bold text-red-900 dark:text-red-100">{filteredRecords.filter(r => r.status === 'absent').length}</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'absent').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-red-200 to-rose-300 dark:from-red-700 dark:to-rose-600 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-red-700 dark:text-red-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-yellow-100 dark:border-yellow-800/50 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-1">Late</p>
              <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{filteredRecords.filter(r => r.status === 'late').length}</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'late').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-yellow-200 to-amber-300 dark:from-yellow-700 dark:to-amber-600 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-yellow-700 dark:text-yellow-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-blue-100 dark:border-blue-800/50 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">Excused</p>
              <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{filteredRecords.filter(r => r.status === 'excused').length}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'excused').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-blue-200 to-indigo-300 dark:from-blue-700 dark:to-indigo-600 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-blue-700 dark:text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters - Modern Card Design */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 p-6 border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Advanced Filters</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={quickFilterLastWeek}
              className="px-4 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all duration-200 flex items-center gap-2 border border-blue-100 dark:border-blue-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Last Week
            </button>
            <button
              onClick={quickFilterLastMonth}
              className="px-4 py-2 bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium hover:bg-purple-100 dark:hover:bg-purple-900/60 transition-all duration-200 flex items-center gap-2 border border-purple-100 dark:border-purple-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Last Month
            </button>
            <button
              onClick={quickFilterAbsentOnly}
              className="px-4 py-2 bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/60 transition-all duration-200 flex items-center gap-2 border border-red-100 dark:border-red-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Absent Only
            </button>
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset All
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Student
            </label>
            <Select
              value={filters.student_id}
              onChange={(value) => setFilters({ ...filters, student_id: value })}
              options={[{ value: '', label: 'All Students' }, ...students]}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Course
            </label>
            <Select
              value={filters.course_id}
              onChange={(value) => setFilters({ ...filters, course_id: value })}
              options={[{ value: '', label: 'All Courses' }, ...courses]}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Instructor
            </label>
            <Select
              value={filters.teacher_id}
              onChange={(value) => setFilters({ ...filters, teacher_id: value })}
              options={[{ value: '', label: 'All Instructors' }, ...instructors]}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Status
            </label>
            <Select
              value={filters.status}
              onChange={(value) => setFilters({ ...filters, status: value })}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'on time', label: 'On Time' },
                { value: 'absent', label: 'Absent' },
                { value: 'late', label: 'Late' },
                { value: 'excused', label: 'Excused' }
              ]}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
            />
          </div>
        </div>
      </div>

      {/* Records Table - Enhanced Design */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-gray-900/30 overflow-hidden border border-gray-100 dark:border-gray-700">
        {/* Table Header with Info */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-700 dark:to-gray-800">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Attendance Records</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Showing <span className="font-semibold text-blue-600 dark:text-blue-400">{filteredRecords.length}</span> records
                  {filteredRecords.length !== records.length && (
                    <span className="text-gray-500 dark:text-gray-500"> (filtered from {records.length} total)</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setExportDataType('records');
                  setShowAdvancedExport(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                title="Export Attendance Records"
              >
                <span>📤</span>
                <span>Advanced Export</span>
              </button>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600 dark:text-gray-400">Items per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-gray-600 dark:text-gray-300 font-medium">Loading attendance records...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Please wait while we fetch the data</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="bg-gray-100 dark:bg-gray-700 p-6 rounded-full">
              <svg className="w-16 h-16 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">No Records Found</h3>
            <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
              Try adjusting your filters or date range to see attendance records
            </p>
            <button
              onClick={resetFilters}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 flex items-center gap-2 shadow-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset Filters
            </button>
          </div>
        ) : (
        <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th 
                  className="px-3 sm:px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors group"
                  onClick={() => handleSort('attendance_date')}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Date
                    <span className="opacity-50 group-hover:opacity-100 transition-opacity">
                      {sortColumn === 'attendance_date' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th 
                  className="px-3 sm:px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors group"
                  onClick={() => handleSort('student_name')}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Student
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'student_name' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => handleSort('course_name')}
                >
                  <div className="flex items-center gap-1">
                    Course
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'course_name' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => handleSort('teacher_name')}
                >
                  <div className="flex items-center gap-1">
                    Instructor
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'teacher_name' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Late Duration
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Method
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Excuse Reason
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => handleSort('location')}
                >
                  <div className="flex items-center gap-1">
                    Location
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'location' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  GPS
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                  onClick={() => handleSort('marked_at')}
                >
                  <div className="flex items-center gap-1">
                    Marked At
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'marked_at' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {getSortedRecords()
                .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                .map((record) => (
                  <tr 
                    key={record.attendance_id} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                    onClick={() => navigate(`/attendance/${record.session_id}`, { state: { selectedDate: record.attendance_date } })}
                    title="Click to view/edit attendance for this date"
                  >
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {format(new Date(record.attendance_date), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {record.student_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {record.course_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {record.instructor_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(record.status)}`}>
                        {getStatusLabel(record.status)}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                      {record.status === 'late' && record.late_minutes ? (
                        <span className={`px-2 py-1 text-xs font-medium rounded ${getLateBracketInfo(record.late_minutes).color}`}>
                          {record.late_minutes} min ({getLateBracketInfo(record.late_minutes).name})
                        </span>
                      ) : record.status === 'late' ? (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">Not recorded</span>
                      ) : record.early_minutes ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">
                          {record.early_minutes} min early
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                      {record.check_in_method ? (
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          record.check_in_method === 'qr_code' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300' :
                          record.check_in_method === 'photo' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' :
                          record.check_in_method === 'bulk' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300' :
                          'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                        }`}>
                          {record.check_in_method === 'qr_code' ? 'QR Code' :
                           record.check_in_method === 'photo' ? 'Photo' :
                           record.check_in_method === 'bulk' ? 'Bulk' :
                           record.check_in_method === 'manual' ? 'Manual' :
                           record.check_in_method}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {record.status === 'excused' && record.excuse_reason ? (
                        <span className="capitalize px-2 py-1 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                          {record.excuse_reason}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                      {record.session_location || '-'}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                      {record.gps_latitude && record.gps_longitude ? (
                        <div className="space-y-1">
                          <div className="text-xs">{record.gps_latitude.toFixed(4)}°, {record.gps_longitude.toFixed(4)}°</div>
                          {record.gps_accuracy && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              ±{record.gps_accuracy.toFixed(0)}m
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">No GPS</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                      {record.marked_at ? (
                        <div className="space-y-1">
                          <div>{format(new Date(record.marked_at), 'MMM dd, HH:mm')}</div>
                          {record.marked_by && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">by {record.marked_by}</div>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {record.gps_latitude && record.gps_longitude && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openMapLocation(record);
                          }}
                          className="px-3 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all duration-200 flex items-center gap-2 text-xs font-medium border border-blue-200 dark:border-blue-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          View Map
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        )}
        
        {/* Modern Pagination */}
        {filteredRecords.length > 0 && !loading && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800">
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(filteredRecords.length / itemsPerPage)}
              totalItems={filteredRecords.length}
              itemsPerPage={itemsPerPage}
              onPageChange={(page) => setCurrentPage(page)}
              onItemsPerPageChange={(items) => {
                setItemsPerPage(items);
                setCurrentPage(1);
              }}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default AttendanceRecords;
