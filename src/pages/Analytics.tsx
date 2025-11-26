/**
 * Analytics Dashboard Page
 * Comprehensive attendance analytics with charts, metrics, and export functionality
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { format, subDays } from 'date-fns';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { pdfExportService } from '../services/pdfExportService';
import type { AttendanceReportData } from '../services/pdfExportService';
import { excelExportService } from '../services/excelExportService';

interface DateFilter {
  startDate: string;
  endDate: string;
}

interface EnhancedStudentAnalytics extends AttendanceReportData {
  course_name: string;
  teacher_name: string;
  consistency_index: number;
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

type StudentAnalytics = AttendanceReportData;

const COLORS = {
  present: '#22c55e',
  absent: '#ef4444',
  late: '#f59e0b',
  excused: '#3b82f6',
  vacation: '#8b5cf6'
};

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentAnalytics[]>([]);
  const [enhancedStudents, setEnhancedStudents] = useState<EnhancedStudentAnalytics[]>([]);
  const [sessions, setSessions] = useState<Array<{ session_id: string; session_name: string }>>([]);
  const [selectedSession, setSelectedSession] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    startDate: format(subDays(new Date(), 365), 'yyyy-MM-dd'), // Last year by default
    endDate: format(new Date(), 'yyyy-MM-dd')
  });

  const [statusDistribution, setStatusDistribution] = useState<Array<{ name: string; value: number }>>([]);
  const [dailyTrends, setDailyTrends] = useState<Array<{ date: string; present: number; absent: number; late: number }>>([]);
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (dateFilter.startDate && dateFilter.endDate) {
      loadAnalytics();
    }
  }, [selectedSession, dateFilter]);

  const loadSessions = async () => {
    const { data } = await supabase
      .from(Tables.SESSION)
      .select('session_id, course:course_id(course_name)')
      .order('created_at', { ascending: false });

    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedSessions = data.map((s: any) => ({
        session_id: s.session_id,
        session_name: s.course?.course_name || 'Unnamed Session'
      }));
      setSessions(mappedSessions);
    }
  };

  const loadAnalytics = async () => {
    setLoading(true);

    try {
      // Build query - include session and course details
      let query = supabase
        .from(Tables.ATTENDANCE)
        .select(`
          attendance_id,
          status,
          check_in_time,
          attendance_date,
          notes,
          session_id,
          student:student_id(student_id, name, email),
          enrollment:enrollment_id(
            session:session_id(
              course:course_id(course_name),
              teacher:teacher_id(name)
            )
          )
        `)
        .gte('attendance_date', dateFilter.startDate)
        .lte('attendance_date', dateFilter.endDate);

      const { data: attendanceData } = await query;

      if (!attendanceData) {
        setLoading(false);
        return;
      }

      // Filter out pending/unmarked records - only count actual attendance data
      const validAttendanceData = attendanceData.filter((a: any) => 
        a.status !== 'pending' && a.status !== null
      );

      // Filter by session if selected
      const filteredData = selectedSession === 'all'
        ? validAttendanceData
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : validAttendanceData.filter((a: any) => a.session_id === selectedSession);

      // Calculate unique dates covered for effective days percentage
      const allUniqueDates = [...new Set(filteredData.map((r: any) => r.attendance_date))].filter(Boolean);
      const daysCovered = allUniqueDates.length;

      // Aggregate by enrollment (student + session combination)
      const enrollmentMap = new Map<string, StudentAnalytics & { course_name: string; teacher_name: string }>();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filteredData.forEach((record: any) => {
        const student = Array.isArray(record.student) ? record.student[0] : record.student;
        const enrollment = Array.isArray(record.enrollment) ? record.enrollment[0] : record.enrollment;
        const session = Array.isArray(enrollment?.session) ? enrollment.session[0] : enrollment?.session;
        const course = Array.isArray(session?.course) ? session.course[0] : session?.course;
        const teacher = Array.isArray(session?.teacher) ? session.teacher[0] : session?.teacher;
        
        if (!student || !record.session_id) return;

        // Use combination of student_id and session_id as key
        const enrollmentKey = `${student.student_id}-${record.session_id}`;
        
        if (!enrollmentMap.has(enrollmentKey)) {
          enrollmentMap.set(enrollmentKey, {
            student_name: student.name,
            student_email: student.email,
            course_name: course?.course_name || 'Unknown Course',
            teacher_name: teacher?.name || 'Unknown Teacher',
            total_records: 0,
            present_count: 0,
            absent_count: 0,
            late_count: 0,
            excused_count: 0,
            vacation_count: 0,
            raw_attendance_rate: 0,
            effective_attendance_rate: 0,
            effective_days: 0,
            total_days: 0,
            unexcused_absent: 0,
            weighted_score: 0
          });
        }

        const enrollmentData = enrollmentMap.get(enrollmentKey)!;
        enrollmentData.total_records++;

        if (record.status === 'present') enrollmentData.present_count++;
        if (record.status === 'absent') enrollmentData.absent_count++;
        if (record.status === 'late') enrollmentData.late_count++;
        if (record.status === 'excused') enrollmentData.excused_count++;
        if (record.status === 'vacation') enrollmentData.vacation_count++;
      });

      // Calculate rates and scores
      const studentsArray = Array.from(enrollmentMap.values()).map((student) => {
        const rawRate = student.total_records > 0
          ? (student.present_count / student.total_records) * 100
          : 0;
        // Effective base: All dates covered minus vacation and excused (students accountable for all dates)
        const effectiveBase = daysCovered - student.vacation_count - student.excused_count;
        // Count 'late' as attended (they showed up, just not on time)
        const attendedCount = student.present_count + student.late_count;
        const effectiveRate = effectiveBase > 0
          ? (attendedCount / effectiveBase) * 100
          : 0;
        const unexcusedAbsent = student.absent_count; // 'absent' status already means unexcused

        // Weighted score calculation (3-component formula) - MATCHES AttendanceRecords.tsx
        // 80% Attendance Rate + 10% Effective Days Coverage + 10% Punctuality
        // effectiveBase = daysCovered - vacation - excused (all students accountable for all dates)
        // daysCovered = unique dates in the filtered period
        const effectiveDaysPercent = daysCovered > 0 
          ? (effectiveBase / daysCovered) * 100 
          : 0;
        const punctualityPercentage = attendedCount > 0
          ? (student.present_count / attendedCount) * 100
          : 0;
        const weightedScore = (0.8 * effectiveRate) + (0.1 * effectiveDaysPercent) + (0.1 * punctualityPercentage);

        return {
          ...student,
          effective_days: effectiveBase,
          total_days: daysCovered,
          raw_attendance_rate: parseFloat(rawRate.toFixed(2)),
          effective_attendance_rate: parseFloat(effectiveRate.toFixed(2)),
          unexcused_absent: unexcusedAbsent,
          weighted_score: parseFloat(weightedScore.toFixed(2))
        };
      });

      setStudents(studentsArray);

      // Calculate enhanced metrics (CI, trends)
      if (showAdvancedMetrics) {
        calculateEnhancedMetrics(studentsArray, filteredData);
      }

      // Calculate status distribution
      const statusCounts = {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        vacation: 0
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filteredData.forEach((record: any) => {
        if (record.status in statusCounts) {
          statusCounts[record.status as keyof typeof statusCounts]++;
        }
      });

      setStatusDistribution([
        { name: 'Present', value: statusCounts.present },
        { name: 'Absent', value: statusCounts.absent },
        { name: 'Late', value: statusCounts.late },
        { name: 'Excused', value: statusCounts.excused },
        { name: 'Vacation', value: statusCounts.vacation }
      ]);

      // Calculate daily trends
      const dailyMap = new Map<string, { present: number; absent: number; late: number }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filteredData.forEach((record: any) => {
        if (!record.attendance_date) return;

        const date = format(new Date(record.attendance_date), 'MMM dd');
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { present: 0, absent: 0, late: 0 });
        }

        const dayData = dailyMap.get(date)!;
        if (record.status === 'present') dayData.present++;
        if (record.status === 'absent') dayData.absent++;
        if (record.status === 'late') dayData.late++;
      });

      const trends = Array.from(dailyMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setDailyTrends(trends);

    } catch (error) {
      console.error('Error loading analytics:', error);
    }

    setLoading(false);
  };

  const handleExportPDF = () => {
    const dateRange = `${format(new Date(dateFilter.startDate), 'PP')} - ${format(new Date(dateFilter.endDate), 'PP')}`;
    const sessionName = selectedSession === 'all'
      ? 'All Sessions'
      : sessions.find((s) => s.session_id === selectedSession)?.session_name;

    pdfExportService.generateReport(students, dateRange, undefined, sessionName);
  };

  const handleExportExcel = async () => {
    // Fetch detailed attendance records for Excel export
    const query = supabase
      .from(Tables.ATTENDANCE)
      .select(`
        attendance_id,
        status,
        check_in_time,
        attendance_date,
        notes,
        gps_latitude,
        gps_longitude,
        gps_accuracy,
        student:student_id(student_id, name, email),
        session_id,
        enrollment:enrollment_id(
          session:session_id(
            course:course_id(course_name),
            location
          )
        )
      `)
      .gte('attendance_date', dateFilter.startDate)
      .lte('attendance_date', dateFilter.endDate);

    const { data } = await query;

    if (!data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const excelData = data.map((record: any) => {
      const student = Array.isArray(record.student) ? record.student[0] : record.student;
      const enrollment = Array.isArray(record.enrollment) ? record.enrollment[0] : record.enrollment;
      const session = Array.isArray(enrollment?.session) ? enrollment.session[0] : enrollment?.session;
      const course = Array.isArray(session?.course) ? session.course[0] : session?.course;

      return {
        date: record.attendance_date ? format(new Date(record.attendance_date), 'PP') : 'N/A',
        student_name: student?.name || 'Unknown',
        student_email: student?.email || 'N/A',
        session_name: course?.course_name || 'N/A',
        location: session?.location || 'N/A',
        status: record.status,
        check_in_time: record.check_in_time ? format(new Date(record.check_in_time), 'PPpp') : null,
        notes: record.notes,
        gps_latitude: record.gps_latitude,
        gps_longitude: record.gps_longitude,
        gps_accuracy: record.gps_accuracy,
        marked_at: record.marked_at || null,
        marked_by: record.marked_by || null
      };
    });

    excelExportService.exportToExcel(excelData);
  };

  const setQuickFilter = (days: number) => {
    setDateFilter({
      startDate: format(subDays(new Date(), days), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd')
    });
  };

  // Calculate advanced analytics metrics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calculateEnhancedMetrics = (studentsArray: StudentAnalytics[], filteredData: any[]) => {
    const uniqueDates = [...new Set(filteredData.map(r => r.attendance_date))].sort();
    
    const enhanced = studentsArray.map(student => {
      const studentRecords = filteredData.filter((r: any) => {
        const recordStudent = Array.isArray(r.student) ? r.student[0] : r.student;
        return recordStudent?.email === student.student_email;
      });

      // Calculate consistency index
      const dailyPattern = uniqueDates.map(date => {
        const record = studentRecords.find((r: any) => r.attendance_date === date);
        if (!record || record.status === 'excused' || record.status === 'vacation') return -1;
        return record.status === 'present' ? 1 : 0;
      }).filter(v => v !== -1);

      const ci = calculateConsistencyIndex(dailyPattern);

      // Calculate cumulative rates for trend
      const cumulativeRates = calculateCumulativeRates(student.student_email, uniqueDates, filteredData);
      const trend = calculateTrend(cumulativeRates.slice(-6));

      return {
        ...student,
        consistency_index: ci,
        trend,
        weeklyChange: cumulativeRates.length > 1 ? 
          cumulativeRates[cumulativeRates.length - 1] - cumulativeRates[cumulativeRates.length - 2] : 0,
        avgRate: cumulativeRates.length > 0 ? 
          cumulativeRates.reduce((a, b) => a + b, 0) / cumulativeRates.length : 0,
        minRate: cumulativeRates.length > 0 ? Math.min(...cumulativeRates) : 0,
        maxRate: cumulativeRates.length > 0 ? Math.max(...cumulativeRates) : 0,
      } as EnhancedStudentAnalytics;
    });

    setEnhancedStudents(enhanced);
  };

  const calculateConsistencyIndex = (pattern: number[]): number => {
    if (pattern.length < 2) return 1.0;
    const mean = pattern.reduce((a, b) => a + b, 0) / pattern.length;
    if (mean === 0) return 1.0;
    const variance = pattern.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pattern.length;
    const stdDev = Math.sqrt(variance);
    return Math.max(0, 1 - (stdDev / mean));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calculateCumulativeRates = (studentEmail: string, dates: string[], allRecords: any[]): number[] => {
    const rates: number[] = [];
    let cumulativePresent = 0;
    let cumulativeTotal = 0;

    dates.forEach(date => {
      const record = allRecords.find((r: any) => {
        const student = Array.isArray(r.student) ? r.student[0] : r.student;
        return student?.email === studentEmail && r.attendance_date === date;
      });
      
      if (record && record.status !== 'excused' && record.status !== 'vacation') {
        cumulativeTotal++;
        if (record.status === 'present') cumulativePresent++;
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

    let numerator = 0, denominator = 0;
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
    if (rSquared < 0.3) classification = 'VOLATILE';
    else if (slope > 2) classification = 'IMPROVING';
    else if (slope < -2) classification = 'DECLINING';

    return {
      slope: Math.round(slope * 10) / 10,
      rSquared: Math.round(rSquared * 100) / 100,
      classification,
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg text-gray-600">Loading analytics...</div>
      </div>
    );
  }

  const totalRecords = students.reduce((sum, s) => sum + s.total_records, 0);
  const avgAttendanceRate = students.length > 0
    ? students.reduce((sum, s) => sum + s.effective_attendance_rate, 0) / students.length
    : 0;
  const avgWeightedScore = students.length > 0
    ? students.reduce((sum, s) => sum + s.weighted_score, 0) / students.length
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Attendance Analytics</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Performance metrics with insights</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button 
            onClick={() => setShowAdvancedMetrics(!showAdvancedMetrics)}
            variant="outline"
            className="text-xs sm:text-sm"
          >
            {showAdvancedMetrics ? 'Hide' : 'Show'} Advanced
          </Button>
          <Button onClick={handleExportPDF} className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm">
            📄 PDF
          </Button>
          <Button onClick={handleExportExcel} className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm">
            📊 Excel
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Session</label>
              <Select
                value={selectedSession}
                onChange={(value) => setSelectedSession(value)}
                options={[
                  { value: 'all', label: 'All Sessions' },
                  ...sessions.map((session) => ({
                    value: session.session_id,
                    label: session.session_name
                  }))
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={dateFilter.startDate}
                onChange={(e) => setDateFilter({ ...dateFilter, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={dateFilter.endDate}
                onChange={(e) => setDateFilter({ ...dateFilter, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => setQuickFilter(7)} className="text-sm">Last 7d</Button>
              <Button onClick={() => setQuickFilter(30)} className="text-sm">Last 30d</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardHeader>
            <CardTitle className="text-white">Total Students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{students.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardHeader>
            <CardTitle className="text-white">Total Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{totalRecords}</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardHeader>
            <CardTitle className="text-white">Avg Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{avgAttendanceRate.toFixed(1)}%</div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardHeader>
            <CardTitle className="text-white">Avg Weighted Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{avgWeightedScore.toFixed(1)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusDistribution.map((entry) => (
                    <Cell
                      key={`cell-${entry.name}`}
                      fill={COLORS[entry.name.toLowerCase() as keyof typeof COLORS]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Daily Trends Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Attendance Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="present" stroke={COLORS.present} strokeWidth={2} />
                <Line type="monotone" dataKey="absent" stroke={COLORS.absent} strokeWidth={2} />
                <Line type="monotone" dataKey="late" stroke={COLORS.late} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Advanced Metrics Section */}
      {showAdvancedMetrics && enhancedStudents.length > 0 && (
        <div className="space-y-6">
          {/* Performance Insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardHeader>
                <CardTitle className="text-green-900 text-sm">🏆 Top Performers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {enhancedStudents.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="font-medium text-green-800">{i + 1}. {s.student_name}</span>
                      <span className="font-bold text-green-900">{s.weighted_score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
              <CardHeader>
                <CardTitle className="text-yellow-900 text-sm">⚠️ Needs Attention</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {enhancedStudents.filter(s => s.effective_attendance_rate < 70).slice(-3).map((s, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="font-medium text-yellow-800">{s.student_name}</span>
                      <span className="font-bold text-yellow-900">{s.effective_attendance_rate}%</span>
                    </div>
                  ))}
                  {enhancedStudents.filter(s => s.effective_attendance_rate < 70).length === 0 && (
                    <div className="text-xs text-yellow-700 italic">All students doing well! 🎉</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-900 text-sm">📈 Trend Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-blue-800">Improving:</span>
                    <span className="font-bold text-green-700">
                      {enhancedStudents.filter(s => s.trend.classification === 'IMPROVING').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-800">Stable:</span>
                    <span className="font-bold text-blue-700">
                      {enhancedStudents.filter(s => s.trend.classification === 'STABLE').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-800">Declining:</span>
                    <span className="font-bold text-red-700">
                      {enhancedStudents.filter(s => s.trend.classification === 'DECLINING').length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Metrics Guide */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">📖 Advanced Metrics Guide</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-blue-800">
                <div><strong>CI (Consistency Index):</strong> 1 - (StdDev / Mean) of attendance pattern</div>
                <div><strong>Trend:</strong> Linear regression on last 6 rates</div>
                <div><strong>R²:</strong> Goodness of fit (0-1, higher = reliable)</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detailed Student Table */}
      <Card>
        <CardHeader>
          <CardTitle>Student Performance Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instructor</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Present</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Absent</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Late</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Excused</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Records</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">On-Time</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Effective Rate</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Score</th>
                  {showAdvancedMetrics && <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">CI</th>}
                  {showAdvancedMetrics && <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Trend</th>}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(showAdvancedMetrics && enhancedStudents.length > 0 ? enhancedStudents : students)
                  .sort((a, b) => b.weighted_score - a.weighted_score)
                  .map((student, index) => {
                    const onTimeCount = student.present_count;
                    const onTimeRate = student.total_records > 0 
                      ? ((onTimeCount / student.total_records) * 100).toFixed(1) 
                      : '0.0';
                    const enhanced = showAdvancedMetrics ? student as EnhancedStudentAnalytics : null;
                    
                    return (
                      <tr key={`${student.student_email}-${(student as any).course_name}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          #{index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{student.student_name}</div>
                          <div className="text-sm text-gray-500">{student.student_email}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {(student as any).course_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {(student as any).teacher_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-green-600 font-medium">
                          {student.present_count}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-red-600 font-medium">
                          {student.absent_count}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-yellow-600 font-medium">
                          {student.late_count}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-blue-600 font-medium">
                          {student.excused_count}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {student.total_records}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium text-green-700">
                          {onTimeRate}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span
                            className={`text-sm font-bold ${
                              student.effective_attendance_rate >= 90
                                ? 'text-green-600'
                                : student.effective_attendance_rate >= 75
                                ? 'text-yellow-600'
                                : 'text-red-600'
                            }`}
                          >
                            {student.effective_attendance_rate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-bold text-blue-600">
                          {student.weighted_score.toFixed(1)}
                        </td>
                        {showAdvancedMetrics && enhanced && (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-700">
                              {enhanced.consistency_index.toFixed(2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <div className="flex flex-col items-center">
                                <span className={`text-xs font-medium px-2 py-1 rounded ${
                                  enhanced.trend.classification === 'IMPROVING' ? 'bg-green-100 text-green-800' :
                                  enhanced.trend.classification === 'DECLINING' ? 'bg-red-100 text-red-800' :
                                  enhanced.trend.classification === 'VOLATILE' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {enhanced.trend.classification}
                                </span>
                                <span className="text-xs text-gray-500 mt-1">
                                  {enhanced.trend.slope > 0 ? '+' : ''}{enhanced.trend.slope}%/wk
                                </span>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
