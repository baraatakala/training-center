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
import { Analytics } from './pages/Analytics';
import './App.css';

function App() {
  return (
    <BrowserRouter>
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
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
