import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { studentService } from '../services/studentService';
import { enrollmentService } from '../services/enrollmentService';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { format } from 'date-fns';

interface AbsentStudent {
  student_id: string;
  student_name: string;
  email: string;
  consecutiveAbsences: number;
  lastAbsenceDate: string;
  absentDates: string[];
  course_name: string;
  course_id: string;
  riskLevel: 'high';
}

export function Dashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    loading: true,
  });

  const [absentStudents, setAbsentStudents] = useState<AbsentStudent[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);

  const loadStats = async () => {
    const [studentsRes, enrollmentsRes, teachersRes, sessionsRes] = await Promise.all([
      studentService.getAll(),
      enrollmentService.getActive(),
      supabase.from(Tables.TEACHER).select('teacher_id'),
      supabase.from(Tables.SESSION).select('session_id'),
    ]);

    setStats({
      totalStudents: studentsRes.data?.length || 0,
      totalTeachers: teachersRes.data?.length || 0,
      activeEnrollments: enrollmentsRes.data?.length || 0,
      totalSessions: sessionsRes.data?.length || 0,
      loading: false,
    });
  };

  const loadAttendanceAlerts = async () => {
    setLoadingAlerts(true);
    try {
      // Get attendance records with session and course info, ordered by date descending
      const { data: attendanceRecords } = await supabase
        .from('attendance')
        .select(`
          student_id,
          attendance_date,
          status,
          session_id,
          student:student_id(name, email),
          session:session_id(course_id, course:course_id(course_name))
        `)
        .order('attendance_date', { ascending: false });

      if (!attendanceRecords || attendanceRecords.length === 0) {
        setAbsentStudents([]);
        setLoadingAlerts(false);
        return;
      }

      // Get unique dates (last 4 newest dates)
      const allDates = [...new Set(attendanceRecords.map((r: any) => r.attendance_date))];
      const last4Dates = allDates.slice(0, 4);

      // Filter records to only last 4 dates
      const recentRecords = attendanceRecords.filter((r: any) => last4Dates.includes(r.attendance_date));

      // Load courses for filter
      const { data: coursesData } = await supabase
        .from('course')
        .select('course_id, course_name')
        .order('course_name');
      
      if (coursesData) {
        setCourses(coursesData.map(c => ({ id: c.course_id, name: c.course_name })));
      }

      // Group by student per course
      const studentCourseData: { 
        [key: string]: { 
          name: string; 
          email: string; 
          courses: {
            [courseId: string]: {
              course_name: string;
              dates: string[];
              statuses: string[];
            }
          }
        } 
      } = {};

      recentRecords.forEach((record: any) => {
        const sid = record.student_id;
        const courseId = record.session?.course_id;
        const courseName = record.session?.course?.course_name || 'Unknown';

        if (!studentCourseData[sid]) {
          studentCourseData[sid] = {
            name: record.student?.name || 'Unknown',
            email: record.student?.email || '',
            courses: {},
          };
        }

        if (!studentCourseData[sid].courses[courseId]) {
          studentCourseData[sid].courses[courseId] = {
            course_name: courseName,
            dates: [],
            statuses: [],
          };
        }

        studentCourseData[sid].courses[courseId].dates.push(record.attendance_date);
        studentCourseData[sid].courses[courseId].statuses.push(record.status);
      });

      // Find students with 2+ consecutive absences
      const alertStudents: AbsentStudent[] = [];

      Object.entries(studentCourseData).forEach(([studentId, studentInfo]) => {
        Object.entries(studentInfo.courses).forEach(([courseId, courseInfo]) => {
          const uniqueDates = [...new Set(courseInfo.dates)].sort().reverse();
          const uniqueStatuses = uniqueDates.map(d => {
            const idx = courseInfo.dates.indexOf(d);
            return idx >= 0 ? courseInfo.statuses[idx] : 'absent';
          });

          // Check for consecutive absences
          let consecutiveAbsences = 0;
          let maxConsecutive = 0;
          let lastAbsenceDate = '';

          uniqueStatuses.forEach((status, idx) => {
            if (status === 'absent') {
              consecutiveAbsences++;
              lastAbsenceDate = uniqueDates[idx];
              maxConsecutive = Math.max(maxConsecutive, consecutiveAbsences);
            } else {
              consecutiveAbsences = 0;
            }
          });

          // Alert only if 2+ consecutive absences
          if (maxConsecutive >= 2) {
            const absentDates = uniqueDates.filter((_, idx) => uniqueStatuses[idx] === 'absent');

            alertStudents.push({
              student_id: studentId,
              student_name: studentInfo.name,
              email: studentInfo.email,
              consecutiveAbsences: maxConsecutive,
              lastAbsenceDate,
              absentDates,
              course_name: courseInfo.course_name,
              course_id: courseId,
              riskLevel: 'high',
            });
          }
        });
      });

      // Sort by course and consecutive absences
      alertStudents.sort((a, b) => {
        if (a.course_name !== b.course_name) {
          return a.course_name.localeCompare(b.course_name);
        }
        return b.consecutiveAbsences - a.consecutiveAbsences;
      });

      setAbsentStudents(alertStudents);
    } catch (error) {
      console.error('Error loading attendance alerts:', error);
    }
    setLoadingAlerts(false);
  };

  const generateEmailLink = (student: AbsentStudent): string => {
    const subject = `Attendance Alert - ${student.student_name} (${student.course_name})`;
    
    const body = `Dear ${student.student_name},\n\nWe noticed that you have been absent ${student.consecutiveAbsences} times consecutively in the course "${student.course_name}".\n\nAbsent Dates: ${student.absentDates.map(d => format(new Date(d), 'MMM dd, yyyy')).join(', ')}\n\nPlease contact us if there are any issues preventing your attendance.\n\nBest regards,\nTraining Center`;

    return `mailto:${student.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  useEffect(() => {
    loadStats();
    loadAttendanceAlerts();
  }, []);

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-0">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">Overview of your training center</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600">Total Students</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-blue-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-blue-700 mt-2">{stats.totalStudents}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-blue-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👨‍🎓</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">Active Enrollments</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-green-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-green-700 mt-2">{stats.activeEnrollments}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-green-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">📚</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600">Total Teachers</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-purple-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-purple-700 mt-2">{stats.totalTeachers}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-purple-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">👩‍🏫</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-600">Total Sessions</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold text-orange-700 mt-2">...</p>
                ) : (
                  <p className="text-3xl font-bold text-orange-700 mt-2">{stats.totalSessions}</p>
                )}
              </div>
              <div className="h-12 w-12 bg-orange-200 rounded-full flex items-center justify-center">
                <span className="text-2xl">📅</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/students">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">👥</span> Manage Students
              </Button>
            </Link>
            <Link to="/sessions">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">📚</span> View Sessions
              </Button>
            </Link>
            <Link to="/sessions">
              <Button variant="outline" className="w-full justify-start" size="lg">
                <span className="mr-2">✓</span> Mark Attendance
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Attendance Alerts */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle>⚠️ Attendance Alerts (Last 4 Dates)</CardTitle>
          <div className="flex items-center gap-3">
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">All Courses</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <Button 
              size="sm" 
              variant="outline"
              onClick={loadAttendanceAlerts}
              disabled={loadingAlerts}
            >
              {loadingAlerts ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingAlerts ? (
            <p className="text-center text-gray-500 py-8">Loading alerts...</p>
          ) : (() => {
            const filtered = selectedCourse === 'all' 
              ? absentStudents 
              : absentStudents.filter(s => s.course_id === selectedCourse);
            
            return filtered.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-green-600 font-medium">✓ No attendance concerns</p>
                <p className="text-sm text-gray-500 mt-1">No students with 2+ consecutive absences in the last 4 dates</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((student) => (
                  <Link
                    key={`${student.student_id}-${student.course_id}`}
                    to={`/attendance-records?studentName=${encodeURIComponent(student.student_name)}&status=absent&course=${student.course_id}`}
                    className="block p-4 rounded-lg border-2 bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900">{student.student_name}</p>
                          <Badge variant="danger">
                            {student.consecutiveAbsences} Consecutive Absences
                          </Badge>
                          <Badge variant="default">
                            {student.course_name}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Absent on: {student.absentDates.map(d => format(new Date(d), 'MMM dd')).join(', ')}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Email: {student.email}
                        </p>
                      </div>
                      <a
                        href={generateEmailLink(student)}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap text-sm font-medium"
                      >
                        📧 Send Email
                      </a>
                    </div>
                  </Link>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
