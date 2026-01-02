import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format, subDays } from 'date-fns';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { BulkImport } from '../components/BulkImport';
import { Pagination } from '../components/ui/Pagination';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface AttendanceRecord {
  attendance_id: string;
  student_id: string;
  session_id: string;
  attendance_date: string;
  status: 'on time' | 'absent' | 'late' | 'excused';
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
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
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
          setFilters((f) => ({ ...f, startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd') }));
        } else if (earliestData && earliestData.attendance_date) {
          setFilters((f) => ({ ...f, startDate: format(new Date(earliestData.attendance_date), 'yyyy-MM-dd') }));
        } else {
          setFilters((f) => ({ ...f, startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd') }));
        }
      } catch (err) {
        console.warn('Error initializing filters, using fallback dates', err);
        setFilters((f) => ({ ...f, startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd') }));
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

  useEffect(() => {
    applyFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, filters]);

  useEffect(() => {
    if (filteredRecords.length > 0) {
      calculateAnalytics();
    } else {
      setStudentAnalytics([]);
      setDateAnalytics([]);
    }
  }, [filteredRecords]);

  const loadFilterOptions = async () => {
    try {
      // Load students
      const { data: studentsData } = await supabase
        .from('student')
        .select('student_id, name')
        .order('name');
      
      if (studentsData) {
        setStudents(studentsData.map(s => ({ value: s.student_id, label: s.name })));
      }

      // Load courses
      const { data: coursesData } = await supabase
        .from('course')
        .select('course_id, course_name')
        .order('course_name');
      
      if (coursesData) {
        setCourses(coursesData.map(c => ({ value: c.course_id, label: c.course_name })));
      }

      // Load instructors
      const { data: teachersData } = await supabase
        .from('teacher')
        .select('teacher_id, name')
        .order('name');
      
      if (teachersData) {
        setInstructors(teachersData.map(t => ({ value: t.teacher_id, label: t.name })));
      }
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select(`
          attendance_id,
          student_id,
          session_id,
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
          session:session_id (
            location,
            course_id,
            teacher_id,
            course:course_id (course_name),
            teacher:teacher_id (name)
          )
        `)
        .not('status', 'is', null)
        .order('attendance_date', { ascending: false })
        .order('marked_at', { ascending: false });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedRecords: AttendanceRecord[] = (data || []).map((record: any) => {
        const session = record.session || {};
        const student = record.student || {};
        const course = session.course || {};
        const teacher = session.teacher || {};
        
        return {
          attendance_id: record.attendance_id,
          student_id: record.student_id,
          session_id: record.session_id,
          attendance_date: record.attendance_date,
          status: record.status,
          excuse_reason: record.excuse_reason || null,
          gps_latitude: record.gps_latitude,
          gps_longitude: record.gps_longitude,
          gps_accuracy: record.gps_accuracy,
          gps_timestamp: record.gps_timestamp,
          marked_by: record.marked_by,
          marked_at: record.marked_at,
          host_address: record.host_address || null,
          student_name: student.name || 'Unknown',
          course_id: session.course_id || '',
          course_name: course.course_name || 'Unknown',
          teacher_id: session.teacher_id || '',
          instructor_name: teacher.name || 'Unknown',
          session_location: session.location || null,
        };
      });

      setRecords(formattedRecords);
    } catch (error) {
      console.error('Error loading records:', error);
    }
    setLoading(false);
  };

  const applyFilters = () => {
    let filtered = [...records];

    // Filter by student
    if (filters.student_id) {
      filtered = filtered.filter(r => r.student_id === filters.student_id);
    }

    // Filter by course
    if (filters.course_id) {
      filtered = filtered.filter(r => r.course_id === filters.course_id);
    }

    // Filter by instructor
    if (filters.teacher_id) {
      filtered = filtered.filter(r => r.teacher_id === filters.teacher_id);
    }

    // Filter by status
    if (filters.status) {
      filtered = filtered.filter(r => r.status === filters.status);
    }

    // Filter by date range
    if (filters.startDate) {
      filtered = filtered.filter(r => r.attendance_date >= filters.startDate);
    }
    if (filters.endDate) {
      filtered = filtered.filter(r => r.attendance_date <= filters.endDate);
    }

    setFilteredRecords(filtered);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on time': return 'bg-green-100 text-green-800';
      case 'absent': return 'bg-red-100 text-red-800';
      case 'late': return 'bg-yellow-100 text-yellow-800';
      case 'excused': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'on time': return 'On Time';
      case 'absent': return 'Absent';
      case 'late': return 'Late';
      case 'excused': return 'Excused';
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
      alert('Please show analytics first to export analytics data');
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
      'مؤشر الانتظام',
      'متوسط المعدل (%)',
      'أدنى معدل (%)',
      'أعلى معدل (%)'
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
      'Consistency Index',
      'Avg Rate (%)',
      'Min Rate (%)',
      'Max Rate (%)'
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
        parseFloat(student.consistencyIndex.toFixed(2)),
        parseFloat(student.avgRate.toFixed(1)),
        parseFloat(student.minRate.toFixed(1)),
        parseFloat(student.maxRate.toFixed(1))
      ];
    });

    // Attendance by Date Sheet
    const dateHeaders = isArabic ? [
      'التاريخ',
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
      return [
        format(new Date(dateData.date), 'MMM dd, yyyy'),
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
    XLSX.writeFile(wb, `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const exportAnalyticsToPDF = () => {
    if (!showAnalytics || studentAnalytics.length === 0 || dateAnalytics.length === 0) {
      alert('Please show analytics first to export PDF report');
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
    });

    // Date Analytics Table
    const performanceTableY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 46;
    doc.setFontSize(12);
    doc.text('Attendance by Date', 14, performanceTableY + 10);

    autoTable(doc, {
      startY: performanceTableY + 14,
      head: [['Date', 'Host Address', 'On Time', 'Late', 'Excused', 'Absent', 'Rate %', 'On Time Names', 'Late Names', 'Excused Names', 'Absent Names']],
      body: dateAnalytics.map((dateData) => {
        let excusedLabel = dateData.excusedNames.join(', ') || '-';
        if (
          dateData.hostAddress === 'SESSION_NOT_HELD' ||
          (dateData.hostAddress && dateData.hostAddress.toUpperCase() === 'SESSION_NOT_HELD')
        ) {
          excusedLabel = reportLanguage === 'ar' ? 'جميع الطلاب' : 'All Students';
        }
        return [
          format(new Date(dateData.date), 'MMM dd, yyyy'),
          dateData.hostAddress || '-',
          dateData.presentCount,
          dateData.lateCount,
          dateData.excusedAbsentCount,
          dateData.unexcusedAbsentCount,
          `${dateData.attendanceRate}%`,
          dateData.presentNames.join(', ') || '-',
          dateData.lateNames.join(', ') || '-',
          excusedLabel,
          dateData.absentNames.join(', ') || '-'
        ];
      }),
      styles: { fontSize: 6, cellPadding: 1.5 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 6 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 25 },
        2: { cellWidth: 10 },
        3: { cellWidth: 10 },
        4: { cellWidth: 10 },
        5: { cellWidth: 10 },
        6: { cellWidth: 12 },
        7: { cellWidth: 'auto' },
        8: { cellWidth: 'auto' },
        9: { cellWidth: 'auto' },
        10: { cellWidth: 'auto' }
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
        columnStyles: {
          0: { cellWidth: 15 },
          1: { cellWidth: 60 },
          2: { cellWidth: 25 },
          3: { cellWidth: 'auto' }
        },
      });
    }

    doc.save(`analytics-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const resetFilters = () => {
    setFilters({
      student_id: '',
      course_id: '',
      teacher_id: '',
      status: '',
      startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd'),
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

  // Calculate advanced analytics
  const calculateAnalytics = () => {
    // Get unique dates and students
    const uniqueDates = [...new Set(filteredRecords.map(r => r.attendance_date))].sort();
    const uniqueStudents = [...new Set(filteredRecords.map(r => r.student_id))];
    const daysCovered = uniqueDates.length;

    // Calculate student analytics
    const studentStats: StudentAnalytics[] = uniqueStudents.map(studentId => {
      const studentRecords = filteredRecords.filter(r => r.student_id === studentId);
      const studentName = studentRecords[0]?.student_name || 'Unknown';

      const presentCount = studentRecords.filter(r => r.status === 'on time').length;
      const absentCount = studentRecords.filter(r => r.status === 'absent').length;
      const excusedCount = studentRecords.filter(r => r.status === 'excused').length;
      const lateCount = studentRecords.filter(r => r.status === 'late').length;

      // Calculate rates (no vacation status in AttendanceRecords)
      // Effective base: All dates covered minus excused days (students are accountable for all dates)
      const effectiveBase = daysCovered - excusedCount;
      // Attendance rate: Present (On Time + Late) / Effective Days
      const totalPresent = presentCount + lateCount;
      const attendanceRate = effectiveBase > 0 ? (totalPresent / effectiveBase) * 100 : 0;

      // Unexcused absences should be calculated as: Effective Days - Present
      // (i.e. accountable days minus days the student was present/on-time or late)
      const unexcusedAbsent = effectiveBase > 0 ? Math.max(0, effectiveBase - totalPresent) : 0;

      // Calculate weighted score (3-component formula)
      // 80% Attendance Rate + 10% Effective Days Coverage + 10% Punctuality
      // Effective days percentage: now always 100% since effectiveBase = daysCovered - excusedCount
      const effectiveDaysPercentage = daysCovered > 0 ? (effectiveBase / daysCovered) * 100 : 0;
      const punctualityPercentage = totalPresent > 0 ? (presentCount / totalPresent) * 100 : 0;
      const weightedScore = (0.8 * attendanceRate) + (0.1 * effectiveDaysPercentage) + (0.1 * punctualityPercentage);

      // Calculate consistency index (based on all present days: on time + late)
      const dailyPattern = uniqueDates.map(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (!record || record.status === 'excused') return -1; // Exclude excused
        return (record.status === 'on time' || record.status === 'late') ? 1 : 0;
      }).filter(v => v !== -1);

      const consistencyIndex = calculateConsistencyIndex(dailyPattern);

      // Calculate trend
      const cumulativeRates = calculateCumulativeRates(studentId, uniqueDates, filteredRecords);
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
      
      uniqueDates.forEach(date => {
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
        daysCovered,
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

    // Calculate date analytics
    const dateStats: DateAnalytics[] = uniqueDates.map(date => {
      const dateRecords = filteredRecords.filter(r => r.attendance_date === date);
      const presentRecords = dateRecords.filter(r => r.status === 'on time');
      const absentRecords = dateRecords.filter(r => r.status === 'absent');
      const excusedRecords = dateRecords.filter(r => r.status === 'excused');
      const lateRecords = dateRecords.filter(r => r.status === 'late');
      
      const presentCount = presentRecords.length;
      const absentCount = absentRecords.length;
      const excusedCount = excusedRecords.length;
      const lateCount = lateRecords.length;
      
      // Calculate unmarked students (students with no record for this date)
      const studentsWithRecords = new Set(dateRecords.map(r => r.student_id));
      const unmarkedStudents = uniqueStudents.filter(sid => !studentsWithRecords.has(sid));
      const unmarkedCount = unmarkedStudents.length;
      
      // Get names of unmarked students
      const unmarkedNames = unmarkedStudents.map(sid => {
        const record = filteredRecords.find(r => r.student_id === sid);
        return record?.student_name || 'Unknown';
      });
      
      // Unexcused absents = explicitly marked absent + unmarked students
      const unexcusedAbsentCount = absentCount + unmarkedCount;
      // Total accountable = all students minus excused
      const totalStudentsOnDate = uniqueStudents.length;
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
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDateAnalytics(dateStats);
  };

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
      
      // Exclude excused from trend calculation
      if (record && record.status !== 'excused') {
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
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Attendance Records</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            View all attendance records with GPS location tracking
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowAnalytics(!showAnalytics)} className="text-xs sm:text-sm">
            {showAnalytics ? 'Hide' : 'Show'} Analytics
          </Button>
          {showAnalytics && (
            <>
              <div className="flex items-center gap-1 border border-gray-300 rounded-md">
                <button
                  onClick={() => setReportLanguage('en')}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-l-md transition-colors ${
                    reportLanguage === 'en' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setReportLanguage('ar')}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-r-md transition-colors ${
                    reportLanguage === 'ar' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  ع
                </button>
              </div>
              <Button variant="outline" onClick={exportAnalyticsToExcel} className="text-xs sm:text-sm">
                📊 Export Excel
              </Button>
              <Button variant="outline" onClick={exportAnalyticsToPDF} className="text-xs sm:text-sm">
                📄 Export PDF
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => setShowBulkImport(!showBulkImport)} className="text-xs sm:text-sm">
            {showBulkImport ? 'Hide' : 'Show'} Import
          </Button>
          <Button variant="outline" onClick={resetFilters} className="text-xs sm:text-sm">
            Reset
          </Button>
          <Button onClick={exportToCSV} className="text-xs sm:text-sm">
            📥 Export
          </Button>
          <Button onClick={loadRecords} className="text-xs sm:text-sm">
            🔄 Refresh
          </Button>
        </div>
      </div>

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

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">Total Records</div>
          <div className="text-2xl font-bold text-gray-900">{filteredRecords.length}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg shadow">
          <div className="text-sm text-green-600">On Time</div>
          <div className="text-2xl font-bold text-green-900">
            {filteredRecords.filter(r => r.status === 'on time').length}
          </div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg shadow">
          <div className="text-sm text-red-600">Absent</div>
          <div className="text-2xl font-bold text-red-900">
            {filteredRecords.filter(r => r.status === 'absent').length}
          </div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg shadow">
          <div className="text-sm text-yellow-600">Late</div>
          <div className="text-2xl font-bold text-yellow-900">
            {filteredRecords.filter(r => r.status === 'late').length}
          </div>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg shadow">
          <div className="text-sm text-blue-600">Excused</div>
          <div className="text-2xl font-bold text-blue-900">
            {filteredRecords.filter(r => r.status === 'excused').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Filters</h2>
          <div className="flex gap-2">
            <button
              onClick={quickFilterLastWeek}
              className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition"
            >
              Last Week
            </button>
            <button
              onClick={quickFilterLastMonth}
              className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition"
            >
              Last Month
            </button>
            <button
              onClick={quickFilterAbsentOnly}
              className="text-xs px-3 py-1 bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition"
            >
              Absent Only
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Student
            </label>
            <Select
              value={filters.student_id}
              onChange={(value) => setFilters({ ...filters, student_id: value })}
              options={[{ value: '', label: 'All Students' }, ...students]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Course
            </label>
            <Select
              value={filters.course_id}
              onChange={(value) => setFilters({ ...filters, course_id: value })}
              options={[{ value: '', label: 'All Courses' }, ...courses]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Instructor
            </label>
            <Select
              value={filters.teacher_id}
              onChange={(value) => setFilters({ ...filters, teacher_id: value })}
              options={[{ value: '', label: 'All Instructors' }, ...instructors]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto max-h-[400px] sm:max-h-[600px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => handleSort('attendance_date')}
                >
                  <div className="flex items-center gap-1">
                    Date
                    <span className="opacity-0 group-hover:opacity-100">
                      {sortColumn === 'attendance_date' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </div>
                </th>
                <th 
                  className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors group"
                  onClick={() => handleSort('student_name')}
                >
                  <div className="flex items-center gap-1">
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
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                        >
                          🗺️ View Map
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {filteredRecords.length > 0 && (
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
        )}
      </div>
    </div>
  );
};

export default AttendanceRecords;
