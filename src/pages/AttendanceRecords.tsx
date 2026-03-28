import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { format, subDays } from 'date-fns';
import { Pagination } from '@/shared/components/ui/Pagination';
import type { ExportCategory, ExportSettings } from '../components/AdvancedExportBuilder';
import { useToast } from '@/shared/hooks/useToast';
import { ToastContainer } from '@/shared/components/ui/ToastContainer';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { loadConfigSync, calcLateScore as calcLateScoreFromConfig, calcCoverageFactor as calcCoverageFromConfig } from '../services/scoringConfigService';
import { parseCoordinates, calculateDistance, formatDistance } from '@/shared/services/geocodingService';
import { loadAttendanceRecordsPageData } from '../services/attendanceRecordsPageService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { ATTENDANCE_STATUS } from '@/shared/constants/attendance';
import { Breadcrumb } from '@/shared/components/ui/Breadcrumb';

const AttendanceCharts = lazy(() => import('../components/AttendanceCharts'));
const AdvancedExportBuilder = lazy(() => import('../components/AdvancedExportBuilder').then((module) => ({ default: module.AdvancedExportBuilder })));
const LocationMap = lazy(() => import('../components/LocationMap').then((module) => ({ default: module.LocationMap })));

interface AttendanceRecord {
  attendance_id: string;
  student_id: string;
  student_specialization?: string | null;
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
  specialization?: string | null;
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
  qualityAdjustedRate: number;
  rawWeightedScore: number;
  coverageFactor: number;
  punctualityRate: number;
  totalLateMinutes: number;
  avgLateMinutes: number;
  maxLateMinutes: number;
  lateScoreAvg: number;
  sessionNotHeldCount: number;
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
  isSessionNotHeld: boolean;
  sessionNotHeldCount: number;
  bookTopic?: string | null;
  bookStartPage?: number | null;
  bookEndPage?: number | null;
  totalLateMinutes: number;
  avgLateMinutes: number;
  topSpecialization?: string | null;
  topSpecializationCount?: number;
  specializationBreakdown?: string[];
}

interface FilterOptions {
  student_ids: string[];
  course_ids: string[];
  teacher_ids: string[];
  statuses: string[];
  startDate: string;
  endDate: string;
}

// ==================== TIERED LATE SCORING ====================
// Default late brackets (matching database defaults)
// ============================================================================
// WEIGHTED SCORE SYSTEM - DYNAMIC CONFIGURATION
// ============================================================================
// All scoring parameters are read from scoringConfigService (loadConfigSync).
// Config is set via the Score Configuration page and stored in localStorage + Supabase.
// Components: Weight %, Late Decay Ï„, Coverage method, Display Brackets, Bonuses.
// ============================================================================

// Display brackets (for UI only - scoring uses smooth decay)
// Now reads from dynamic config; falls back to hardcoded defaults only if config has none
const getLateBrackets = () => {
  const cfg = loadConfigSync();
  if (cfg.late_brackets && cfg.late_brackets.length > 0) {
    return cfg.late_brackets.map(b => ({
      min: b.min,
      max: b.max === 999 ? Infinity : b.max,
      name: b.name,
      color: b.color,
    }));
  }
  return [
    { min: 1, max: 5, name: 'Minor', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
    { min: 6, max: 15, name: 'Moderate', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
    { min: 16, max: 30, name: 'Significant', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
    { min: 31, max: 60, name: 'Severe', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
    { min: 61, max: Infinity, name: 'Very Late', color: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200' },
  ];
};

/**
 * Calculate late score using smooth exponential decay
 * Now reads from dynamic scoring configuration (localStorage-backed)
 * Falls back to default config if none saved.
 * 
 * @param lateMinutes - Number of minutes late
 * @returns Score between 0 and 1
 */
const getLateScoreWeight = (lateMinutes: number | null | undefined): number => {
  const config = loadConfigSync();
  return calcLateScoreFromConfig(lateMinutes, config);
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

  const brackets = getLateBrackets();
  const bracket = brackets.find(b => lateMinutes >= b.min && lateMinutes <= b.max);
  return bracket
    ? { name: bracket.name, color: bracket.color }
    : { name: 'Very Late', color: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200' };
};

/**
 * Smart date formatter: uses 'MMM dd' when all dates are in the same year,
 * switches to 'MMM dd, yy' when dates span multiple years.
 */
const smartDateFormat = (date: Date, allDates: Date[]): string => {
  const years = new Set(allDates.map(d => d.getFullYear()));
  return format(date, years.size > 1 ? 'MMM dd, yy' : 'MMM dd');
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

  useEffect(() => {
    localStorage.setItem('exportFieldSelections', JSON.stringify(savedFieldSelections));
  }, [savedFieldSelections]);

  useEffect(() => {
    localStorage.setItem('exportSettings', JSON.stringify(savedExportSettings));
  }, [savedExportSettings]);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AttendanceRecord[]>([]);
  const hostGpsLookupRef = useRef(new Map<string, { lat: number; lon: number }>());
  const [loading, setLoading] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [, setIsTeacher] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(() => {
    try {
      return localStorage.getItem('attendance_showAnalytics') === 'true';
    } catch {
      return false;
    }
  });
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics[]>([]);
  const [dateAnalytics, setDateAnalytics] = useState<DateAnalytics[]>([]);
  const [reportLanguage, setReportLanguage] = useState<'en' | 'ar'>('en');
  const [showArabicPdfConfirm, setShowArabicPdfConfirm] = useState(false);

  const [collapseStudentTable, setCollapseStudentTable] = useState(() => {
    try {
      return localStorage.getItem('attendance_collapseStudentTable') === 'true';
    } catch {
      return false;
    }
  });
  const [collapseDateTable, setCollapseDateTable] = useState(() => {
    try {
      return localStorage.getItem('attendance_collapseDateTable') === 'true';
    } catch {
      return false;
    }
  });
  const [collapseHostTable, setCollapseHostTable] = useState(() => {
    try {
      return localStorage.getItem('attendance_collapseHostTable') === 'true';
    } catch {
      return false;
    }
  });
  const [collapseCrosstabTable, setCollapseCrosstabTable] = useState(() => {
    try {
      return localStorage.getItem('attendance_collapseCrosstabTable') === 'true';
    } catch {
      return false;
    }
  });
  const [collapseScoreExplainer, setCollapseScoreExplainer] = useState(() => {
    try {
      const saved = localStorage.getItem('attendance_collapseScoreExplainer');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [collapseChartsSection, setCollapseChartsSection] = useState(() => {
    try {
      return localStorage.getItem('attendance_collapseChartsSection') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('attendance_showAnalytics', String(showAnalytics));
      localStorage.setItem('attendance_collapseStudentTable', String(collapseStudentTable));
      localStorage.setItem('attendance_collapseDateTable', String(collapseDateTable));
      localStorage.setItem('attendance_collapseHostTable', String(collapseHostTable));
      localStorage.setItem('attendance_collapseCrosstabTable', String(collapseCrosstabTable));
      localStorage.setItem('attendance_collapseScoreExplainer', String(collapseScoreExplainer));
      localStorage.setItem('attendance_collapseChartsSection', String(collapseChartsSection));
    } catch {
      /* ignore localStorage errors */
    }
  }, [
    showAnalytics,
    collapseStudentTable,
    collapseDateTable,
    collapseHostTable,
    collapseCrosstabTable,
    collapseScoreExplainer,
    collapseChartsSection,
  ]);

  // Table include/exclude toggles for exports â€” persisted in localStorage
  const [includedTables, setIncludedTables] = useState<{
    summary: boolean;
    student: boolean;
    date: boolean;
    host: boolean;
    crosstab: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('analyticsIncludedTables');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { summary: true, student: true, date: true, host: true, crosstab: false };
  });
  useEffect(() => {
    localStorage.setItem('analyticsIncludedTables', JSON.stringify(includedTables));
  }, [includedTables]);

  // Matrix date selection â€” which dates to include in the cross-tab matrix (all exports + UI)
  // null means "all dates" (default), otherwise a Set of selected date strings â€” persisted in localStorage
  const [matrixSelectedDates, setMatrixSelectedDates] = useState<Set<string> | null>(() => {
    try {
      const saved = localStorage.getItem('matrixSelectedDates');
      if (saved) {
        const arr = JSON.parse(saved) as string[] | null;
        return arr ? new Set(arr) : null;
      }
    } catch { /* ignore */ }
    return null;
  });
  useEffect(() => {
    try {
      localStorage.setItem('matrixSelectedDates', JSON.stringify(matrixSelectedDates ? [...matrixSelectedDates] : null));
    } catch { /* ignore */ }
  }, [matrixSelectedDates]);
  const [showMatrixDatePicker, setShowMatrixDatePicker] = useState(false);

  // Matrix sorting â€” persisted in localStorage
  type MatrixSortField = 'name' | 'score' | 'attendance' | 'present' | 'absent' | 'late';
  type MatrixSortDir = 'asc' | 'desc';
  const [matrixSortField, setMatrixSortField] = useState<MatrixSortField>(() => {
    try {
      const saved = localStorage.getItem('matrixSortField');
      if (saved && ['name', 'score', 'attendance', 'present', 'absent', 'late'].includes(saved)) return saved as MatrixSortField;
    } catch { /* ignore */ }
    return 'score';
  });
  const [matrixSortDir, setMatrixSortDir] = useState<MatrixSortDir>(() => {
    try {
      const saved = localStorage.getItem('matrixSortDir');
      if (saved === 'asc' || saved === 'desc') return saved;
    } catch { /* ignore */ }
    return 'desc';
  });
  useEffect(() => {
    localStorage.setItem('matrixSortField', matrixSortField);
    localStorage.setItem('matrixSortDir', matrixSortDir);
  }, [matrixSortField, matrixSortDir]);

  // Helper: sort students using matrix sort settings (used in both UI and exports)
  const sortStudentsForMatrix = <T extends { student_name: string; weightedScore: number; attendanceRate: number; presentCount: number; lateCount: number; absentCount: number }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => {
      let cmp = 0;
      switch (matrixSortField) {
        case 'name': cmp = a.student_name.localeCompare(b.student_name, 'ar'); break;
        case 'score': cmp = a.weightedScore - b.weightedScore; break;
        case 'attendance': cmp = a.attendanceRate - b.attendanceRate; break;
        case 'present': cmp = (a.presentCount + a.lateCount) - (b.presentCount + b.lateCount); break;
        case 'absent': cmp = a.absentCount - b.absentCount; break;
        case 'late': cmp = a.lateCount - b.lateCount; break;
        default: cmp = a.weightedScore - b.weightedScore;
      }
      return matrixSortDir === 'asc' ? cmp : -cmp;
    });

  const [scoreExplainerStudent, setScoreExplainerStudent] = useState<string>('');
  const [scoreExplainerLang, setScoreExplainerLang] = useState<'en' | 'ar' | 'both'>('both');
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [collapseFilters, setCollapseFilters] = useState(false);

  // Arabic display mode for the table
  const [arabicMode, setArabicMode] = useState(false);

  // Scoring config key â€” a serialized snapshot of the config from localStorage.
  // Changes when the user saves new scoring config. Used as a dependency to
  // force analytics recalculation with updated weights.
  const [scoringConfigKey, setScoringConfigKey] = useState(() => JSON.stringify(loadConfigSync()));
  
  // Re-read scoring config whenever this page becomes visible (covers SPA navigation,
  // tab switching, and returning from Score Config page)
  useEffect(() => {
    const checkConfigChange = () => {
      const fresh = JSON.stringify(loadConfigSync());
      setScoringConfigKey(prev => prev !== fresh ? fresh : prev);
    };
    // Fires when tab becomes visible again OR when SPA navigates back to this page
    document.addEventListener('visibilitychange', checkConfigChange);
    window.addEventListener('focus', checkConfigChange);
    // Also check every time this component mounts (SPA route change)
    checkConfigChange();
    // Also listen for custom event dispatched by scoring config save
    window.addEventListener('scoring-config-changed', checkConfigChange);
    return () => {
      document.removeEventListener('visibilitychange', checkConfigChange);
      window.removeEventListener('focus', checkConfigChange);
      window.removeEventListener('scoring-config-changed', checkConfigChange);
    };
  }, []);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Earliest and latest attendance date state
  const [earliestDate, setEarliestDate] = useState<string>('');
  const [latestDate, setLatestDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Filter state
  const [filters, setFilters] = useState<FilterOptions>({
    student_ids: [],
    course_ids: [],
    teacher_ids: [],
    statuses: [],
    startDate: '',
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // Multi-select dropdown open states
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);

  // Click-outside-to-close for filter dropdowns
  useEffect(() => {
    if (!openFilterDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setOpenFilterDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openFilterDropdown]);

  // Dropdown options
  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [courses, setCourses] = useState<{ value: string; label: string }[]>([]);
  const [instructors, setInstructors] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    // Initialize: fetch earliest and latest attendance dates and then load filters + records
    const init = async () => {
      try {
        // Fetch earliest and latest attendance_date in parallel
        const [earliestRes, latestRes] = await Promise.all([
          supabase
            .from('attendance')
            .select('attendance_date')
            .order('attendance_date', { ascending: true })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('attendance')
            .select('attendance_date')
            .order('attendance_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        // Determine start date
        if (earliestRes.error) {
          console.warn('Failed to fetch earliest attendance date, falling back to 1 year ago', earliestRes.error);
          const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
          setEarliestDate(fallback);
          setFilters((f) => ({ ...f, startDate: fallback }));
        } else if (earliestRes.data?.attendance_date) {
          const earliest = format(new Date(earliestRes.data.attendance_date), 'yyyy-MM-dd');
          setEarliestDate(earliest);
          setFilters((f) => ({ ...f, startDate: earliest }));
        } else {
          const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
          setEarliestDate(fallback);
          setFilters((f) => ({ ...f, startDate: fallback }));
        }

        // Determine end date: latest of (today, latest attendance_date)
        const today = format(new Date(), 'yyyy-MM-dd');
        const latestAttendance = latestRes.data?.attendance_date
          ? format(new Date(latestRes.data.attendance_date), 'yyyy-MM-dd')
          : today;
        const endDate = latestAttendance > today ? latestAttendance : today;
        setLatestDate(endDate);
        setFilters((f) => ({ ...f, endDate }));
      } catch (err) {
        console.warn('Error initializing filters, using fallback dates', err);
        const fallback = format(subDays(new Date(), 365), 'yyyy-MM-dd');
        setEarliestDate(fallback);
        setFilters((f) => ({ ...f, startDate: fallback }));
      }

      // load dropdown options and records after filters initialized
      await loadFilterOptions();
      await loadRecords();

      // Check if current user is a teacher or admin
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          const { data: teacher } = await supabase
            .from('teacher')
            .select('teacher_id')
            .ilike('email', user.email)
            .maybeSingle();
          if (teacher) {
            setIsTeacher(true);
          } else {
            // Fallback: check admin table
            const { data: adminRecord } = await supabase
              .from('admin')
              .select('admin_id')
              .ilike('email', user.email)
              .maybeSingle();
            setIsTeacher(!!adminRecord);
          }
        }
      } catch {
        setIsTeacher(false);
      }
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
          setFilters(f => ({ ...f, student_ids: [student.value] }));
        }
      }

      // Apply status filter
      if (status) {
        setFilters(f => ({ ...f, statuses: [status] }));
      }

      // Apply course filter
      if (course) {
        setFilters(f => ({ ...f, course_ids: [course] }));
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

    // Filter by students (multi-select)
    if (filters.student_ids.length > 0) {
      filtered = filtered.filter(r => filters.student_ids.includes(r.student_id));
    }

    // Filter by courses (multi-select)
    if (filters.course_ids.length > 0) {
      filtered = filtered.filter(r => filters.course_ids.includes(r.course_id));
    }

    // Filter by instructors (multi-select)
    if (filters.teacher_ids.length > 0) {
      filtered = filtered.filter(r => filters.teacher_ids.includes(r.teacher_id));
    }

    // Filter by statuses (multi-select)
    if (filters.statuses.length > 0) {
      filtered = filtered.filter(r => filters.statuses.includes(r.status));
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
      // Recalculates when data, visibility, or scoring config changes
      calculateAnalytics();
    } else {
      setStudentAnalytics([]);
      setDateAnalytics([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRecords, showAnalytics, scoringConfigKey]);

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
      const { data, error, hostGpsLookup, warnings } = await loadAttendanceRecordsPageData(filters.student_ids);
      if (error) throw error;
      warnings.forEach((message) => console.warn(message));
      hostGpsLookupRef.current = hostGpsLookup;
      setRecords((data || []) as AttendanceRecord[]);
    } catch (error) {
      console.error('Error loading records:', error);
      showError('Failed to load attendance records. Please try again.');
      setRecords([]);
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refreshRecords = useCallback(() => { loadRecords(); }, [filters.student_ids]);
  useRefreshOnFocus(refreshRecords);

  const getStatusColor = (status: string) => {
    switch (status) {
      case ATTENDANCE_STATUS.ON_TIME: return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case ATTENDANCE_STATUS.ABSENT: return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case ATTENDANCE_STATUS.LATE: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
      case ATTENDANCE_STATUS.EXCUSED: return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case ATTENDANCE_STATUS.NOT_ENROLLED: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const getStatusLabel = (status: string) => {
    if (arabicMode) {
      switch (status) {
        case ATTENDANCE_STATUS.ON_TIME: return 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª';
        case ATTENDANCE_STATUS.ABSENT: return 'ØºØ§Ø¦Ø¨';
        case ATTENDANCE_STATUS.LATE: return 'Ù…ØªØ£Ø®Ø±';
        case ATTENDANCE_STATUS.EXCUSED: return 'Ù…Ø¹Ø°ÙˆØ±';
        case ATTENDANCE_STATUS.NOT_ENROLLED: return 'ØºÙŠØ± Ù…Ø³Ø¬Ù„';
        default: return status;
      }
    }
    switch (status) {
      case ATTENDANCE_STATUS.ON_TIME: return 'On Time';
      case ATTENDANCE_STATUS.ABSENT: return 'Absent';
      case ATTENDANCE_STATUS.LATE: return 'Late';
      case ATTENDANCE_STATUS.EXCUSED: return 'Excused';
      case ATTENDANCE_STATUS.NOT_ENROLLED: return 'Not Enrolled';
      default: return status;
    }
  };

  // Arabic translations for table headers and values
  const t = useMemo(() => arabicMode ? {
    attendanceRecords: 'Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
    subtitle: 'ðŸ“ Ø­Ø¶ÙˆØ± Ù…ÙØªØªØ¨Ø¹ Ø¨Ø§Ù„Ù€ GPS Ù…Ø¹ ØªØ­Ù„ÙŠÙ„Ø§Øª Ù…ØªÙ‚Ø¯Ù…Ø©',
    showing: 'Ø¹Ø±Ø¶',
    records: 'Ø³Ø¬Ù„Ø§Øª',
    filteredFrom: 'Ù…ØµÙØ§Ø© Ù…Ù†',
    total: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ',
    advancedExport: 'ØªØµØ¯ÙŠØ± Ù…ØªÙ‚Ø¯Ù…',
    itemsPerPage: 'Ø¹Ù†Ø§ØµØ± Ù„ÙƒÙ„ ØµÙØ­Ø©:',
    date: 'Ø§Ù„ØªØ§Ø±ÙŠØ®',
    student: 'Ø§Ù„Ø·Ø§Ù„Ø¨',
    course: 'Ø§Ù„Ø¯ÙˆØ±Ø©',
    instructor: 'Ø§Ù„Ù…Ø¯Ø±Ø³',
    status: 'Ø§Ù„Ø­Ø§Ù„Ø©',
    lateDuration: 'Ù…Ø¯Ø© Ø§Ù„ØªØ£Ø®ÙŠØ±',
    method: 'Ø§Ù„Ø·Ø±ÙŠÙ‚Ø©',
    excuseReason: 'Ø³Ø¨Ø¨ Ø§Ù„Ø¹Ø°Ø±',
    location: 'Ø§Ù„Ù…ÙˆÙ‚Ø¹',
    gps: 'GPS',
    markedAt: 'ÙˆÙ‚Øª Ø§Ù„ØªØ³Ø¬ÙŠÙ„',
    actions: 'Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª',
    viewMap: 'Ø¹Ø±Ø¶ Ø§Ù„Ø®Ø±ÙŠØ·Ø©',
    notRecorded: 'ØºÙŠØ± Ù…Ø³Ø¬Ù„',
    noGps: 'Ø¨Ø¯ÙˆÙ† GPS',
    minEarly: 'Ø¯Ù‚ÙŠÙ‚Ø© Ù…Ø¨ÙƒØ±Ø§Ù‹',
    min: 'Ø¯Ù‚ÙŠÙ‚Ø©',
    loading: 'Ø¬Ø§Ø±ÙŠ ØªØ­Ù…ÙŠÙ„ Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±...',
    loadingSubtext: 'ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø± Ø¨ÙŠÙ†Ù…Ø§ Ù†Ø­Ø¶Ø± Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª',
    noRecords: 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª',
    noRecordsDesc: 'Ø­Ø§ÙˆÙ„ ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„ÙÙ„Ø§ØªØ± Ø£Ùˆ Ù†Ø·Ø§Ù‚ Ø§Ù„ØªØ§Ø±ÙŠØ® Ù„Ø±Ø¤ÙŠØ© Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
    resetFilters: 'Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ† Ø§Ù„ÙÙ„Ø§ØªØ±',
    advancedFilters: 'ÙÙ„Ø§ØªØ± Ù…ØªÙ‚Ø¯Ù…Ø©',
    activeFilters: 'ÙÙ„ØªØ± Ù†Ø´Ø·',
    hideFilters: 'Ø¥Ø®ÙØ§Ø¡ Ø§Ù„ÙÙ„Ø§ØªØ±',
    showFilters: 'Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„ÙÙ„Ø§ØªØ±',
    lastWeek: 'Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ø§Ù„Ù…Ø§Ø¶ÙŠ',
    lastMonth: 'Ø§Ù„Ø´Ù‡Ø± Ø§Ù„Ù…Ø§Ø¶ÙŠ',
    absentOnly: 'Ø§Ù„ØºØ§Ø¦Ø¨ÙˆÙ† ÙÙ‚Ø·',
    resetAll: 'Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ† Ø§Ù„ÙƒÙ„',
    statusLabel: 'Ø§Ù„Ø­Ø§Ù„Ø©',
    allStudents: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨',
    allCourses: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…ÙˆØ§Ø¯',
    allInstructors: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ø¹Ù„Ù…ÙŠÙ†',
    allStatuses: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø­Ø§Ù„Ø§Øª',
    startDateLabel: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©',
    endDateLabel: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ©',
    clearAll: 'Ù…Ø³Ø­ Ø§Ù„ÙƒÙ„',
    selected: 'Ù…Ø­Ø¯Ø¯',
    qrCode: 'Ø±Ù…Ø² QR',
    photo: 'ØµÙˆØ±Ø©',
    bulk: 'Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø¬Ù…Ø§Ø¹ÙŠ',
    manual: 'ÙŠØ¯ÙˆÙŠ',
    by: 'Ø¨ÙˆØ§Ø³Ø·Ø©',
    // Analytics & Summary
    hideAnalytics: 'Ø¥Ø®ÙØ§Ø¡ Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª',
    showAnalytics: 'Ø¹Ø±Ø¶ Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª',
    refresh: 'ØªØ­Ø¯ÙŠØ«',
    summaryStatistics: 'ðŸ“Š Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ù…Ù„Ø®ØµØ©',
    totalStudents: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨',
    classAvgRate: 'Ù…ØªÙˆØ³Ø· Ù…Ø¹Ø¯Ù„ Ø§Ù„ØµÙ',
    avgWeightedScore: 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…ÙˆØ²ÙˆÙ†Ø©',
    avgAttendanceByDate: 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ®',
    medianRateByDate: 'Ø§Ù„ÙˆØ³ÙŠØ· Ù„Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ®',
    exportAnalytics: 'ØªØµØ¯ÙŠØ± Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª',
    exportAnalyticsDesc: 'ØªÙ†Ø²ÙŠÙ„ Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ± Ø£Ùˆ ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…Ø¹Ø±ÙˆØ¶Ø© ÙÙŠ Ø§Ù„Ø¬Ø¯Ø§ÙˆÙ„ Ø£Ø¯Ù†Ø§Ù‡',
    exporting: 'Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªØµØ¯ÙŠØ±...',
    studentPerformance: 'ðŸŽ“ ØªØ­Ù„ÙŠÙ„Ø§Øª Ø£Ø¯Ø§Ø¡ Ø§Ù„Ø·Ù„Ø§Ø¨',
    attendanceByDate: 'ðŸ“… Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ®',
    hostAnalyticsTitle: 'ðŸ  ØªØ­Ù„ÙŠÙ„Ø§Øª Ø§Ù„Ù…Ø¶ÙŠÙ',
    crosstabTitle: 'ðŸ—“ï¸ Ù…ØµÙÙˆÙØ© Ø§Ù„Ø­Ø¶ÙˆØ±',
    crosstabDesc: 'Ø§Ù„Ø·Ù„Ø§Ø¨ Ã— Ø§Ù„ØªÙˆØ§Ø±ÙŠØ® Ù…Ø¹ Ù…Ø¤Ø´Ø±Ø§Øª Ù…Ù„ÙˆÙ†Ø©',
    includeTables: 'ØªØ¶Ù…ÙŠÙ† Ø§Ù„Ø¬Ø¯Ø§ÙˆÙ„',
    summaryTable: 'Ø§Ù„Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª',
    studentTable: 'Ø§Ù„Ø·Ù„Ø§Ø¨',
    dateTable: 'Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®',
    hostTable: 'Ø§Ù„Ù…Ø¶ÙŠÙÙŠÙ†',
    crosstabTable: 'Ø§Ù„Ù…ØµÙÙˆÙØ©',
    locationMap: 'ðŸ“ Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ù…ÙˆØ§Ù‚Ø¹',
    locationMapDesc: 'Ù…ÙˆØ§Ù‚Ø¹ Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ© Ù…Ø¹ Ø§Ù„Ù…Ø³Ø§ÙØ§Øª ÙˆØ§Ù„ØªÙˆØ¬ÙŠÙ‡',
    viewOnMap: 'Ø¹Ø±Ø¶ Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø±ÙŠØ·Ø©',
    getDirections: 'Ø§Ù„Ø§ØªØ¬Ø§Ù‡Ø§Øª',
    distanceBetween: 'Ø§Ù„Ù…Ø³Ø§ÙØ© Ø¨ÙŠÙ† Ø§Ù„Ù…ÙˆØ§Ù‚Ø¹',
    noGpsData: 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª GPS',
    locationSummary: 'Ù…Ù„Ø®Øµ Ø§Ù„Ù…ÙˆØ§Ù‚Ø¹',
    uniqueLocations: 'Ù…ÙˆØ§Ù‚Ø¹ ÙØ±ÙŠØ¯Ø©',
    totalSessions: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¬Ù„Ø³Ø§Øª',
    avgDistance: 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ù…Ø³Ø§ÙØ©',
    students: 'Ø·Ù„Ø§Ø¨',
    sessions: 'Ø¬Ù„Ø³Ø§Øª',
    hosts: 'Ù…Ø¶ÙŠÙÙŠÙ†',
    fields: 'Ø­Ù‚ÙˆÙ„',
    all: 'Ø§Ù„ÙƒÙ„',
    edit: 'ØªØ¹Ø¯ÙŠÙ„',
    totalRecords: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª',
    allEntries: 'Ø¬Ù…ÙŠØ¹ Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
    onTime: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª',
    absent: 'ØºÙŠØ§Ø¨',
    late: 'Ù…ØªØ£Ø®Ø±',
    excused: 'Ù…Ø¹Ø°ÙˆØ±',
    ofTotal: 'Ù…Ù† Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ',
    filters: 'Ø§Ù„ØªØµÙÙŠØ©',
    studentPerformanceReport: 'ØªÙ‚Ø±ÙŠØ± Ø£Ø¯Ø§Ø¡ Ø§Ù„Ø·Ù„Ø§Ø¨',
    attendanceByDateReport: 'ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ®',
    hostRankingsReport: 'ØªÙ‚Ø±ÙŠØ± ØªØ±ØªÙŠØ¨ Ø§Ù„Ù…Ø¶ÙŠÙÙŠÙ†',
    dateRowsToExport: 'ðŸ“… ØµÙÙˆÙ Ø§Ù„ØªØ§Ø±ÙŠØ® Ù„Ù„ØªØµØ¯ÙŠØ±',
  } : {
    attendanceRecords: 'Attendance Records',
    subtitle: 'ðŸ“ GPS-Tracked Attendance with Advanced Analytics',
    showing: 'Showing',
    records: 'records',
    filteredFrom: 'filtered from',
    total: 'total',
    advancedExport: 'Advanced Export',
    itemsPerPage: 'Items per page:',
    date: 'Date',
    student: 'Student',
    course: 'Course',
    instructor: 'Instructor',
    status: 'Status',
    lateDuration: 'Late Duration',
    method: 'Method',
    excuseReason: 'Excuse Reason',
    location: 'Location',
    gps: 'GPS',
    markedAt: 'Marked At',
    actions: 'Actions',
    viewMap: 'View Map',
    notRecorded: 'Not recorded',
    noGps: 'No GPS',
    minEarly: 'min early',
    min: 'min',
    loading: 'Loading attendance records...',
    loadingSubtext: 'Please wait while we fetch the data',
    noRecords: 'No Records Found',
    noRecordsDesc: 'Try adjusting your filters or date range to see attendance records',
    resetFilters: 'Reset Filters',
    advancedFilters: 'Advanced Filters',
    activeFilters: 'active filter',
    hideFilters: 'Hide Filters',
    showFilters: 'Show Filters',
    lastWeek: 'Last Week',
    lastMonth: 'Last Month',
    absentOnly: 'Absent Only',
    resetAll: 'Reset All',
    statusLabel: 'Status',
    allStudents: 'All Students',
    allCourses: 'All Courses',
    allInstructors: 'All Instructors',
    allStatuses: 'All Statuses',
    startDateLabel: 'Start Date',
    endDateLabel: 'End Date',
    clearAll: 'Clear all',
    selected: 'selected',
    qrCode: 'QR Code',
    photo: 'Photo',
    bulk: 'Bulk',
    manual: 'Manual',
    by: 'by',
    // Analytics & Summary
    hideAnalytics: 'Hide Analytics',
    showAnalytics: 'Show Analytics',
    refresh: 'Refresh',
    summaryStatistics: 'ðŸ“Š Summary Statistics',
    totalStudents: 'Total Students',
    classAvgRate: 'Class Avg Rate',
    avgWeightedScore: 'Avg Weighted Score',
    avgAttendanceByDate: 'Avg Attendance by Date',
    medianRateByDate: 'Median Rate by Date',
    exportAnalytics: 'Export Analytics',
    exportAnalyticsDesc: 'Download reports or configure fields shown in tables below',
    exporting: 'Exporting...',
    studentPerformance: 'ðŸŽ“ Student Performance Analytics',
    attendanceByDate: 'ðŸ“… Attendance by Date',
    hostAnalyticsTitle: 'ðŸ  Host Analytics',
    crosstabTitle: 'ðŸ—“ï¸ Attendance Matrix',
    crosstabDesc: 'Students Ã— Dates with color-coded status',
    includeTables: 'Include Tables',
    summaryTable: 'Summary',
    studentTable: 'Students',
    dateTable: 'Dates',
    hostTable: 'Hosts',
    crosstabTable: 'Matrix',
    locationMap: 'ðŸ“ Location Map',
    locationMapDesc: 'Host locations with distances & routing',
    viewOnMap: 'View on Map',
    getDirections: 'Directions',
    distanceBetween: 'Distance Between Locations',
    noGpsData: 'No GPS data',
    locationSummary: 'Location Summary',
    uniqueLocations: 'unique locations',
    totalSessions: 'total sessions',
    avgDistance: 'avg distance',
    students: 'students',
    sessions: 'sessions',
    hosts: 'hosts',
    fields: 'fields',
    all: 'All',
    edit: 'Edit',
    totalRecords: 'Total Records',
    allEntries: 'All attendance entries',
    onTime: 'On Time',
    absent: 'Absent',
    late: 'Late',
    excused: 'Excused',
    ofTotal: 'of total',
    filters: 'Filters',
    studentPerformanceReport: 'Student Performance Report',
    attendanceByDateReport: 'Attendance by Date Report',
    hostRankingsReport: 'Host Rankings Report',
    dateRowsToExport: 'ðŸ“… Date Rows to Export',
  }, [arabicMode]);

  // Sort filteredRecords based on Advanced Export Builder sort settings for records
  // Pre-computed status counts to avoid repeated .filter() in stat cards
  const statusCounts = useMemo(() => {
    const counts = { onTime: 0, absent: 0, late: 0, excused: 0 };
    for (const r of filteredRecords) {
      if (r.status === 'on time') counts.onTime++;
      else if (r.status === 'absent') counts.absent++;
      else if (r.status === 'late') counts.late++;
      else if (r.status === 'excused') counts.excused++;
    }
    return counts;
  }, [filteredRecords]);

  const sortedRecords = useMemo(() => {
    const settings = savedExportSettings.records;
    const sortLayers = settings?.sortLayers && settings.sortLayers.length > 0
      ? settings.sortLayers
      : settings?.sortByField
        ? [{ field: settings.sortByField, direction: settings.sortDirection || 'asc' as const }]
        : [];

    if (sortLayers.length === 0) return filteredRecords;

    // Map export field keys to record property names
    const fieldToRecordKey: Record<string, string> = {
      date: 'attendance_date',
      dayOfWeek: 'attendance_date',
      student_name: 'student_name',
      course_name: 'course_name',
      instructor_name: 'instructor_name',
      status: 'status',
      late_minutes: 'late_minutes',
      check_in_method: 'check_in_method',
      excuse_reason: 'excuse_reason',
      host_address: 'host_address',
      marked_at: 'marked_at',
      session_location: 'session_location',
      attendance_id: 'attendance_id',
      student_id: 'student_id',
      course_id: 'course_id',
      gps_latitude: 'gps_latitude',
      gps_longitude: 'gps_longitude',
      gps_accuracy: 'gps_accuracy',
      gps_timestamp: 'gps_timestamp',
    };

    const dateFields = new Set(['date', 'attendance_date', 'marked_at', 'gps_timestamp', 'dayOfWeek']);
    const numberFields = new Set(['late_minutes', 'early_minutes', 'gps_latitude', 'gps_longitude', 'gps_accuracy', 'distance_from_host']);

    return [...filteredRecords].sort((a, b) => {
      for (const layer of sortLayers) {
        const recordKey = (fieldToRecordKey[layer.field] || layer.field) as keyof AttendanceRecord;
        const dir = layer.direction === 'desc' ? -1 : 1;
        const aVal = a[recordKey];
        const bVal = b[recordKey];

        if (aVal == null && bVal == null) continue;
        if (aVal == null) return dir;
        if (bVal == null) return -dir;

        let cmp = 0;
        if (dateFields.has(layer.field) || dateFields.has(recordKey as string)) {
          const aDate = new Date(aVal as string).getTime();
          const bDate = new Date(bVal as string).getTime();
          cmp = aDate - bDate;
        } else if (numberFields.has(layer.field) || numberFields.has(recordKey as string) || (typeof aVal === 'number' && typeof bVal === 'number')) {
          cmp = (aVal as number) - (bVal as number);
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }

        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
  }, [filteredRecords, savedExportSettings.records]);

  // Get sort indicator for a column in the records table
  const getRecordsSortIndicator = (exportFieldKey: string): { direction: 'asc' | 'desc'; priority: number; total: number } | null => {
    const settings = savedExportSettings.records;
    const sortLayers = settings?.sortLayers && settings.sortLayers.length > 0
      ? settings.sortLayers
      : settings?.sortByField
        ? [{ field: settings.sortByField, direction: settings.sortDirection || 'asc' as const }]
        : [];
    const idx = sortLayers.findIndex(l => l.field === exportFieldKey);
    if (idx === -1) return null;
    return { direction: sortLayers[idx].direction, priority: idx + 1, total: sortLayers.length };
  };

  const openMapLocation = (record: AttendanceRecord) => {
    if (record.gps_latitude && record.gps_longitude) {
      const url = `https://www.google.com/maps?q=${record.gps_latitude},${record.gps_longitude}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // ==================== DYNAMIC COLUMN ORDER FOR RECORDS TABLE ====================
  // Default column order (used when no custom selection is saved)
  const DEFAULT_RECORD_COLUMNS = ['date', 'student_name', 'course_name', 'instructor_name', 'status', 'late_minutes', 'check_in_method', 'excuse_reason', 'host_address', '_gps', 'marked_at'];

  // GPS-related field keys that all map to the single GPS column
  const GPS_FIELD_KEYS = new Set(['gps_latitude', 'gps_longitude', 'gps_coordinates', 'gps_accuracy', 'distance_from_host']);
  
  // Column definitions mapping field keys to labels and sort keys
  const RECORD_COLUMN_DEFS: Record<string, { label: string; sortKey?: string; icon?: React.ReactNode }> = useMemo(() => ({
    date: { label: t.date, sortKey: 'date', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
    dayOfWeek: { label: arabicMode ? 'ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹' : 'Day', sortKey: 'dayOfWeek' },
    attendance_id: { label: arabicMode ? 'Ø±Ù‚Ù… Ø§Ù„Ø³Ø¬Ù„' : 'Record ID', sortKey: 'attendance_id' },
    student_name: { label: t.student, sortKey: 'student_name', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
    student_id: { label: arabicMode ? 'Ø±Ù‚Ù… Ø§Ù„Ø·Ø§Ù„Ø¨' : 'Student ID', sortKey: 'student_id' },
    course_name: { label: t.course, sortKey: 'course_name' },
    course_id: { label: arabicMode ? 'Ø±Ù‚Ù… Ø§Ù„Ø¯ÙˆØ±Ø©' : 'Course ID', sortKey: 'course_id' },
    instructor_name: { label: t.instructor, sortKey: 'instructor_name' },
    session_location: { label: arabicMode ? 'Ù…ÙˆÙ‚Ø¹ Ø§Ù„Ø¬Ù„Ø³Ø©' : 'Session Location', sortKey: 'session_location' },
    book_topic: { label: arabicMode ? 'Ù…ÙˆØ¶ÙˆØ¹ Ø§Ù„ÙƒØªØ§Ø¨' : 'Book Topic' },
    book_pages: { label: arabicMode ? 'ØµÙØ­Ø§Øª Ø§Ù„ÙƒØªØ§Ø¨' : 'Book Pages' },
    book_start_page: { label: arabicMode ? 'ØµÙØ­Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©' : 'Start Page' },
    book_end_page: { label: arabicMode ? 'ØµÙØ­Ø© Ø§Ù„Ù†Ù‡Ø§ÙŠØ©' : 'End Page' },
    status: { label: t.status, sortKey: 'status' },
    status_display: { label: arabicMode ? 'Ø§Ù„Ø­Ø§Ù„Ø© (Ø¹Ø±Ø¶)' : 'Status (Display)' },
    is_present: { label: arabicMode ? 'Ø­Ø§Ø¶Ø±' : 'Is Present' },
    is_late: { label: arabicMode ? 'Ù…ØªØ£Ø®Ø±' : 'Is Late' },
    is_excused: { label: arabicMode ? 'Ù…Ø¹Ø°ÙˆØ±' : 'Is Excused' },
    is_absent: { label: arabicMode ? 'ØºØ§Ø¦Ø¨' : 'Is Absent' },
    late_minutes: { label: t.lateDuration, sortKey: 'late_minutes' },
    late_bracket: { label: arabicMode ? 'ÙØ¦Ø© Ø§Ù„ØªØ£Ø®Ø±' : 'Late Bracket' },
    early_minutes: { label: arabicMode ? 'Ù…Ø¨ÙƒØ±' : 'Early (min)' },
    check_in_time: { label: arabicMode ? 'ÙˆÙ‚Øª Ø§Ù„Ø¯Ø®ÙˆÙ„' : 'Check-in Time' },
    gps_timestamp: { label: arabicMode ? 'ÙˆÙ‚Øª GPS' : 'GPS Timestamp' },
    excuse_reason: { label: t.excuseReason, sortKey: 'excuse_reason' },
    check_in_method: { label: t.method, sortKey: 'check_in_method' },
    host_address: { label: t.location, sortKey: 'host_address' },
    gps_latitude: { label: arabicMode ? 'Ø®Ø· Ø§Ù„Ø¹Ø±Ø¶' : 'GPS Lat' },
    gps_longitude: { label: arabicMode ? 'Ø®Ø· Ø§Ù„Ø·ÙˆÙ„' : 'GPS Lng' },
    gps_coordinates: { label: arabicMode ? 'Ø¥Ø­Ø¯Ø§Ø«ÙŠØ§Øª GPS' : 'GPS Coords' },
    gps_accuracy: { label: arabicMode ? 'Ø¯Ù‚Ø© GPS' : 'GPS Accuracy' },
    distance_from_host: { label: arabicMode ? 'Ø§Ù„Ù…Ø³Ø§ÙØ© Ù…Ù† Ø§Ù„Ù…Ø¶ÙŠÙ' : 'Distance' },
    marked_by: { label: arabicMode ? 'Ø³Ø¬Ù„ Ø¨ÙˆØ§Ø³Ø·Ø©' : 'Marked By' },
    marked_at: { label: t.markedAt, sortKey: 'marked_at' },
    session_id: { label: arabicMode ? 'Ø±Ù‚Ù… Ø§Ù„Ø¬Ù„Ø³Ø©' : 'Session ID' },
    teacher_id: { label: arabicMode ? 'Ø±Ù‚Ù… Ø§Ù„Ù…Ø¯Ø±Ø¨' : 'Teacher ID' },
    _gps: { label: t.gps }, // virtual composite GPS column
  }), [arabicMode, t]);

  // Build ordered column list respecting export builder's Column Order
  const orderedRecordColumns = useMemo((): string[] => {
    const selected = savedFieldSelections.records;
    if (!selected || selected.length === 0) return DEFAULT_RECORD_COLUMNS;

    // Build ordered list from selected fields, collapsing GPS fields into _gps
    const ordered: string[] = [];
    let gpsInserted = false;
    for (const key of selected) {
      if (GPS_FIELD_KEYS.has(key)) {
        if (!gpsInserted) {
          ordered.push('_gps');
          gpsInserted = true;
        }
      } else {
        ordered.push(key);
      }
    }
    return ordered;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedFieldSelections.records]);

  // Render a header cell for the records table
  const renderRecordHeader = (colKey: string) => {
    const def = RECORD_COLUMN_DEFS[colKey];
    if (!def) return null;
    const si = def.sortKey ? getRecordsSortIndicator(def.sortKey) : null;
    return (
      <th key={colKey} className="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">
        <div className="flex items-center gap-1">
          {def.icon && def.icon}
          {def.label}
          {si && <span className="ml-1 text-blue-500 dark:text-blue-400 text-[10px] font-bold">{si.direction === 'asc' ? 'â†‘' : 'â†“'}{si.total > 1 ? si.priority : ''}</span>}
        </div>
      </th>
    );
  };

  // Render a body cell for the records table
  const renderRecordCell = (colKey: string, record: AttendanceRecord) => {
    const tdClass = "px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm";
    switch (colKey) {
      case 'date':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{format(new Date(record.attendance_date), 'MMM dd, yyyy')}</td>;
      case 'dayOfWeek':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{format(new Date(record.attendance_date), 'EEEE')}</td>;
      case 'attendance_id':
        return <td key={colKey} className={`${tdClass} text-gray-500 dark:text-gray-400 font-mono text-[10px]`}>{record.attendance_id}</td>;
      case 'student_name':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.student_name}</td>;
      case 'student_id':
        return <td key={colKey} className={`${tdClass} text-gray-500 dark:text-gray-400 font-mono text-[10px]`}>{record.student_id}</td>;
      case 'course_name':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.course_name}</td>;
      case 'course_id':
        return <td key={colKey} className={`${tdClass} text-gray-500 dark:text-gray-400 font-mono text-[10px]`}>{record.course_id}</td>;
      case 'instructor_name':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.instructor_name}</td>;
      case 'session_location':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.session_location || '-'}</td>;
      case 'book_topic':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.book_topic || '-'}</td>;
      case 'book_pages':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.book_start_page && record.book_end_page ? `${record.book_start_page}-${record.book_end_page}` : '-'}</td>;
      case 'book_start_page':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.book_start_page || '-'}</td>;
      case 'book_end_page':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.book_end_page || '-'}</td>;
      case 'status':
        return (
          <td key={colKey} className={`${tdClass}`}>
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(record.status)}`}>
              {getStatusLabel(record.status)}
            </span>
          </td>
        );
      case 'status_display':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.status === 'on time' ? 'On Time' : record.status === 'late' ? 'Late' : record.status === 'excused' ? 'Excused' : record.status === 'absent' ? 'Absent' : record.status}</td>;
      case 'is_present':
        return <td key={colKey} className={`${tdClass}`}>{record.status === 'on time' ? <span className="text-green-600 dark:text-green-400 font-bold">Yes</span> : <span className="text-gray-400">No</span>}</td>;
      case 'is_late':
        return <td key={colKey} className={`${tdClass}`}>{record.status === 'late' ? <span className="text-amber-600 dark:text-amber-400 font-bold">Yes</span> : <span className="text-gray-400">No</span>}</td>;
      case 'is_excused':
        return <td key={colKey} className={`${tdClass}`}>{record.status === 'excused' ? <span className="text-blue-600 dark:text-blue-400 font-bold">Yes</span> : <span className="text-gray-400">No</span>}</td>;
      case 'is_absent':
        return <td key={colKey} className={`${tdClass}`}>{record.status === 'absent' ? <span className="text-red-600 dark:text-red-400 font-bold">Yes</span> : <span className="text-gray-400">No</span>}</td>;
      case 'late_minutes':
        return (
          <td key={colKey} className={`${tdClass}`}>
            {record.status === 'late' && record.late_minutes ? (
              <span className={`px-2 py-1 text-xs font-medium rounded ${getLateBracketInfo(record.late_minutes).color}`}>
                {record.late_minutes} {t.min} ({getLateBracketInfo(record.late_minutes).name})
              </span>
            ) : record.status === 'late' ? (
              <span className="text-gray-400 dark:text-gray-500 text-xs">{t.notRecorded}</span>
            ) : record.early_minutes ? (
              <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">
                {record.early_minutes} {t.minEarly}
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">-</span>
            )}
          </td>
        );
      case 'late_bracket':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.status === 'late' && record.late_minutes ? getLateBracketInfo(record.late_minutes).name : '-'}</td>;
      case 'early_minutes':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>{record.early_minutes || '-'}</td>;
      case 'check_in_time':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white font-mono text-[10px]`}>{record.gps_timestamp ? format(new Date(record.gps_timestamp), 'HH:mm:ss') : '-'}</td>;
      case 'gps_timestamp':
        return <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white font-mono text-[10px]`}>{record.gps_timestamp ? format(new Date(record.gps_timestamp), 'MMM dd, yyyy HH:mm:ss') : '-'}</td>;
      case 'excuse_reason':
        return (
          <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>
            {record.status === 'excused' && record.excuse_reason ? (
              <span className="capitalize px-2 py-1 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                {record.excuse_reason}
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">-</span>
            )}
          </td>
        );
      case 'check_in_method':
        return (
          <td key={colKey} className={`${tdClass}`}>
            {record.check_in_method ? (
              <span className={`px-2 py-1 text-xs font-medium rounded ${
                record.check_in_method === 'qr_code' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300' :
                record.check_in_method === 'photo' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' :
                record.check_in_method === 'bulk' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300' :
                'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
              }`}>
                {record.check_in_method === 'qr_code' ? t.qrCode :
                 record.check_in_method === 'photo' ? t.photo :
                 record.check_in_method === 'bulk' ? t.bulk :
                 record.check_in_method === 'manual' ? t.manual :
                 record.check_in_method}
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">-</span>
            )}
          </td>
        );
      case 'host_address': {
        const addr = record.host_address || record.session_location || null;
        if (!addr) return <td key={colKey} className={`${tdClass} text-gray-400 dark:text-gray-500`}>-</td>;
        // Try to extract GPS coords for map link
        const hasGps = record.gps_latitude && record.gps_longitude;
        const coordsParsed = parseCoordinates(addr);
        const mapQuery = hasGps
          ? `${record.gps_latitude},${record.gps_longitude}`
          : coordsParsed ? `${coordsParsed.lat},${coordsParsed.lon}`
          : encodeURIComponent(addr);
        return (
          <td key={colKey} className={`${tdClass} text-gray-900 dark:text-white`}>
            <div className="flex items-center gap-1.5">
              <span className="truncate max-w-[160px]" title={addr}>{addr}</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 flex-shrink-0"
                title={t.viewOnMap}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </a>
            </div>
          </td>
        );
      }
      case 'gps_latitude':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300 font-mono text-[10px]`}>{record.gps_latitude ? record.gps_latitude.toFixed(6) : '-'}</td>;
      case 'gps_longitude':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300 font-mono text-[10px]`}>{record.gps_longitude ? record.gps_longitude.toFixed(6) : '-'}</td>;
      case 'gps_coordinates':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300 font-mono text-[10px]`}>{record.gps_latitude && record.gps_longitude ? `${record.gps_latitude.toFixed(4)}Â°, ${record.gps_longitude.toFixed(4)}Â°` : '-'}</td>;
      case 'gps_accuracy':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300`}>{record.gps_accuracy ? `Â±${Math.round(record.gps_accuracy)}m` : '-'}</td>;
      case 'distance_from_host':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300`}>{record.distance_from_host ? `${Math.round(record.distance_from_host)}m` : '-'}</td>;
      case '_gps': // Composite GPS column
        return (
          <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300`}>
            {record.gps_latitude && record.gps_longitude ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono">{record.gps_latitude.toFixed(4)}Â°, {record.gps_longitude.toFixed(4)}Â°</span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${record.gps_latitude},${record.gps_longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 flex-shrink-0"
                    title={t.viewOnMap}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </a>
                </div>
                {record.gps_accuracy && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Â±{record.gps_accuracy.toFixed(0)}m</div>
                )}
                {record.distance_from_host != null && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">â†” {formatDistance(record.distance_from_host)} from host</div>
                )}
              </div>
            ) : (
              <span className="text-gray-400 dark:text-gray-500 text-xs">{t.noGps}</span>
            )}
          </td>
        );
      case 'marked_by':
        return <td key={colKey} className={`${tdClass} text-gray-600 dark:text-gray-300`}>{record.marked_by || '-'}</td>;
      case 'marked_at':
        return (
          <td key={colKey} className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
            {record.marked_at ? (
              <div className="space-y-1">
                <div>{format(new Date(record.marked_at), 'MMM dd, HH:mm')}</div>
                {record.marked_by && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t.by} {record.marked_by}</div>
                )}
              </div>
            ) : '-'}
          </td>
        );
      case 'session_id':
        return <td key={colKey} className={`${tdClass} text-gray-500 dark:text-gray-400 font-mono text-[10px]`}>{record.session_id}</td>;
      case 'teacher_id':
        return <td key={colKey} className={`${tdClass} text-gray-500 dark:text-gray-400 font-mono text-[10px]`}>{record.teacher_id}</td>;
      default:
        return <td key={colKey} className={`${tdClass} text-gray-400`}>-</td>;
    }
  };

  const exportAnalyticsToExcel = async () => {
    if (!showAnalytics || studentAnalytics.length === 0) {
      warning('Please show analytics first to export analytics data');
      return;
    }

    const XLSX = await import('xlsx');

    const isArabic = reportLanguage === 'ar';

    // Summary Statistics Sheet (always included)
    const summaryHeaders = isArabic
      ? ['Ø§Ù„Ø¹Ù†ØµØ±', 'Ø§Ù„Ù‚ÙŠÙ…Ø©']
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
    const medianRateByDate = (() => {
      if (dateAnalytics.length === 0) return 0;
      const sorted = [...dateAnalytics].sort((a, b) => a.attendanceRate - b.attendanceRate);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1].attendanceRate + sorted[mid].attendanceRate) / 2)
        : Math.round(sorted[mid].attendanceRate);
    })();

    const summaryRows = isArabic
      ? [
          ['Ø¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨', totalStudents],
          ['Ø¹Ø¯Ø¯ Ø§Ù„Ø¬Ù„Ø³Ø§Øª', totalSessions],
          ['Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ± ÙÙŠ Ø§Ù„ÙˆÙ‚Øª', totalPresent],
          ['Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†', totalLate],
          ['Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨ Ø¨Ø¯ÙˆÙ† Ø¹Ø°Ø±', totalAbsent],
          ['Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨ Ø¨Ø¹Ø°Ø±', totalExcused],
          ['Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± Ù„Ù„ØµÙ (%)', `${classAvgRate}%`],
          ['Ù…ØªÙˆØ³Ø· Ø§Ù„Ù†Ù‚Ø§Ø· Ø§Ù„Ù…Ø±Ø¬Ø­Ø©', avgWeightedScore],
          ['Ù…ØªÙˆØ³Ø· Ù…Ø¤Ø´Ø± Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…', avgConsistency],
          ['Ù…ØªÙˆØ³Ø· Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ® (%)', `${avgAttendanceByDate}%`],
          ['Ø§Ù„ÙˆØ³ÙŠØ· Ù„Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ® (%)', `${medianRateByDate}%`],
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
          ['Median Rate by Date (%)', `${medianRateByDate}%`],
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
        scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} Ã— ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
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
        excusedLabel = reportLanguage === 'ar' ? 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨' : 'All Students';
      }
      
      const bookPages = dateData.bookStartPage && dateData.bookEndPage 
        ? `${dateData.bookStartPage}-${dateData.bookEndPage}` 
        : '-';
      const pagesCount = dateData.bookStartPage && dateData.bookEndPage
        ? dateData.bookEndPage - dateData.bookStartPage + 1
        : 0;
      const totalPresent = dateData.presentCount + dateData.lateCount;
      const totalStudents = totalPresent + dateData.excusedAbsentCount + dateData.unexcusedAbsentCount;
      // Accountable = those who should have attended (excused excluded from denominator)
      const totalAccountable = totalPresent + dateData.unexcusedAbsentCount;
      // Attendance Rate: (Total Present / Accountable) Ã— 100
      const attendanceRate = totalAccountable > 0 ? Math.round((totalPresent / totalAccountable) * 100) : 0;
      // Absence Rate: (Unexcused Absent / Accountable) Ã— 100
      const absentRate = totalAccountable > 0 ? Math.round((dateData.unexcusedAbsentCount / totalAccountable) * 100) : 0;
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
        topSpecialization: dateData.topSpecialization || '-',
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
    // Collect all host dates for smart year formatting
    const allHostRawDates = hostRankings.flatMap(h => h.rawDates);

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
        dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates)).join(', '),
      };
    });
    
    // Apply sorting from saved settings for host analytics
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    // Re-assign ranks after sorting
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    const hostRows = hostDataObjects.map((data, index) => 
      hostConfig.getData(data as Record<string, unknown>, index)
    );

    // Create workbook with sheets â€” respect includedTables toggles
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary Statistics
    if (includedTables.summary) {
      const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
      XLSX.utils.book_append_sheet(wb, wsSummary, isArabic ? 'Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ø¹Ø§Ù…Ø©' : 'Summary Statistics');
    }

    // Sheet 2: Student Performance (filtered by saved selection)
    if (includedTables.student) {
      const ws1 = XLSX.utils.aoa_to_sheet([studentConfig.headers, ...studentRows]);
      XLSX.utils.book_append_sheet(wb, ws1, isArabic ? 'Ø£Ø¯Ø§Ø¡ Ø§Ù„Ø·Ù„Ø§Ø¨' : 'Student Performance');
    }

    // Sheet 3: Attendance by Date (filtered by saved selection)
    if (includedTables.date) {
      const ws2 = XLSX.utils.aoa_to_sheet([dateConfig.headers, ...dateRows]);
      XLSX.utils.book_append_sheet(wb, ws2, isArabic ? 'Ø§Ù„Ø­Ø¶ÙˆØ± Ø¨Ø§Ù„ØªØ§Ø±ÙŠØ®' : 'Attendance by Date');
    }

    // Sheet 4: Host Rankings (filtered by saved selection)
    if (includedTables.host) {
      const ws3 = XLSX.utils.aoa_to_sheet([hostConfig.headers, ...hostRows]);
      XLSX.utils.book_append_sheet(wb, ws3, isArabic ? 'ØªØµÙ†ÙŠÙ Ø§Ù„Ù…Ø¶ÙŠÙÙŠÙ†' : 'Host Rankings');
    }

    // Sheet 5: Cross-Tab Heatmap (Student Ã— Date matrix)
    if (includedTables.crosstab) {
      const sortedStudents = sortStudentsForMatrix(studentAnalytics);
      const allSortedDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const sortedDates = matrixSelectedDates
        ? allSortedDates.filter(d => matrixSelectedDates.has(d.date))
        : allSortedDates;
      const ctAllRawDates = sortedDates.map(d => new Date(d.date));
      const ctHeaders = [isArabic ? 'Ø§Ù„Ø·Ø§Ù„Ø¨' : 'Student', ...sortedDates.map(d => smartDateFormat(new Date(d.date), ctAllRawDates))];
      const ctRows = sortedStudents.map(student => {
        const row: (string | number)[] = [student.student_name];
        sortedDates.forEach(dateData => {
          const record = filteredRecords.find(r => r.student_id === student.student_id && r.attendance_date === dateData.date);
          if (!record) { row.push('-'); return; }
          if (record.status === 'on time') row.push(isArabic ? 'Ø­Ø§Ø¶Ø±' : 'On Time');
          else if (record.status === 'late') row.push(`${isArabic ? 'Ù…ØªØ£Ø®Ø±' : 'Late'} ${record.late_minutes ? `(${record.late_minutes}m)` : ''}`);
          else if (record.status === 'excused' || (record.status === 'absent' && record.excuse_reason)) row.push(isArabic ? 'Ù…Ø¹Ø°ÙˆØ±' : 'Excused');
          else row.push(isArabic ? 'ØºØ§Ø¦Ø¨' : 'Absent');
        });
        return row;
      });
      const wsCT = XLSX.utils.aoa_to_sheet([ctHeaders, ...ctRows]);
      XLSX.utils.book_append_sheet(wb, wsCT, isArabic ? 'Ù…ØµÙÙˆÙØ© Ø§Ù„Ø·Ù„Ø§Ø¨ Ã— Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®' : 'Student Ã— Date Matrix');
    }

    // Ensure at least one sheet exists
    if (wb.SheetNames.length === 0) {
      const wsEmpty = XLSX.utils.aoa_to_sheet([['No tables selected for export']]);
      XLSX.utils.book_append_sheet(wb, wsEmpty, 'Info');
    }

    // Export to file
    const excelFileName = isArabic 
      ? `ØªÙ‚Ø±ÙŠØ±_Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
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
        scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} Ã— ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
        // Late Duration
        totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: Math.round((student.lateScoreAvg || 0) * 1000) / 1000,
        sessionNotHeldCount: student.sessionNotHeldCount || 0,
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
        topSpecialization: d.topSpecialization || '-',
      };
    });
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Prepare host data with all possible fields
    const hostMap = new Map<string, { count: number; rawDates: Date[]; present: number; late: number; absent: number; excused: number }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || { count: 0, rawDates: [], present: 0, late: 0, absent: 0, excused: 0 };
        existing.count++;
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });
    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    const allHostRawDates2 = Array.from(hostMap.values()).flatMap(h => h.rawDates);
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
          totalAbsent: host.absent + host.excused,
          totalExcused: host.excused,
          totalStudents,
          dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates2)).join(', '),
        };
      });
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    // Build CSV content with sections â€” respect includedTables toggles
    const sections: string[] = [];
    
    // Section 1: Student Performance
    if (includedTables.student) {
      const studentTitle = isArabic ? '# Ø£Ø¯Ø§Ø¡ Ø§Ù„Ø·Ù„Ø§Ø¨' : '# Student Performance';
      const studentHeaderRow = studentConfig.headers.map(escapeCSV).join(',');
      const studentRows = studentDataObjects.map((data, index) => 
        studentConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
      );
      sections.push(studentTitle);
      sections.push(studentHeaderRow);
      sections.push(...studentRows);
      sections.push(''); // Empty line between sections
    }

    // Section 2: Attendance by Date
    if (includedTables.date) {
      const dateTitle = isArabic ? '# Ø§Ù„Ø­Ø¶ÙˆØ± Ø­Ø³Ø¨ Ø§Ù„ØªØ§Ø±ÙŠØ®' : '# Attendance by Date';
      const dateHeaderRow = dateConfig.headers.map(escapeCSV).join(',');
      const dateRows = dateDataObjects.map((data, index) => 
        dateConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
      );
      sections.push(dateTitle);
      sections.push(dateHeaderRow);
      sections.push(...dateRows);
      sections.push(''); // Empty line between sections
    }

    // Section 3: Host Rankings
    if (includedTables.host && hostDataObjects.length > 0) {
      const hostTitle = isArabic ? '# ØªØµÙ†ÙŠÙ Ø§Ù„Ù…Ø¶ÙŠÙÙŠÙ†' : '# Host Rankings';
      const hostHeaderRow = hostConfig.headers.map(escapeCSV).join(',');
      const hostRows = hostDataObjects.map((data, index) => 
        hostConfig.getData(data as Record<string, unknown>, index).map(escapeCSV).join(',')
      );
      sections.push(hostTitle);
      sections.push(hostHeaderRow);
      sections.push(...hostRows);
      sections.push('');
    }

    // Section 4: Cross-Tab Matrix
    if (includedTables.crosstab) {
      const sortedStudents = sortStudentsForMatrix(studentAnalytics);
      const allSortedDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const sortedDates = matrixSelectedDates
        ? allSortedDates.filter(d => matrixSelectedDates.has(d.date))
        : allSortedDates;
      const ctTitle = isArabic ? '# Ù…ØµÙÙˆÙØ© Ø§Ù„Ø·Ù„Ø§Ø¨ Ã— Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®' : '# Student Ã— Date Matrix';
      const ctHeaders = [isArabic ? 'Ø§Ù„Ø·Ø§Ù„Ø¨' : 'Student', ...sortedDates.map(d => smartDateFormat(new Date(d.date), sortedDates.map(x => new Date(x.date))))].map(escapeCSV).join(',');
      const ctRows = sortedStudents.map(student => {
        const cells: string[] = [student.student_name];
        sortedDates.forEach(dateData => {
          const record = filteredRecords.find(r => r.student_id === student.student_id && r.attendance_date === dateData.date);
          if (!record) { cells.push('-'); return; }
          if (record.status === 'on time') cells.push(isArabic ? 'Ø­Ø§Ø¶Ø±' : 'On Time');
          else if (record.status === 'late') cells.push(`${isArabic ? 'Ù…ØªØ£Ø®Ø±' : 'Late'} ${record.late_minutes ? `(${record.late_minutes}m)` : ''}`);
          else if (record.status === 'excused' || (record.status === 'absent' && record.excuse_reason)) cells.push(isArabic ? 'Ù…Ø¹Ø°ÙˆØ±' : 'Excused');
          else cells.push(isArabic ? 'ØºØ§Ø¦Ø¨' : 'Absent');
        });
        return cells.map(escapeCSV).join(',');
      });
      sections.push(ctTitle);
      sections.push(ctHeaders);
      sections.push(...ctRows);
    }

    if (sections.length === 0) {
      sections.push('No tables selected for export');
    }

    // Add BOM for UTF-8 and create blob
    const BOM = '\uFEFF';
    const csvContent = BOM + sections.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const csvFileName = isArabic 
      ? `ØªÙ‚Ø±ÙŠØ±_Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª_${format(new Date(), 'yyyy-MM-dd')}.csv`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.setAttribute('download', csvFileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportAnalyticsToPDF = async (skipArabicCheck = false) => {
    if (!showAnalytics || studentAnalytics.length === 0 || dateAnalytics.length === 0) {
      warning('Please show analytics first to export PDF report');
      return;
    }

    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const isArabic = reportLanguage === 'ar';
    
    // For Arabic, we'll use a workaround: render text as images or use simple transliteration
    // Since jsPDF doesn't support Arabic fonts out of the box, we keep English for PDF
    // and recommend CSV for full Arabic support
    if (isArabic && !skipArabicCheck) {
      setShowArabicPdfConfirm(true);
      return;
    }
    
    // Title (Always English for PDF)
    doc.setFontSize(18);
    doc.text('Attendance Analytics Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, 22, { align: 'center' });
    doc.text(`Date Range: ${format(new Date(filters.startDate), 'MMM dd, yyyy')} - ${format(new Date(filters.endDate), 'MMM dd, yyyy')}`, pageWidth / 2, 28, { align: 'center' });

    // Summary Statistics Section (Compact Format)
    let currentY = 32; // Track Y position for dynamic section placement

    if (includedTables.summary) {
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
      const medianRateByDate = (() => {
        if (dateAnalytics.length === 0) return 0;
        const sorted = [...dateAnalytics].sort((a, b) => a.attendanceRate - b.attendanceRate);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
          ? Math.round((sorted[mid - 1].attendanceRate + sorted[mid].attendanceRate) / 2)
          : Math.round(sorted[mid].attendanceRate);
      })();

      // Compact inline stats display (Always English for PDF)
      const statsText = `Total Students: ${totalStudents} Students | class Avg Rate: ${classAvgRate}% | Avg weighted Score: ${avgWeightedScore} | Avg attendance by Date: ${avgAttendanceByDate}% | Median Rate by Date: ${medianRateByDate}%`;
      doc.setFontSize(8);
      doc.text(statsText, 8, 35);
      doc.setFontSize(10); // Restore font size for following content
      currentY = 38;
    }

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
        scoreFormula: `(${(student.rawWeightedScore || 0).toFixed(1)} Ã— ${(student.coverageFactor || 0).toFixed(3)}) = ${student.weightedScore.toFixed(1)}`,
        // Late Duration
        totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: (student.lateScoreAvg || 0).toFixed(3),
        sessionNotHeldCount: student.sessionNotHeldCount || 0,
      };
    });
    
    // Apply sorting from saved settings
    const studentDataObjects = sortDataBySettings(studentDataObjectsUnsorted, 'studentAnalytics');
    studentDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });


    // Student Performance Table using saved fields
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
        // User explicitly selected fields to color â€” map field keys to column indices
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

    if (includedTables.student) {
      doc.setFontSize(12);
      doc.text('Student Performance Summary', 14, currentY + 4);

      // Detect percentage columns for student table
      const studentColorColumns = studentColoring.colorColumns;
      
      autoTable(doc, {
        startY: currentY + 8,
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
      currentY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || currentY + 8;
    }

    // Date Analytics Table using saved fields
    if (includedTables.date) {
    
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
        topSpecialization: dateData.topSpecialization || '-',
      };
    });
    
    // Apply sorting and row filtering from saved settings
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Detect percentage columns for date table - use per-type settings
    const dateColorColumns = dateColoring.colorColumns;

    doc.setFontSize(12);
    doc.text('Attendance by Date', 14, currentY + 10);

    autoTable(doc, {
      startY: currentY + 14,
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
    currentY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || currentY + 14;
    } // end includedTables.date

    // Host Rankings Table using saved fields
    if (includedTables.host) {
    
    // Calculate host rankings
    const hostMap = new Map<string, { 
      count: number; 
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
          rawDates: [],
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
        };
        existing.count++;
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    const allHostRawDates3 = Array.from(hostMap.values()).flatMap(h => h.rawDates);
    
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
          dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates3)).join(', '),
        };
      });
    
    // Apply sorting from saved settings
    const hostDataObjects = sortDataBySettings(hostDataObjectsUnsorted, 'hostAnalytics');
    hostDataObjects.forEach((obj, idx) => { obj.rank = idx + 1; });

    if (hostDataObjects.length > 0) {
      doc.setFontSize(12);
      doc.text('Host Rankings', 14, currentY + 10);

      // Detect percentage columns for host table - use per-type settings
      const hostColorColumns = hostColoring.colorColumns;

      autoTable(doc, {
        startY: currentY + 14,
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
      currentY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || currentY + 14;
    }
    } // end includedTables.host

    // Cross-Tab Matrix (Student Ã— Date) for PDF â€” Smart Auto-Builder
    // Automatically handles any number of dates/students with orientation & pagination
    if (includedTables.crosstab && studentAnalytics.length > 0 && dateAnalytics.length > 0) {
      const sortedStudents = sortStudentsForMatrix(studentAnalytics);
      const allSortedDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      // Apply date selection filter
      const sortedDates = matrixSelectedDates
        ? allSortedDates.filter(d => matrixSelectedDates.has(d.date))
        : allSortedDates;

      if (sortedDates.length > 0) {
      // Build fast lookup for status
      const statusLookup = new Map<string, { status: string; late_minutes?: number }>();
      filteredRecords.forEach(r => {
        statusLookup.set(`${r.student_id}|${r.attendance_date}`, { status: r.status, late_minutes: r.late_minutes ?? undefined });
      });

      const totalDates = sortedDates.length;

      // Smart layout calculation â€” aggressive scaling to fit all on one page
      // Portrait usable width ~182mm, Landscape usable width ~269mm
      // Dynamic name column & date column widths based on date count
      const nameColWidth = totalDates <= 20 ? 30 : totalDates <= 35 ? 26 : 22;
      const portraitUsable = 182;
      const landscapeUsable = 269;

      // Calculate minimum viable column width based on content
      // With tiny font, columns can be as narrow as 6mm
      const minDateColWidth = totalDates <= 15 ? 9 : totalDates <= 25 ? 7.5 : totalDates <= 40 ? 6.5 : 5.5;

      const portraitMaxCols = Math.floor((portraitUsable - nameColWidth) / minDateColWidth);
      const landscapeMaxCols = Math.floor((landscapeUsable - nameColWidth) / minDateColWidth);

      // Decide orientation and chunking â€” try to fit everything on one page
      let useLandscape = false;
      let colsPerChunk: number;

      if (totalDates <= portraitMaxCols) {
        useLandscape = false;
        colsPerChunk = totalDates;
      } else if (totalDates <= landscapeMaxCols) {
        useLandscape = true;
        colsPerChunk = totalDates;
      } else {
        // Too many â€” split into chunks, use landscape for max cols
        useLandscape = true;
        colsPerChunk = landscapeMaxCols;
      }

      // Dynamic font sizing â€” scale down for more dates
      const fontSize = totalDates <= 14 ? 6.5
        : totalDates <= 20 ? 5.5
        : totalDates <= 30 ? 5
        : totalDates <= 45 ? 4.5
        : 4;
      const headerFontSize = Math.max(fontSize - 0.5, 3.5);
      const cellPadding = totalDates <= 20 ? 1.5 : totalDates <= 35 ? 1 : 0.7;

      // Calculate how many chunks we need
      const numChunks = Math.ceil(totalDates / colsPerChunk);

      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const startCol = chunkIdx * colsPerChunk;
        const endCol = Math.min(startCol + colsPerChunk, totalDates);
        const chunkDates = sortedDates.slice(startCol, endCol);

        // Add a new page for the matrix (landscape or portrait)
        doc.addPage(useLandscape ? 'l' : 'p');
        const matrixPageWidth = doc.internal.pageSize.width;

        // Title with chunk info and selection info
        doc.setFontSize(11);
        let matrixTitle = 'Student Ã— Date Matrix';
        if (matrixSelectedDates) {
          matrixTitle += ` (${totalDates} of ${allSortedDates.length} dates selected)`;
        }
        if (numChunks > 1) {
          matrixTitle += ` â€” Page ${chunkIdx + 1}/${numChunks} (Dates ${startCol + 1}â€“${endCol})`;
        }
        doc.text(matrixTitle, 14, 14);

        // Date format: compact for many columns
        const dateFormat = totalDates <= 15 ? 'MM/dd' : totalDates <= 30 ? 'dd' : 'd';
        const ctHeaders = ['Student', ...chunkDates.map(d => format(new Date(d.date), dateFormat))];

        // ALL students â€” auto page break handled by autoTable
        const ctBody = sortedStudents.map(student => {
          const row: string[] = [student.student_name];
          chunkDates.forEach(dateData => {
            const key = `${student.student_id}|${dateData.date}`;
            const rec = statusLookup.get(key);
            if (!rec) { row.push('-'); return; }
            if (rec.status === 'on time') row.push('âœ“');
            else if (rec.status === 'late') row.push(`L${rec.late_minutes || ''}`);
            else if (rec.status === 'excused') row.push('E');
            else row.push('âœ—');
          });
          return row;
        });

        // Calculate dynamic column width for dates â€” fill available space
        const availableWidth = matrixPageWidth - 28; // margins
        const dateColWidth = (availableWidth - nameColWidth) / chunkDates.length;

        // Build column styles dynamically
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colStyles: Record<number, any> = {
          0: { halign: 'left', cellWidth: nameColWidth },
        };
        for (let c = 1; c <= chunkDates.length; c++) {
          colStyles[c] = { cellWidth: dateColWidth };
        }

        autoTable(doc, {
          startY: 18,
          head: [ctHeaders],
          body: ctBody,
          styles: { fontSize, cellPadding, halign: 'center', overflow: 'hidden' },
          headStyles: { fillColor: [124, 58, 237], fontSize: headerFontSize, cellPadding: 0.8 },
          columnStyles: colStyles,
          alternateRowStyles: { fillColor: [245, 245, 245] },
          rowPageBreak: 'avoid',
          margin: { left: 14, right: 14 },
          didParseCell: (hookData) => {
            if (hookData.section === 'body' && hookData.column.index > 0) {
              const text = hookData.cell.text.join('');
              if (text === 'âœ“') hookData.cell.styles.fillColor = [209, 250, 229]; // emerald (on time)
              else if (text.startsWith('L')) hookData.cell.styles.fillColor = [254, 249, 195]; // yellow (late)
              else if (text === 'âœ—') hookData.cell.styles.fillColor = [254, 202, 202]; // red (absent)
              else if (text === 'E') hookData.cell.styles.fillColor = [219, 234, 254]; // blue (excused)
            }
          },
        });
      }
      } // end sortedDates.length > 0
      currentY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || currentY + 14;
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
      ? `ØªÙ‚Ø±ÙŠØ±_Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª_${format(new Date(), 'yyyy-MM-dd')}.pdf`
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
  const { wordExportService } = await import('../services/wordExportService');

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
    const medianRateByDate = (() => {
      if (dateAnalytics.length === 0) return 0;
      const sorted = [...dateAnalytics].sort((a, b) => a.attendanceRate - b.attendanceRate);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1].attendanceRate + sorted[mid].attendanceRate) / 2
        : sorted[mid].attendanceRate;
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
      medianRateByDate,
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
        scoreFormula: `(${(s.rawWeightedScore || 0).toFixed(1)} Ã— ${(s.coverageFactor || 0).toFixed(3)}) = ${s.weightedScore.toFixed(1)}`,
        // Late Duration
        totalLateMinutes: Math.round((s.totalLateMinutes || 0) * 10) / 10,
        avgLateMinutes: Math.round((s.avgLateMinutes || 0) * 10) / 10,
        maxLateMinutes: Math.round((s.maxLateMinutes || 0) * 10) / 10,
        lateScoreAvg: (s.lateScoreAvg || 0).toFixed(3),
        sessionNotHeldCount: s.sessionNotHeldCount || 0,
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
        excusedNames = isArabic ? 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨' : 'All Students';
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
        topSpecialization: d.topSpecialization || '-',
      };
    });
    
    // Apply sorting and row filtering from saved settings
    const dateDataObjects = filterExcludedDateRows(sortDataBySettings(dateDataObjectsUnsorted, 'dateAnalytics'));

    // Prepare host data with all possible fields
    const hostMap = new Map<string, {
      count: number;
      rawDates: Date[];
      present: number;
      late: number;
      absent: number;
      excused: number;
    }>();
    
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
        const existing = hostMap.get(dateData.hostAddress) || {
          count: 0, rawDates: [], present: 0, late: 0, absent: 0, excused: 0,
        };
        existing.count++;
        existing.rawDates.push(new Date(dateData.date));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
    const allHostRawDates4 = Array.from(hostMap.values()).flatMap(h => h.rawDates);

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
          dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates4)).join(', '),
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

    // Build cross-tab matrix data for Word export
    let crosstabForWord: { headers: string[]; rows: string[][] } | undefined;
    if (includedTables.crosstab && studentAnalytics.length > 0 && dateAnalytics.length > 0) {
      const sortedStudents = sortStudentsForMatrix(studentAnalytics);
      const allSortedDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const sortedDates = matrixSelectedDates
        ? allSortedDates.filter(d => matrixSelectedDates.has(d.date))
        : allSortedDates;
      crosstabForWord = {
        headers: [isArabic ? 'Ø§Ù„Ø·Ø§Ù„Ø¨' : 'Student', ...sortedDates.map(d => smartDateFormat(new Date(d.date), sortedDates.map(x => new Date(x.date))))],
        rows: sortedStudents.map(student => {
          const cells: string[] = [student.student_name];
          sortedDates.forEach(dateData => {
            const record = filteredRecords.find(r => r.student_id === student.student_id && r.attendance_date === dateData.date);
            if (!record) { cells.push('-'); return; }
            if (record.status === 'on time') cells.push(isArabic ? 'Ø­Ø§Ø¶Ø±' : 'âœ“');
            else if (record.status === 'late') cells.push(`${isArabic ? 'Ù…ØªØ£Ø®Ø±' : 'L'}${record.late_minutes ? ` (${record.late_minutes}m)` : ''}`);
            else if (record.status === 'excused') cells.push(isArabic ? 'Ù…Ø¹Ø°ÙˆØ±' : 'E');
            else cells.push(isArabic ? 'ØºØ§Ø¦Ø¨' : 'âœ—');
          });
          return cells;
        }),
      };
    }

    try {
      await wordExportService.exportAnalyticsToWordDynamic(
        includedTables.student ? studentDataForExport : [],
        includedTables.student ? studentConfig.headers : [],
        includedTables.date ? dateDataForExport : [],
        includedTables.date ? dateConfig.headers : [],
        includedTables.host ? hostDataForExport : [],
        includedTables.host ? hostConfig.headers : [],
        includedTables.summary ? summaryStats : { totalStudents: 0, totalSessions: 0, classAvgRate: 0, avgWeightedScore: 0, avgAttendanceByDate: 0, medianRateByDate: 0, totalPresent: 0, totalAbsent: 0, totalExcused: 0, totalLate: 0 },
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
          crosstabData: crosstabForWord,
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
      student_ids: [],
      course_ids: [],
      teacher_ids: [],
      statuses: [],
      startDate: earliestDate || format(subDays(new Date(), 365), 'yyyy-MM-dd'),
      endDate: latestDate,
    });
    setOpenFilterDropdown(null);
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
      statuses: ['absent'],
    });
  };

  // Calculate advanced analytics - memoized for performance
  const calculateAnalytics = useCallback(() => {
    // Count "session not held" per student BEFORE filtering them out
    const notHeldByStudent = new Map<string, number>();
    for (const r of filteredRecords) {
      if (r.excuse_reason === 'session not held') {
        notHeldByStudent.set(r.student_id, (notHeldByStudent.get(r.student_id) || 0) + 1);
      }
    }

    const coveredRecords = filteredRecords.filter(r => r.status !== 'not enrolled');

    // Filter out 'not enrolled' and cancelled session records from analytics
    const analyticsRecords = filteredRecords.filter(r => 
      r.status !== 'not enrolled' && 
      r.excuse_reason !== 'session not held'
    );
    
    // Get unique dates for session-wide analytics (attendance by date)
    const uniqueDates = [...new Set(coveredRecords.map(r => r.attendance_date))].sort();
    
    // Compute GLOBAL total session days from ALL records (unfiltered).
    // Exclude dates where sessions were cancelled ("session not held") so they
    // don't inflate the denominator and unfairly penalize coverage.
    const notHeldDates = new Set(
      records.filter(r => r.excuse_reason === 'session not held').map(r => r.attendance_date)
    );
    const globalTotalSessionDays = new Set(
      records.filter(r => r.status !== 'not enrolled' && r.excuse_reason !== 'session not held')
        .map(r => r.attendance_date)
        .filter(d => !notHeldDates.has(d))
    ).size;
    
    // Get unique students from filtered records
    const uniqueStudents = [...new Set(coveredRecords.map(r => r.student_id))];

    // Calculate student analytics
    const studentStats: StudentAnalytics[] = uniqueStudents.map((studentId, _idx) => {
      const studentRecords = analyticsRecords.filter(r => r.student_id === studentId);
      const studentCoveredRecords = coveredRecords.filter(r => r.student_id === studentId);
      const studentName = studentCoveredRecords[0]?.student_name || 'Unknown';
      const specialization = studentCoveredRecords[0]?.student_specialization || null;

      // Calculate days covered FOR THIS SPECIFIC STUDENT (not all session dates)
      const studentCoveredDates = [...new Set(studentCoveredRecords.map(r => r.attendance_date))].sort();
      const studentEffectiveDates = [...new Set(studentRecords.map(r => r.attendance_date))].sort();
      const studentDaysCovered = studentCoveredDates.length;
      const studentSessionNotHeldCount = notHeldByStudent.get(studentId) || 0;

      const presentCount = studentRecords.filter(r => r.status === 'on time').length;
      const excusedCount = studentRecords.filter(r => r.status === 'excused').length;
      const unexcusedAbsentCount = studentRecords.filter(r => r.status === 'absent').length;
      const absentCount = excusedCount + unexcusedAbsentCount; // Total absent: excused + unexcused
      const lateCount = studentRecords.filter(r => r.status === 'late').length;
      const lateRecords = studentRecords.filter(r => r.status === 'late');

      // Calculate rates (no vacation status in AttendanceRecords)
      // Effective base: Student's covered dates minus excused days (only accountable for dates after enrollment)
      const effectiveBase = studentDaysCovered - excusedCount - studentSessionNotHeldCount;
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
      // Now uses dynamic config from scoringConfigService
      const scoringConfig = loadConfigSync();
      const punctualityPercentage = totalPresent > 0 ? (presentCount / totalPresent) * 100 : 0;
      
      // Calculate consistency (informational â€” NOT part of weighted score)
      const dailyPattern = studentEffectiveDates.map(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (!record || record.status === 'excused') return -1; // Exclude excused
        return (record.status === 'on time' || record.status === 'late') ? 1 : 0;
      }).filter(v => v !== -1);
      
      const consistencyIndex = calculateConsistencyIndex(dailyPattern);
      
      const w1 = scoringConfig.weight_quality / 100;
      const w2 = scoringConfig.weight_attendance / 100;
      const w3 = scoringConfig.weight_punctuality / 100;
      
      const rawWeightedScore = 
        (w1 * qualityAdjustedRate) +    // Quality (with late penalties)
        (w2 * attendanceRate) +          // Attendance (showed up)
        (w3 * punctualityPercentage);    // Punctuality (on-time ratio)
      
      // Debug: log first student's score breakdown to verify config integration
      // Debug: log first student's score breakdown to verify config integration
      if (_idx === 0) {
        console.log(`[ScoreCalc] ${studentName}: w=${scoringConfig.weight_quality}/${scoringConfig.weight_attendance}/${scoringConfig.weight_punctuality} | Q=${qualityAdjustedRate.toFixed(1)} A=${attendanceRate.toFixed(1)} P=${punctualityPercentage.toFixed(1)} | raw=${rawWeightedScore.toFixed(2)}`);
      }

      // ==================== COVERAGE FACTOR ====================
      // Now uses dynamic config from scoringConfigService
      // Global denominator: total session days excluding "session not held" dates.
      // Uses unfiltered records so score is stable regardless of UI filters.
      const totalSessionDays = globalTotalSessionDays;
      const coverageFactor = calcCoverageFromConfig(effectiveBase, totalSessionDays, scoringConfig);
      let weightedScore = rawWeightedScore * Math.min(coverageFactor, 1);
      
      // ==================== BONUSES & PENALTIES ====================
      // Apply configurable bonus/penalty modifiers from scoring config
      // Perfect attendance bonus: awarded if attendanceRate === 100
      if (attendanceRate >= 100 && scoringConfig.perfect_attendance_bonus > 0) {
        weightedScore += scoringConfig.perfect_attendance_bonus;
      }
      
      // Absence penalty multiplier: amplifies the impact of unexcused absences
      if (scoringConfig.absence_penalty_multiplier > 1.0 && unexcusedAbsent > 0) {
        // Each unexcused absence reduces score by (multiplier - 1) * base_deduction
        const baseDeduction = (unexcusedAbsent / effectiveBase) * 100;
        const extraPenalty = baseDeduction * (scoringConfig.absence_penalty_multiplier - 1);
        weightedScore = Math.max(0, weightedScore - extraPenalty);
      }
      
      // Streak bonus: reward consecutive weeks of attendance
      if (scoringConfig.streak_bonus_per_week > 0) {
        // Count consecutive attendance weeks (7-day windows with at least one present day)
        let consecutiveWeeks = 0;
        let maxConsecutiveWeeks = 0;
        const sortedDates = studentEffectiveDates.sort();
        if (sortedDates.length > 0) {
          const weekStart = new Date(sortedDates[0]);
          let currentWeek = 0;
          let hadPresenceThisWeek = false;
          for (const dateStr of sortedDates) {
            const d = new Date(dateStr);
            const daysSinceStart = Math.floor((d.getTime() - weekStart.getTime()) / 86400000);
            const weekNum = Math.floor(daysSinceStart / 7);
            if (weekNum > currentWeek) {
              if (hadPresenceThisWeek) {
                consecutiveWeeks++;
                maxConsecutiveWeeks = Math.max(maxConsecutiveWeeks, consecutiveWeeks);
              } else {
                consecutiveWeeks = 0;
              }
              currentWeek = weekNum;
              hadPresenceThisWeek = false;
            }
            const rec = studentRecords.find(r => r.attendance_date === dateStr);
            if (rec && (rec.status === 'on time' || rec.status === 'late')) {
              hadPresenceThisWeek = true;
            }
          }
          if (hadPresenceThisWeek) {
            consecutiveWeeks++;
            maxConsecutiveWeeks = Math.max(maxConsecutiveWeeks, consecutiveWeeks);
          }
        }
        weightedScore += maxConsecutiveWeeks * scoringConfig.streak_bonus_per_week;
      }
      
      // Cap weighted score at 100 max
      weightedScore = Math.min(100, Math.max(0, weightedScore));
      // Calculate trend using student-specific dates (not all session dates)
      const cumulativeRates = calculateCumulativeRates(studentId, studentEffectiveDates, analyticsRecords);
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
      
      studentEffectiveDates.forEach(date => {
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
        specialization,
        totalRecords: studentCoveredRecords.length,
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
        sessionNotHeldCount: studentSessionNotHeldCount,
      };
    }).sort((a, b) => b.weightedScore - a.weightedScore);

    setStudentAnalytics(studentStats);

    // Calculate date analytics (exclude 'not enrolled' records)
    const dateStats: DateAnalytics[] = uniqueDates.map(date => {
      const dateCoveredRecords = coveredRecords.filter(r => r.attendance_date === date);
      const isSessionNotHeld = dateCoveredRecords.some(r =>
        r.excuse_reason === 'session not held' || r.host_address === 'SESSION_NOT_HELD'
      );

      if (isSessionNotHeld) {
        const totalStudents = new Set(dateCoveredRecords.map(r => r.student_id)).size;
        return {
          date,
          presentCount: 0,
          unexcusedAbsentCount: 0,
          excusedAbsentCount: totalStudents,
          lateCount: 0,
          attendanceRate: 0,
          presentNames: [],
          lateNames: [],
          excusedNames: ['All Students'],
          absentNames: [],
          hostAddress: 'SESSION_NOT_HELD',
          isSessionNotHeld: true,
          sessionNotHeldCount: totalStudents,
          bookTopic: null,
          bookStartPage: null,
          bookEndPage: null,
          totalLateMinutes: 0,
          avgLateMinutes: 0,
          topSpecialization: null,
          topSpecializationCount: 0,
          specializationBreakdown: [],
        };
      }

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
      const specializationCounts = new Map<string, number>();

      [...presentRecords, ...lateRecords].forEach((record) => {
        const specialization = record.student_specialization || 'Unspecified';
        specializationCounts.set(specialization, (specializationCounts.get(specialization) || 0) + 1);
      });

      const specializationBreakdown = [...specializationCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([specialization, count]) => `${specialization} (${count})`);
      const topSpecializationEntry = [...specializationCounts.entries()].sort((left, right) => right[1] - left[1])[0];

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
        isSessionNotHeld: false,
        sessionNotHeldCount: 0,
        bookTopic: dateRecords[0]?.book_topic || null,
        bookStartPage: dateRecords[0]?.book_start_page || null,
        bookEndPage: dateRecords[0]?.book_end_page || null,
        totalLateMinutes: Math.round(dateTotalLateMin),
        avgLateMinutes: Math.round(dateAvgLateMin * 10) / 10,
        topSpecialization: topSpecializationEntry?.[0] || null,
        topSpecializationCount: topSpecializationEntry?.[1] || 0,
        specializationBreakdown,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDateAnalytics(dateStats);
  }, [filteredRecords, records]); // Recompute when data changes

  const calculateConsistencyIndex = (pattern: number[]): number => {
    // Consistency Index: measures how REGULARLY a student attends
    // This is purely about the DISTRIBUTION of absences, NOT attendance rate.
    // It answers: "Are your absences scattered or clustered together?"
    //
    // Two Components (averaged):
    //   1. Scatter Ratio: Are absences fragmented into many small streaks?
    //   2. Streak Penalty: How long is the longest consecutive absence block?
    //
    // Dampening: With only 1-2 absences, clustering barely matters â†’ trends to 100%
    //
    // Examples:
    //   âœ…âŒâœ…âŒâœ…âŒâœ…âŒ (perfectly scattered)     â†’ ~100%
    //   âœ…âœ…âŒâœ…âœ…âŒâœ…âœ… (spread out singles)      â†’ ~100%
    //   âœ…âœ…âœ…âŒâŒâœ…âœ…âœ… (2-day block)             â†’ ~72%
    //   âœ…âœ…âœ…âœ…âŒâŒâŒâŒ (all clustered at end)    â†’ ~20%
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

    // Component 1: Scatter ratio â€” are absences fragmented into many small streaks?
    // Best case: each absence is isolated (ratio = 1). Worst: one big block (ratio â‰ˆ 0).
    const scatterRatio = absenceStreaks.length / totalAbsent;
    const normalizedScatter = totalAbsent > 1
      ? (scatterRatio - 1 / totalAbsent) / (1 - 1 / totalAbsent)
      : 1;

    // Component 2: Longest streak penalty â€” is there one dominant absence block?
    // Missing 3 days in a row hurts more than missing 3 separate days.
    const streakPenalty = totalAbsent > 1
      ? 1 - (longestStreak - 1) / (totalAbsent - 1)
      : 1;

    // Average both components
    const rawConsistency = 0.5 * normalizedScatter + 0.5 * streakPenalty;

    // Dampening: when absences are few (1-2), clustering barely matters
    // With 5+ absences, full clustering impact applies
    const dampeningFactor = Math.min(totalAbsent / 5, 1);
    const consistency = rawConsistency * dampeningFactor + (1 - dampeningFactor);

    return Math.round(Math.min(1, Math.max(0, consistency)) * 100) / 100;
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
          labelAr: 'Ø§Ù„Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ©',
          icon: 'ðŸ‘¤',
          fields: [
            { key: 'rank', label: 'Rank', labelAr: 'Ø§Ù„Ø±ØªØ¨Ø©', category: 'basic', defaultSelected: true },
            { key: 'student_id', label: 'Student ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø·Ø§Ù„Ø¨', category: 'basic', defaultSelected: false },
            { key: 'student_name', label: 'Student Name', labelAr: 'Ø§Ø³Ù… Ø§Ù„Ø·Ø§Ù„Ø¨', category: 'basic', defaultSelected: true },
          ]
        },
        {
          id: 'attendance',
          label: 'Attendance Stats',
          labelAr: 'Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
          icon: 'ðŸ“Š',
          fields: [
            { key: 'presentCount', label: 'On Time', labelAr: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª', category: 'attendance', defaultSelected: true },
            { key: 'lateCount', label: 'Late', labelAr: 'Ù…ØªØ£Ø®Ø±', category: 'attendance', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'attendance', defaultSelected: true },
            { key: 'absentCount', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨', category: 'attendance', defaultSelected: false },
            { key: 'unexcusedAbsent', label: 'Unexcused Absent', labelAr: 'ØºÙŠØ§Ø¨ Ø¨Ø¯ÙˆÙ† Ø¹Ø°Ø±', category: 'attendance', defaultSelected: true },
            { key: 'excusedCount', label: 'Excused', labelAr: 'Ù…Ø¹Ø°ÙˆØ±', category: 'attendance', defaultSelected: true },
            { key: 'sessionNotHeldCount', label: 'Not Held', labelAr: 'Ø¬Ù„Ø³Ø§Øª Ù„Ù… ØªØ¹Ù‚Ø¯', category: 'attendance', defaultSelected: true },
            { key: 'totalRecords', label: 'Total Records', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª', category: 'attendance', defaultSelected: false },
          ]
        },
        {
          id: 'metrics',
          label: 'Performance Metrics',
          labelAr: 'Ù…Ù‚Ø§ÙŠÙŠØ³ Ø§Ù„Ø£Ø¯Ø§Ø¡',
          icon: 'ðŸ“ˆ',
          fields: [
            { key: 'effectiveDays', label: 'Effective Days', labelAr: 'Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„ÙØ¹Ù„ÙŠØ©', category: 'metrics', defaultSelected: true },
            { key: 'daysCovered', label: 'Days Covered', labelAr: 'Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„Ù…ØºØ·Ø§Ø©', category: 'metrics', defaultSelected: true },
            { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'metrics', defaultSelected: true },
            { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…', category: 'metrics', defaultSelected: true },
            { key: 'weightedScore', label: 'Weighted Score', labelAr: 'Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…ÙˆØ²ÙˆÙ†Ø©', category: 'metrics', defaultSelected: true },
            { key: 'consistencyIndex', label: 'Consistency Index', labelAr: 'Ù…Ø¤Ø´Ø± Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…', category: 'metrics', defaultSelected: false },
          ]
        },
        {
          id: 'trend',
          label: 'Trend Analysis',
          labelAr: 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø§ØªØ¬Ø§Ù‡',
          icon: 'ðŸ“‰',
          fields: [
            { key: 'trendSlope', label: 'Trend Slope', labelAr: 'Ù…ÙŠÙ„ Ø§Ù„Ø§ØªØ¬Ø§Ù‡', category: 'trend', defaultSelected: false },
            { key: 'trendClassification', label: 'Trend Classification', labelAr: 'ØªØµÙ†ÙŠÙ Ø§Ù„Ø§ØªØ¬Ø§Ù‡', category: 'trend', defaultSelected: false },
            { key: 'trendRSquared', label: 'Trend RÂ² Value', labelAr: 'Ù‚ÙŠÙ…Ø© RÂ²', category: 'trend', defaultSelected: false },
            { key: 'weeklyChange', label: 'Weekly Change %', labelAr: 'Ø§Ù„ØªØºÙŠØ± Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ', category: 'trend', defaultSelected: false },
          ]
        },
        {
          id: 'rates',
          label: 'Rate Statistics',
          labelAr: 'Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ø§Ù„Ù…Ø¹Ø¯Ù„Ø§Øª',
          icon: 'ðŸ“',
          fields: [
            { key: 'avgRate', label: 'Average Rate', labelAr: 'Ø§Ù„Ù…Ø¹Ø¯Ù„ Ø§Ù„Ù…ØªÙˆØ³Ø·', category: 'rates', defaultSelected: false },
            { key: 'minRate', label: 'Minimum Rate', labelAr: 'Ø£Ø¯Ù†Ù‰ Ù…Ø¹Ø¯Ù„', category: 'rates', defaultSelected: false },
            { key: 'maxRate', label: 'Maximum Rate', labelAr: 'Ø£Ø¹Ù„Ù‰ Ù…Ø¹Ø¯Ù„', category: 'rates', defaultSelected: false },
          ]
        },
        {
          id: 'scoreBreakdown',
          label: 'ðŸ” Score Breakdown',
          labelAr: 'ðŸ” ØªÙØµÙŠÙ„ Ø§Ù„Ø¯Ø±Ø¬Ø©',
          icon: 'ðŸ§®',
          fields: [
            { key: 'qualityAdjustedRate', label: 'Quality-Adjusted Rate %', labelAr: 'Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø¬ÙˆØ¯Ø© Ø§Ù„Ù…Ø¹Ø¯Ù„', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'rawWeightedScore', label: 'Raw Score (before coverage)', labelAr: 'Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø®Ø§Ù…', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'coverageFactor', label: 'Coverage Factor', labelAr: 'Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ©', category: 'scoreBreakdown', defaultSelected: false },
            { key: 'scoreFormula', label: 'Score Formula', labelAr: 'Ù…Ø¹Ø§Ø¯Ù„Ø© Ø§Ù„Ø¯Ø±Ø¬Ø©', category: 'scoreBreakdown', defaultSelected: false },
          ]
        },
        {
          id: 'lateDuration',
          label: 'â±ï¸ Late Duration',
          labelAr: 'â±ï¸ Ù…Ø¯Ø© Ø§Ù„ØªØ£Ø®ÙŠØ±',
          icon: 'â°',
          fields: [
            { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ØªØ£Ø®ÙŠØ± (Ø¯Ù‚ÙŠÙ‚Ø©)', category: 'lateDuration', defaultSelected: false },
            { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø§Ù„ØªØ£Ø®ÙŠØ±', category: 'lateDuration', defaultSelected: false },
            { key: 'maxLateMinutes', label: 'Max Late (min)', labelAr: 'Ø£Ù‚ØµÙ‰ ØªØ£Ø®ÙŠØ±', category: 'lateDuration', defaultSelected: false },
            { key: 'lateScoreAvg', label: 'Avg Late Credit (0-1)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø±ØµÙŠØ¯ Ø§Ù„ØªØ£Ø®ÙŠØ±', category: 'lateDuration', defaultSelected: false },
          ]
        }
      ];
    } else if (exportDataType === 'dateAnalytics') {
      return [
        {
          id: 'session',
          label: 'Session Info',
          labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø¬Ù„Ø³Ø©',
          icon: 'ðŸ“…',
          fields: [
            { key: 'date', label: 'Date', labelAr: 'Ø§Ù„ØªØ§Ø±ÙŠØ®', category: 'session', defaultSelected: true },
            { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹', category: 'session', defaultSelected: false },
            { key: 'hostAddress', label: 'Host Address', labelAr: 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù…Ø¶ÙŠÙ', category: 'session', defaultSelected: true },
          ]
        },
        {
          id: 'book',
          label: 'Book Coverage',
          labelAr: 'ØªØºØ·ÙŠØ© Ø§Ù„ÙƒØªØ§Ø¨',
          icon: 'ðŸ“š',
          fields: [
            { key: 'bookTopic', label: 'Book Topic', labelAr: 'Ù…ÙˆØ¶ÙˆØ¹ Ø§Ù„ÙƒØªØ§Ø¨', category: 'book', defaultSelected: true },
            { key: 'bookPages', label: 'Pages', labelAr: 'Ø§Ù„ØµÙØ­Ø§Øª', category: 'book', defaultSelected: true },
            { key: 'bookStartPage', label: 'Start Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©', category: 'book', defaultSelected: false },
            { key: 'bookEndPage', label: 'End Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ù†Ù‡Ø§ÙŠØ©', category: 'book', defaultSelected: false },
            { key: 'pagesCount', label: 'Pages Count', labelAr: 'Ø¹Ø¯Ø¯ Ø§Ù„ØµÙØ­Ø§Øª', category: 'book', defaultSelected: false },
          ]
        },
        {
          id: 'counts',
          label: 'Attendance Counts',
          labelAr: 'Ø£Ø¹Ø¯Ø§Ø¯ Ø§Ù„Ø­Ø¶ÙˆØ±',
          icon: 'ðŸ”¢',
          fields: [
            { key: 'presentCount', label: 'On Time', labelAr: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª', category: 'counts', defaultSelected: true },
            { key: 'lateCount', label: 'Late', labelAr: 'Ù…ØªØ£Ø®Ø±', category: 'counts', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'counts', defaultSelected: false },
            { key: 'excusedAbsentCount', label: 'Excused', labelAr: 'Ù…Ø¹Ø°ÙˆØ±', category: 'counts', defaultSelected: true },
            { key: 'unexcusedAbsentCount', label: 'Absent', labelAr: 'ØºØ§Ø¦Ø¨', category: 'counts', defaultSelected: true },
            { key: 'totalAbsent', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨', category: 'counts', defaultSelected: false },
            { key: 'totalStudents', label: 'Total Students', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨', category: 'counts', defaultSelected: false },
          ]
        },
        {
          id: 'rates',
          label: 'Rates & Percentages',
          labelAr: 'Ø§Ù„Ù†Ø³Ø¨ ÙˆØ§Ù„Ù…Ø¹Ø¯Ù„Ø§Øª',
          icon: 'ðŸ“Š',
          fields: [
            { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'rates', defaultSelected: true },
            { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…', category: 'rates', defaultSelected: false },
            { key: 'absentRate', label: 'Absence Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„ØºÙŠØ§Ø¨', category: 'rates', defaultSelected: false },
          ]
        },
        {
          id: 'lateDuration',
          label: 'â±ï¸ Late Duration',
          labelAr: 'â±ï¸ Ù…Ø¯Ø© Ø§Ù„ØªØ£Ø®ÙŠØ±',
          icon: 'â°',
          fields: [
            { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ØªØ£Ø®ÙŠØ± (Ø¯Ù‚ÙŠÙ‚Ø©)', category: 'lateDuration', defaultSelected: false },
            { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø§Ù„ØªØ£Ø®ÙŠØ±', category: 'lateDuration', defaultSelected: false },
          ]
        },
        {
          id: 'specialization',
          label: 'Specialization',
          labelAr: 'Ø§Ù„ØªØ®ØµØµ',
          icon: 'ðŸŽ“',
          fields: [
            { key: 'topSpecialization', label: 'Most Present Specialization', labelAr: 'Ø§Ù„ØªØ®ØµØµ Ø§Ù„Ø£ÙƒØ«Ø± Ø­Ø¶ÙˆØ±Ø§Ù‹', category: 'specialization', defaultSelected: true },
          ]
        },
        {
          id: 'names',
          label: 'Student Names',
          labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ø·Ù„Ø§Ø¨',
          icon: 'ðŸ‘¥',
          fields: [
            { key: 'presentNames', label: 'On Time Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ø­Ø§Ø¶Ø±ÙŠÙ†', category: 'names', defaultSelected: false },
            { key: 'lateNames', label: 'Late Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†', category: 'names', defaultSelected: false },
            { key: 'excusedNames', label: 'Excused Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ø¹Ø°ÙˆØ±ÙŠÙ†', category: 'names', defaultSelected: false },
            { key: 'absentNames', label: 'Absent Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„ØºØ§Ø¦Ø¨ÙŠÙ†', category: 'names', defaultSelected: false },
          ]
        }
      ];
    } else if (exportDataType === 'hostAnalytics') {
      return [
        {
          id: 'host',
          label: 'Host Info',
          labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù…Ø¶ÙŠÙ',
          icon: 'ðŸ ',
          fields: [
            { key: 'rank', label: 'Rank', labelAr: 'Ø§Ù„Ø±ØªØ¨Ø©', category: 'host', defaultSelected: true },
            { key: 'address', label: 'Host Address', labelAr: 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù…Ø¶ÙŠÙ', category: 'host', defaultSelected: true },
          ]
        },
        {
          id: 'stats',
          label: 'Hosting Statistics',
          labelAr: 'Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©',
          icon: 'ðŸ“Š',
          fields: [
            { key: 'count', label: 'Times Hosted', labelAr: 'Ø¹Ø¯Ø¯ Ù…Ø±Ø§Øª Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©', category: 'stats', defaultSelected: true },
            { key: 'percentage', label: 'Hosting Percentage %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©', category: 'stats', defaultSelected: false },
            { key: 'firstHostDate', label: 'First Host Date', labelAr: 'Ø£ÙˆÙ„ ØªØ§Ø±ÙŠØ® Ø§Ø³ØªØ¶Ø§ÙØ©', category: 'stats', defaultSelected: false },
            { key: 'lastHostDate', label: 'Last Host Date', labelAr: 'Ø¢Ø®Ø± ØªØ§Ø±ÙŠØ® Ø§Ø³ØªØ¶Ø§ÙØ©', category: 'stats', defaultSelected: false },
          ]
        },
        {
          id: 'attendance',
          label: 'Attendance Stats',
          labelAr: 'Ø¥Ø­ØµØ§Ø¦ÙŠØ§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
          icon: 'âœ…',
          fields: [
            { key: 'attendanceRate', label: 'Avg Attendance Rate %', labelAr: 'Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'attendance', defaultSelected: true },
            { key: 'totalOnTime', label: 'Total On Time', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ ÙÙŠ Ø§Ù„ÙˆÙ‚Øª', category: 'attendance', defaultSelected: true },
            { key: 'totalLate', label: 'Total Late', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†', category: 'attendance', defaultSelected: true },
            { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ±', category: 'attendance', defaultSelected: true },
            { key: 'totalAbsent', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨', category: 'attendance', defaultSelected: true },
            { key: 'totalExcused', label: 'Total Excused', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…Ø¹Ø°ÙˆØ±ÙŠÙ†', category: 'attendance', defaultSelected: true },
            { key: 'totalStudents', label: 'Total Students', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨', category: 'attendance', defaultSelected: false },
          ]
        },
        {
          id: 'dates',
          label: 'Hosting Dates',
          labelAr: 'ØªÙˆØ§Ø±ÙŠØ® Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©',
          icon: 'ðŸ“…',
          fields: [
            { key: 'dates', label: 'All Dates', labelAr: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®', category: 'dates', defaultSelected: true },
            { key: 'datesList', label: 'Dates List (separate rows)', labelAr: 'Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®', category: 'dates', defaultSelected: false },
          ]
        }
      ];
    }
    // Default: records - Full field list for detailed record exports
    return [
      {
        id: 'basic',
        label: 'Basic Info',
        labelAr: 'Ø§Ù„Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ©',
        icon: 'ðŸ“‹',
        fields: [
          { key: 'date', label: 'Date', labelAr: 'Ø§Ù„ØªØ§Ø±ÙŠØ®', category: 'basic', defaultSelected: true },
          { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹', category: 'basic', defaultSelected: false },
          { key: 'attendance_id', label: 'Record ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø³Ø¬Ù„', category: 'basic', defaultSelected: false },
        ]
      },
      {
        id: 'student',
        label: 'Student Info',
        labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨',
        icon: 'ðŸ‘¤',
        fields: [
          { key: 'student_name', label: 'Student Name', labelAr: 'Ø§Ø³Ù… Ø§Ù„Ø·Ø§Ù„Ø¨', category: 'student', defaultSelected: true },
          { key: 'student_id', label: 'Student ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø·Ø§Ù„Ø¨', category: 'student', defaultSelected: false },
        ]
      },
      {
        id: 'course',
        label: 'Course Info',
        labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø¯ÙˆØ±Ø©',
        icon: 'ðŸ“š',
        fields: [
          { key: 'course_name', label: 'Course Name', labelAr: 'Ø§Ø³Ù… Ø§Ù„Ø¯ÙˆØ±Ø©', category: 'course', defaultSelected: true },
          { key: 'course_id', label: 'Course ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø¯ÙˆØ±Ø©', category: 'course', defaultSelected: false },
          { key: 'instructor_name', label: 'Instructor', labelAr: 'Ø§Ù„Ù…Ø¯Ø±Ø¨', category: 'course', defaultSelected: true },
          { key: 'session_location', label: 'Session Location', labelAr: 'Ù…ÙˆÙ‚Ø¹ Ø§Ù„Ø¬Ù„Ø³Ø©', category: 'course', defaultSelected: false },
        ]
      },
      {
        id: 'book',
        label: 'Book Coverage',
        labelAr: 'ØªØºØ·ÙŠØ© Ø§Ù„ÙƒØªØ§Ø¨',
        icon: 'ðŸ“–',
        fields: [
          { key: 'book_topic', label: 'Book Topic', labelAr: 'Ù…ÙˆØ¶ÙˆØ¹ Ø§Ù„ÙƒØªØ§Ø¨', category: 'book', defaultSelected: false },
          { key: 'book_pages', label: 'Book Pages', labelAr: 'ØµÙØ­Ø§Øª Ø§Ù„ÙƒØªØ§Ø¨', category: 'book', defaultSelected: false },
          { key: 'book_start_page', label: 'Start Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©', category: 'book', defaultSelected: false },
          { key: 'book_end_page', label: 'End Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ù†Ù‡Ø§ÙŠØ©', category: 'book', defaultSelected: false },
        ]
      },
      {
        id: 'attendance',
        label: 'Attendance Details',
        labelAr: 'ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±',
        icon: 'âœ…',
        fields: [
          { key: 'status', label: 'Status', labelAr: 'Ø§Ù„Ø­Ø§Ù„Ø©', category: 'attendance', defaultSelected: true },
          { key: 'status_display', label: 'Status (Display)', labelAr: 'Ø§Ù„Ø­Ø§Ù„Ø© (Ø¹Ø±Ø¶)', category: 'attendance', defaultSelected: false },
          { key: 'is_present', label: 'Is Present', labelAr: 'Ø­Ø§Ø¶Ø±', category: 'attendance', defaultSelected: false },
          { key: 'is_late', label: 'Is Late', labelAr: 'Ù…ØªØ£Ø®Ø±', category: 'attendance', defaultSelected: false },
          { key: 'is_excused', label: 'Is Excused', labelAr: 'Ù…Ø¹Ø°ÙˆØ±', category: 'attendance', defaultSelected: false },
          { key: 'is_absent', label: 'Is Absent', labelAr: 'ØºØ§Ø¦Ø¨', category: 'attendance', defaultSelected: false },
        ]
      },
      {
        id: 'timing',
        label: 'Timing Details',
        labelAr: 'ØªÙØ§ØµÙŠÙ„ Ø§Ù„ØªÙˆÙ‚ÙŠØª',
        icon: 'â°',
        fields: [
          { key: 'late_minutes', label: 'Late Duration (min)', labelAr: 'Ù…Ø¯Ø© Ø§Ù„ØªØ£Ø®Ø±', category: 'timing', defaultSelected: true },
          { key: 'late_bracket', label: 'Late Bracket', labelAr: 'ÙØ¦Ø© Ø§Ù„ØªØ£Ø®Ø±', category: 'timing', defaultSelected: false },
          { key: 'early_minutes', label: 'Early (min)', labelAr: 'Ù…Ø¨ÙƒØ±', category: 'timing', defaultSelected: false },
          { key: 'check_in_time', label: 'Check-in Time', labelAr: 'ÙˆÙ‚Øª Ø§Ù„Ø¯Ø®ÙˆÙ„', category: 'timing', defaultSelected: false },
          { key: 'gps_timestamp', label: 'GPS Timestamp', labelAr: 'ÙˆÙ‚Øª GPS', category: 'timing', defaultSelected: false },
        ]
      },
      {
        id: 'excuse',
        label: 'Excuse Info',
        labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ø¹Ø°Ø±',
        icon: 'ðŸ“',
        fields: [
          { key: 'excuse_reason', label: 'Excuse Reason', labelAr: 'Ø³Ø¨Ø¨ Ø§Ù„Ø¹Ø°Ø±', category: 'excuse', defaultSelected: true },
          { key: 'check_in_method', label: 'Check-in Method', labelAr: 'Ø·Ø±ÙŠÙ‚Ø© Ø§Ù„ØªØ³Ø¬ÙŠÙ„', category: 'excuse', defaultSelected: false },
        ]
      },
      {
        id: 'location',
        label: 'Location Info',
        labelAr: 'Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù…ÙˆÙ‚Ø¹',
        icon: 'ðŸ“',
        fields: [
          { key: 'host_address', label: 'Host Address', labelAr: 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù…Ø¶ÙŠÙ', category: 'location', defaultSelected: true },
          { key: 'gps_latitude', label: 'GPS Latitude', labelAr: 'Ø®Ø· Ø§Ù„Ø¹Ø±Ø¶', category: 'location', defaultSelected: false },
          { key: 'gps_longitude', label: 'GPS Longitude', labelAr: 'Ø®Ø· Ø§Ù„Ø·ÙˆÙ„', category: 'location', defaultSelected: false },
          { key: 'gps_coordinates', label: 'GPS Coordinates', labelAr: 'Ø¥Ø­Ø¯Ø§Ø«ÙŠØ§Øª GPS', category: 'location', defaultSelected: false },
          { key: 'gps_accuracy', label: 'GPS Accuracy (m)', labelAr: 'Ø¯Ù‚Ø© GPS', category: 'location', defaultSelected: false },
          { key: 'distance_from_host', label: 'Distance from Host (m)', labelAr: 'Ø§Ù„Ù…Ø³Ø§ÙØ© Ù…Ù† Ø§Ù„Ù…Ø¶ÙŠÙ', category: 'location', defaultSelected: false },
        ]
      },
      {
        id: 'metadata',
        label: 'Metadata',
        labelAr: 'Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ÙˆØµÙÙŠØ©',
        icon: 'ðŸ”–',
        fields: [
          { key: 'marked_by', label: 'Marked By', labelAr: 'Ø³Ø¬Ù„ Ø¨ÙˆØ§Ø³Ø·Ø©', category: 'metadata', defaultSelected: false },
          { key: 'marked_at', label: 'Marked At', labelAr: 'ÙˆÙ‚Øª Ø§Ù„ØªØ³Ø¬ÙŠÙ„', category: 'metadata', defaultSelected: true },
          { key: 'session_id', label: 'Session ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø¬Ù„Ø³Ø©', category: 'metadata', defaultSelected: false },
          { key: 'teacher_id', label: 'Teacher ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ù…Ø¯Ø±Ø¨', category: 'metadata', defaultSelected: false },
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
        { key: 'rank', label: 'Rank', labelAr: 'Ø§Ù„ØªØ±ØªÙŠØ¨' },
        { key: 'student_id', label: 'Student ID', labelAr: 'Ø±Ù‚Ù… Ø§Ù„Ø·Ø§Ù„Ø¨' },
        { key: 'student_name', label: 'Student Name', labelAr: 'Ø§Ø³Ù… Ø§Ù„Ø·Ø§Ù„Ø¨' },
        { key: 'presentCount', label: 'On Time', labelAr: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª' },
        { key: 'lateCount', label: 'Late', labelAr: 'Ù…ØªØ£Ø®Ø±' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø­Ø§Ø¶Ø±' },
        { key: 'absentCount', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨' },
        { key: 'unexcusedAbsent', label: 'Unexcused Absent', labelAr: 'ØºØ§Ø¦Ø¨ Ø¨Ø¯ÙˆÙ† Ø¹Ø°Ø±' },
        { key: 'excusedCount', label: 'Excused', labelAr: 'ØºØ§Ø¦Ø¨ Ø¨Ø¹Ø°Ø±' },
        { key: 'sessionNotHeldCount', label: 'Not Held', labelAr: 'Ø¬Ù„Ø³Ø§Øª Ù„Ù… ØªØ¹Ù‚Ø¯' },
        { key: 'totalRecords', label: 'Total Records', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª' },
        { key: 'effectiveDays', label: 'Effective Days', labelAr: 'Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„ÙØ¹Ù„ÙŠØ©' },
        { key: 'daysCovered', label: 'Days Covered', labelAr: 'Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„Ù…ØºØ·Ø§Ø©' },
        { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± (%)' },
        { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª (%)' },
        { key: 'weightedScore', label: 'Weighted Score', labelAr: 'Ø§Ù„Ù†Ù‚Ø§Ø· Ø§Ù„Ù…Ø±Ø¬Ø­Ø©' },
        { key: 'consistencyIndex', label: 'Consistency Index', labelAr: 'Ù…Ø¤Ø´Ø± Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…' },
        { key: 'trendSlope', label: 'Trend Slope', labelAr: 'Ù…ÙŠÙ„ Ø§Ù„Ø§ØªØ¬Ø§Ù‡' },
        { key: 'trendClassification', label: 'Trend Classification', labelAr: 'ØªØµÙ†ÙŠÙ Ø§Ù„Ø§ØªØ¬Ø§Ù‡' },
        { key: 'trendRSquared', label: 'Trend RÂ² Value', labelAr: 'Ù‚ÙŠÙ…Ø© RÂ²' },
        { key: 'weeklyChange', label: 'Weekly Change %', labelAr: 'Ø§Ù„ØªØºÙŠØ± Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ÙŠ (%)' },
        { key: 'avgRate', label: 'Average Rate', labelAr: 'Ø§Ù„Ù…Ø¹Ø¯Ù„ Ø§Ù„Ù…ØªÙˆØ³Ø·' },
        { key: 'minRate', label: 'Minimum Rate', labelAr: 'Ø£Ø¯Ù†Ù‰ Ù…Ø¹Ø¯Ù„' },
        { key: 'maxRate', label: 'Maximum Rate', labelAr: 'Ø£Ø¹Ù„Ù‰ Ù…Ø¹Ø¯Ù„' },
        // Score Breakdown
        { key: 'qualityAdjustedRate', label: 'Quality-Adjusted Rate %', labelAr: 'Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø¬ÙˆØ¯Ø© Ø§Ù„Ù…Ø¹Ø¯Ù„' },
        { key: 'rawWeightedScore', label: 'Raw Score (before coverage)', labelAr: 'Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø®Ø§Ù…' },
        { key: 'coverageFactor', label: 'Coverage Factor', labelAr: 'Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ©' },
        { key: 'scoreFormula', label: 'Score Formula', labelAr: 'Ù…Ø¹Ø§Ø¯Ù„Ø© Ø§Ù„Ø¯Ø±Ø¬Ø©' },
        // Late Duration
        { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ØªØ£Ø®ÙŠØ± (Ø¯Ù‚ÙŠÙ‚Ø©)' },
        { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø§Ù„ØªØ£Ø®ÙŠØ±' },
        { key: 'maxLateMinutes', label: 'Max Late (min)', labelAr: 'Ø£Ù‚ØµÙ‰ ØªØ£Ø®ÙŠØ±' },
        { key: 'lateScoreAvg', label: 'Avg Late Credit (0-1)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø±ØµÙŠØ¯ Ø§Ù„ØªØ£Ø®ÙŠØ±' },
      );
    } else if (dataType === 'dateAnalytics') {
      // Date fields
      allFields.push(
        { key: 'date', label: 'Date', labelAr: 'Ø§Ù„ØªØ§Ø±ÙŠØ®' },
        { key: 'dayOfWeek', label: 'Day of Week', labelAr: 'ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹' },
        { key: 'hostAddress', label: 'Host Address', labelAr: 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù…Ø¶ÙŠÙ' },
        { key: 'bookTopic', label: 'Book Topic', labelAr: 'Ø§Ù„Ù…ÙˆØ¶ÙˆØ¹' },
        { key: 'bookPages', label: 'Pages', labelAr: 'Ø§Ù„ØµÙØ­Ø§Øª' },
        { key: 'bookStartPage', label: 'Start Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©' },
        { key: 'bookEndPage', label: 'End Page', labelAr: 'ØµÙØ­Ø© Ø§Ù„Ù†Ù‡Ø§ÙŠØ©' },
        { key: 'pagesCount', label: 'Pages Count', labelAr: 'Ø¹Ø¯Ø¯ Ø§Ù„ØµÙØ­Ø§Øª' },
        { key: 'presentCount', label: 'On Time', labelAr: 'ÙÙŠ Ø§Ù„ÙˆÙ‚Øª' },
        { key: 'lateCount', label: 'Late', labelAr: 'Ù…ØªØ£Ø®Ø±' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ±' },
        { key: 'excusedAbsentCount', label: 'Excused', labelAr: 'Ù…Ø¹Ø°ÙˆØ±' },
        { key: 'unexcusedAbsentCount', label: 'Absent', labelAr: 'ØºØ§Ø¦Ø¨' },
        { key: 'totalAbsent', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨' },
        { key: 'totalStudents', label: 'Total Students', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨' },
        { key: 'attendanceRate', label: 'Attendance Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø­Ø¶ÙˆØ±' },
        { key: 'punctualityRate', label: 'Punctuality Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…' },
        { key: 'absentRate', label: 'Absence Rate %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„ØºÙŠØ§Ø¨' },
        { key: 'presentNames', label: 'On Time Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ ÙÙŠ Ø§Ù„ÙˆÙ‚Øª' },
        { key: 'lateNames', label: 'Late Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†' },
        { key: 'excusedNames', label: 'Excused Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ù…Ø¹Ø°ÙˆØ±ÙŠÙ†' },
        { key: 'absentNames', label: 'Absent Names', labelAr: 'Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„ØºØ§Ø¦Ø¨ÙŠÙ†' },
        // Late Duration
        { key: 'totalLateMinutes', label: 'Total Late (min)', labelAr: 'Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„ØªØ£Ø®ÙŠØ± (Ø¯Ù‚ÙŠÙ‚Ø©)' },
        { key: 'avgLateMinutes', label: 'Avg Late (min)', labelAr: 'Ù…ØªÙˆØ³Ø· Ø§Ù„ØªØ£Ø®ÙŠØ±' },
        { key: 'topSpecialization', label: 'Most Present Specialization', labelAr: 'Ø§Ù„ØªØ®ØµØµ Ø§Ù„Ø£ÙƒØ«Ø± Ø­Ø¶ÙˆØ±Ø§Ù‹' },
      );
    } else if (dataType === 'hostAnalytics') {
      // Host fields
      allFields.push(
        { key: 'rank', label: 'Rank', labelAr: 'Ø§Ù„Ø±ØªØ¨Ø©' },
        { key: 'address', label: 'Host Address', labelAr: 'Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù…Ø¶ÙŠÙ' },
        { key: 'count', label: 'Times Hosted', labelAr: 'Ø¹Ø¯Ø¯ Ù…Ø±Ø§Øª Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©' },
        { key: 'percentage', label: 'Hosting Percentage %', labelAr: 'Ù†Ø³Ø¨Ø© Ø§Ù„Ø§Ø³ØªØ¶Ø§ÙØ©' },
        { key: 'attendanceRate', label: 'Avg Attendance Rate %', labelAr: 'Ù…ØªÙˆØ³Ø· Ù†Ø³Ø¨Ø© Ø§Ù„Ø­Ø¶ÙˆØ±' },
        { key: 'firstHostDate', label: 'First Host Date', labelAr: 'Ø£ÙˆÙ„ ØªØ§Ø±ÙŠØ® Ø§Ø³ØªØ¶Ø§ÙØ©' },
        { key: 'lastHostDate', label: 'Last Host Date', labelAr: 'Ø¢Ø®Ø± ØªØ§Ø±ÙŠØ® Ø§Ø³ØªØ¶Ø§ÙØ©' },
        { key: 'totalOnTime', label: 'Total On Time', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø¶ÙˆØ±' },
        { key: 'totalLate', label: 'Total Late', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…ØªØ£Ø®Ø±ÙŠÙ†' },
        { key: 'totalPresent', label: 'Total Present', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø­Ø§Ø¶Ø±ÙŠÙ†' },
        { key: 'totalAbsent', label: 'Total Absent', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØºÙŠØ§Ø¨' },
        { key: 'totalExcused', label: 'Total Excused', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…Ø¹Ø°ÙˆØ±ÙŠÙ†' },
        { key: 'totalStudents', label: 'Total Students', labelAr: 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø·Ù„Ø§Ø¨' },
        { key: 'dates', label: 'All Dates', labelAr: 'Ø¬Ù…ÙŠØ¹ Ø§Ù„ØªÙˆØ§Ø±ÙŠØ®' },
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
  
  // Helper: Get sort settings for a data type (supports multi-layer)
  const getSortSettingsForType = (dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'): { sortByField?: string; sortDirection: 'asc' | 'desc'; sortLayers?: Array<{field: string; direction: 'asc' | 'desc'}> } => {
    const settings = savedExportSettings[dataType];
    return {
      sortByField: settings?.sortByField,
      sortDirection: settings?.sortDirection || 'asc',
      sortLayers: settings?.sortLayers,
    };
  };
  
  // Helper: Sort data array based on saved settings (supports multi-layer)
  const sortDataBySettings = <T extends Record<string, unknown>>(
    data: T[],
    dataType: 'studentAnalytics' | 'dateAnalytics' | 'hostAnalytics'
  ): T[] => {
    const { sortByField, sortDirection, sortLayers } = getSortSettingsForType(dataType);
    
    // Build effective layers: use sortLayers if available, else fall back to single field
    const effectiveLayers: Array<{field: string; direction: 'asc' | 'desc'}> = 
      (sortLayers && sortLayers.length > 0) 
        ? sortLayers 
        : (sortByField ? [{ field: sortByField, direction: sortDirection }] : []);
    
    if (effectiveLayers.length === 0) return data;
    
    // Helper to get sort value for a field
    const getSortValue = (item: T, field: string): number | string => {
      const isDateField = field.toLowerCase().includes('date') || 
                          field === 'firstHostDate' || 
                          field === 'lastHostDate';
      if (isDateField) {
        const rawKey = `${field}Raw`;
        if (rawKey in item && typeof item[rawKey] === 'number') {
          return item[rawKey] as number;
        }
        const dateVal = item[field];
        if (dateVal && typeof dateVal === 'string') {
          const parsed = new Date(dateVal);
          if (!isNaN(parsed.getTime())) return parsed.getTime();
        }
        return 0;
      }
      const val = item[field];
      if (val == null) return '';
      // If value is a string that looks numeric (e.g., '78.6', '100%', '0.345'), parse it as a number for proper sorting
      if (typeof val === 'string') {
        const numMatch = val.match(/^(-?\d+\.?\d*)%?$/);
        if (numMatch) return parseFloat(numMatch[1]);
      }
      return val as number | string;
    };
    
    return [...data].sort((a, b) => {
      for (const layer of effectiveLayers) {
        const dir = layer.direction === 'desc' ? -1 : 1;
        const aVal = getSortValue(a, layer.field);
        const bVal = getSortValue(b, layer.field);
        
        if (aVal == null && bVal != null) return dir;
        if (bVal == null && aVal != null) return -dir;
        
        let cmp = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
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
          scoreFormula: `(${Math.round((student.rawWeightedScore || 0) * 100) / 100} Ã— ${Math.round((student.coverageFactor || 0) * 1000) / 1000}) = ${student.weightedScore}`,
          // Late Duration
          totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
          avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
          maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
          lateScoreAvg: Math.round((student.lateScoreAvg || 0) * 1000) / 1000,
          sessionNotHeldCount: student.sessionNotHeldCount || 0,
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
        // Effective (accountable) students = total minus excused
        const totalAccountable = totalPresent + dateData.unexcusedAbsentCount;
        // Attendance Rate: (Total Present / Accountable) Ã— 100 â€” excused excluded from denominator
        const attendanceRate = totalAccountable > 0 ? Math.round((totalPresent / totalAccountable) * 100) : 0;
        // Absence Rate: (Unexcused Absent / Accountable) Ã— 100
        const absentRate = totalAccountable > 0 ? Math.round((dateData.unexcusedAbsentCount / totalAccountable) * 100) : 0;
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
          // Rates & Percentages (excused excluded from denominator for fairness)
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
          topSpecialization: dateData.topSpecialization || '-',
        };
      });
    } else if (exportDataType === 'hostAnalytics') {
      // Build host map with attendance stats per host
      const hostMap = new Map<string, { 
        count: number; 
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
            rawDates: [],
            present: 0,
            late: 0,
            absent: 0,
            excused: 0,
            totalStudents: 0
          };
          existing.count++;
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
      const allHostRawDates5 = Array.from(hostMap.values()).flatMap(h => h.rawDates);
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
            dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates5)).join(', '),
            datesList: host.rawDates.map(d => smartDateFormat(d, allHostRawDates5)).join('\n'),
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
          ? `${r.gps_latitude.toFixed(4)}Â°, ${r.gps_longitude.toFixed(4)}Â°` 
          : '-',
        gps_accuracy: r.gps_accuracy ? `Â±${Math.round(r.gps_accuracy)}m` : '-',
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
      {/* Breadcrumb Navigation */}
      <div className="px-4 pt-4">
        <Breadcrumb items={[
          { label: 'Dashboard', path: '/' },
          { label: 'Attendance Records' },
        ]} />
      </div>
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      {/* Advanced Export Builder Modal */}
      {showAdvancedExport && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />}>
          <AdvancedExportBuilder
            key={`export-${exportDataType}`}
            isOpen={showAdvancedExport}
            onClose={() => setShowAdvancedExport(false)}
            categories={getExportCategories()}
            data={getExportData()}
            defaultTitle={
              exportDataType === 'studentAnalytics' ? t.studentPerformanceReport :
              exportDataType === 'dateAnalytics' ? t.attendanceByDateReport :
              exportDataType === 'hostAnalytics' ? t.hostRankingsReport :
              t.attendanceRecords
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
            rowFilterLabel={exportDataType === 'dateAnalytics' ? t.dateRowsToExport : undefined}
          />
        </Suspense>
      )}
      
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
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.attendanceRecords}</h1>
                  <p className="text-blue-100 text-sm sm:text-base mt-1">
                    {t.subtitle}
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
                {showAnalytics ? t.hideAnalytics : t.showAnalytics}
              </button>
              
              {showAnalytics && (
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg p-1 border border-white/20">
                  <button
                    onClick={() => { setReportLanguage('en'); setArabicMode(false); }}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                      reportLanguage === 'en' 
                        ? 'bg-white text-blue-700 shadow-md' 
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => { setReportLanguage('ar'); setArabicMode(true); }}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                      reportLanguage === 'ar' 
                        ? 'bg-white text-blue-700 shadow-md' 
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    Ø¹
                  </button>
                </div>
              )}
              
              <button
                onClick={loadRecords}
                className="px-4 py-2 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-gray-700 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t.refresh}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 space-y-6">

      {/* Advanced Analytics Dashboard */}
      {showAnalytics && (
        <div className="space-y-4 sm:space-y-6">
          {/* Summary Statistics - Enhanced Cards */}
          {includedTables.summary && (
          <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-2xl shadow-lg dark:shadow-gray-900/30 border border-gray-100 dark:border-gray-700">
            <h2 className="text-base sm:text-lg font-semibold mb-4 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              {t.summaryStatistics}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 p-3 sm:p-4 rounded-xl border border-blue-100 dark:border-blue-800/50 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <div className="text-xs sm:text-sm text-blue-700 dark:text-blue-400 font-medium">{t.totalStudents}</div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-blue-900 dark:text-blue-100">{studentAnalytics.length}</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-3 sm:p-4 rounded-xl border border-green-100 dark:border-green-800/50 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <div className="text-xs sm:text-sm text-green-700 dark:text-green-400 font-medium">{t.classAvgRate}</div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-green-900 dark:text-green-100">
                  {studentAnalytics.length > 0
                    ? Math.round(
                        studentAnalytics.reduce((sum, s) => sum + s.attendanceRate, 0) /
                          studentAnalytics.length
                      )
                    : 0}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 dark:from-purple-900/30 dark:to-fuchsia-900/30 p-3 sm:p-4 rounded-xl border border-purple-100 dark:border-purple-800/50 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                  <div className="text-xs sm:text-sm text-purple-700 dark:text-purple-400 font-medium">{t.avgWeightedScore}</div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-purple-900 dark:text-purple-100">
                  {studentAnalytics.length > 0
                    ? Math.round(
                        studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) /
                          studentAnalytics.length
                      )
                    : 0}
                </div>
              </div>
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/30 dark:to-blue-900/30 p-3 sm:p-4 rounded-xl border border-sky-100 dark:border-sky-800/50 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-sky-500"></div>
                  <div className="text-xs sm:text-sm text-sky-700 dark:text-sky-400 font-medium">{t.avgAttendanceByDate}</div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-sky-900 dark:text-sky-100">
                  {dateAnalytics.length > 0
                    ? Math.round(
                        dateAnalytics.reduce((sum, d) => sum + d.attendanceRate, 0) /
                          dateAnalytics.length
                      )
                    : 0}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/30 dark:to-violet-900/30 p-3 sm:p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  <div className="text-xs sm:text-sm text-indigo-700 dark:text-indigo-400 font-medium">{t.medianRateByDate}</div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-indigo-900 dark:text-indigo-100">
                  {(() => {
                    if (dateAnalytics.length === 0) return 0;
                    const sorted = [...dateAnalytics].sort((a, b) => a.attendanceRate - b.attendanceRate);
                    const mid = Math.floor(sorted.length / 2);
                    return sorted.length % 2 === 0
                      ? Math.round((sorted[mid - 1].attendanceRate + sorted[mid].attendanceRate) / 2)
                      : Math.round(sorted[mid].attendanceRate);
                  })()}%
                </div>
              </div>
            </div>
          </div>
          )}



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
                  <h3 className="font-semibold text-gray-900 dark:text-white">{t.exportAnalytics}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">{t.exportAnalyticsDesc}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={() => { void exportAnalyticsToExcel(); }} aria-label="Export to Excel" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Excel
                </button>
                <button onClick={() => { void exportAnalyticsToPDF(); }} aria-label="Export to PDF" className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  PDF
                </button>
                <button onClick={() => { void exportAnalyticsToWord(); }} disabled={exportingWord} aria-label="Export to Word" className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md ${exportingWord ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  {exportingWord ? t.exporting : 'Word'}
                </button>
                <button onClick={exportAnalyticsToCSV} aria-label="Export to CSV" className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  CSV
                </button>
              </div>
            </div>
            {/* Field Selection Status */}
            <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700">
              <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold">ðŸ“Š {t.student}:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.studentAnalytics.length > 0 ? `${savedFieldSelections.studentAnalytics.length} ${t.fields}` : t.all}
                  </span>
                  {(savedExportSettings.studentAnalytics?.sortLayers || []).length > 0 ? (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.studentAnalytics.sortLayers!.map(l => `${l.field} ${l.direction === 'desc' ? 'â†“' : 'â†‘'}`).join(', ')})</span>
                  ) : savedExportSettings.studentAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.studentAnalytics.sortByField} {savedExportSettings.studentAnalytics.sortDirection === 'desc' ? 'â†“' : 'â†‘'})</span>
                  )}
                  {savedExportSettings.studentAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">ðŸŒˆ</span>}
                  <button onClick={() => { setExportDataType('studentAnalytics'); setShowAdvancedExport(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline text-xs ml-1">{t.edit}</button>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-green-600 dark:text-green-400 font-semibold">ðŸ“… {t.date}:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.dateAnalytics.length > 0 ? `${savedFieldSelections.dateAnalytics.length} ${t.fields}` : t.all}
                  </span>
                  {(savedExportSettings.dateAnalytics?.sortLayers || []).length > 0 ? (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.dateAnalytics.sortLayers!.map(l => `${l.field} ${l.direction === 'desc' ? 'â†“' : 'â†‘'}`).join(', ')})</span>
                  ) : savedExportSettings.dateAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.dateAnalytics.sortByField} {savedExportSettings.dateAnalytics.sortDirection === 'desc' ? 'â†“' : 'â†‘'})</span>
                  )}
                  {savedExportSettings.dateAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">ðŸŒˆ</span>}
                  <button onClick={() => { setExportDataType('dateAnalytics'); setShowAdvancedExport(true); }} className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 underline text-xs ml-1">{t.edit}</button>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
                  <span className="text-orange-600 dark:text-orange-400 font-semibold">ðŸ  {t.location}:</span>
                  <span className="text-green-600 dark:text-green-400">
                    {savedFieldSelections.hostAnalytics.length > 0 ? `${savedFieldSelections.hostAnalytics.length} ${t.fields}` : t.all}
                  </span>
                  {(savedExportSettings.hostAnalytics?.sortLayers || []).length > 0 ? (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.hostAnalytics.sortLayers!.map(l => `${l.field} ${l.direction === 'desc' ? 'â†“' : 'â†‘'}`).join(', ')})</span>
                  ) : savedExportSettings.hostAnalytics?.sortByField && (
                    <span className="text-purple-600 dark:text-purple-400 text-xs">(Sort: {savedExportSettings.hostAnalytics.sortByField} {savedExportSettings.hostAnalytics.sortDirection === 'desc' ? 'â†“' : 'â†‘'})</span>
                  )}
                  {savedExportSettings.hostAnalytics?.enableConditionalColoring !== false && <span className="text-rose-500 text-xs">ðŸŒˆ</span>}
                  <button onClick={() => { setExportDataType('hostAnalytics'); setShowAdvancedExport(true); }} className="text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300 underline text-xs ml-1">{t.edit}</button>
                </div>
              </div>
              {/* Table Include/Exclude Toggles */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-600 dark:text-gray-400 font-medium">{t.includeTables}:</span>
                {([
                  { key: 'summary' as const, label: t.summaryTable, icon: 'ðŸ“Š' },
                  { key: 'student' as const, label: t.studentTable, icon: 'ðŸŽ“' },
                  { key: 'date' as const, label: t.dateTable, icon: 'ðŸ“…' },
                  { key: 'host' as const, label: t.hostTable, icon: 'ðŸ ' },
                  { key: 'crosstab' as const, label: t.crosstabTable, icon: 'ðŸ—“ï¸' },
                ]).map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => setIncludedTables(prev => ({ ...prev, [key]: !prev[key] }))}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all duration-150 ${
                      includedTables[key]
                        ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 line-through'
                    }`}
                    title={includedTables[key] ? `Click to exclude ${label} from export` : `Click to include ${label} in export`}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                    {includedTables[key]
                      ? <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      : <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    }
                  </button>
                ))}
              </div>

              {/* Matrix Date Picker â€” Select which dates to include in cross-tab */}
              {includedTables.crosstab && dateAnalytics.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowMatrixDatePicker(prev => !prev)}
                    className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 font-medium transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    ðŸ—“ï¸ Matrix Date Selection
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      ({matrixSelectedDates ? `${matrixSelectedDates.size}/${dateAnalytics.length}` : `All ${dateAnalytics.length}`} dates)
                    </span>
                    <svg className={`w-3 h-3 transition-transform duration-200 ${showMatrixDatePicker ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showMatrixDatePicker && (() => {
                    const allDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    const allDateObjects = allDates.map(d => new Date(d.date));
                    const selectedCount = matrixSelectedDates ? matrixSelectedDates.size : allDates.length;
                    const allSelected = !matrixSelectedDates || matrixSelectedDates.size === allDates.length;

                    return (
                      <div className="mt-2 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800">
                        {/* Quick actions */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <button
                            onClick={() => setMatrixSelectedDates(null)}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${allSelected ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-gray-800 text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40'}`}
                          >
                            Select All
                          </button>
                          <button
                            onClick={() => setMatrixSelectedDates(new Set())}
                            className="px-2 py-0.5 text-[10px] rounded border bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            Deselect All
                          </button>
                          <button
                            onClick={() => {
                              const last7 = allDates.slice(-7);
                              setMatrixSelectedDates(new Set(last7.map(d => d.date)));
                            }}
                            className="px-2 py-0.5 text-[10px] rounded border bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                          >
                            Last 7
                          </button>
                          <button
                            onClick={() => {
                              const last14 = allDates.slice(-14);
                              setMatrixSelectedDates(new Set(last14.map(d => d.date)));
                            }}
                            className="px-2 py-0.5 text-[10px] rounded border bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                          >
                            Last 14
                          </button>
                          <button
                            onClick={() => {
                              const first = allDates.slice(0, Math.ceil(allDates.length / 2));
                              setMatrixSelectedDates(new Set(first.map(d => d.date)));
                            }}
                            className="px-2 py-0.5 text-[10px] rounded border bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            First Half
                          </button>
                          <button
                            onClick={() => {
                              const second = allDates.slice(Math.floor(allDates.length / 2));
                              setMatrixSelectedDates(new Set(second.map(d => d.date)));
                            }}
                            className="px-2 py-0.5 text-[10px] rounded border bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            Second Half
                          </button>
                          <span className="ml-auto text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            {selectedCount}/{allDates.length} selected
                          </span>
                        </div>
                        {/* Date chips grid */}
                        <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
                          {allDates.map(d => {
                            const isSelected = !matrixSelectedDates || matrixSelectedDates.has(d.date);
                            const dateObj = new Date(d.date);
                            return (
                              <button
                                key={d.date}
                                onClick={() => {
                                  setMatrixSelectedDates(prev => {
                                    const current = prev || new Set(allDates.map(x => x.date));
                                    const next = new Set(current);
                                    if (next.has(d.date)) {
                                      next.delete(d.date);
                                    } else {
                                      next.add(d.date);
                                    }
                                    // If all are selected again, return null (meaning "all")
                                    if (next.size === allDates.length) return null;
                                    return next;
                                  });
                                }}
                                className={`px-1.5 py-0.5 text-[10px] rounded border transition-all duration-100 ${
                                  isSelected
                                    ? 'bg-violet-100 dark:bg-violet-800/50 border-violet-400 dark:border-violet-600 text-violet-800 dark:text-violet-200 font-medium shadow-sm'
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500'
                                }`}
                                title={format(dateObj, 'EEEE, MMM dd, yyyy')}
                              >
                                {smartDateFormat(dateObj, allDateObjects)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Charts Section */}
          {(studentAnalytics.length > 0 || dateAnalytics.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
              <button
                onClick={() => setCollapseChartsSection(prev => !prev)}
                className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-violet-50 to-cyan-50 dark:from-violet-900/20 dark:to-cyan-900/20 border-b dark:border-gray-700 flex items-center justify-between hover:from-violet-100 hover:to-cyan-100 dark:hover:from-violet-900/30 dark:hover:to-cyan-900/30 transition-colors cursor-pointer"
              >
                <div className="text-left">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Interactive Analytics Charts</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Collapse state is now preserved when you leave and return to this page.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{studentAnalytics.length} students â€¢ {dateAnalytics.length} dates</span>
                  <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${collapseChartsSection ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {!collapseChartsSection && (
                <div className="p-4 sm:p-6">
                  <Suspense fallback={
                    <div className="rounded-2xl border border-dashed border-violet-200 dark:border-violet-700 p-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500 mx-auto mb-3" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">Loading charts...</p>
                    </div>
                  }>
                    <AttendanceCharts
                      studentAnalytics={studentAnalytics}
                      dateAnalytics={dateAnalytics}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          )}

          {/* Student Performance Table â€” Dynamic columns from field selections */}
          {includedTables.student && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseStudentTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              <div>
                <h2 className="text-base sm:text-lg font-semibold dark:text-white">{t.studentPerformance}</h2>
                {(() => {
                  const _cfg = loadConfigSync();
                  return (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                      Weights: Q{_cfg.weight_quality}% / A{_cfg.weight_attendance}% / P{_cfg.weight_punctuality}%
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{studentAnalytics.length} {t.students}</span>
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
                      scoreFormula: `(${(student.rawWeightedScore || 0).toFixed(1)} Ã— ${(student.coverageFactor || 0).toFixed(3)}) = ${student.weightedScore.toFixed(1)}`,
                      totalLateMinutes: Math.round((student.totalLateMinutes || 0) * 10) / 10,
                      avgLateMinutes: Math.round((student.avgLateMinutes || 0) * 10) / 10,
                      maxLateMinutes: Math.round((student.maxLateMinutes || 0) * 10) / 10,
                      lateScoreAvg: (student.lateScoreAvg || 0).toFixed(3),
                      sessionNotHeldCount: student.sessionNotHeldCount || 0,
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
                            <tr key={String(data.studentName || data.rank || index)} className="hover:bg-gray-50 dark:hover:bg-gray-700">
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
          )}

          {/* Date Analytics Table â€” Dynamic columns from field selections */}
          {includedTables.date && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseDateTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              <h2 className="text-base sm:text-lg font-semibold dark:text-white">{t.attendanceByDate}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {(() => {
                    const excluded = savedExportSettings.dateAnalytics?.excludedRows;
                    const hasExcluded = excluded && excluded.length > 0;
                    const hasMatrixFilter = !!matrixSelectedDates;
                    if (hasExcluded) {
                      const excludedSet = new Set(excluded);
                      const visibleCount = dateAnalytics.filter(d => !excludedSet.has(format(new Date(d.date), 'MMM dd, yyyy'))).length;
                      return `${visibleCount} of ${dateAnalytics.length} ${t.sessions}`;
                    }
                    if (hasMatrixFilter) {
                      return `${dateAnalytics.filter(d => matrixSelectedDates.has(d.date)).length} of ${dateAnalytics.length} ${t.sessions}`;
                    }
                    return `${dateAnalytics.length} ${t.sessions}`;
                  })()}
                </span>
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
                  // Filter by export builder excluded rows (primary) or cross-tab date picker (fallback)
                  const excludedDateRows = savedExportSettings.dateAnalytics?.excludedRows;
                  const hasExcluded = excludedDateRows && excludedDateRows.length > 0;
                  let visibleDates = dateAnalytics;
                  if (hasExcluded) {
                    const excludedSet = new Set(excludedDateRows);
                    visibleDates = dateAnalytics.filter(d => !excludedSet.has(format(new Date(d.date), 'MMM dd, yyyy')));
                  } else if (matrixSelectedDates) {
                    visibleDates = dateAnalytics.filter(d => matrixSelectedDates.has(d.date));
                  }
                  const dataObjects = visibleDates.map((d) => {
                    const totalPres = d.presentCount + d.lateCount;
                    const totalAbs = d.excusedAbsentCount + d.unexcusedAbsentCount;
                    const totalStud = totalPres + totalAbs;
                    // Accountable = those who should have attended (excused excluded)
                    const totalAccountable = totalPres + d.unexcusedAbsentCount;
                    const punctRate = totalPres > 0 ? Math.round(d.presentCount / totalPres * 100) : 0;
                    const absRate = totalAccountable > 0 ? Math.round((d.unexcusedAbsentCount / totalAccountable) * 100) : 0;
                    const bookPages = d.bookStartPage && d.bookEndPage ? `${d.bookStartPage}-${d.bookEndPage}` : '-';
                    const pagesCount = d.bookStartPage && d.bookEndPage ? d.bookEndPage - d.bookStartPage + 1 : 0;
                    const dateObj = new Date(d.date);
                    let excusedLabel = d.excusedNames.join(', ') || '-';
                    if (d.hostAddress === 'SESSION_NOT_HELD' || (d.hostAddress && d.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')) {
                      excusedLabel = isArabic ? 'Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨' : 'All Students';
                    }
                    const hostAddressLabel = d.isSessionNotHeld
                      ? (isArabic ? 'Ù„Ù… ØªØ¹Ù‚Ø¯ Ø§Ù„Ø¬Ù„Ø³Ø©' : 'Session Not Held')
                      : (d.hostAddress || '-');
                    return {
                      date: format(dateObj, 'MMM dd, yyyy'),
                      dayOfWeek: format(dateObj, 'EEEE'),
                      hostAddress: hostAddressLabel,
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
                      topSpecialization: d.topSpecialization || '-',
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
                            <tr key={String(data.date || data.rank || index)} className="hover:bg-gray-50 dark:hover:bg-gray-700">
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
          )}

          {/* Host Analytics Table â€” Dynamic columns from field selections */}
          {includedTables.host && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseHostTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              <h2 className="text-base sm:text-lg font-semibold dark:text-white">{t.hostAnalyticsTitle}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {(() => {
                    const hostMap = new Map<string, number>();
                    dateAnalytics.forEach((d) => {
                      if (d.hostAddress && d.hostAddress !== 'SESSION_NOT_HELD') {
                        hostMap.set(d.hostAddress, (hostMap.get(d.hostAddress) || 0) + 1);
                      }
                    });
                    return `${hostMap.size} ${t.hosts}`;
                  })()}
                </span>
                <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${collapseHostTable ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {!collapseHostTable && (
              <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
                {(() => {
                  const isArabic = reportLanguage === 'ar';
                  const config = filterDataByFields('hostAnalytics', isArabic);

                  // Build host data from dateAnalytics
                  const hostMap = new Map<string, { count: number; rawDates: Date[]; present: number; late: number; absent: number; excused: number }>();
                  dateAnalytics.forEach((dateData) => {
                    if (dateData.hostAddress && dateData.hostAddress !== 'SESSION_NOT_HELD') {
                      const existing = hostMap.get(dateData.hostAddress) || { count: 0, rawDates: [], present: 0, late: 0, absent: 0, excused: 0 };
                      existing.count++;
                      existing.rawDates.push(new Date(dateData.date));
                      existing.present += dateData.presentCount;
                      existing.late += dateData.lateCount;
                      existing.absent += dateData.unexcusedAbsentCount;
                      existing.excused += dateData.excusedAbsentCount;
                      hostMap.set(dateData.hostAddress, existing);
                    }
                  });

                  const totalHostings = Array.from(hostMap.values()).reduce((sum, h) => sum + h.count, 0);
                  const allHostRawDates6 = Array.from(hostMap.values()).flatMap(h => h.rawDates);
                  const hostRankings = Array.from(hostMap.entries())
                    .map(([address, data]) => ({ address, ...data }))
                    .sort((a, b) => b.count - a.count);

                  const dataObjects = hostRankings.map((host, index) => {
                    const totalPresent = host.present + host.late;
                    const totalStudents = totalPresent + host.absent + host.excused;
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
                      dates: host.rawDates.map(d => smartDateFormat(d, allHostRawDates6)).join(', '),
                    } as Record<string, unknown>;
                  });

                  const sorted = sortDataBySettings(dataObjects, 'hostAnalytics');
                  sorted.forEach((obj, idx) => { obj.rank = idx + 1; });

                  if (sorted.length === 0) {
                    return (
                      <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        <span className="text-2xl block mb-2">ðŸ </span>
                        <p className="text-sm">No host data available. Host addresses are recorded when attendance is marked.</p>
                      </div>
                    );
                  }

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
                            <tr key={String(data.hostName || data.rank || index)} className="hover:bg-gray-50 dark:hover:bg-gray-700">
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
          )}

          {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
              LOCATION MAP â€” Host Locations with Map Embed & Distance Matrix
              â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
          {includedTables.host && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            {(() => {
              // Build location points from attendance records and host addresses
              const hostGpsMap = new Map<string, { lats: number[]; lons: number[]; count: number; dates: string[] }>();

              // First, try to parse GPS from attendance records grouped by host_address
              filteredRecords.forEach(r => {
                const addr = r.host_address || r.session_location;
                if (!addr || addr === 'SESSION_NOT_HELD') return;
                const existing = hostGpsMap.get(addr) || { lats: [], lons: [], count: 0, dates: [] };
                if (r.gps_latitude && r.gps_longitude) {
                  existing.lats.push(r.gps_latitude);
                  existing.lons.push(r.gps_longitude);
                }
                if (r.attendance_date && !existing.dates.includes(r.attendance_date)) {
                  existing.dates.push(r.attendance_date);
                }
                existing.count++;
                hostGpsMap.set(addr, existing);
              });

              // Also try to parse coordinates from host address strings
              const locationPoints: Array<{ label: string; lat: number; lon: number; count: number; dates: string[] }> = [];

              // Collect all dates across all locations for smart year formatting
              const allLocRawDates = Array.from(hostGpsMap.values()).flatMap(d => d.dates.map(ds => new Date(ds)));

              hostGpsMap.forEach((data, addr) => {
                let lat: number | null = null;
                let lon: number | null = null;

                // 1) Use host GPS from session_date_host (configured by teacher)
                const hostGps = hostGpsLookupRef.current.get(addr);
                if (hostGps) {
                  lat = hostGps.lat;
                  lon = hostGps.lon;
                } else if (data.lats.length > 0) {
                  // 2) Fallback: average student check-in GPS
                  lat = data.lats.reduce((s, v) => s + v, 0) / data.lats.length;
                  lon = data.lons.reduce((s, v) => s + v, 0) / data.lons.length;
                } else {
                  // 3) Try to parse from address string (if it contains coordinates)
                  const parsed = parseCoordinates(addr);
                  if (parsed) {
                    lat = parsed.lat;
                    lon = parsed.lon;
                  }
                }

                if (lat !== null && lon !== null) {
                  locationPoints.push({
                    label: addr.length > 40 ? addr.substring(0, 37) + '...' : addr,
                    lat,
                    lon,
                    count: data.dates.length,
                    dates: data.dates.sort().map(d => smartDateFormat(new Date(d), allLocRawDates)),
                  });
                }
              });

              if (locationPoints.length === 0) return null;

              // Calculate pairwise distances
              const distances: { from: string; to: string; distance: number }[] = [];
              for (let i = 0; i < locationPoints.length; i++) {
                for (let j = i + 1; j < locationPoints.length; j++) {
                  distances.push({
                    from: locationPoints[i].label,
                    to: locationPoints[j].label,
                    distance: calculateDistance(
                      locationPoints[i].lat, locationPoints[i].lon,
                      locationPoints[j].lat, locationPoints[j].lon
                    ),
                  });
                }
              }
              distances.sort((a, b) => a.distance - b.distance);

              const avgDist = distances.length > 0
                ? distances.reduce((s, d) => s + d.distance, 0) / distances.length
                : 0;
              const totalSessions = locationPoints.reduce((s, p) => s + p.count, 0);

              return (
                <>
                  <button
                    onClick={() => {
                      const el = document.getElementById('location-map-body');
                      if (el) el.classList.toggle('hidden');
                    }}
                    className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 border-b dark:border-gray-600 flex items-center justify-between hover:from-blue-100 hover:to-cyan-100 dark:hover:from-blue-900/40 dark:hover:to-cyan-900/40 transition-colors cursor-pointer"
                  >
                    <div>
                      <h2 className="text-base sm:text-lg font-semibold dark:text-white">{t.locationMap}</h2>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">{t.locationMapDesc}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Summary badges */}
                      <div className="hidden sm:flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-[10px] font-medium">
                          {locationPoints.length} {t.uniqueLocations}
                        </span>
                        <span className="px-2 py-0.5 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded text-[10px] font-medium">
                          {totalSessions} {t.totalSessions}
                        </span>
                        {avgDist > 0 && (
                          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded text-[10px] font-medium">
                            {t.avgDistance}: {formatDistance(avgDist)}
                          </span>
                        )}
                      </div>
                      <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  <div id="location-map-body">
                    {/* Location Map Embed â€” includes location selector, map, details, Google Maps & Directions links */}
                    <Suspense fallback={<div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-sm text-gray-500 dark:text-gray-400 text-center">Loading map...</div>}>
                      <LocationMap
                        locations={locationPoints}
                        showEmbed={true}
                        showDistanceMatrix={locationPoints.length > 1}
                        zoom={13}
                      />
                    </Suspense>

                      {/* Distance is shown inside LocationMap's built-in distance matrix toggle */}
                    </div>
                </>
              );
            })()}
          </div>
          )}

          {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
              CROSS-TAB HEATMAP TABLE â€” Student Ã— Date Matrix
              Color-coded cells showing attendance status
              â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
          {includedTables.crosstab && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/30 overflow-hidden">
            <button
              onClick={() => setCollapseCrosstabTable(prev => !prev)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-900/30 dark:to-fuchsia-900/30 border-b dark:border-gray-600 flex items-center justify-between hover:from-violet-100 hover:to-fuchsia-100 dark:hover:from-violet-900/40 dark:hover:to-fuchsia-900/40 transition-colors cursor-pointer"
            >
              <div>
                <h2 className="text-base sm:text-lg font-semibold dark:text-white">{t.crosstabTitle}</h2>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">{t.crosstabDesc}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {studentAnalytics.length} Ã— {matrixSelectedDates ? matrixSelectedDates.size : dateAnalytics.length}
                  {matrixSelectedDates && <span className="text-violet-500"> (of {dateAnalytics.length})</span>}
                </span>
                <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${collapseCrosstabTable ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {!collapseCrosstabTable && (
              <div className="overflow-x-auto overflow-y-auto max-h-[500px] sm:max-h-[700px]">
                {(() => {
                  // Build a lookup: studentId â†’ date â†’ record
                  const recordLookup = new Map<string, Map<string, AttendanceRecord>>();
                  const analyticsRecords = filteredRecords.filter(r =>
                    r.status !== 'not enrolled' && r.excuse_reason !== 'session not held'
                  );
                  analyticsRecords.forEach(r => {
                    if (!recordLookup.has(r.student_id)) recordLookup.set(r.student_id, new Map());
                    recordLookup.get(r.student_id)!.set(r.attendance_date, r);
                  });

                  const allSortedDates = [...dateAnalytics].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                  const sortedDates = matrixSelectedDates
                    ? allSortedDates.filter(d => matrixSelectedDates.has(d.date))
                    : allSortedDates;
                  const notHeldDateSet = new Set(
                    allSortedDates
                      .filter(d => d.isSessionNotHeld || d.hostAddress === 'SESSION_NOT_HELD')
                      .map(d => d.date)
                  );
                  const sortedStudents = sortStudentsForMatrix(studentAnalytics);

                  const handleMatrixSort = (field: MatrixSortField) => {
                    if (matrixSortField === field) {
                      setMatrixSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    } else {
                      setMatrixSortField(field);
                      setMatrixSortDir(field === 'name' ? 'asc' : 'desc');
                    }
                  };
                  const sortIndicator = (field: MatrixSortField) =>
                    matrixSortField === field ? (matrixSortDir === 'asc' ? ' â–²' : ' â–¼') : '';

                  if (sortedDates.length === 0 || sortedStudents.length === 0) {
                    return (
                      <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        <span className="text-2xl block mb-2">ðŸ—“ï¸</span>
                        <p className="text-sm">No data to display in the matrix.</p>
                      </div>
                    );
                  }

                  // Status cell rendering with creative color coding
                  const getCellStyle = (record: AttendanceRecord | undefined, dateStr: string): { bg: string; text: string; icon: string; title: string } => {
                    if (!record && notHeldDateSet.has(dateStr)) {
                      return { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300', icon: 'NH', title: 'Session Not Held' };
                    }
                    if (!record) return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-400 dark:text-gray-500', icon: 'â€”', title: 'No record' };
                    switch (record.status) {
                      case 'on time':
                        return { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-300', icon: 'âœ“', title: 'On Time' };
                      case 'late': {
                        const mins = record.late_minutes || 0;
                        if (mins <= 5) return { bg: 'bg-lime-100 dark:bg-lime-900/40', text: 'text-lime-700 dark:text-lime-300', icon: `${mins}â€²`, title: `Late ${mins} min (Minor)` };
                        if (mins <= 15) return { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', icon: `${mins}â€²`, title: `Late ${mins} min (Moderate)` };
                        if (mins <= 30) return { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', icon: `${mins}â€²`, title: `Late ${mins} min (Significant)` };
                        return { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', icon: `${mins}â€²`, title: `Late ${mins} min (Severe)` };
                      }
                      case 'absent':
                        return { bg: 'bg-red-200 dark:bg-red-900/60', text: 'text-red-800 dark:text-red-200', icon: 'âœ—', title: 'Absent' };
                      case 'excused':
                        return { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', icon: 'E', title: `Excused${record.excuse_reason ? `: ${record.excuse_reason}` : ''}` };
                      default:
                        return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-400 dark:text-gray-500', icon: '?', title: record.status };
                    }
                  };

                  return (
                    <>
                      {/* Sort controls bar */}
                      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-violet-50 dark:bg-violet-900/20 border-b dark:border-gray-700 text-[10px]">
                        <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 mr-1">Sort by:</span>
                        {([
                          ['name', 'ðŸ”¤ Name'],
                          ['score', 'ðŸ† Score'],
                          ['attendance', 'ðŸ“Š Attendance'],
                          ['present', 'âœ“ Present'],
                          ['late', 'â° Late'],
                          ['absent', 'âœ— Absent'],
                        ] as [MatrixSortField, string][]).map(([field, label]) => (
                          <button
                            key={field}
                            onClick={() => handleMatrixSort(field)}
                            className={`px-2 py-0.5 rounded border transition-colors ${
                              matrixSortField === field
                                ? 'bg-violet-600 text-white border-violet-600 font-bold'
                                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                            }`}
                          >
                            {label}{sortIndicator(field)}
                          </button>
                        ))}
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 text-[10px]">
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-300 dark:border-emerald-700"></span>On Time</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-lime-100 dark:bg-lime-900/40 border border-lime-300 dark:border-lime-700"></span>Late â‰¤5m</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700"></span>Late 6-15m</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700"></span>Late 16-30m</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700"></span>Late 30m+</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-red-200 dark:bg-red-900/60 border border-red-400 dark:border-red-600"></span>Absent</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700"></span>Excused</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-purple-100 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-700"></span>Session Not Held</span>
                        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><span className="w-3 h-3 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600"></span>No Record</span>
                      </div>
                      <table className="min-w-full border-collapse">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <th
                              className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-r dark:border-gray-600 min-w-[140px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 select-none"
                              onClick={() => handleMatrixSort('name')}
                              title="Sort by student name"
                            >
                              Student{sortIndicator('name')}
                            </th>
                            {sortedDates.map(d => {
                              const dateObj = new Date(d.date);
                              return (
                                <th key={d.date} className="px-1 py-2 text-center text-[9px] font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-600 min-w-[40px] max-w-[48px]" title={format(dateObj, 'EEEE, MMM dd, yyyy')}>
                                  <div>{format(dateObj, 'dd')}</div>
                                  <div className="text-[8px] text-gray-400 dark:text-gray-500">{format(dateObj, 'MMM')}</div>
                                </th>
                              );
                            })}
                            <th
                              className="px-3 py-2 text-center text-xs font-medium text-gray-600 dark:text-gray-300 border-b border-l dark:border-gray-600 min-w-[50px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 select-none"
                              onClick={() => handleMatrixSort('attendance')}
                              title="Sort by attendance rate"
                            >
                              Rate{sortIndicator('attendance')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedStudents.map((student) => {
                            const studentMap = recordLookup.get(student.student_id);
                            return (
                              <tr key={student.student_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                                <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-800 dark:text-gray-200 border-b border-r dark:border-gray-700 truncate max-w-[160px]" title={student.student_name}>
                                  {student.student_name}
                                </td>
                                {sortedDates.map(d => {
                                  const record = studentMap?.get(d.date);
                                  const cellStyle = getCellStyle(record, d.date);
                                  return (
                                    <td
                                      key={d.date}
                                      className={`px-0 py-0 text-center border-b dark:border-gray-700`}
                                      title={cellStyle.title}
                                    >
                                      <div className={`${cellStyle.bg} ${cellStyle.text} w-full h-full px-1 py-1.5 text-[10px] font-bold leading-none`}>
                                        {cellStyle.icon}
                                      </div>
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-1.5 text-center text-xs font-semibold border-b border-l dark:border-gray-700">
                                  <span className={`${student.attendanceRate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : student.attendanceRate >= 70 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {student.attendanceRate}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          WEIGHTED SCORE EXPLAINER â€” Bilingual, per-student breakdown
          â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {showAnalytics && studentAnalytics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/30 overflow-hidden border border-indigo-100 dark:border-indigo-900/40">
          {/* Header */}
          <button
            onClick={() => setCollapseScoreExplainer(prev => !prev)}
            className="w-full px-5 sm:px-6 py-4 bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-900/30 dark:via-purple-900/30 dark:to-pink-900/30 border-b border-indigo-100 dark:border-indigo-800 flex items-center justify-between hover:from-indigo-100 hover:via-purple-100 hover:to-pink-100 dark:hover:from-indigo-900/40 dark:hover:via-purple-900/40 dark:hover:to-pink-900/40 transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                <span className="text-white text-lg">ðŸ§®</span>
              </div>
              <div className="text-left">
                <h2 className="text-base sm:text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                  Score Breakdown / ØªÙØµÙŠÙ„ Ø§Ù„Ø¯Ø±Ø¬Ø§Øª
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Understand how each student's weighted score is calculated â€” Ø§ÙÙ‡Ù… ÙƒÙŠÙ ÙŠØªÙ… Ø­Ø³Ø§Ø¨ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…Ø±Ø¬Ø­Ø© Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨
                </p>
              </div>
            </div>
            <svg className={`w-5 h-5 text-indigo-500 dark:text-indigo-400 transition-transform duration-300 ${collapseScoreExplainer ? '-rotate-90' : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {!collapseScoreExplainer && (
            <div className="p-5 sm:p-6 space-y-6">

              {/* â”€â”€ Formula Overview â”€â”€ */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* English */}
                {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                <div className="relative overflow-hidden rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-5">
                  <div className="absolute top-0 right-0 w-24 h-24 opacity-5 text-8xl">ðŸ“</div>
                  <h3 className="font-bold text-blue-800 dark:text-blue-300 text-sm uppercase tracking-wider mb-3">ðŸ‡¬ðŸ‡§ How Your Score Works</h3>
                  <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                    <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-3 font-mono text-xs border border-blue-100 dark:border-blue-800">
                      <div className="text-blue-600 dark:text-blue-400 font-bold mb-1">Raw Score =</div>
                      <div className="pl-4 space-y-0.5">
                        <div><span className="text-emerald-600 dark:text-emerald-400 font-bold">{loadConfigSync().weight_quality}%</span> Ã— Quality Rate <span className="text-gray-400">(on-time = full, late = partial credit)</span></div>
                        <div><span className="text-blue-600 dark:text-blue-400 font-bold">{loadConfigSync().weight_attendance}%</span> Ã— Attendance Rate <span className="text-gray-400">(showed up at all)</span></div>
                        <div><span className="text-amber-600 dark:text-amber-400 font-bold">{loadConfigSync().weight_punctuality}%</span> Ã— Punctuality <span className="text-gray-400">(on-time Ã· total present)</span></div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-blue-100 dark:border-blue-800">
                        {(() => {
                          const _cov = loadConfigSync();
                          if (!_cov.coverage_enabled || _cov.coverage_method === 'none') {
                            return <><span className="text-indigo-600 dark:text-indigo-400 font-bold">Final Score</span> = Raw Score <span className="text-gray-400">(coverage disabled)</span></>;
                          }
                          const methodLabel = _cov.coverage_method === 'sqrt' ? 'âˆš' : _cov.coverage_method === 'log' ? 'log' : '';
                          return <><span className="text-indigo-600 dark:text-indigo-400 font-bold">Final Score</span> = Raw Score Ã— {methodLabel}(Your Days Ã· Total Sessions)</>;
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Arabic */}
                {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                <div dir="rtl" className="relative overflow-hidden rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 p-5">
                  <div className="absolute top-0 left-0 w-24 h-24 opacity-5 text-8xl">ðŸ“</div>
                  <h3 className="font-bold text-emerald-800 dark:text-emerald-300 text-sm uppercase tracking-wider mb-3">ðŸ‡¸ðŸ‡¦ ÙƒÙŠÙ ÙŠØªÙ… Ø­Ø³Ø§Ø¨ Ø¯Ø±Ø¬ØªÙƒ</h3>
                  <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                    <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-3 font-mono text-xs border border-emerald-100 dark:border-emerald-800">
                      <div className="text-emerald-600 dark:text-emerald-400 font-bold mb-1">Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø®Ø§Ù… =</div>
                      <div className="pr-4 space-y-0.5">
                        <div><span className="text-emerald-600 dark:text-emerald-400 font-bold">{(() => { const c = loadConfigSync(); const arabicNum = String(c.weight_quality).replace(/[0-9]/g, d => 'Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©'[parseInt(d)]); return arabicNum; })()}Ùª</span> Ã— Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø¬ÙˆØ¯Ø© <span className="text-gray-400">(Ø­Ø¶ÙˆØ± Ø¨Ø§Ù„ÙˆÙ‚Øª = ÙƒØ§Ù…Ù„ØŒ Ù…ØªØ£Ø®Ø± = Ø±ØµÙŠØ¯ Ø¬Ø²Ø¦ÙŠ)</span></div>
                        <div><span className="text-blue-600 dark:text-blue-400 font-bold">{(() => { const c = loadConfigSync(); const arabicNum = String(c.weight_attendance).replace(/[0-9]/g, d => 'Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©'[parseInt(d)]); return arabicNum; })()}Ùª</span> Ã— Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± <span className="text-gray-400">(Ø­Ø¶Ø±Øª Ø£ØµÙ„Ø§Ù‹)</span></div>
                        <div><span className="text-amber-600 dark:text-amber-400 font-bold">{(() => { const c = loadConfigSync(); const arabicNum = String(c.weight_punctuality).replace(/[0-9]/g, d => 'Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©'[parseInt(d)]); return arabicNum; })()}Ùª</span> Ã— Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª <span className="text-gray-400">(Ø¨Ø§Ù„ÙˆÙ‚Øª Ã· Ù…Ø¬Ù…ÙˆØ¹ Ø§Ù„Ø­Ø¶ÙˆØ±)</span></div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-emerald-100 dark:border-emerald-800">
                        {(() => {
                          const _cov = loadConfigSync();
                          if (!_cov.coverage_enabled || _cov.coverage_method === 'none') {
                            return <><span className="text-indigo-600 dark:text-indigo-400 font-bold">Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ©</span> = Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø®Ø§Ù… <span className="text-gray-400">(Ø§Ù„ØªØºØ·ÙŠØ© Ù…Ø¹Ø·Ù„Ø©)</span></>;
                          }
                          const methodLabel = _cov.coverage_method === 'sqrt' ? 'âˆš' : _cov.coverage_method === 'log' ? 'log' : '';
                          return <><span className="text-indigo-600 dark:text-indigo-400 font-bold">Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ©</span> = Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ø®Ø§Ù… Ã— {methodLabel}(Ø£ÙŠØ§Ù…Ùƒ Ã· Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¬Ù„Ø³Ø§Øª)</>;
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>

              {/* Toggle for detailed explanations */}
              <button
                type="button"
                onClick={() => setShowScoreDetails(prev => !prev)}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform duration-200 ${showScoreDetails ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {showScoreDetails ? 'Hide Detailed Explanations / Ø¥Ø®ÙØ§Ø¡ Ø§Ù„ØªÙØ§ØµÙŠÙ„' : 'ðŸ“– Show Detailed Explanations / Ø¹Ø±Ø¶ Ø´Ø±Ø­ Ù…ÙØµÙ„'}
              </button>

              {showScoreDetails && (
              <>
              {/* â”€â”€ Deep Dive: Component Explanations â”€â”€ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* === QUALITY RATE (50%) === */}
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-green-50/50 dark:from-emerald-900/10 dark:to-green-900/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">ðŸ’Ž</span>
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-300 text-sm">
                      {scoreExplainerLang === 'ar' ? `Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø¬ÙˆØ¯Ø© (${loadConfigSync().weight_quality}Ùª)` : scoreExplainerLang === 'both' ? `Quality Rate / Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø¬ÙˆØ¯Ø© (${loadConfigSync().weight_quality}%)` : `Quality Rate (${loadConfigSync().weight_quality}%)`}
                    </h4>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                    <div className="space-y-2">
                      <p>Not all "present" days are equal. <strong className="text-gray-800 dark:text-gray-200">On-time = 100% credit, but late arrivals get partial credit</strong> based on how late they were.</p>
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-emerald-100 dark:border-emerald-800 font-mono text-[11px]">
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold mb-1">Late Credit = e<sup>âˆ’(minutes / {loadConfigSync().late_decay_constant})</sup></div>
                        <div className="text-gray-500 dark:text-gray-400">This is a smooth exponential decay curve â€” no sudden drops.</div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {(() => {
                          const _dc = loadConfigSync();
                          return [5, 10, 15, 20, 30, 45, 60, 90].map(min => {
                            const pct = Math.round(Math.max(_dc.late_minimum_credit, Math.exp(-min / _dc.late_decay_constant)) * 100);
                            const clr = pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-yellow-400' : pct >= 30 ? 'bg-orange-400' : 'bg-red-400';
                            return { min, pct, clr };
                          });
                        })().map(r => (
                          <div key={r.min} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 w-8 text-right font-mono">{r.min}m</span>
                            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                              <div className={`h-full rounded-full ${r.clr}`} style={{ width: `${r.pct}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 w-8">{r.pct}%</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Formula: Quality = (OnTimeDays + Î£ late credits) / EffectiveDays Ã— 100. If late_minutes is unknown, {Math.round(loadConfigSync().late_null_estimate * 100)}% credit is used. Minimum credit is {Math.round(loadConfigSync().late_minimum_credit * 100)}% â€” you always get something for showing up.</p>
                    </div>
                    )}
                    {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                    <div dir="rtl" className="space-y-2">
                      <p>Ù„ÙŠØ³Øª ÙƒÙ„ Ø£ÙŠØ§Ù… Ø§Ù„Ø­Ø¶ÙˆØ± Ù…ØªØ³Ø§ÙˆÙŠØ©. <strong className="text-gray-800 dark:text-gray-200">Ø¨Ø§Ù„ÙˆÙ‚Øª = Ø±ØµÙŠØ¯ ÙƒØ§Ù…Ù„ Ù¡Ù Ù ÙªØŒ Ù„ÙƒÙ† Ø§Ù„Ù…ØªØ£Ø®Ø± ÙŠØ­ØµÙ„ Ø¹Ù„Ù‰ Ø±ØµÙŠØ¯ Ø¬Ø²Ø¦ÙŠ</strong> Ø­Ø³Ø¨ Ù…Ø¯Ø© Ø§Ù„ØªØ£Ø®Ø±.</p>
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-emerald-100 dark:border-emerald-800 font-mono text-[11px]">
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold mb-1">Ø±ØµÙŠØ¯ Ø§Ù„ØªØ£Ø®Ø± = e<sup>âˆ’(Ø§Ù„Ø¯Ù‚Ø§Ø¦Ù‚ / {loadConfigSync().late_decay_constant})</sup></div>
                        <div className="text-gray-500 dark:text-gray-400">Ù‡Ø°Ø§ Ù…Ù†Ø­Ù†Ù‰ ØªÙ†Ø§Ù‚Øµ Ø§Ù†Ø³ÙŠØ§Ø¨ÙŠ â€” Ø¨Ù„Ø§ Ù‚ÙØ²Ø§Øª Ù…ÙØ§Ø¬Ø¦Ø©.</div>
                      </div>
                      {(() => {
                        const _dc2 = loadConfigSync();
                        const pcts = [5, 15, 30, 60].map(m => Math.round(Math.max(_dc2.late_minimum_credit, Math.exp(-m / _dc2.late_decay_constant)) * 100));
                        return <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Ø§Ù„Ø­Ø³Ø§Ø¨: Ø§Ù„Ø¬ÙˆØ¯Ø© = (Ø£ÙŠØ§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª + Ù…Ø¬Ù…ÙˆØ¹ Ø£Ø±ØµØ¯Ø© Ø§Ù„ØªØ£Ø®Ø±) / Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„ÙØ¹Ù„ÙŠØ© Ã— Ù¡Ù Ù . ØªØ£Ø®Ø± Ù¥ Ø¯Ù‚Ø§Ø¦Ù‚ = {pcts[0]}ÙªØŒ Ù¡Ù¥ Ø¯Ù‚ÙŠÙ‚Ø© = {pcts[1]}ÙªØŒ Ù£Ù  Ø¯Ù‚ÙŠÙ‚Ø© = {pcts[2]}ÙªØŒ Ù¦Ù  Ø¯Ù‚ÙŠÙ‚Ø© = {pcts[3]}Ùª. Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰ {Math.round(_dc2.late_minimum_credit * 100)}Ùª Ø¯Ø§Ø¦Ù…Ø§Ù‹.</p>;
                      })()}
                    </div>
                    )}
                  </div>
                </div>

                {/* === CONSISTENCY INDEX (Informational â€” not part of score) === */}
                <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50/50 to-indigo-50/50 dark:from-purple-900/10 dark:to-indigo-900/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">ðŸ“Š</span>
                    <h4 className="font-bold text-purple-800 dark:text-purple-300 text-sm">
                      {scoreExplainerLang === 'ar' ? 'Ù…Ø¤Ø´Ø± Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù… (Ù…Ø¹Ù„ÙˆÙ…Ø§ØªÙŠ ÙÙ‚Ø·)' : scoreExplainerLang === 'both' ? 'Consistency Index (Info Only) / Ù…Ø¤Ø´Ø± Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…' : 'Consistency Index (Info Only)'}
                    </h4>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                    <div className="space-y-2">
                      <p><strong className="text-gray-800 dark:text-gray-200">This is NOT part of the weighted score.</strong> It's an informational metric that measures how your absences are distributed â€” scattered single absences are better than big blocks of missing days.</p>
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-purple-100 dark:border-purple-800 text-[11px] space-y-1.5">
                        <div className="font-bold text-purple-600 dark:text-purple-400">Two Components (averaged):</div>
                        <div className="pl-2 space-y-1">
                          <div><span className="text-purple-500 font-bold">1. Scatter Ratio</span> â€” Are absences fragmented into many small gaps, or clumped together?</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 pl-3">Best: each absence is isolated (ratio = 1). Worst: one big block (ratio â‰ˆ 0).</div>
                          <div><span className="text-purple-500 font-bold">2. Streak Penalty</span> â€” How long is your longest consecutive absence block?</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 pl-3">Missing 3 days in a row hurts more than missing 3 separate days.</div>
                        </div>
                        <div className="border-t border-purple-100 dark:border-purple-800 pt-1.5 mt-1">
                          <div><span className="text-purple-500 font-bold">Dampening:</span> With only 1-2 absences, clustering matters less â†’ score trends toward 100%.</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">dampening = min(absences / 5, 1). Fewer absences = less penalty.</div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Examples (8-day patterns):</div>
                        {[
                          { pattern: 'âœ…âŒâœ…âŒâœ…âŒâœ…âŒ', score: 'â‰ˆ 100%', desc: 'Absences perfectly scattered', color: 'text-emerald-600 dark:text-emerald-400' },
                          { pattern: 'âœ…âœ…âŒâœ…âœ…âŒâœ…âœ…', score: 'â‰ˆ 100%', desc: 'Single absences spread out', color: 'text-emerald-600 dark:text-emerald-400' },
                          { pattern: 'âœ…âœ…âœ…âŒâŒâœ…âœ…âœ…', score: 'â‰ˆ 72%', desc: '2-day block in the middle', color: 'text-amber-600 dark:text-amber-400' },
                          { pattern: 'âœ…âœ…âœ…âœ…âŒâŒâŒâŒ', score: 'â‰ˆ 20%', desc: 'All absences clustered at end', color: 'text-red-600 dark:text-red-400' },
                        ].map((ex, i) => (
                          <div key={i} className="flex items-center gap-2 bg-white/40 dark:bg-gray-800/40 rounded px-2 py-1">
                            <span className="font-mono text-[10px] tracking-widest">{ex.pattern}</span>
                            <span className={`font-bold text-[11px] ${ex.color}`}>{ex.score}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 hidden sm:inline">â€” {ex.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    )}
                    {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                    <div dir="rtl" className="space-y-2">
                      <p><strong className="text-gray-800 dark:text-gray-200">Ù‡Ø°Ø§ Ù„ÙŠØ³ Ø¬Ø²Ø¡Ø§Ù‹ Ù…Ù† Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„Ù…Ø±Ø¬Ø­Ø©.</strong> Ù‡Ùˆ Ù…Ù‚ÙŠØ§Ø³ Ù…Ø¹Ù„ÙˆÙ…Ø§ØªÙŠ ÙŠÙ‚ÙŠØ³ ÙƒÙŠÙ ØªÙˆØ²Ù‘Ø¹ ØºÙŠØ§Ø¨Ùƒ â€” ØºÙŠØ§Ø¨ ÙŠÙˆÙ… Ù‡Ù†Ø§ ÙˆÙŠÙˆÙ… Ù‡Ù†Ø§Ùƒ Ø£ÙØ¶Ù„ Ù…Ù† ØºÙŠØ§Ø¨ Ø£ÙŠØ§Ù… Ù…ØªØªØ§Ù„ÙŠØ©.</p>
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-purple-100 dark:border-purple-800 text-[11px] space-y-1.5">
                        <div className="font-bold text-purple-600 dark:text-purple-400">Ù…ÙƒÙˆÙ‘Ù†Ø§Ù† (ÙŠØªÙ… Ø­Ø³Ø§Ø¨ Ù…ØªÙˆØ³Ø·Ù‡Ù…Ø§):</div>
                        <div className="pr-2 space-y-1">
                          <div><span className="text-purple-500 font-bold">Ù¡. Ù†Ø³Ø¨Ø© Ø§Ù„ØªØ´ØªØª</span> â€” Ù‡Ù„ Ø§Ù„ØºÙŠØ§Ø¨ Ù…Ø¨Ø¹Ø«Ø± ÙƒØ£ÙŠØ§Ù… ÙØ±Ø¯ÙŠØ© Ø£Ù… Ù…ØªÙƒØªÙ„ØŸ</div>
                          <div><span className="text-purple-500 font-bold">Ù¢. Ø¹Ù‚ÙˆØ¨Ø© Ø§Ù„ØªØªØ§Ø¨Ø¹</span> â€” Ù…Ø§ Ø£Ø·ÙˆÙ„ Ø³Ù„Ø³Ù„Ø© ØºÙŠØ§Ø¨ Ù…ØªØªØ§Ù„ÙŠØ© Ø¹Ù†Ø¯ÙƒØŸ</div>
                        </div>
                        <div className="border-t border-purple-100 dark:border-purple-800 pt-1.5 mt-1">
                          <div><span className="text-purple-500 font-bold">Ø§Ù„ØªØ®ÙÙŠÙ:</span> Ø¥Ø°Ø§ ØºØ¨Øª ÙŠÙˆÙ… Ø£Ùˆ ÙŠÙˆÙ…ÙŠÙ† ÙÙ‚Ø·ØŒ Ø§Ù„ØªÙƒØªÙ„ Ù„Ø§ ÙŠÙ‡Ù… ÙƒØ«ÙŠØ±Ø§Ù‹ â†’ Ø§Ù„Ø¯Ø±Ø¬Ø© ØªÙ‚ØªØ±Ø¨ Ù…Ù† Ù¡Ù Ù Ùª.</div>
                        </div>
                      </div>
                      <div className="space-y-1 text-[10px]">
                        <div>âœ…âŒâœ…âŒâœ…âŒâœ…âŒ â†’ <span className="text-emerald-600 dark:text-emerald-400 font-bold">Ù¡Ù Ù Ùª</span> (ØºÙŠØ§Ø¨ Ù…Ø¨Ø¹Ø«Ø±)</div>
                        <div>âœ…âœ…âœ…âœ…âŒâŒâŒâŒ â†’ <span className="text-red-600 dark:text-red-400 font-bold">Ù¢Ù Ùª</span> (ØºÙŠØ§Ø¨ Ù…ØªÙƒØªÙ„)</div>
                      </div>
                    </div>
                    )}
                  </div>
                </div>

                {/* === ATTENDANCE RATE (25%) + PUNCTUALITY (10%) === */}
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/50 to-sky-50/50 dark:from-blue-900/10 dark:to-sky-900/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">ðŸ“…</span>
                    <h4 className="font-bold text-blue-800 dark:text-blue-300 text-sm">
                      {scoreExplainerLang === 'ar' ? `Ø§Ù„Ø­Ø¶ÙˆØ± (${loadConfigSync().weight_attendance}Ùª) + Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª (${loadConfigSync().weight_punctuality}Ùª)` : scoreExplainerLang === 'both' ? `Attendance (${loadConfigSync().weight_attendance}%) + Punctuality (${loadConfigSync().weight_punctuality}%) / Ø§Ù„Ø­Ø¶ÙˆØ± + Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…` : `Attendance (${loadConfigSync().weight_attendance}%) + Punctuality (${loadConfigSync().weight_punctuality}%)`}
                    </h4>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                    <div className="space-y-2">
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-blue-100 dark:border-blue-800 text-[11px] space-y-2">
                        <div>
                          <span className="font-bold text-blue-600 dark:text-blue-400">Attendance Rate</span> = (On Time + Late) / Effective Days Ã— 100
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Simple binary: Were you there? Yes or no. Late counts as present. Excused days are excluded from the denominator.</div>
                        </div>
                        <div className="border-t border-blue-100 dark:border-blue-800 pt-2">
                          <span className="font-bold text-amber-600 dark:text-amber-400">Punctuality</span> = On Time Days / (On Time + Late) Ã— 100
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Of the days you showed up, what % were you on time? Someone always late gets low punctuality even with 100% attendance.</div>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Why both? A student with 90% attendance but always late should score differently than one with 90% attendance always on time. Attendance rewards showing up; Punctuality rewards being prompt.</p>
                    </div>
                    )}
                    {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                    <div dir="rtl" className="space-y-2">
                      <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-blue-100 dark:border-blue-800 text-[11px] space-y-2">
                        <div>
                          <span className="font-bold text-blue-600 dark:text-blue-400">Ù…Ø¹Ø¯Ù„ Ø§Ù„Ø­Ø¶ÙˆØ±</span> = (Ø¨Ø§Ù„ÙˆÙ‚Øª + Ù…ØªØ£Ø®Ø±) / Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„ÙØ¹Ù„ÙŠØ© Ã— Ù¡Ù Ù 
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Ø¨Ø¨Ø³Ø§Ø·Ø©: Ù‡Ù„ Ø­Ø¶Ø±ØªØŸ Ù†Ø¹Ù… Ø£Ùˆ Ù„Ø§. Ø§Ù„Ù…ØªØ£Ø®Ø± ÙŠÙØ­Ø³Ø¨ Ø­Ø§Ø¶Ø±Ø§Ù‹. Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„Ù…Ø¹Ø°ÙˆØ±Ø© ØªÙØ³ØªØ¨Ø¹Ø¯.</div>
                        </div>
                        <div className="border-t border-blue-100 dark:border-blue-800 pt-2">
                          <span className="font-bold text-amber-600 dark:text-amber-400">Ø§Ù„Ø§Ù„ØªØ²Ø§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª</span> = Ø£ÙŠØ§Ù… Ø¨Ø§Ù„ÙˆÙ‚Øª / (Ø¨Ø§Ù„ÙˆÙ‚Øª + Ù…ØªØ£Ø®Ø±) Ã— Ù¡Ù Ù 
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Ù…Ù† Ø§Ù„Ø£ÙŠØ§Ù… Ø§Ù„ØªÙŠ Ø­Ø¶Ø±ØªÙ‡Ø§ØŒ ÙƒÙ… Ù†Ø³Ø¨Ø© Ø§Ù„Ù„ÙŠ ÙƒÙ†Øª Ø¨Ø§Ù„ÙˆÙ‚Øª ÙÙŠÙ‡Ø§ØŸ</div>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Ø§Ù„Ø­Ø¶ÙˆØ± ÙŠÙƒØ§ÙØ¦ Ù…Ù† ÙŠØ£ØªÙŠØŒ ÙˆØ§Ù„Ø§Ù„ØªØ²Ø§Ù… ÙŠÙƒØ§ÙØ¦ Ù…Ù† ÙŠØ£ØªÙŠ Ø¨Ø§Ù„ÙˆÙ‚Øª.</p>
                    </div>
                    )}
                  </div>
                </div>

                {/* === COVERAGE FACTOR === */}
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/50 to-violet-50/50 dark:from-indigo-900/10 dark:to-violet-900/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">ðŸ“</span>
                    <h4 className="font-bold text-indigo-800 dark:text-indigo-300 text-sm">
                      {scoreExplainerLang === 'ar' ? 'Ù…Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ© (Ø§Ù„Ù…Ø¶Ø§Ø¹Ù Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ)' : scoreExplainerLang === 'both' ? 'Coverage Factor / Ù…Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ©' : 'Coverage Factor (Final Multiplier)'}
                    </h4>
                  </div>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                    <div className="space-y-2">
                      {(() => {
                        const _cc = loadConfigSync();
                        if (!_cc.coverage_enabled || _cc.coverage_method === 'none') {
                          return <p className="text-yellow-600 dark:text-yellow-400 font-bold">Coverage Factor is currently DISABLED in your scoring config. All students get coverage = 1.0.</p>;
                        }
                        const methodName = _cc.coverage_method === 'sqrt' ? 'Square root' : _cc.coverage_method === 'log' ? 'Logarithmic' : 'Linear';
                        const formulaSymbol = _cc.coverage_method === 'sqrt' ? 'âˆš' : _cc.coverage_method === 'log' ? 'log(1 + rÂ·(e-1))' : '';
                        const totalSessions = 27;
                        const computeFactor = (days: number) => {
                          const ratio = days / totalSessions;
                          let f: number;
                          if (_cc.coverage_method === 'sqrt') f = Math.sqrt(ratio);
                          else if (_cc.coverage_method === 'log') f = Math.log(1 + ratio * (Math.E - 1));
                          else f = ratio;
                          return Math.max(_cc.coverage_minimum, Math.min(f, 1));
                        };
                        const exampleDays = [1, 3, 8, 15, 22, totalSessions];
                        return (
                          <>
                            <p><strong className="text-gray-800 dark:text-gray-200">Prevents inflated scores for students with few days.</strong> A student who attended 2/2 sessions with 100% quality shouldn't outrank someone with 95% quality over 25 sessions.</p>
                            <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-indigo-100 dark:border-indigo-800 font-mono text-[11px]">
                              <div className="text-indigo-600 dark:text-indigo-400 font-bold">Coverage = {formulaSymbol}(EffectiveDays / TotalSessions)</div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{methodName} scaling. Min: {_cc.coverage_minimum}. Capped at 1.0.</div>
                            </div>
                            <div className="space-y-0.5">
                              <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">With {totalSessions} total sessions:</div>
                              {exampleDays.map(days => {
                                const factor = computeFactor(days);
                                const pct = Math.round(factor * 100);
                                const color = pct < 40 ? 'text-red-600 dark:text-red-400' : pct < 70 ? 'text-orange-600 dark:text-orange-400' : pct < 85 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
                                const barColor = pct < 40 ? 'bg-red-400' : pct < 70 ? 'bg-orange-400' : pct < 85 ? 'bg-amber-400' : 'bg-emerald-400';
                                return (
                                  <div key={days} className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 w-8 text-right font-mono">{days}d</span>
                                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className={`text-[10px] font-bold w-8 ${color}`}>{factor.toFixed(2)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    )}
                    {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                    <div dir="rtl" className="space-y-2">
                      {(() => {
                        const _cc2 = loadConfigSync();
                        if (!_cc2.coverage_enabled || _cc2.coverage_method === 'none') {
                          return <p className="text-yellow-600 dark:text-yellow-400 font-bold">Ù…Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ© Ù…Ø¹Ø·Ù„ Ø­Ø§Ù„ÙŠØ§Ù‹. Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨ ÙŠØ­ØµÙ„ÙˆÙ† Ø¹Ù„Ù‰ ØªØºØ·ÙŠØ© = Ù¡.Ù </p>;
                        }
                        const methodName = _cc2.coverage_method === 'sqrt' ? 'Ø¬Ø°Ø± ØªØ±Ø¨ÙŠØ¹ÙŠ' : _cc2.coverage_method === 'log' ? 'Ù„ÙˆØºØ§Ø±ÙŠØªÙ…ÙŠ' : 'Ø®Ø·ÙŠ';
                        const formulaSymbol = _cc2.coverage_method === 'sqrt' ? 'âˆš' : _cc2.coverage_method === 'log' ? 'log' : '';
                        return (
                          <>
                            <p><strong className="text-gray-800 dark:text-gray-200">ÙŠÙ…Ù†Ø¹ ØªØ¶Ø®Ù… Ø§Ù„Ø¯Ø±Ø¬Ø§Øª Ù„Ù…Ù† Ø­Ø¶Ø± Ø£ÙŠØ§Ù… Ù‚Ù„ÙŠÙ„Ø©.</strong></p>
                            <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-2.5 border border-indigo-100 dark:border-indigo-800 font-mono text-[11px]">
                              <div className="text-indigo-600 dark:text-indigo-400 font-bold">Ø§Ù„ØªØºØ·ÙŠØ© = {formulaSymbol}(Ø£ÙŠØ§Ù…Ùƒ Ø§Ù„ÙØ¹Ù„ÙŠØ© / Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¬Ù„Ø³Ø§Øª)</div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Ø·Ø±ÙŠÙ‚Ø©: {methodName}. Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰: {_cc2.coverage_minimum}. Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰ Ù¡.Ù </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Late Credit Quick Reference - dynamically computed */}
              <div className="flex gap-2 flex-wrap justify-center">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs">âœ¨ On time = 100% credit</span>
                {(() => {
                  const _qr = loadConfigSync();
                  const calc = (m: number) => Math.round(Math.max(_qr.late_minimum_credit, Math.exp(-m / _qr.late_decay_constant)) * 100);
                  return (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs">â° 15 min late â‰ˆ {calc(15)}%</span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs">ðŸ• 30 min late â‰ˆ {calc(30)}%</span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs">ðŸ“‰ 60 min late â‰ˆ {calc(60)}%</span>
                    </>
                  );
                })()}
              </div>
              </>
              )}

              {/* â”€â”€ Controls â”€â”€ */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Language / Ø§Ù„Ù„ØºØ©:</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                    {(['both', 'en', 'ar'] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setScoreExplainerLang(lang)}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                          scoreExplainerLang === lang
                            ? 'bg-indigo-500 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        {lang === 'both' ? 'ðŸŒ Both' : lang === 'en' ? 'ðŸ‡¬ðŸ‡§ EN' : 'ðŸ‡¸ðŸ‡¦ AR'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Student / Ø§Ù„Ø·Ø§Ù„Ø¨:</label>
                  <select
                    value={scoreExplainerStudent}
                    onChange={(e) => setScoreExplainerStudent(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700"
                  >
                    <option value="">All Students â€” Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨</option>
                    {studentAnalytics
                      .sort((a, b) => b.weightedScore - a.weightedScore)
                      .map((s) => (
                        <option key={s.student_id} value={s.student_id}>
                          {s.student_name} â€” {s.weightedScore.toFixed(1)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* â”€â”€ Per-Student Score Cards â”€â”€ */}
              <div className="space-y-3">
                {studentAnalytics
                  .filter((s) => !scoreExplainerStudent || s.student_id === scoreExplainerStudent)
                  .sort((a, b) => b.weightedScore - a.weightedScore)
                  .slice(0, scoreExplainerStudent ? 1 : 50)
                  .map((student, idx) => {
                    const totalPres = student.presentCount + student.lateCount;
                    const punctRate = totalPres > 0 ? (student.presentCount / totalPres) * 100 : 0;
                    const consistencyPct = student.consistencyIndex * 100;
                    const qualityPct = student.qualityAdjustedRate;
                    const attendancePct = student.attendanceRate;

                    // Calculate individual component contributions using dynamic config
                    const _sc = loadConfigSync();
                    const qualityContrib = (_sc.weight_quality / 100) * qualityPct;
                    const attendanceContrib = (_sc.weight_attendance / 100) * attendancePct;
                    const punctualityContrib = (_sc.weight_punctuality / 100) * punctRate;
                    const rawScore = qualityContrib + attendanceContrib + punctualityContrib;
                    const coverageF = student.coverageFactor || 0;
                    const finalScore = student.weightedScore;

                    // Score grade
                    const grade = finalScore >= 90 ? { label: 'Excellent / Ù…Ù…ØªØ§Ø²', emoji: 'ðŸ†', color: 'emerald' }
                      : finalScore >= 75 ? { label: 'Very Good / Ø¬ÙŠØ¯ Ø¬Ø¯Ø§Ù‹', emoji: 'ðŸŒŸ', color: 'blue' }
                      : finalScore >= 60 ? { label: 'Good / Ø¬ÙŠØ¯', emoji: 'ðŸ‘', color: 'amber' }
                      : finalScore >= 40 ? { label: 'Needs Improvement / ÙŠØ­ØªØ§Ø¬ ØªØ­Ø³ÙŠÙ†', emoji: 'âš ï¸', color: 'orange' }
                      : { label: 'Critical / Ø­Ø±Ø¬', emoji: 'ðŸš¨', color: 'red' };

                    // Find weakest area
                    const components = [
                      { name: 'Quality', nameAr: 'Ø§Ù„Ø¬ÙˆØ¯Ø©', value: qualityPct, weight: _sc.weight_quality },
                      { name: 'Attendance', nameAr: 'Ø§Ù„Ø­Ø¶ÙˆØ±', value: attendancePct, weight: _sc.weight_attendance },
                      { name: 'Punctuality', nameAr: 'Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…', value: punctRate, weight: _sc.weight_punctuality },
                    ];
                    const weakest = [...components].sort((a, b) => a.value - b.value)[0];
                    const strongest = [...components].sort((a, b) => b.value - a.value)[0];

                    return (
                      <div
                        key={student.student_id}
                        className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden hover:shadow-md transition-all duration-200"
                      >
                        {/* Student header bar */}
                        <div className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r ${
                          grade.color === 'emerald' ? 'from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20' :
                          grade.color === 'blue' ? 'from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20' :
                          grade.color === 'amber' ? 'from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20' :
                          grade.color === 'orange' ? 'from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20' :
                          'from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20'
                        }`}>
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{grade.emoji}</span>
                            <div>
                              <div className="font-bold text-gray-800 dark:text-white text-sm">{student.student_name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{grade.label}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                                {finalScore.toFixed(1)}
                              </div>
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">/ 100</div>
                            </div>
                            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">#{idx + 1}</span>
                          </div>
                        </div>

                        {/* Score Breakdown */}
                        <div className="px-4 py-4 space-y-3">
                          {/* Component bars */}
                          <div className="space-y-2">
                            {[
                              { label: 'Quality / Ø§Ù„Ø¬ÙˆØ¯Ø©', labelShort: `${_sc.weight_quality}%`, value: qualityPct, contrib: qualityContrib, color: 'emerald', icon: 'ðŸ’Ž' },
                              { label: 'Attendance / Ø§Ù„Ø­Ø¶ÙˆØ±', labelShort: `${_sc.weight_attendance}%`, value: attendancePct, contrib: attendanceContrib, color: 'blue', icon: 'ðŸ“…' },
                              { label: 'Punctuality / Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…', labelShort: `${_sc.weight_punctuality}%`, value: punctRate, contrib: punctualityContrib, color: 'amber', icon: 'â°' },
                              { label: 'Consistency / Ø§Ù„Ø§Ù†ØªØ¸Ø§Ù…', labelShort: 'info', value: consistencyPct, contrib: 0, color: 'purple', icon: 'ðŸ“Š' },
                            ].map((comp) => (
                              <div key={comp.label} className="group/bar">
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span>{comp.icon}</span>
                                    <span className="font-medium text-gray-700 dark:text-gray-300">{comp.label}</span>
                                    <span className="text-gray-400 dark:text-gray-500 font-mono">({comp.labelShort})</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-800 dark:text-gray-200">{comp.value.toFixed(1)}%</span>
                                    {comp.labelShort === 'info' ? (
                                      <span className="text-purple-400 dark:text-purple-500 text-[10px] font-mono italic">info only</span>
                                    ) : (
                                      <span className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">â†’ +{comp.contrib.toFixed(1)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      comp.color === 'emerald' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' :
                                      comp.color === 'blue' ? 'bg-gradient-to-r from-blue-400 to-blue-500' :
                                      comp.color === 'purple' ? 'bg-gradient-to-r from-purple-400 to-purple-500' :
                                      'bg-gradient-to-r from-amber-400 to-amber-500'
                                    }`}
                                    style={{ width: `${Math.min(comp.value, 100)}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Raw â†’ Coverage â†’ Final pipeline */}
                          <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs font-mono flex-wrap">
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">Raw / Ø§Ù„Ø®Ø§Ù…</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">{rawScore.toFixed(1)}</span>
                            </div>
                            <span className="text-gray-400 dark:text-gray-500">Ã—</span>
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">Coverage / Ø§Ù„ØªØºØ·ÙŠØ©</span>
                              <span className={`font-bold ${coverageF >= 0.8 ? 'text-green-600 dark:text-green-400' : coverageF >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                                {coverageF.toFixed(3)}
                              </span>
                            </div>
                            <span className="text-gray-400 dark:text-gray-500">=</span>
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">Final / Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ</span>
                              <span className="font-black text-base text-purple-600 dark:text-purple-400">{finalScore.toFixed(1)}</span>
                            </div>
                            <div className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 border-l border-gray-200 dark:border-gray-600 pl-2">
                              {student.effectiveDays}d / {dateAnalytics.length} sessions
                            </div>
                          </div>

                          {/* Insight / Tip */}
                          <div className="flex flex-col sm:flex-row gap-2">
                            {(scoreExplainerLang === 'en' || scoreExplainerLang === 'both') && (
                            <div className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                              <span className="font-bold">ðŸ’¡ Tip:</span>{' '}
                              {coverageF < 0.5
                                ? `Low coverage factor (${coverageF.toFixed(2)}) is significantly reducing your score. Attend more sessions to improve.`
                                : weakest.value < 50
                                  ? `Your weakest area is ${weakest.name} (${weakest.value.toFixed(0)}%). Focus on improving this to boost your overall score.`
                                  : strongest.value >= 90
                                    ? `Great ${strongest.name.toLowerCase()} at ${strongest.value.toFixed(0)}%! ${weakest.name} (${weakest.value.toFixed(0)}%) has the most room for improvement.`
                                    : `Well-balanced performance. Keep maintaining your attendance and punctuality.`
                              }
                            </div>
                            )}
                            {(scoreExplainerLang === 'ar' || scoreExplainerLang === 'both') && (
                            <div dir="rtl" className="flex-1 text-xs px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                              <span className="font-bold">ðŸ’¡ Ù†ØµÙŠØ­Ø©:</span>{' '}
                              {coverageF < 0.5
                                ? `Ù…Ø¹Ø§Ù…Ù„ Ø§Ù„ØªØºØ·ÙŠØ© Ù…Ù†Ø®ÙØ¶ (${coverageF.toFixed(2)}) ÙˆÙ‡Ø°Ø§ ÙŠÙ‚Ù„Ù„ Ø¯Ø±Ø¬ØªÙƒ Ø¨Ø´ÙƒÙ„ ÙƒØ¨ÙŠØ±. Ø§Ø­Ø¶Ø± Ø§Ù„Ù…Ø²ÙŠØ¯ Ù…Ù† Ø§Ù„Ø¬Ù„Ø³Ø§Øª Ù„Ù„ØªØ­Ø³ÙŠÙ†.`
                                : weakest.value < 50
                                  ? `Ø£Ø¶Ø¹Ù Ù†Ù‚Ø·Ø© Ù„Ø¯ÙŠÙƒ Ù‡ÙŠ ${weakest.nameAr} (${weakest.value.toFixed(0)}Ùª). Ø±ÙƒÙ‘Ø² Ø¹Ù„Ù‰ ØªØ­Ø³ÙŠÙ†Ù‡Ø§ Ù„Ø±ÙØ¹ Ø¯Ø±Ø¬ØªÙƒ.`
                                  : strongest.value >= 90
                                    ? `${strongest.nameAr} Ù…Ù…ØªØ§Ø² Ø¨Ù†Ø³Ø¨Ø© ${strongest.value.toFixed(0)}Ùª! ${weakest.nameAr} (${weakest.value.toFixed(0)}Ùª) ÙÙŠÙ‡ Ø£ÙƒØ¨Ø± Ù…Ø¬Ø§Ù„ Ù„Ù„ØªØ­Ø³ÙŠÙ†.`
                                    : `Ø£Ø¯Ø§Ø¡ Ù…ØªÙˆØ§Ø²Ù†. Ø­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø­Ø¶ÙˆØ±Ùƒ ÙˆØ§Ù„ØªØ²Ø§Ù…Ùƒ Ø¨Ø§Ù„ÙˆÙ‚Øª.`
                              }
                            </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Show count when viewing all */}
              {!scoreExplainerStudent && studentAnalytics.length > 50 && (
                <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                  Showing top 50 of {studentAnalytics.length} students â€” Ø¹Ø±Ø¶ Ø£ÙØ¶Ù„ Ù¥Ù  Ù…Ù† {studentAnalytics.length} Ø·Ø§Ù„Ø¨
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary Stats Cards - Enhanced Design */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 dark:border-gray-700 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{t.totalRecords}</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{filteredRecords.length}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">{t.allEntries}</p>
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
              <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">{t.onTime}</p>
              <p className="text-3xl font-bold text-green-900 dark:text-green-100">{statusCounts.onTime}</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((statusCounts.onTime / filteredRecords.length) * 100)}%` 
                  : '0%'} {t.ofTotal}
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
              <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">{t.absent}</p>
              <p className="text-3xl font-bold text-red-900 dark:text-red-100">{statusCounts.absent}</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((statusCounts.absent / filteredRecords.length) * 100)}%` 
                  : '0%'} {t.ofTotal}
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
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-1">{t.late}</p>
              <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{statusCounts.late}</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((statusCounts.late / filteredRecords.length) * 100)}%` 
                  : '0%'} {t.ofTotal}
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
              <p className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">{t.excused}</p>
              <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{statusCounts.excused}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((statusCounts.excused / filteredRecords.length) * 100)}%` 
                  : '0%'} {t.ofTotal}
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
        {/* Filter Header - Collapsible */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
          <button
            onClick={() => setCollapseFilters(!collapseFilters)}
            className="flex items-center gap-3 group cursor-pointer"
            aria-label={collapseFilters ? t.showFilters : t.hideFilters}
          >
            <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition-colors">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t.advancedFilters}</h2>
            {(filters.student_ids.length + filters.course_ids.length + filters.teacher_ids.length + filters.statuses.length) > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-bold rounded-full animate-pulse">
                {filters.student_ids.length + filters.course_ids.length + filters.teacher_ids.length + filters.statuses.length} {t.activeFilters}
              </span>
            )}
            <svg className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${collapseFilters ? (arabicMode ? 'rotate-90' : '-rotate-90') : 'rotate-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {!collapseFilters && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={quickFilterLastWeek}
                className="px-4 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all duration-200 flex items-center gap-2 border border-blue-100 dark:border-blue-700"
                aria-label={t.lastWeek}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t.lastWeek}
              </button>
              <button
                onClick={quickFilterLastMonth}
                className="px-4 py-2 bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium hover:bg-purple-100 dark:hover:bg-purple-900/60 transition-all duration-200 flex items-center gap-2 border border-purple-100 dark:border-purple-700"
                aria-label={t.lastMonth}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t.lastMonth}
              </button>
              <button
                onClick={quickFilterAbsentOnly}
                className="px-4 py-2 bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/60 transition-all duration-200 flex items-center gap-2 border border-red-100 dark:border-red-700"
                aria-label={t.absentOnly}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {t.absentOnly}
              </button>
              <button
                onClick={resetFilters}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                  (filters.student_ids.length + filters.course_ids.length + filters.teacher_ids.length + filters.statuses.length) > 0
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-900/60'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                aria-label={t.resetAll}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t.resetAll}
              </button>
            </div>
          )}
        </div>
        {/* Filter Grid - Collapsible */}
        <div ref={filterPanelRef} className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 transition-all duration-300 ${collapseFilters ? 'hidden' : ''}`}>
          {/* Multi-select: Student */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {t.student}
              {filters.student_ids.length > 0 && <span className="ml-auto bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{filters.student_ids.length}</span>}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenFilterDropdown(openFilterDropdown === 'student' ? null : 'student')}
                className="w-full px-3 py-2 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 text-left text-sm flex items-center justify-between"
              >
                <span className="truncate">{filters.student_ids.length === 0 ? t.allStudents : `${filters.student_ids.length} ${t.selected}`}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${openFilterDropdown === 'student' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openFilterDropdown === 'student' && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  <button type="button" onClick={() => setFilters(f => ({ ...f, student_ids: [] }))} className="w-full px-3 py-2 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-medium border-b border-gray-100 dark:border-gray-700">{t.clearAll}</button>
                  {students.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" checked={filters.student_ids.includes(opt.value)} onChange={() => setFilters(f => ({ ...f, student_ids: f.student_ids.includes(opt.value) ? f.student_ids.filter(v => v !== opt.value) : [...f.student_ids, opt.value] }))} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Multi-select: Course */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {t.course}
              {filters.course_ids.length > 0 && <span className="ml-auto bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{filters.course_ids.length}</span>}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenFilterDropdown(openFilterDropdown === 'course' ? null : 'course')}
                className="w-full px-3 py-2 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 text-left text-sm flex items-center justify-between"
              >
                <span className="truncate">{filters.course_ids.length === 0 ? t.allCourses : `${filters.course_ids.length} ${t.selected}`}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${openFilterDropdown === 'course' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openFilterDropdown === 'course' && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  <button type="button" onClick={() => setFilters(f => ({ ...f, course_ids: [] }))} className="w-full px-3 py-2 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-medium border-b border-gray-100 dark:border-gray-700">{t.clearAll}</button>
                  {courses.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" checked={filters.course_ids.includes(opt.value)} onChange={() => setFilters(f => ({ ...f, course_ids: f.course_ids.includes(opt.value) ? f.course_ids.filter(v => v !== opt.value) : [...f.course_ids, opt.value] }))} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Multi-select: Instructor */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {t.instructor}
              {filters.teacher_ids.length > 0 && <span className="ml-auto bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{filters.teacher_ids.length}</span>}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenFilterDropdown(openFilterDropdown === 'instructor' ? null : 'instructor')}
                className="w-full px-3 py-2 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 text-left text-sm flex items-center justify-between"
              >
                <span className="truncate">{filters.teacher_ids.length === 0 ? t.allInstructors : `${filters.teacher_ids.length} ${t.selected}`}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${openFilterDropdown === 'instructor' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openFilterDropdown === 'instructor' && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  <button type="button" onClick={() => setFilters(f => ({ ...f, teacher_ids: [] }))} className="w-full px-3 py-2 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-medium border-b border-gray-100 dark:border-gray-700">{t.clearAll}</button>
                  {instructors.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" checked={filters.teacher_ids.includes(opt.value)} onChange={() => setFilters(f => ({ ...f, teacher_ids: f.teacher_ids.includes(opt.value) ? f.teacher_ids.filter(v => v !== opt.value) : [...f.teacher_ids, opt.value] }))} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Multi-select: Status */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t.statusLabel}
              {filters.statuses.length > 0 && <span className="ml-auto bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{filters.statuses.length}</span>}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenFilterDropdown(openFilterDropdown === 'status' ? null : 'status')}
                className="w-full px-3 py-2 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 text-left text-sm flex items-center justify-between"
              >
                <span className="truncate">{filters.statuses.length === 0 ? t.allStatuses : filters.statuses.map(s => s === 'on time' ? 'On Time' : s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}</span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${openFilterDropdown === 'status' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {openFilterDropdown === 'status' && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  <button type="button" onClick={() => setFilters(f => ({ ...f, statuses: [] }))} className="w-full px-3 py-2 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-medium border-b border-gray-100 dark:border-gray-700">{t.clearAll}</button>
                  {[{ value: 'on time', label: 'On Time' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }, { value: 'excused', label: 'Excused' }].map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" checked={filters.statuses.includes(opt.value)} onChange={() => setFilters(f => ({ ...f, statuses: f.statuses.includes(opt.value) ? f.statuses.filter(v => v !== opt.value) : [...f.statuses, opt.value] }))} className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t.startDateLabel}
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
              {t.endDateLabel}
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t.attendanceRecords}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.showing} <span className="font-semibold text-blue-600 dark:text-blue-400">{filteredRecords.length}</span> {t.records}
                  {filteredRecords.length !== records.length && (
                    <span className="text-gray-500 dark:text-gray-500"> ({t.filteredFrom} {records.length} {t.total})</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Arabic Toggle */}
              <button
                onClick={() => { setArabicMode(!arabicMode); setReportLanguage(arabicMode ? 'en' : 'ar'); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                  arabicMode
                    ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
                title={arabicMode ? 'Switch to English' : 'Ø§Ù„ØªØ¨Ø¯ÙŠÙ„ Ø¥Ù„Ù‰ Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©'}
              >
                <span className="text-base">{arabicMode ? 'ðŸ‡ºðŸ‡¸' : 'ðŸ‡¸ðŸ‡¦'}</span>
                <span>{arabicMode ? 'EN' : 'Ø¹Ø±Ø¨ÙŠ'}</span>
              </button>
              <button
                onClick={() => {
                  setExportDataType('records');
                  setShowAdvancedExport(true);
                }}
                className="relative flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                title="Export Attendance Records"
              >
                <span>ðŸ“¤</span>
                <span>{t.advancedExport}</span>
                {savedFieldSelections.records.length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
                    {savedFieldSelections.records.length}
                  </span>
                )}
              </button>

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
            <p className="text-gray-600 dark:text-gray-300 font-medium">{t.loading}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.loadingSubtext}</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="bg-gray-100 dark:bg-gray-700 p-6 rounded-full">
              <svg className="w-16 h-16 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{t.noRecords}</h3>
            <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
              {t.noRecordsDesc}
            </p>
            <button
              onClick={resetFilters}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 flex items-center gap-2 shadow-md"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t.resetFilters}
            </button>
          </div>
        ) : (
        <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto" dir={arabicMode ? 'rtl' : 'ltr'}>
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 sticky top-0 z-10 shadow-sm">
              <tr>
                {/* Dynamic columns in the order from export builder */}
                {orderedRecordColumns.map(colKey => renderRecordHeader(colKey))}
                {/* Actions column always at the end */}
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {t.actions}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {sortedRecords
                .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                .map((record) => (
                  <tr 
                    key={record.attendance_id} 
                    className="hover:bg-blue-50/60 dark:hover:bg-blue-900/20 cursor-pointer transition-all duration-150 group/row border-l-2 border-transparent hover:border-blue-500"
                    onClick={() => navigate(`/attendance/${record.session_id}`, { state: { selectedDate: record.attendance_date } })}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/attendance/${record.session_id}`, { state: { selectedDate: record.attendance_date } }); } }}
                    aria-label={`View attendance for ${record.student_name} on ${record.attendance_date}`}
                    title="Click to view/edit attendance for this date"
                  >
                    {/* Dynamic cells in the same order */}
                    {orderedRecordColumns.map(colKey => renderRecordCell(colKey, record))}
                    {/* Actions cell always at the end */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {record.gps_latitude && record.gps_longitude && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openMapLocation(record);
                          }}
                          className="px-3 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all duration-200 flex items-center gap-2 text-xs font-medium border border-blue-200 dark:border-blue-700"
                          aria-label={t.viewMap}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {t.viewMap}
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

      <ConfirmDialog
        isOpen={showArabicPdfConfirm}
        type="warning"
        title="Arabic PDF Export"
        message="PDF export works best in English. For full Arabic support with proper formatting, please use CSV Export. Continue with English PDF?"
        confirmText="Continue"
        onConfirm={() => { setShowArabicPdfConfirm(false); void exportAnalyticsToPDF(true); }}
        onCancel={() => setShowArabicPdfConfirm(false)}
      />
    </div>
  );
};

export default AttendanceRecords;
