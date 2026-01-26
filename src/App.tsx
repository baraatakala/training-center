import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Teachers } from './pages/Teachers';
import { Students } from './pages/Students';
import { Courses } from './pages/Courses';
import { Sessions } from './pages/Sessions';
import { Enrollments } from './pages/Enrollments';
import { Attendance } from './pages/Attendance';
import AttendanceRecords from './pages/AttendanceRecords';
import { AuditLogs } from './pages/AuditLogs';
import { StudentCheckIn } from './pages/StudentCheckIn';
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import { AuthProvider } from './context/AuthContext';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/checkin/:token" element={<StudentCheckIn />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout>
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
                  </Routes>
                </Layout>
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
