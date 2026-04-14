import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Layout } from './Layout';
import { Login } from '@/features/auth/pages/Login';
import { ResetPassword } from '@/features/auth/pages/ResetPassword';
import { PrivateRoute } from '@/shared/components/PrivateRoute';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ToastContainer } from '@/shared/components/ui/Toast';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { ScrollToTop } from '@/shared/components/ui/ScrollToTop';
import './App.css';

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import('@/features/dashboard/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Teachers = lazy(() => import('@/features/teachers/pages/Teachers').then(m => ({ default: m.Teachers })));
const Students = lazy(() => import('@/features/students/pages/Students').then(m => ({ default: m.Students })));
const Courses = lazy(() => import('@/features/courses/pages/Courses').then(m => ({ default: m.Courses })));
const Sessions = lazy(() => import('@/features/sessions/pages/Sessions').then(m => ({ default: m.Sessions })));
const Enrollments = lazy(() => import('@/features/enrollments/pages/Enrollments').then(m => ({ default: m.Enrollments })));
const Attendance = lazy(() => import('@/features/attendance/pages/Attendance').then(m => ({ default: m.Attendance })));
const AttendanceRecords = lazy(() => import('@/features/attendance/pages/AttendanceRecords').then(m => ({ default: m.AttendanceRecords })));
const AuditLogs = lazy(() => import('@/features/audit/pages/AuditLogs').then(m => ({ default: m.AuditLogs })));
const StudentCheckIn = lazy(() => import('@/features/checkin/pages/StudentCheckIn').then(m => ({ default: m.StudentCheckIn })));
const PhotoCheckIn = lazy(() => import('@/features/checkin/pages/PhotoCheckIn').then(m => ({ default: m.PhotoCheckIn })));
const Announcements = lazy(() => import('@/features/communication/pages/Announcements').then(m => ({ default: m.Announcements })));
const Messages = lazy(() => import('@/features/communication/pages/Messages').then(m => ({ default: m.Messages })));
const ScoringConfiguration = lazy(() => import('@/features/scoring/pages/ScoringConfiguration').then(m => ({ default: m.ScoringConfiguration })));
const ExcuseRequests = lazy(() => import('@/features/excuses/pages/ExcuseRequests').then(m => ({ default: m.ExcuseRequests })));
const NotFound = lazy(() => import('@/app/NotFound').then(m => ({ default: m.NotFound })));

function PageLoader() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      {/* Header skeleton */}
      <div>
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-48" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-72 mt-2" />
      </div>
      {/* Content skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="p-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded flex-1" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SafePage({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
        <ToastContainer />
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/checkin/:token" element={<SafePage><StudentCheckIn /></SafePage>} />
          <Route path="/photo-checkin/:token" element={<SafePage><PhotoCheckIn /></SafePage>} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<SafePage><Dashboard /></SafePage>} />
                    <Route path="/teachers" element={<SafePage><Teachers /></SafePage>} />
                    <Route path="/students" element={<SafePage><Students /></SafePage>} />
                    <Route path="/courses" element={<SafePage><Courses /></SafePage>} />
                    <Route path="/sessions" element={<SafePage><Sessions /></SafePage>} />
                    <Route path="/enrollments" element={<SafePage><Enrollments /></SafePage>} />
                    <Route path="/attendance/:sessionId" element={<SafePage><Attendance /></SafePage>} />
                    <Route path="/attendance-records" element={<SafePage><AttendanceRecords /></SafePage>} />
                    <Route path="/audit-logs" element={<SafePage><AuditLogs /></SafePage>} />
                    <Route path="/announcements" element={<SafePage><Announcements /></SafePage>} />
                    <Route path="/messages" element={<SafePage><Messages /></SafePage>} />
                    <Route path="/scoring-config" element={<SafePage><ScoringConfiguration /></SafePage>} />
                    <Route path="/excuse-requests" element={<SafePage><ExcuseRequests /></SafePage>} />
                    <Route path="/feedback-analytics" element={<Navigate to="/attendance-records?tab=feedback" replace />} />
                    <Route path="*" element={<SafePage><NotFound /></SafePage>} />
                  </Routes>
                </Layout>
              </PrivateRoute>
            }
          />
        </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;