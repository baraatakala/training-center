import { useState, useEffect, useMemo, type FormEvent } from 'react';
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

const CALENDAR_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

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
    learning_method: initialData?.learning_method || 'face_to_face',
    virtual_provider: initialData?.virtual_provider || null,
    virtual_meeting_link: initialData?.virtual_meeting_link || null,
    requires_recording: initialData?.requires_recording ?? false,
    default_recording_visibility: initialData?.default_recording_visibility || 'course_staff',
    feedback_enabled: initialData?.feedback_enabled ?? false,
    feedback_anonymous_allowed: initialData?.feedback_anonymous_allowed ?? true,
    teacher_can_host: initialData?.teacher_can_host ?? true,
  });

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>(
    initialData?.day ? initialData.day.split(',').map(d => d.trim()) : []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentLocations, setRecentLocations] = useState<string[]>([]);

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
    const { data, error: fetchError } = await supabase
      .from(Tables.TEACHER)
      .select('teacher_id, name')
      .order('name');
    if (fetchError) {
      setError('Failed to load teachers.');
    } else if (data) {
      setTeachers(data);
    }
  };

  const loadCourses = async () => {
    const { data, error: fetchError } = await supabase
      .from(Tables.COURSE)
      .select('course_id, course_name')
      .order('course_name');
    if (fetchError) {
      setError('Failed to load courses.');
    } else if (data) {
      setCourses(data);
    }
  };

  useEffect(() => {
    loadTeachers();
    loadCourses();
    // Load recent locations for suggestions
    supabase
      .from(Tables.SESSION)
      .select('location')
      .not('location', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: locErr }) => {
        if (locErr) {
          console.error('Failed to load recent locations:', locErr.message);
          return;
        }
        if (data) {
          const unique = [...new Set(data.map(d => d.location).filter(Boolean) as string[])];
          setRecentLocations(unique.slice(0, 10));
        }
      });
  }, []);

  /** Auto-detect virtual provider from pasted URL */
  const detectProviderFromUrl = (url: string): CreateSession['virtual_provider'] => {
    const u = url.toLowerCase();
    if (u.includes('zoom.us') || u.includes('zoom.com')) return 'zoom';
    if (u.includes('meet.google.com')) return 'google_meet';
    if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'microsoft_teams';
    return 'other';
  };

  /** Auto-suggest today as start date for new sessions */
  const suggestedStartDate = useMemo(() => {
    if (initialData?.start_date) return '';
    return new Date().toISOString().slice(0, 10);
  }, [initialData?.start_date]);

  useEffect(() => {
    setFormData({
      course_id: initialData?.course_id || '',
      teacher_id: initialData?.teacher_id || '',
      start_date: initialData?.start_date || '',
      end_date: initialData?.end_date || '',
      day: initialData?.day || null,
      time: initialData?.time || null,
      location: initialData?.location || null,
      grace_period_minutes: initialData?.grace_period_minutes ?? 15,
      learning_method: initialData?.learning_method || 'face_to_face',
      virtual_provider: initialData?.virtual_provider || null,
      virtual_meeting_link: initialData?.virtual_meeting_link || null,
      requires_recording: initialData?.requires_recording ?? false,
      default_recording_visibility: initialData?.default_recording_visibility || 'course_staff',
      feedback_enabled: initialData?.feedback_enabled ?? false,
      feedback_anonymous_allowed: initialData?.feedback_anonymous_allowed ?? true,
      teacher_can_host: initialData?.teacher_can_host ?? true,
    });
    setSelectedDays(initialData?.day ? initialData.day.split(',').map(d => d.trim()) : []);
  }, [initialData]);

  useEffect(() => {
    if (!formData.start_date || initialData || selectedDays.length > 0) return;
    const parsed = new Date(`${formData.start_date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return;
    const detectedDay = CALENDAR_DAYS[parsed.getDay()];
    if (!detectedDay) return;
    setSelectedDays([detectedDay]);
    setFormData(prev => ({ ...prev, day: detectedDay }));
  }, [formData.start_date, initialData, selectedDays.length]);

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
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      setError('End date cannot be before start date.');
      return;
    }
    if (selectedDays.length === 0) {
      setError('Please select at least one day.');
      return;
    }
    if (formData.learning_method === 'face_to_face' && formData.virtual_meeting_link) {
      setError('Face-to-face sessions cannot have a virtual meeting link.');
      return;
    }
    if ((formData.learning_method === 'online' || formData.learning_method === 'hybrid') && formData.virtual_meeting_link) {
      const isValidUrl = /^https?:\/\//i.test(formData.virtual_meeting_link);
      if (!isValidUrl) {
        setError('Virtual meeting link must be a valid URL starting with http:// or https://');
        return;
      }
      if (!formData.virtual_provider) {
        setError('Please select a virtual provider when a meeting link is used.');
        return;
      }
    }

    setLoading(true);

    try {
      await onSubmit({
        ...formData,
        virtual_provider: formData.learning_method === 'face_to_face' ? null : formData.virtual_provider,
        virtual_meeting_link: formData.learning_method === 'face_to_face' ? null : formData.virtual_meeting_link,
      });
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

      <div>
        <Input
          label="Start Date"
          type="date"
          value={formData.start_date}
          onChange={(value) => setFormData({ ...formData, start_date: value })}
          required
        />
        {!initialData && !formData.start_date && suggestedStartDate && (
          <button
            type="button"
            onClick={() => setFormData(prev => ({ ...prev, start_date: suggestedStartDate }))}
            className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline py-2 px-2.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 min-h-[36px]"
          >
            Use today ({suggestedStartDate})
          </button>
        )}
      </div>

      <Input
        label="End Date"
        type="date"
        value={formData.end_date}
        onChange={(value) => setFormData({ ...formData, end_date: value })}
        required
      />
      {!initialData && formData.start_date && !formData.end_date && (
        <button
          type="button"
          onClick={() => setFormData(prev => ({ ...prev, end_date: prev.start_date }))}
          className="-mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline py-2 px-2.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 min-h-[36px]"
        >
          Use same day as start date
        </button>
      )}

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
              <span className="text-sm text-gray-700 dark:text-gray-300">{day}</span>
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
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Start time"
          />
          <input
            type="time"
            value={formData.time?.split('-')[1]?.trim() || ''}
            onChange={(e) => {
              const startTime = formData.time?.split('-')[0]?.trim() || '';
              setFormData({ ...formData, time: startTime ? `${startTime}-${e.target.value}` : e.target.value });
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="End time"
          />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {formData.time || 'Select start and end time'}
        </p>
      </div>

      <Select
        label="Learning Method"
        value={formData.learning_method || 'face_to_face'}
        onChange={(value) => setFormData({
          ...formData,
          learning_method: value as CreateSession['learning_method'],
          ...(value === 'face_to_face' ? { virtual_provider: null, virtual_meeting_link: null } : {}),
        })}
        options={[
          { value: 'face_to_face', label: 'Face to Face' },
          { value: 'online', label: 'Online' },
          { value: 'hybrid', label: 'Hybrid' },
        ]}
        required
      />

      {formData.learning_method !== 'online' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
          <input
            type="text"
            list="recent-locations"
            value={formData.location || ''}
            onChange={(e) => setFormData({ ...formData, location: e.target.value || null })}
            placeholder="e.g., Main Campus - Room 202"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {recentLocations.length > 0 && (
            <datalist id="recent-locations">
              {recentLocations.map(loc => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          )}
        </div>
      )}

      {formData.learning_method !== 'face_to_face' && (
        <>
          <Select
            label="Virtual Provider"
            value={formData.virtual_provider || ''}
            onChange={(value) => setFormData({ ...formData, virtual_provider: (value || null) as CreateSession['virtual_provider'] })}
            options={[
              { value: 'zoom', label: 'Zoom' },
              { value: 'google_meet', label: 'Google Meet' },
              { value: 'microsoft_teams', label: 'Microsoft Teams' },
              { value: 'other', label: 'Other' },
            ]}
            placeholder="Select a meeting provider"
          />

          <Input
            label="Virtual Meeting Link"
            type="url"
            value={formData.virtual_meeting_link || ''}
            onChange={(value) => {
              const updates: Partial<CreateSession> = { virtual_meeting_link: value || null };
              // Auto-detect provider from pasted URL
              if (value && /^https?:\/\//i.test(value)) {
                const detected = detectProviderFromUrl(value);
                if (detected && !formData.virtual_provider) {
                  updates.virtual_provider = detected;
                }
              }
              setFormData(prev => ({ ...prev, ...updates }));
            }}
            placeholder="https://... (provider auto-detected)"
          />
        </>
      )}

      <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(formData.requires_recording)}
            onChange={(e) => setFormData({ ...formData, requires_recording: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Session should be recorded</span>
        </label>

        {formData.requires_recording && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Recording links are added later from Attendance for each session date, then shown to students from the Sessions page.
            </p>
            <Select
              label="Default Recording Visibility"
              value={formData.default_recording_visibility || 'course_staff'}
              onChange={(value) => setFormData({ ...formData, default_recording_visibility: (value || 'course_staff') as CreateSession['default_recording_visibility'] })}
              options={[
                { value: 'private_staff', label: 'Private Staff' },
                { value: 'course_staff', label: 'Course Staff' },
                { value: 'enrolled_students', label: 'Enrolled Students' },
                { value: 'organization', label: 'Organization' },
                { value: 'public_link', label: 'Public Link' },
              ]}
              required
            />
          </>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-emerald-200 dark:border-emerald-700 p-4 bg-emerald-50/50 dark:bg-emerald-900/20">
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <span>🏠</span> Session Host Control
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(formData.teacher_can_host)}
            onChange={(e) => setFormData({ ...formData, teacher_can_host: e.target.checked })}
            className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-gray-300 rounded"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Teacher can host this session</span>
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Turn this off when hosting should be limited to enrolled students only.
        </p>
      </div>

      {/* Feedback Settings */}
      <div className="space-y-3 rounded-lg border border-purple-200 dark:border-purple-700 p-4 bg-purple-50/50 dark:bg-purple-900/20">
        <p className="text-sm font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-2">
          <span>💜</span> Post Check-In Feedback
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(formData.feedback_enabled)}
            onChange={(e) => setFormData({ ...formData, feedback_enabled: e.target.checked })}
            className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable feedback after check-in</span>
        </label>
        {formData.feedback_enabled && (
          <label className="flex items-center gap-2 cursor-pointer ml-6">
            <input
              type="checkbox"
              checked={Boolean(formData.feedback_anonymous_allowed)}
              onChange={(e) => setFormData({ ...formData, feedback_anonymous_allowed: e.target.checked })}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">Allow anonymous submissions</span>
          </label>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Students will see an optional feedback form after successful QR or face check-in.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Grace Period (minutes)
          <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
            Students can check in without being marked late
          </span>
        </label>
        <select
          value={formData.grace_period_minutes}
          onChange={(e) => setFormData({ ...formData, grace_period_minutes: parseInt(e.target.value) })}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
