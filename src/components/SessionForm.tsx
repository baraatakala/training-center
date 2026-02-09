import { useState, useEffect, type FormEvent } from 'react';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import { Tables, type CreateSession } from '../types/database.types';

interface Teacher {
  teacher_id: string;
  name: string;
}

interface Course {
  course_id: string;
  course_name: string;
}

interface SessionFormProps {
  onSubmit: (data: CreateSession) => Promise<void>;
  onCancel: () => void;
  initialData?: CreateSession | null;
}

export function SessionForm({ onSubmit, onCancel, initialData }: SessionFormProps) {
  const [formData, setFormData] = useState<CreateSession>({
    course_id: initialData?.course_id || '',
    teacher_id: initialData?.teacher_id || '',
    start_date: initialData?.start_date || '',
    end_date: initialData?.end_date || '',
    day: initialData?.day || null,
    time: initialData?.time || null,
    location: initialData?.location || null,
    grace_period_minutes: initialData?.grace_period_minutes ?? 15,
  });

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>(
    initialData?.day ? initialData.day.split(',').map(d => d.trim()) : []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const daysOfWeek = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday'
  ];

  const loadTeachers = async () => {
    const { data } = await supabase
      .from(Tables.TEACHER)
      .select('teacher_id, name')
      .order('name');
    if (data) setTeachers(data);
  };

  const loadCourses = async () => {
    const { data } = await supabase
      .from(Tables.COURSE)
      .select('course_id, course_name')
      .order('course_name');
    if (data) setCourses(data);
  };

  useEffect(() => {
    loadTeachers();
    loadCourses();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!formData.course_id) {
      setError('Please select a course.');
      return;
    }
    if (!formData.teacher_id) {
      setError('Please select a teacher.');
      return;
    }
    if (!formData.start_date) {
      setError('Start date is required.');
      return;
    }
    if (!formData.end_date) {
      setError('End date is required.');
      return;
    }
    if (new Date(formData.end_date) <= new Date(formData.start_date)) {
      setError('End date must be after start date.');
      return;
    }

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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <Select
        label="Course"
        value={formData.course_id}
        onChange={(value) => setFormData({ ...formData, course_id: value })}
        options={courses.map(c => ({ value: c.course_id, label: c.course_name }))}
        placeholder="Select a course"
        required
      />

      <Select
        label="Teacher"
        value={formData.teacher_id}
        onChange={(value) => setFormData({ ...formData, teacher_id: value })}
        options={teachers.map(t => ({ value: t.teacher_id, label: t.name }))}
        placeholder="Select a teacher"
        required
      />

      <Input
        label="Start Date"
        type="date"
        value={formData.start_date}
        onChange={(value) => setFormData({ ...formData, start_date: value })}
        required
      />

      <Input
        label="End Date"
        type="date"
        value={formData.end_date}
        onChange={(value) => setFormData({ ...formData, end_date: value })}
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Day(s) <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {daysOfWeek.map((day) => (
            <label key={day} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedDays.includes(day)}
                onChange={(e) => {
                  const newDays = e.target.checked
                    ? [...selectedDays, day]
                    : selectedDays.filter(d => d !== day);
                  setSelectedDays(newDays);
                  setFormData({ ...formData, day: newDays.join(', ') || null });
                }}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">{day}</span>
            </label>
          ))}
        </div>
        {selectedDays.length > 0 && (
          <p className="mt-2 text-sm text-gray-600">
            Selected: <span className="font-medium">{selectedDays.join(', ')}</span>
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Time Range
        </label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="time"
            value={formData.time?.split('-')[0]?.trim() || ''}
            onChange={(e) => {
              const endTime = formData.time?.split('-')[1]?.trim() || '';
              setFormData({ ...formData, time: endTime ? `${e.target.value}-${endTime}` : e.target.value });
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Start time"
          />
          <input
            type="time"
            value={formData.time?.split('-')[1]?.trim() || ''}
            onChange={(e) => {
              const startTime = formData.time?.split('-')[0]?.trim() || '';
              setFormData({ ...formData, time: startTime ? `${startTime}-${e.target.value}` : e.target.value });
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="End time"
          />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {formData.time || 'Select start and end time'}
        </p>
      </div>

      <Input
        label="Location"
        type="text"
        value={formData.location || ''}
        onChange={(value) => setFormData({ ...formData, location: value || null })}
        placeholder="e.g., Main Campus - Room 202"
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Grace Period (minutes)
          <span className="text-gray-500 font-normal ml-2">
            Students can check in without being marked late
          </span>
        </label>
        <select
          value={formData.grace_period_minutes}
          onChange={(e) => setFormData({ ...formData, grace_period_minutes: parseInt(e.target.value) })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value={0}>0 minutes (no grace period)</option>
          <option value={5}>5 minutes</option>
          <option value={10}>10 minutes</option>
          <option value={15}>15 minutes (default)</option>
          <option value={20}>20 minutes</option>
          <option value={30}>30 minutes</option>
          <option value={45}>45 minutes</option>
          <option value={60}>60 minutes (1 hour)</option>
        </select>
        <p className="mt-1 text-sm text-gray-500">
          Students checking in after this grace period will be marked as late
        </p>
      </div>

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : initialData ? 'Update Session' : 'Create Session'}
        </Button>
      </div>
    </form>
  );
}
