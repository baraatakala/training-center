import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format, subDays } from 'date-fns';
import { Select } from '../components/ui/Select';
import { BulkImport } from '../components/BulkImport';
import { Pagination } from '../components/ui/Pagination';
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
}

interface FilterOptions {
  student_id: string;
  course_id: string;
  teacher_id: string;
  status: string;
  startDate: string;
  endDate: string;
}

const AttendanceRecords = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toasts, success, error: showError, warning, removeToast } = useToast();

  // Modal state for customize export
  const [showCustomizeExport, setShowCustomizeExport] = useState(false);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics[]>([]);
  const [dateAnalytics, setDateAnalytics] = useState<DateAnalytics[]>([]);
  const [reportLanguage, setReportLanguage] = useState<'en' | 'ar'>('en');

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

      if (coursesRes.data) {
        setCourses(coursesRes.data.map(c => ({ value: c.course_id, label: c.course_name })));
      }

      if (teachersRes.data) {
        setInstructors(teachersRes.data.map(t => ({ value: t.teacher_id, label: t.name })));
      }
    } catch (error) {
      console.error('Error loading filter options:', error);
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
          : Promise.resolve({ data: null }),
        sessionDatePairs.length > 0
          ? supabase
              .from('session_date_host')
              .select('session_id, attendance_date, host_address')
          : Promise.resolve({ data: null })
      ]);

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
    }
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on time': return 'bg-green-100 text-green-800';
      case 'absent': return 'bg-red-100 text-red-800';
      case 'late': return 'bg-yellow-100 text-yellow-800';
      case 'excused': return 'bg-blue-100 text-blue-800';
      case 'not enrolled': return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-800';
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

  const exportToCSV = () => {
    const headers = [
      'Date',
      'Student',
      'Course',
      'Instructor',
      'Status',
      'Excuse Reason',
      'Location',
      'GPS Latitude',
      'GPS Longitude',
      'GPS Accuracy',
      'Marked By',
      'Marked At'
    ];

    const rows = filteredRecords.map(record => [
      format(new Date(record.attendance_date), 'MMM dd, yyyy'),
      record.student_name,
      record.course_name,
      record.instructor_name,
      record.status,
      (record.status === 'excused' && record.excuse_reason) ? record.excuse_reason : '-',
      record.session_location || '-',
      record.gps_latitude ? record.gps_latitude.toString() : '-',
      record.gps_longitude ? record.gps_longitude.toString() : '-',
      record.gps_accuracy ? `${record.gps_accuracy}m` : '-',
      record.marked_by || '-',
      record.marked_at ? format(new Date(record.marked_at), 'MMM dd, yyyy HH:mm') : '-'
    ]);

    // Escape CSV fields and add BOM for UTF-8 encoding
    const escapeCSV = (field: unknown) => {
      const str = String(field || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    // Add UTF-8 BOM to support special characters in Excel
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-records-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportAnalyticsToExcel = () => {
    if (!showAnalytics || studentAnalytics.length === 0) {
      warning('Please show analytics first to export analytics data');
      return;
    }

    const isArabic = reportLanguage === 'ar';


    // Summary Statistics Sheet
    const summaryHeaders = isArabic
      ? ['العنصر', 'القيمة']
      : ['Metric', 'Value'];

    // Calculate summary values
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

    const summaryRows = isArabic
      ? [
          ['عدد الطلاب', totalStudents],
          ['معدل الحضور للصف (%)', `${classAvgRate}%`],
          ['متوسط النقاط المرجحة', avgWeightedScore],
          ['متوسط الحضور حسب التاريخ (%)', `${avgAttendanceByDate}%`],
          ['متوسط الحضور حسب التاريخ للحصص النشطة (%)', `${avgAttendanceByAccruedDate}%`],
        ]
      : [
          ['Total Students', totalStudents],
          ['Class Avg Rate (%)', `${classAvgRate}%`],
          ['Avg Weighted Score', avgWeightedScore],
          ['Avg Attendance by Date (%)', `${avgAttendanceByDate}%`],
          ['Avg Attendance by Accrued Date (%)', `${avgAttendanceByAccruedDate}%`],
        ];

    // Student Performance Sheet
    const studentHeaders = isArabic ? [
      'الترتيب',
      'اسم الطالب',
      'في الوقت',
      'متأخر',
      'حاضر',
      'غائب بدون عذر',
      'غائب بعذر',
      'الأيام الفعلية',
      'الأيام المغطاة',
      'معدل الحضور (%)',
      'معدل الالتزام بالوقت (%)',
      'النقاط المرجحة',
    ] : [
      'Rank',
      'Student Name',
      'On Time',
      'Late',
      'Present',
      'Unexcused Absent',
      'Excused',
      'Effective Days',
      'Days Covered',
      'Attendance Rate (%)',
      'Punctuality Rate (%)',
      'Weighted Score',
    ];

    const studentRows = studentAnalytics.map((student, index) => {
      const totalPresent = student.presentCount + student.lateCount;
      const punctualityRate = totalPresent > 0 
        ? Math.round(student.presentCount / totalPresent * 100)
        : 0;

      return [
        index + 1,
        student.student_name,
        student.presentCount,
        student.lateCount,
        totalPresent,
        student.unexcusedAbsent,
        student.excusedCount,
        student.effectiveDays,
        student.daysCovered,
        student.attendanceRate,
        punctualityRate,
        student.weightedScore,
      ];
    });

    // Attendance by Date Sheet
    const dateHeaders = isArabic ? [
      'التاريخ',
      'الموضوع',
      'الصفحات',
      'عنوان المضيف',
      'في الوقت',
      'متأخر',
      'معذور',
      'غائب',
      'النسبة %',
      'أسماء في الوقت',
      'أسماء المتأخرين',
      'أسماء المعذورين',
      'أسماء الغائبين'
    ] : [
      'Date',
      'Book Topic',
      'Pages',
      'Host Address',
      'On Time',
      'Late',
      'Excused',
      'Absent',
      'Rate %',
      'On Time Names',
      'Late Names',
      'Excused Names',
      'Absent Names'
    ];

    const dateRows = dateAnalytics.map((dateData) => {
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
      
      return [
        format(new Date(dateData.date), 'MMM dd, yyyy'),
        dateData.bookTopic || '-',
        bookPages,
        dateData.hostAddress || '-',
        dateData.presentCount,
        dateData.lateCount,
        dateData.excusedAbsentCount,
        dateData.unexcusedAbsentCount,
        dateData.attendanceRate,
        dateData.presentNames.join(', ') || '-',
        dateData.lateNames.join(', ') || '-',
        excusedLabel,
        dateData.absentNames.join(', ') || '-'
      ];
    });

    // Create workbook with three sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary Statistics
    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, wsSummary, isArabic ? 'إحصائيات عامة' : 'Summary Statistics');

    // Sheet 2: Student Performance
    const ws1 = XLSX.utils.aoa_to_sheet([studentHeaders, ...studentRows]);
    XLSX.utils.book_append_sheet(wb, ws1, isArabic ? 'أداء الطلاب' : 'Student Performance');

    // Sheet 3: Attendance by Date
    const ws2 = XLSX.utils.aoa_to_sheet([dateHeaders, ...dateRows]);
    XLSX.utils.book_append_sheet(wb, ws2, isArabic ? 'الحضور بالتاريخ' : 'Attendance by Date');

    // Sheet 4: Host Rankings
    const hostMap = new Map<string, { count: number; dates: string[] }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress) {
        const existing = hostMap.get(dateData.hostAddress) || { count: 0, dates: [] };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const hostRankings = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count);

    const hostHeaders = isArabic ? [
      'الرتبة',
      'عنوان المضيف',
      'عدد مرات الاستضافة',
      'التواريخ'
    ] : [
      'Rank',
      'Host Address',
      'Times Hosted',
      'Dates'
    ];

    const hostRows = hostRankings.map((host, index) => [
      index + 1,
      host.address,
      host.count,
      host.dates.join(', ')
    ]);

    const ws3 = XLSX.utils.aoa_to_sheet([hostHeaders, ...hostRows]);
    XLSX.utils.book_append_sheet(wb, ws3, isArabic ? 'تصنيف المضيفين' : 'Host Rankings');

    // Export to file
    const excelFileName = isArabic 
      ? `تقرير_التحليلات_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      : `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, excelFileName);
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

    // Student Performance Table
    doc.setFontSize(12);
    doc.text('Student Performance Summary', 14, 42);
    
    autoTable(doc, {
      startY: 46,
      head: [['Rank', 'Student', 'Present', 'On Time', 'Late', 'Absent', 'Excused', 'Attendance %', 'Punctuality %', 'Score']],
      body: studentAnalytics.slice(0, 20).map((student, index) => {
        const totalPresent = student.presentCount + student.lateCount;
        const punctualityRate = totalPresent > 0 
          ? Math.round(student.presentCount / totalPresent * 100)
          : 0;
        return [
          index + 1,
          student.student_name,
          totalPresent,
          student.presentCount,
          student.lateCount,
          student.unexcusedAbsent,
          student.excusedCount,
          `${student.attendanceRate}%`,
          `${punctualityRate}%`,
          student.weightedScore.toFixed(1)
        ];
      }),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      rowPageBreak: 'avoid',
    });

    // Date Analytics Table
    const performanceTableY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 46;
    doc.setFontSize(12);
    doc.text('Attendance by Date', 14, performanceTableY + 10);

    autoTable(doc, {
      startY: performanceTableY + 14,
      head: [['Date', 'Book Progress', 'Host', 'On Time', 'Late', 'Excused', 'Absent', 'Rate %', 'On Time Names', 'Late Names', 'Excused Names', 'Absent Names']],
      body: dateAnalytics.map((dateData) => {
        let excusedLabel = dateData.excusedAbsentCount.toString();
        let excusedNamesLabel = dateData.excusedNames.join(', ') || '-';
        if (
          dateData.hostAddress === 'SESSION_NOT_HELD' ||
          (dateData.hostAddress && dateData.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
        ) {
          excusedLabel = reportLanguage === 'ar' ? 'جميع الطلاب' : 'All Students';
          excusedNamesLabel = reportLanguage === 'ar' ? 'جميع الطلاب' : 'All Students';
        }
        
        const bookProgress = dateData.bookTopic && dateData.bookStartPage && dateData.bookEndPage
          ? `${dateData.bookTopic} (p.${dateData.bookStartPage}-${dateData.bookEndPage})`
          : dateData.bookTopic || '-';
        
        return [
          format(new Date(dateData.date), 'MMM dd, yyyy'),
          bookProgress,
          dateData.hostAddress || '-',
          dateData.presentCount,
          dateData.lateCount,
          excusedLabel,
          dateData.unexcusedAbsentCount,
          `${dateData.attendanceRate}%`,
          dateData.presentNames.join(', ') || '-',
          dateData.lateNames.join(', ') || '-',
          excusedNamesLabel,
          dateData.absentNames.join(', ') || '-',
        ];
      }),
      styles: { fontSize: 6, cellPadding: 1.5 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 6 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      rowPageBreak: 'avoid',
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 40 },
        2: { cellWidth: 22 },
        3: { cellWidth: 10 },
        4: { cellWidth: 10 },
        5: { cellWidth: 12 },
        6: { cellWidth: 10 },
        7: { cellWidth: 12 },
        8: { cellWidth: 'auto' },
        9: { cellWidth: 'auto' },
        10: { cellWidth: 'auto' },
        11: { cellWidth: 'auto' },
      },
    });

    // Host Rankings Table
    const dateTableY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || performanceTableY + 14;
    
    // Calculate host rankings
    const hostMap = new Map<string, { count: number; dates: string[] }>();
    dateAnalytics.forEach((dateData) => {
      if (dateData.hostAddress) {
        const existing = hostMap.get(dateData.hostAddress) || { count: 0, dates: [] };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const hostRankings = Array.from(hostMap.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.count - a.count);

    if (hostRankings.length > 0) {
      doc.setFontSize(12);
      doc.text('Host Rankings (All Hosts by Session Count)', 14, dateTableY + 10);

      autoTable(doc, {
        startY: dateTableY + 14,
        head: [['Rank', 'Host Address', 'Times Hosted', 'Dates']],
        body: hostRankings.map((host, index) => [
          index + 1,
          host.address,
          host.count,
          host.dates.join(', ')
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        rowPageBreak: 'avoid',
        columnStyles: {
          0: { cellWidth: 15 },
          1: { cellWidth: 60 },
          2: { cellWidth: 25 },
          3: { cellWidth: 'auto' }
        },
      });
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

    // Prepare comprehensive student data with ALL fields matching Excel
    const studentData = studentAnalytics.map((s, index) => {
      const totalPresent = s.presentCount + s.lateCount;
      const punctualityRate = totalPresent > 0 
        ? (s.presentCount / totalPresent * 100)
        : 0;

      return {
        rank: index + 1,
        student_name: s.student_name,
        on_time: s.presentCount,
        late: s.lateCount,
        present_total: totalPresent,
        unexcused_absent: s.unexcusedAbsent,
        excused: s.excusedCount,
        effective_days: s.effectiveDays,
        days_covered: s.daysCovered,
        attendance_rate: s.attendanceRate,
        punctuality_rate: punctualityRate,
        weighted_score: s.weightedScore,
      };
    });

    // Prepare comprehensive date data with ALL fields including book info and names
    const dateData = dateAnalytics.map(d => {
      let excusedCount = d.excusedAbsentCount;
      let excusedNames = d.excusedNames.join(', ') || '-';
      const totalStudents = d.presentCount + d.lateCount + d.excusedAbsentCount + d.unexcusedAbsentCount;
      
      if (
        d.hostAddress === 'SESSION_NOT_HELD' ||
        (d.hostAddress && d.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
      ) {
        excusedCount = totalStudents;
        excusedNames = isArabic ? 'جميع الطلاب' : 'All Students';
      }
      
      const bookPages = d.bookStartPage && d.bookEndPage 
        ? `${d.bookStartPage}-${d.bookEndPage}` 
        : '-';
      
      return {
        date: format(new Date(d.date), 'MMM dd, yyyy'),
        book_topic: d.bookTopic || '-',
        book_pages: bookPages,
        host_address: d.hostAddress || '-',
        on_time: d.presentCount,
        late: d.lateCount,
        excused: excusedCount,
        absent: d.unexcusedAbsentCount,
        attendance_rate: d.attendanceRate,
        on_time_names: d.presentNames.join(', ') || '-',
        late_names: d.lateNames.join(', ') || '-',
        excused_names: excusedNames,
        absent_names: d.absentNames.join(', ') || '-',
      };
    });

    // Prepare host rankings data with all details and dates
    const hostMap = new Map<string, {
      count: number;
      dates: string[];
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
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
        };
        existing.count++;
        existing.dates.push(format(new Date(dateData.date), 'MMM dd'));
        existing.present += dateData.presentCount;
        existing.late += dateData.lateCount;
        existing.absent += dateData.unexcusedAbsentCount;
        existing.excused += dateData.excusedAbsentCount;
        hostMap.set(dateData.hostAddress, existing);
      }
    });

    const hostData = Array.from(hostMap.entries())
      .map(([name, data]) => {
        const totalAttendance = data.present + data.late;
        const totalPossible = data.present + data.late + data.absent;
        const attendanceRate = totalPossible > 0 ? (totalAttendance / totalPossible) * 100 : 0;
        
        return {
          host_name: name,
          total_hosted: data.count,
          dates: data.dates.join(', '),
          present: data.present,
          absent: data.absent,
          excused: data.excused,
          late: data.late,
          attendance_rate: attendanceRate,
        };
      })
      .sort((a, b) => b.total_hosted - a.total_hosted)
      .map((host, index) => ({
        rank: index + 1,
        ...host,
      }));

    try {
      await wordExportService.exportAnalyticsToWord(
        studentData,
        dateData,
        hostData,
        summaryStats,
        isArabic,
        filters.startDate,
        filters.endDate
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

      // Calculate rates (no vacation status in AttendanceRecords)
      // Effective base: Student's covered dates minus excused days (only accountable for dates after enrollment)
      const effectiveBase = studentDaysCovered - excusedCount;
      // Attendance rate: Present (On Time + Late) / Effective Days
      const totalPresent = presentCount + lateCount;
      const attendanceRate = effectiveBase > 0 ? (totalPresent / effectiveBase) * 100 : 0;

      // Unexcused absences should be calculated as: Effective Days - Present
      // (i.e. accountable days minus days the student was present/on-time or late)
      const unexcusedAbsent = effectiveBase > 0 ? Math.max(0, effectiveBase - totalPresent) : 0;

      // Calculate weighted score (3-component formula)
      // 80% Attendance Rate + 10% Effective Days Coverage + 10% Punctuality
      // Effective days percentage: now always 100% since effectiveBase = studentDaysCovered - excusedCount
      const effectiveDaysPercentage = studentDaysCovered > 0 ? (effectiveBase / studentDaysCovered) * 100 : 0;
      const punctualityPercentage = totalPresent > 0 ? (presentCount / totalPresent) * 100 : 0;
      const weightedScore = (0.8 * attendanceRate) + (0.1 * effectiveDaysPercentage) + (0.1 * punctualityPercentage);

      // Calculate consistency index (based on all present days: on time + late)
      const dailyPattern = studentUniqueDates.map(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (!record || record.status === 'excused') return -1; // Exclude excused
        return (record.status === 'on time' || record.status === 'late') ? 1 : 0;
      }).filter(v => v !== -1);

      const consistencyIndex = calculateConsistencyIndex(dailyPattern);

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
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDateAnalytics(dateStats);
  }, [filteredRecords]); // Memoize with filteredRecords dependency

  const calculateConsistencyIndex = (pattern: number[]): number => {
    // Consistency Index: measures how consistently present the student is
    // Score 0-1 based on percentage of days present (excluding excused)
    // 1.0 = always present, 0.0 = never present
    if (pattern.length === 0) return 0;
    
    const presentDays = pattern.filter(v => v === 1).length;
    const consistency = presentDays / pattern.length;
    
    return Math.round(consistency * 100) / 100;
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-50 pb-8">
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
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
                className="px-4 py-2 bg-white hover:bg-blue-50 text-blue-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-lg"
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
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
            <h2 className="text-base sm:text-lg font-semibold mb-4">📊 Summary Statistics</h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="border-l-4 border-blue-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600">Total Students</div>
                <div className="text-xl sm:text-2xl font-bold">{studentAnalytics.length}</div>
              </div>
              <div className="border-l-4 border-green-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600">Class Avg Rate</div>
                <div className="text-xl sm:text-2xl font-bold">
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
                <div className="text-xs sm:text-sm text-gray-600">Avg Weighted Score</div>
                <div className="text-xl sm:text-2xl font-bold">
                  {studentAnalytics.length > 0
                    ? Math.round(
                        studentAnalytics.reduce((sum, s) => sum + s.weightedScore, 0) /
                          studentAnalytics.length
                      )
                    : 0}
                </div>
              </div>
              <div className="border-l-4 border-blue-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600">Avg Attendance by Date</div>
                <div className="text-xl sm:text-2xl font-bold">
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
                <div className="text-xs sm:text-sm text-gray-600">Avg Attendance by Accrued Date</div>
                <div className="text-xl sm:text-2xl font-bold">
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

          {/* Student Performance Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-b">
              <h2 className="text-base sm:text-lg font-semibold">🎓 Student Performance Analytics</h2>
            </div>
            <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Present</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">On Time</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Late</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Absent</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Excused</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Effective Days</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Punctuality</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Weighted Score</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {studentAnalytics.map((student, index) => (
                    <tr key={student.student_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{student.student_name}</td>
                      <td className="px-4 py-3 text-sm text-center text-green-600 font-medium">{student.presentCount + student.lateCount}</td>
                      <td className="px-4 py-3 text-sm text-center text-green-700 font-medium">{student.presentCount}</td>
                      <td className="px-4 py-3 text-sm text-center text-yellow-600 font-medium">{student.lateCount}</td>
                      <td className="px-4 py-3 text-sm text-center text-red-600 font-medium">{student.unexcusedAbsent}</td>
                      <td className="px-4 py-3 text-sm text-center text-blue-600 font-medium">{student.excusedCount}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-900">{student.effectiveDays}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-semibold ${
                          student.attendanceRate >= 90 ? 'text-green-600' :
                          student.attendanceRate >= 70 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {student.attendanceRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-semibold ${
                          student.presentCount + student.lateCount > 0
                            ? (student.presentCount / (student.presentCount + student.lateCount) * 100) >= 80 ? 'text-green-600'
                            : (student.presentCount / (student.presentCount + student.lateCount) * 100) >= 60 ? 'text-yellow-600' : 'text-red-600'
                            : 'text-gray-400'
                        }`}>
                          {student.presentCount + student.lateCount > 0
                            ? `${Math.round(student.presentCount / (student.presentCount + student.lateCount) * 100)}%`
                            : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-semibold text-purple-600">
                        {student.weightedScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Date Analytics Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-b">
              <h2 className="text-base sm:text-lg font-semibold">📅 Attendance by Date</h2>
            </div>
            <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Host Address</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">On Time</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Late</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Excused</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Absent</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">On Time Names</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Late Names</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Excused Names</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Absent Names</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dateAnalytics.map((dateData) => (
                    <tr key={dateData.date} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                        {format(new Date(dateData.date), 'MMM dd, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                        {dateData.bookTopic ? (
                          <div className="space-y-1">
                            <div className="flex items-start gap-1">
                              <span className="text-base">📚</span>
                              <span className="font-medium text-blue-900">{dateData.bookTopic}</span>
                            </div>
                            {dateData.bookStartPage && dateData.bookEndPage && (
                              <div className="text-xs text-blue-700 pl-5">
                                Pages {dateData.bookStartPage}-{dateData.bookEndPage}
                                <span className="text-blue-600 ml-1">
                                  ({dateData.bookEndPage - dateData.bookStartPage + 1} pages)
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                        {dateData.hostAddress ? (
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-medium">
                            📍 {dateData.hostAddress}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-green-600 font-medium">
                        {dateData.presentCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-yellow-600 font-medium">
                        {dateData.lateCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-blue-600 font-medium">
                        {dateData.excusedAbsentCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-red-600 font-medium">
                        {dateData.unexcusedAbsentCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-center whitespace-nowrap">
                        <span className={`font-semibold px-3 py-1 rounded-full ${
                          dateData.attendanceRate >= 90 ? 'bg-green-100 text-green-800' :
                          dateData.attendanceRate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {dateData.attendanceRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.presentNames.length > 0 ? dateData.presentNames.join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.lateNames.length > 0 ? dateData.lateNames.join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {(() => {
                          if (
                            dateData.hostAddress === 'SESSION_NOT_HELD' ||
                            (dateData.hostAddress && dateData.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
                          ) {
                            return reportLanguage === 'ar' ? 'جميع الطلاب' : 'All Students';
                          }
                          return dateData.excusedNames.length > 0 ? dateData.excusedNames.join(', ') : '-';
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.absentNames.length > 0 ? dateData.absentNames.join(', ') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Summary Stats Cards - Enhanced Design */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-white to-gray-50 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Total Records</p>
              <p className="text-3xl font-bold text-gray-900">{filteredRecords.length}</p>
              <p className="text-xs text-gray-500 mt-2">All attendance entries</p>
            </div>
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-green-100 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-700 mb-1">On Time</p>
              <p className="text-3xl font-bold text-green-900">{filteredRecords.filter(r => r.status === 'on time').length}</p>
              <p className="text-xs text-green-600 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'on time').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-200 to-emerald-300 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-red-50 to-rose-50 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-red-100 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-700 mb-1">Absent</p>
              <p className="text-3xl font-bold text-red-900">{filteredRecords.filter(r => r.status === 'absent').length}</p>
              <p className="text-xs text-red-600 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'absent').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-red-200 to-rose-300 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-yellow-100 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-yellow-700 mb-1">Late</p>
              <p className="text-3xl font-bold text-yellow-900">{filteredRecords.filter(r => r.status === 'late').length}</p>
              <p className="text-xs text-yellow-600 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'late').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-yellow-200 to-amber-300 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-yellow-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-blue-100 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-700 mb-1">Excused</p>
              <p className="text-3xl font-bold text-blue-900">{filteredRecords.filter(r => r.status === 'excused').length}</p>
              <p className="text-xs text-blue-600 mt-2">
                {filteredRecords.length > 0 
                  ? `${Math.round((filteredRecords.filter(r => r.status === 'excused').length / filteredRecords.length) * 100)}%` 
                  : '0%'} of total
              </p>
            </div>
            <div className="bg-gradient-to-br from-blue-200 to-indigo-300 p-3 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters - Modern Card Design */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Advanced Filters</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={quickFilterLastWeek}
              className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-all duration-200 flex items-center gap-2 border border-blue-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Last Week
            </button>
            <button
              onClick={quickFilterLastMonth}
              className="px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 transition-all duration-200 flex items-center gap-2 border border-purple-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Last Month
            </button>
            <button
              onClick={quickFilterAbsentOnly}
              className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-all duration-200 flex items-center gap-2 border border-red-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Absent Only
            </button>
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-all duration-200 flex items-center gap-2"
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
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
            />
          </div>
        </div>
      </div>

      {/* Export Actions Bar */}
      {showAnalytics && (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl shadow-lg p-4 border border-indigo-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-100 p-2 rounded-lg">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Export Analytics</h3>
                <p className="text-xs text-gray-600">Download comprehensive reports in your preferred format</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => setShowCustomizeExport(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Customize Export
              </button>
              <button
                onClick={exportAnalyticsToExcel}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Excel
              </button>
              <button
                onClick={exportAnalyticsToPDF}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                PDF
              </button>
              <button
                onClick={exportAnalyticsToWord}
                disabled={exportingWord}
                className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md ${exportingWord ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {exportingWord ? 'Exporting...' : 'Word'}
              </button>
              <button
                onClick={exportToCSV}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                CSV
              </button>
            </div>
          </div>

          {/* Customize Export Modal */}
          {showCustomizeExport && (
            <CustomizeExportModal
              onClose={() => setShowCustomizeExport(false)}
              onApply={(config) => {
                setCustomizeExportConfig(config);
                setShowCustomizeExport(false);
              }}
              studentAnalyticsColumns={[
                { key: 'student_name', label: 'Student' },
                { key: 'presentCount', label: 'Present' },
                { key: 'onTimeCount', label: 'On Time' },
                { key: 'lateCount', label: 'Late' },
                { key: 'absentCount', label: 'Absent' },
                { key: 'excusedCount', label: 'Excused' },
                { key: 'effectiveDays', label: 'Effective Days' },
                { key: 'attendanceRate', label: 'Rate' },
                { key: 'punctuality', label: 'Punctuality' },
                { key: 'weightedScore', label: 'Weighted Score' },
              ]}
              dateAnalyticsColumns={[
                { key: 'date', label: 'Date' },
                { key: 'bookTopic', label: 'Book Progress' },
                { key: 'hostAddress', label: 'Host Address' },
                { key: 'presentCount', label: 'On Time' },
                { key: 'lateCount', label: 'Late' },
                { key: 'excusedAbsentCount', label: 'Excused' },
                { key: 'unexcusedAbsentCount', label: 'Absent' },
                { key: 'attendanceRate', label: 'Rate' },
                { key: 'presentNames', label: 'On Time Names' },
                { key: 'lateNames', label: 'Late Names' },
                { key: 'excusedNames', label: 'Excused Names' },
                { key: 'absentNames', label: 'Absent Names' },
              ]}
              initialConfig={customizeExportConfig}
            />
          )}

        // --- End of AttendanceRecords component ---


        // --- End of AttendanceRecords component ---

        // --- CustomizeExportModal component ---
        function CustomizeExportModal({
          onClose,
          onApply,
          studentAnalyticsColumns,
          dateAnalyticsColumns,
          initialConfig = {
            tables: {
              studentAnalytics: true,
              dateAnalytics: true,
            },
            fields: {
              studentAnalytics: studentAnalyticsColumns.map(col => col.key),
              dateAnalytics: dateAnalyticsColumns.map(col => col.key),
            },
          },
        }) {
          const [selectedTables, setSelectedTables] = useState(initialConfig.tables);
          const [selectedFields, setSelectedFields] = useState(initialConfig.fields);

          const handleTableToggle = (table) => {
            setSelectedTables({ ...selectedTables, [table]: !selectedTables[table] });
          };

          const handleFieldToggle = (table, key) => {
            setSelectedFields((prev) => {
              const current = prev[table] || [];
              return {
                ...prev,
                [table]: current.includes(key)
                  ? current.filter((k) => k !== key)
                  : [...current, key],
              };
            });
          };

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full relative">
                <button
                  className="absolute top-3 right-3 text-gray-400 hover:text-gray-700"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold mb-4">Customize Export</h2>
                <div className="space-y-6">
                  <div>
                    <label className="font-semibold text-gray-800 mb-2 block">Select Tables to Export</label>
                    <div className="flex gap-4 mb-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTables.studentAnalytics}
                          onChange={() => handleTableToggle('studentAnalytics')}
                        />
                        Student Performance Analytics
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTables.dateAnalytics}
                          onChange={() => handleTableToggle('dateAnalytics')}
                        />
                        Attendance by Date
                      </label>
                    </div>
                  </div>
                  {selectedTables.studentAnalytics && (
                    <div>
                      <label className="font-medium text-gray-700 mb-1 block">Student Performance Fields</label>
                      <div className="flex flex-wrap gap-3">
                        {studentAnalyticsColumns.map(col => (
                          <label key={col.key} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={selectedFields.studentAnalytics.includes(col.key)}
                              onChange={() => handleFieldToggle('studentAnalytics', col.key)}
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedTables.dateAnalytics && (
                    <div>
                      <label className="font-medium text-gray-700 mb-1 block">Attendance by Date Fields</label>
                      <div className="flex flex-wrap gap-3">
                        {dateAnalyticsColumns.map(col => (
                          <label key={col.key} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={selectedFields.dateAnalytics.includes(col.key)}
                              onChange={() => handleFieldToggle('dateAnalytics', col.key)}
                            />
                            {col.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"
                    onClick={onClose}
                  >Cancel</button>
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    onClick={() => onApply({ tables: selectedTables, fields: selectedFields })}
                  >Apply</button>
                </div>
              </div>
            </div>
          );
        }
        // --- End CustomizeExportModal ---
        // Add state for customize export config
        const [customizeExportConfig, setCustomizeExportConfig] = useState({});
        </div>
      )}

      {/* Records Table - Enhanced Design */}
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        {/* Table Header with Info */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-2 rounded-lg">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Attendance Records</h3>
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold text-blue-600">{filteredRecords.length}</span> records
                  {filteredRecords.length !== records.length && (
                    <span className="text-gray-500"> (filtered from {records.length} total)</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Items per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-gray-600 font-medium">Loading attendance records...</p>
            <p className="text-sm text-gray-500">Please wait while we fetch the data</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="bg-gray-100 p-6 rounded-full">
              <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900">No Records Found</h3>
            <p className="text-gray-600 text-center max-w-md">
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
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th 
                  className="px-3 sm:px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-200 transition-colors group"
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
                  className="px-3 sm:px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-200 transition-colors group"
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
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
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
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
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
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Excuse Reason
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => handleSort('location')}
                >
                  <div className="flex items-center gap-1">
                    Location
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'location' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  GPS
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => handleSort('marked_at')}
                >
                  <div className="flex items-center gap-1">
                    Marked At
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'marked_at' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-4 text-center text-gray-500">
                    Loading records...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-4 text-center text-gray-500">
                    No attendance records found
                  </td>
                </tr>
              ) : (
                getSortedRecords()
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((record) => (
                  <tr 
                    key={record.attendance_id} 
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/attendance/${record.session_id}`, { state: { selectedDate: record.attendance_date } })}
                    title="Click to view/edit attendance for this date"
                  >
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {format(new Date(record.attendance_date), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {record.student_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {record.course_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {record.instructor_name}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(record.status)}`}>
                        {getStatusLabel(record.status)}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {record.status === 'excused' && record.excuse_reason ? (
                        <span className="capitalize px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                          {record.excuse_reason}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {record.session_location || '-'}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                      {record.gps_latitude && record.gps_longitude ? (
                        <div className="space-y-1">
                          <div className="text-xs">{record.gps_latitude.toFixed(4)}°, {record.gps_longitude.toFixed(4)}°</div>
                          {record.gps_accuracy && (
                            <div className="text-xs text-gray-500">
                              ±{record.gps_accuracy.toFixed(0)}m
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">No GPS</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {record.marked_at ? (
                        <div className="space-y-1">
                          <div>{format(new Date(record.marked_at), 'MMM dd, HH:mm')}</div>
                          {record.marked_by && (
                            <div className="text-xs text-gray-500">by {record.marked_by}</div>
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
                          className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-all duration-200 flex items-center gap-2 text-xs font-medium border border-blue-200"
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
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
        
        {/* Modern Pagination */}
        {filteredRecords.length > 0 && !loading && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gradient-to-r from-gray-50 to-white">
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
