import { useState, useEffect, type FormEvent } from 'react';
import { Input } from '@/shared/components/ui/Input';
import { Select } from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/Button';
import { courseService } from '@/features/courses/services/courseService';
import { type CreateCourse } from '@/shared/types/database.types';

interface Teacher {
  teacher_id: string;
  name: string;
}

interface Course {
  course_id: string;
  teacher_id: string;
  course_name: string;
  category: string;
  description?: string | null;
  description_format?: 'markdown' | 'plain_text' | null;
}

interface CourseFormProps {
  course?: Course;
  onSubmit: (data: CreateCourse) => Promise<void>;
  onCancel: () => void;
}

export function CourseForm({ course, onSubmit, onCancel }: CourseFormProps) {
  const [formData, setFormData] = useState<CreateCourse>({
    teacher_id: course?.teacher_id || null,
    course_name: course?.course_name || '',
    category: course?.category || null,
    description: course?.description || null,
    description_format: course?.description_format || 'markdown',
  });

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTeachers = async () => {
    const { data, error: fetchError } = await courseService.getTeachersLookup();
    if (fetchError) {
      setError('Failed to load teachers. Please try again.');
    } else if (data) {
      setTeachers(data);
    }
  };

  useEffect(() => {
    loadTeachers();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!formData.course_name.trim()) {
      setError('Course name is required.');
      return;
    }
    if (formData.course_name.trim().length < 2) {
      setError('Course name must be at least 2 characters.');
      return;
    }
    if (!formData.teacher_id) {
      setError('Please select an instructor.');
      return;
    }
    const trimmedDescription = formData.description?.trim() || '';
    if (trimmedDescription.length > 6000) {
      setError('Description must be 6000 characters or less.');
      return;
    }

    setLoading(true);

    try {
      await onSubmit({
        ...formData,
        course_name: formData.course_name.trim(),
        description: trimmedDescription || null,
        description_format: formData.description_format || 'markdown',
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

      <Input
        label="Course Name"
        type="text"
        value={formData.course_name}
        onChange={(value) => setFormData({ ...formData, course_name: value })}
        placeholder="Enter course name"
        required
      />

      <Input
        label="Category"
        type="text"
        value={formData.category || ''}
        onChange={(value) => setFormData({ ...formData, category: value || null })}
        placeholder="e.g., Programming, Design, Data Science"
        required
      />

      <Select
        label="Instructor"
        value={formData.teacher_id || ''}
        onChange={(value) => setFormData({ ...formData, teacher_id: value || null })}
        options={teachers.map(t => ({ value: t.teacher_id, label: t.name }))}
        placeholder="Select an instructor"
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description
        </label>
        <textarea
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
          rows={6}
          maxLength={6000}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Markdown supported. Add course goals, scope, requirements, and expected outcomes."
        />
        <div className="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Supports Markdown formatting.</span>
          <span>{(formData.description || '').length}/6000</span>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : course ? 'Update Course' : 'Add Course'}
        </Button>
      </div>
    </form>
  );
}
