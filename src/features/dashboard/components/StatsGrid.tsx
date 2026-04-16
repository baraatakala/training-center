import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import type { DashboardStats } from '../constants/dashboardConstants';

interface StatsGridProps {
  stats: DashboardStats;
  pendingExcuses: number;
  isTeacher: boolean;
}

export function StatsGrid({ stats, pendingExcuses, isTeacher }: StatsGridProps) {
  return (
    <>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blue-100">Total Students</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalStudents}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-600 dark:from-emerald-600 dark:to-emerald-700 rounded-2xl p-6 text-white shadow-lg shadow-emerald-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-100">Active Enrollments</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.activeEnrollments}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 rounded-2xl p-6 text-white shadow-lg shadow-purple-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-purple-100">Total Teachers</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalTeachers}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600 rounded-2xl p-6 text-white shadow-lg shadow-amber-500/25">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10"></div>
          <div className="relative">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-12 w-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-amber-100">Total Sessions</p>
                {stats.loading ? (
                  <p className="text-2xl font-bold mt-1">...</p>
                ) : (
                  <p className="text-3xl font-bold mt-1">{stats.totalSessions}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions (Teacher/Admin only) */}
      {isTeacher && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link to="/students">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                Manage Students
              </Button>
            </Link>
            <Link to="/attendance-records">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                Attendance Records
              </Button>
            </Link>
            <Link to="/excuse-requests">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Excuse Requests
                {pendingExcuses > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                    {pendingExcuses}
                  </span>
                )}
              </Button>
            </Link>
            <Link to="/announcements">
              <Button variant="outline" className="w-full justify-start gap-3" size="lg">
                <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                Announcements
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>}
    </>
  );
}
