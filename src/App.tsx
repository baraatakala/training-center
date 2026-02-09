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
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading...
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