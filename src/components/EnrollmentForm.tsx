import { useState, useEffect, type FormEvent } from 'react';
import { Select } from './ui/Select';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { supabase } from '../lib/supabase';
import { enrollmentService } from '../services/enrollmentService';
import { Tables, type CreateEnrollment } from '../types/database.types';

interface Student {
  student_id: string;
  name: string;
  email: string;
}

interface Session {
  session_id: string;
  start_date: string;
  teacher_id: string | null;
  course: {
    course_name: string;
  };
}

interface EnrollmentFormProps {
  onSubmit: (data: CreateEnrollment) => Promise<void>;
  onCancel: () => void;
  // Optional initial data for editing an existing enrollment
  initialData?: Partial<CreateEnrollment> | null;
}

export function EnrollmentForm({ onSubmit, onCancel, initialData = null }: EnrollmentFormProps) {
  const [formData, setFormData] = useState<CreateEnrollment>({
    student_id: initialData?.student_id || '',
    session_id: initialData?.session_id || '',
    enrollment_date: initialData?.enrollment_date || new Date().toISOString().split('T')[0],
    status: (initialData?.status as 'active' | 'completed' | 'dropped' | 'pending') || 'active',
    can_host: typeof initialData?.can_host === 'boolean' ? initialData!.can_host : false,
  });

  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [studentEnrollments, setStudentEnrollments] = useState<Array<{
    enrollment_id: string;
    status: string;
    session?: {
      course?: {
        course_name: string;
      };
    };
  }>>([]);
  const [sessionCapacity, setSessionCapacity] = useState<{
    currentCount: number;
    maxCapacity: number | null;
    isAtCapacity: boolean;
    spotsRemaining: number | null;
  } | null>(null);

  const loadData = async () => {
    const [studentsRes, sessionsRes] = await Promise.all([
      supabase.from(Tables.STUDENT).select('student_id, name, email').order('name'),
      supabase.from(Tables.SESSION).select(`
        session_id,
        start_date,
        teacher_id,
        course:course_id(course_name)
      `).order('start_date', { ascending: false }),
    ]);

    if (studentsRes.data) setStudents(studentsRes.data);
    if (sessionsRes.data) {
      const sessionData = sessionsRes.data as unknown as Session[];
      setSessions(sessionData);
      setFilteredSessions(sessionData);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Load student's current enrollments when student is selected
  useEffect(() => {
    if (formData.student_id) {
      // Show all sessions - no teacher filtering needed
      setFilteredSessions(sessions);

      // Load student's enrollments
      enrollmentService.getByStudent(formData.student_id).then(({ data }) => {
        if (data) {
          setStudentEnrollments(data);
        }
      });
    } else {
      setStudentEnrollments([]);
      setFilteredSessions(sessions);
    }
  }, [formData.student_id, students, sessions]);

  // Check session capacity when session is selected
  useEffect(() => {
    if (formData.session_id) {
      enrollmentService.getSessionCapacity(formData.session_id).then(({ data }) => {
        setSessionCapacity(data);
      });
    } else {
      setSessionCapacity(null);
    }
  }, [formData.session_id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <Select
        label="Student"
        value={formData.student_id}
        onChange={(value) => setFormData({ ...formData, student_id: value })}
        options={students.map(s => ({ 
          value: s.student_id, 
          label: `${s.name} (${s.email})` 
        }))}
        placeholder="Select a student"
        required
      />

      {/* Student's Current Enrollments */}
      {studentEnrollments.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm font-medium text-blue-900 mb-2">
            Student's Current Enrollments ({studentEnrollments.length})
          </div>
          <div className="space-y-1">
            {studentEnrollments.slice(0, 3).map((e) => (
              <div key={e.enrollment_id} className="text-xs text-blue-700 flex items-center justify-between">
                <span>{e.session?.course?.course_name || 'Unknown Course'}</span>
                <Badge variant={e.status === 'active' ? 'success' : 'default'}>
                  {e.status}
                </Badge>
              </div>
            ))}
            {studentEnrollments.length > 3 && (
              <div className="text-xs text-blue-600 italic">
                +{studentEnrollments.length - 3} more enrollment(s)
              </div>
            )}
          </div>
        </div>
      )}

      <Select
        label="Session"
        value={formData.session_id}
        onChange={(value) => setFormData({ ...formData, session_id: value })}
        options={filteredSessions.map(s => ({ 
          value: s.session_id, 
          label: `${s.course.course_name} - ${new Date(s.start_date).toLocaleDateString()}` 
        }))}
        placeholder="Select a session"
        required
      />

      {/* Session Capacity Warning */}
      {sessionCapacity && (
        <div className={`border rounded-lg p-3 ${
          sessionCapacity.isAtCapacity 
            ? 'bg-red-50 border-red-200' 
            : sessionCapacity.spotsRemaining !== null && sessionCapacity.spotsRemaining <= 3
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-green-50 border-green-200'
        }`}>
          <div className={`text-sm font-medium mb-1 ${
            sessionCapacity.isAtCapacity 
              ? 'text-red-900' 
              : sessionCapacity.spotsRemaining !== null && sessionCapacity.spotsRemaining <= 3
                ? 'text-yellow-900'
                : 'text-green-900'
          }`}>
            Session Capacity
          </div>
          <div className={`text-xs ${
            sessionCapacity.isAtCapacity 
              ? 'text-red-700' 
              : sessionCapacity.spotsRemaining !== null && sessionCapacity.spotsRemaining <= 3
                ? 'text-yellow-700'
                : 'text-green-700'
          }`}>
            {sessionCapacity.maxCapacity ? (
              <>
                {sessionCapacity.currentCount} / {sessionCapacity.maxCapacity} enrolled
                {sessionCapacity.isAtCapacity ? (
                  <span className="font-semibold"> - Session is FULL</span>
                ) : sessionCapacity.spotsRemaining !== null && sessionCapacity.spotsRemaining <= 3 ? (
                  <span className="font-semibold"> - Only {sessionCapacity.spotsRemaining} spot(s) remaining</span>
                ) : (
                  <span> - {sessionCapacity.spotsRemaining} spots available</span>
                )}
              </>
            ) : (
              `${sessionCapacity.currentCount} enrolled - No capacity limit set`
            )}
          </div>
        </div>
      )}

      <Input
        label="Enrollment Date"
        type="date"
        value={formData.enrollment_date}
        onChange={(value) => setFormData({ ...formData, enrollment_date: value })}
        required
      />

      <Select
        label="Status"
        value={formData.status}
        onChange={(value) => {
          const newStatus = value as 'active' | 'completed' | 'dropped' | 'pending';
          // Automatically disable can_host if status is not 'active'
          setFormData({ 
            ...formData, 
            status: newStatus,
            can_host: newStatus === 'active' ? formData.can_host : false
          });
        }}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'pending', label: 'Pending' },
          { value: 'completed', label: 'Completed' },
          { value: 'dropped', label: 'Dropped' },
        ]}
        required
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!formData.can_host}
          onChange={(e) => setFormData({ ...formData, can_host: e.target.checked })}
          disabled={formData.status !== 'active'}
          className={`h-4 w-4 border-gray-300 rounded ${
            formData.status === 'active' 
              ? 'text-blue-600 cursor-pointer' 
              : 'text-gray-300 cursor-not-allowed'
          }`}
        />
        <span className={`text-sm ${formData.status === 'active' ? 'text-gray-700' : 'text-gray-400'}`}>
          Can host sessions at home {formData.status !== 'active' && '(only for active enrollments)'}
        </span>
      </label>

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Enrolling...' : 'Enroll Student'}
        </Button>
      </div>
    </form>
  );
}
