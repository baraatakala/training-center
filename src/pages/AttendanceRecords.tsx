import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format, subDays } from 'date-fns';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { BulkImport } from '../components/BulkImport';
import { Pagination } from '../components/ui/Pagination';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface AttendanceRecord {
  attendance_id: string;
  student_id: string;
  session_id: string;
  attendance_date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
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
  absenteeismRate: number;
  presentNames: string[];
  lateNames: string[];
  excusedNames: string[];
  absentNames: string[];
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
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics[]>([]);
  const [dateAnalytics, setDateAnalytics] = useState<DateAnalytics[]>([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  
  // Filter state
  const [filters, setFilters] = useState<FilterOptions>({
    student_id: '',
    course_id: '',
    teacher_id: '',
    status: '',
    startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // Dropdown options
  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [courses, setCourses] = useState<{ value: string; label: string }[]>([]);
  const [instructors, setInstructors] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    loadFilterOptions();
    loadRecords();
  }, []);

  useEffect(() => {
    applyFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, filters]);

  useEffect(() => {
    if (showAnalytics && filteredRecords.length > 0) {
      calculateAnalytics();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnalytics, filteredRecords]);

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
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          gps_timestamp,
          marked_by,
          marked_at,
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
          gps_latitude: record.gps_latitude,
          gps_longitude: record.gps_longitude,
          gps_accuracy: record.gps_accuracy,
          gps_timestamp: record.gps_timestamp,
          marked_by: record.marked_by,
          marked_at: record.marked_at,
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
      case 'present': return 'bg-green-100 text-green-800';
      case 'absent': return 'bg-red-100 text-red-800';
      case 'late': return 'bg-yellow-100 text-yellow-800';
      case 'excused': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
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
      record.session_location || '-',
      record.gps_latitude || '-',
      record.gps_longitude || '-',
      record.gps_accuracy ? `${record.gps_accuracy}m` : '-',
      record.marked_by || '-',
      record.marked_at ? format(new Date(record.marked_at), 'MMM dd, yyyy HH:mm') : '-'
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-records-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const exportAnalyticsToCSV = () => {
    if (!showAnalytics || studentAnalytics.length === 0) {
      alert('Please show analytics first to export analytics data');
      return;
    }

    const headers = [
      'Rank',
      'Student Name',
      'Present',
      'Unexcused Absent',
      'Excused',
      'Effective Days',
      'Days Covered',
      'Attendance Rate (%)',
      'Weighted Score',
      'Consistency Index',
      'Trend Classification',
      'Trend Slope (%/week)',
      'R-Squared',
      'Weekly Change (%)',
      'Avg Rate (%)',
      'Min Rate (%)',
      'Max Rate (%)'
    ];

    const rows = studentAnalytics.map((student, index) => [
      index + 1,
      student.student_name,
      student.presentCount,
      student.unexcusedAbsent,
      student.excusedCount,
      student.effectiveDays,
      student.daysCovered,
      student.attendanceRate,
      student.weightedScore,
      student.consistencyIndex.toFixed(2),
      student.trend.classification,
      student.trend.slope,
      student.trend.rSquared,
      student.weeklyChange.toFixed(1),
      student.avgRate.toFixed(1),
      student.minRate.toFixed(1),
      student.maxRate.toFixed(1)
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const exportAnalyticsToPDF = () => {
    if (!showAnalytics || studentAnalytics.length === 0 || dateAnalytics.length === 0) {
      alert('Please show analytics first to export PDF report');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    
    // Title
    doc.setFontSize(18);
    doc.text('Attendance Analytics Report', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, 22, { align: 'center' });
    doc.text(`Date Range: ${format(new Date(filters.startDate), 'MMM dd, yyyy')} - ${format(new Date(filters.endDate), 'MMM dd, yyyy')}`, pageWidth / 2, 28, { align: 'center' });

    // Student Performance Table
    doc.setFontSize(14);
    doc.text('Student Performance Summary', 14, 38);
    
    autoTable(doc, {
      startY: 42,
      head: [['Rank', 'Student', 'Present', 'On Time', 'Late', 'Absent', 'Excused', 'Rate %', 'Score', 'Trend']],
      body: studentAnalytics.slice(0, 20).map((student, index) => [
        index + 1,
        student.student_name,
        student.presentCount + student.lateCount,
        student.presentCount,
        student.lateCount,
        student.unexcusedAbsent,
        student.excusedCount,
        `${student.attendanceRate}%`,
        student.weightedScore.toFixed(1),
        student.trend.classification
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    // Date Analytics Table
    const finalY = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 42;
    doc.setFontSize(14);
    doc.text('Attendance by Date', 14, finalY + 15);

    autoTable(doc, {
      startY: finalY + 19,
      head: [['Date', 'Present', 'Late', 'Excused', 'Absent', 'Rate %', 'Present Names', 'Late Names', 'Excused Names', 'Absent Names']],
      body: dateAnalytics.map((dateData) => [
        format(new Date(dateData.date), 'MMM dd, yyyy'),
        dateData.presentCount,
        dateData.lateCount,
        dateData.excusedAbsentCount,
        dateData.unexcusedAbsentCount,
        `${dateData.absenteeismRate}%`,
        dateData.presentNames.join(', ') || '-',
        dateData.lateNames.join(', ') || '-',
        dateData.excusedNames.join(', ') || '-',
        dateData.absentNames.join(', ') || '-'
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 12 },
        2: { cellWidth: 12 },
        3: { cellWidth: 12 },
        4: { cellWidth: 12 },
        5: { cellWidth: 15 },
        6: { cellWidth: 'auto' },
        7: { cellWidth: 'auto' },
        8: { cellWidth: 'auto' },
        9: { cellWidth: 'auto' }
      },
    });

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

      const presentCount = studentRecords.filter(r => r.status === 'present').length;
      const absentCount = studentRecords.filter(r => r.status === 'absent').length;
      const excusedCount = studentRecords.filter(r => r.status === 'excused').length;
      const lateCount = studentRecords.filter(r => r.status === 'late').length;
      const unexcusedAbsent = absentCount; // 'absent' status already means unexcused

      // Calculate rates (no vacation status in AttendanceRecords)
      const totalRecords = studentRecords.length;
      const effectiveBase = totalRecords - excusedCount; // Excused days don't count
      // Attendance rate: Present (On Time + Late) / Effective Days
      const totalPresent = presentCount + lateCount;
      const attendanceRate = effectiveBase > 0 ? (totalPresent / effectiveBase) * 100 : 0;

      // Calculate weighted score (2-component formula - no vacation tracking in this page)
      // 80% Attendance Rate + 20% Excuse Discipline
      // Note: Analytics page uses 3-component with vacation tracking
      const excuseDiscipline = totalRecords > 0 
        ? (1 - excusedCount / totalRecords) * 100 
        : 100;
      const weightedScore = (0.8 * attendanceRate) + (0.2 * excuseDiscipline);

      // Calculate consistency index
      const dailyPattern = uniqueDates.map(date => {
        const record = studentRecords.find(r => r.attendance_date === date);
        if (!record || record.status === 'excused') return -1; // Exclude excused
        return record.status === 'present' ? 1 : 0;
      }).filter(v => v !== -1);

      const consistencyIndex = calculateConsistencyIndex(dailyPattern);

      // Calculate trend
      const cumulativeRates = calculateCumulativeRates(studentId, uniqueDates, filteredRecords);
      const trend = calculateTrend(cumulativeRates.slice(-6)); // Last 6 samples

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
        weeklyChange: cumulativeRates.length > 1 ? 
          cumulativeRates[cumulativeRates.length - 1] - cumulativeRates[cumulativeRates.length - 2] : 0,
        avgRate: cumulativeRates.length > 0 ? 
          cumulativeRates.reduce((a, b) => a + b, 0) / cumulativeRates.length : 0,
        minRate: cumulativeRates.length > 0 ? Math.min(...cumulativeRates) : 0,
        maxRate: cumulativeRates.length > 0 ? Math.max(...cumulativeRates) : 0,
      };
    }).sort((a, b) => b.weightedScore - a.weightedScore);

    setStudentAnalytics(studentStats);

    // Calculate date analytics
    const dateStats: DateAnalytics[] = uniqueDates.map(date => {
      const dateRecords = filteredRecords.filter(r => r.attendance_date === date);
      const presentRecords = dateRecords.filter(r => r.status === 'present');
      const absentRecords = dateRecords.filter(r => r.status === 'absent');
      const excusedRecords = dateRecords.filter(r => r.status === 'excused');
      const lateRecords = dateRecords.filter(r => r.status === 'late');
      
      const presentCount = presentRecords.length;
      const absentCount = absentRecords.length;
      const excusedCount = excusedRecords.length;
      const lateCount = lateRecords.length;
      
      // Unexcused absents are 'absent' status only (not just missing records)
      const unexcusedAbsentCount = absentCount;
      // Total accountable = all who had a record and weren't excused
      const totalAccountable = presentCount + absentCount + lateCount;
      // Attendance rate: (Present + Late) / Total Accountable
      const attendanceRate = totalAccountable > 0 ? ((presentCount + lateCount) / totalAccountable) * 100 : 0;

      return {
        date,
        presentCount,
        unexcusedAbsentCount,
        excusedAbsentCount: excusedCount,
        lateCount,
        absenteeismRate: Math.round(attendanceRate * 10) / 10,
        presentNames: presentRecords.map(r => r.student_name),
        lateNames: lateRecords.map(r => r.student_name),
        excusedNames: excusedRecords.map(r => r.student_name),
        absentNames: absentRecords.map(r => r.student_name),
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDateAnalytics(dateStats);
  };

  const calculateConsistencyIndex = (pattern: number[]): number => {
    if (pattern.length < 2) return 1.0;
    
    const mean = pattern.reduce((a, b) => a + b, 0) / pattern.length;
    if (mean === 0) return 1.0;
    
    const variance = pattern.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pattern.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.max(0, 1 - (stdDev / mean));
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
        if (record.status === 'present') {
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
              <Button variant="outline" onClick={exportAnalyticsToCSV} className="text-xs sm:text-sm">
                📊 Export CSV
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
              <div className="border-l-4 border-red-500 pl-3 sm:pl-4">
                <div className="text-xs sm:text-sm text-gray-600">Avg Absenteeism</div>
                <div className="text-xl sm:text-2xl font-bold">
                  {dateAnalytics.length > 0
                    ? Math.round(
                        dateAnalytics.reduce((sum, d) => sum + d.absenteeismRate, 0) /
                          dateAnalytics.length
                      )
                    : 0}
                  %
                </div>
              </div>
            </div>
          </div>

          {/* Analytics Legend */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">📖 Metrics Guide</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-blue-800">
              <div>
                <strong>Attendance Rate:</strong> (Present + Late) / (Total - Excused) × 100
              </div>
              <div>
                <strong>Weighted Score:</strong> (0.8 × Attendance Rate) + (0.2 × Excuse Discipline)
              </div>
              <div>
                <strong>CI (Consistency Index):</strong> max(0, 1 - σ/μ) of attendance pattern
              </div>
              <div>
                <strong>Trend:</strong> Linear regression on last 6 attendance rates
              </div>
              <div>
                <strong>R²:</strong> Goodness of fit (0-1, higher = more reliable trend)
              </div>
              <div>
                <strong>Weekly Δ:</strong> Change from previous week's attendance rate
              </div>
            </div>
          </div>

          {/* Performance Insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Best Performers */}
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-green-900 mb-3 flex items-center gap-2">
                🏆 Top Performers
              </h3>
              <div className="space-y-2">
                {studentAnalytics.slice(0, 3).map((student, idx) => (
                  <div key={student.student_id} className="flex justify-between items-center text-xs">
                    <span className="font-medium text-green-800">
                      {idx + 1}. {student.student_name}
                    </span>
                    <span className="font-bold text-green-900">{student.weightedScore}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Students Needing Support */}
            <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border border-yellow-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                ⚠️ Needs Attention
              </h3>
              <div className="space-y-2">
                {studentAnalytics
                  .filter(s => s.attendanceRate < 70)
                  .slice(-3)
                  .map((student) => (
                    <div key={student.student_id} className="flex justify-between items-center text-xs">
                      <span className="font-medium text-yellow-800">{student.student_name}</span>
                      <span className="font-bold text-yellow-900">{student.attendanceRate}%</span>
                    </div>
                  ))}
                {studentAnalytics.filter(s => s.attendanceRate < 70).length === 0 && (
                  <div className="text-xs text-yellow-700 italic">All students doing well! 🎉</div>
                )}
              </div>
            </div>

            {/* Trend Insights */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                📈 Trend Summary
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-blue-800">Improving:</span>
                  <span className="font-bold text-green-700">
                    {studentAnalytics.filter(s => s.trend.classification === 'IMPROVING').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-800">Stable:</span>
                  <span className="font-bold text-blue-700">
                    {studentAnalytics.filter(s => s.trend.classification === 'STABLE').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-800">Declining:</span>
                  <span className="font-bold text-red-700">
                    {studentAnalytics.filter(s => s.trend.classification === 'DECLINING').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-800">Volatile:</span>
                  <span className="font-bold text-yellow-700">
                    {studentAnalytics.filter(s => s.trend.classification === 'VOLATILE').length}
                  </span>
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
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Weighted Score</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Trend</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Weekly Δ</th>
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
                      <td className="px-4 py-3 text-sm text-center font-semibold text-purple-600">
                        {student.weightedScore}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <div className="flex flex-col items-center">
                          <span className={`text-xs font-medium px-2 py-1 rounded ${
                            student.trend.classification === 'IMPROVING' ? 'bg-green-100 text-green-800' :
                            student.trend.classification === 'DECLINING' ? 'bg-red-100 text-red-800' :
                            student.trend.classification === 'VOLATILE' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {student.trend.classification}
                          </span>
                          <span className="text-xs text-gray-500 mt-1">
                            {student.trend.slope > 0 ? '+' : ''}{student.trend.slope}%/wk
                          </span>
                          <span className="text-xs text-gray-400">(R²={student.trend.rSquared})</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={student.weeklyChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {student.weeklyChange > 0 ? '+' : ''}{student.weeklyChange.toFixed(1)}%
                        </span>
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
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Present</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Late</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Excused</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Absent</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Present Names</th>
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
                          dateData.absenteeismRate >= 90 ? 'bg-green-100 text-green-800' :
                          dateData.absenteeismRate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {dateData.absenteeismRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.presentNames.length > 0 ? dateData.presentNames.join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.lateNames.length > 0 ? dateData.lateNames.join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs">
                        {dateData.excusedNames.length > 0 ? dateData.excusedNames.join(', ') : '-'}
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
          <div className="text-sm text-green-600">Present</div>
          <div className="text-2xl font-bold text-green-900">
            {filteredRecords.filter(r => r.status === 'present').length}
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
                { value: 'present', label: 'Present' },
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
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Date
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Student
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Course
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Instructor
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Location
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  GPS
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Marked At
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    Loading records...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    No attendance records found
                  </td>
                </tr>
              ) : (
                filteredRecords
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
                        {record.status}
                      </span>
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
