import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import { AuthProvider } from './context/AuthContext';
import { ToastContainer } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollToTop } from './components/ui/ScrollToTop';
import './App.css';

// Lazy-loaded pages for code splitting
const Teachers = lazy(() => import('./pages/Teachers').then(m => ({ default: m.Teachers })));
const Students = lazy(() => import('./pages/Students').then(m => ({ default: m.Students })));
const Courses = lazy(() => import('./pages/Courses').then(m => ({ default: m.Courses })));
const Sessions = lazy(() => import('./pages/Sessions').then(m => ({ default: m.Sessions })));
const Enrollments = lazy(() => import('./pages/Enrollments').then(m => ({ default: m.Enrollments })));
const Attendance = lazy(() => import('./pages/Attendance').then(m => ({ default: m.Attendance })));
const AttendanceRecords = lazy(() => import('./pages/AttendanceRecords'));
const AuditLogs = lazy(() => import('./pages/AuditLogs').then(m => ({ default: m.AuditLogs })));
const StudentCheckIn = lazy(() => import('./pages/StudentCheckIn').then(m => ({ default: m.StudentCheckIn })));
const PhotoCheckIn = lazy(() => import('./pages/PhotoCheckIn').then(m => ({ default: m.PhotoCheckIn })));
const Announcements = lazy(() => import('./pages/Announcements').then(m => ({ default: m.Announcements })));
const Messages = lazy(() => import('./pages/Messages').then(m => ({ default: m.Messages })));
const NotFound = lazy(() => import('./pages/NotFound'));

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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
        <ToastContainer />
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/checkin/:token" element={<Suspense fallback={<PageLoader />}><StudentCheckIn /></Suspense>} />
          <Route path="/photo-checkin/:token" element={<Suspense fallback={<PageLoader />}><PhotoCheckIn /></Suspense>} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout>
                  <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/teachers" element={<Teachers />} />
                    <Route path="/students" element={<Students />} />
                    <Route path="/courses" element={<Courses />} />
                    <Route path="/sessions" element={<Sessions />} />
                    <Route path="/enrollments" element={<Enrollments />} />
                    <Route path="/attendance/:sessionId" element={<Attendance />} />
                    <Route path="/attendance-records" element={<AttendanceRecords />} />
                    <Route path="/audit-logs" element={<AuditLogs />} />
                    <Route path="/announcements" element={<Announcements />} />
                    <Route path="/messages" element={<Messages />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  </Suspense>
                  </ErrorBoundary>
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