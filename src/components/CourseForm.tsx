import { useState, useEffect, type FormEvent } from 'react';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import { Tables, type CreateCourse } from '../types/database.types';

interface Teacher {
  teacher_id: string;
  name: string;
}

interface Course {
  course_id: string;
  teacher_id: string;
  course_name: string;
  category: string;
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
  });

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTeachers = async () => {
    const { data } = await supabase
      .from(Tables.TEACHER)
      .select('teacher_id, name')
      .order('name');
    if (data) setTeachers(data);
  };

  useEffect(() => {
    loadTeachers();
  }, []);

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
