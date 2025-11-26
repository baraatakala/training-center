import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { studentService } from '../services/studentService';
import { enrollmentService } from '../services/enrollmentService';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';

interface EnrollmentWithDetails {
  enrollment_id: string;
  status: string;
  enrollment_date: string;
  student: { name: string; email: string };
  session: {
    course: { course_name: string };
  };
}

export function Dashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalTeachers: 0,
    activeEnrollments: 0,
    totalSessions: 0,
    loading: true,
  });

  const [recentEnrollments, setRecentEnrollments] = useState<EnrollmentWithDetails[]>([]);

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

  const loadRecentEnrollments = async () => {
    const { data } = await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        *,
        student:student_id(name, email),
        session:session_id(
          *,
          course:course_id(course_name)
        )
      `)
      .order('enrollment_date', { ascending: false })
      .limit(5);

    if (data) setRecentEnrollments(data as EnrollmentWithDetails[]);
  };

  useEffect(() => {
    loadStats();
    loadRecentEnrollments();
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

      {/* Recent Enrollments */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Enrollments</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEnrollments.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No recent enrollments</p>
          ) : (
            <div className="space-y-3">
              {recentEnrollments.map((enrollment) => (
                <div
                  key={enrollment.enrollment_id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{enrollment.student?.name}</p>
                    <p className="text-sm text-gray-600">{enrollment.session?.course?.course_name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={enrollment.status === 'active' ? 'success' : 'default'}>
                      {enrollment.status}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      {new Date(enrollment.enrollment_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
