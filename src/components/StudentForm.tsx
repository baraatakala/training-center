import { useState, useEffect } from 'react';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';
import type { Student, CreateStudent } from '../types/database.types';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';

type StudentFormProps = {
  student?: Student;
  onSubmit: (data: CreateStudent) => Promise<void>;
  onCancel: () => void;
};

export function StudentForm({ student, onSubmit, onCancel }: StudentFormProps) {
  const [formData, setFormData] = useState<CreateStudent>({
    name: '',
    email: '',
    phone: '',
    address: '',
    location: '',
    nationality: '',
    age: null,
    teacher_id: null,
  });
  const [teachers, setTeachers] = useState<Array<{ teacher_id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTeachers();
    if (student) {
      setFormData({
        name: student.name,
        email: student.email,
        phone: student.phone || '',
        address: student.address || '',
        location: student.location || '',
        nationality: student.nationality || '',
        age: student.age,
        teacher_id: student.teacher_id,
      });
    }
  }, [student]);

  async function loadTeachers() {
    const { data } = await supabase.from(Tables.TEACHER).select('teacher_id, name');
    if (data) setTeachers(data);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <Input
        label="Full Name"
        value={formData.name}
        onChange={(value) => setFormData({ ...formData, name: value })}
        placeholder="Enter student name"
        required
      />

      <Input
        label="Email"
        type="email"
        value={formData.email}
        onChange={(value) => setFormData({ ...formData, email: value })}
        placeholder="student@example.com"
        required
      />

      <Input
        label="Phone"
        type="tel"
        value={formData.phone || ''}
        onChange={(value) => setFormData({ ...formData, phone: value })}
        placeholder="+1-555-0123"
      />

      <Input
        label="Address"
        value={formData.address || ''}
        onChange={(value) => setFormData({ ...formData, address: value })}
        placeholder="123 Main St, City"
      />

      <Input
        label="Location"
        value={formData.location || ''}
        onChange={(value) => setFormData({ ...formData, location: value })}
        placeholder="City, Country"
      />

      <Input
        label="Nationality"
        value={formData.nationality || ''}
        onChange={(value) => setFormData({ ...formData, nationality: value })}
        placeholder="USA"
      />

      <Input
        label="Age"
        type="number"
        value={formData.age?.toString() || ''}
        onChange={(value) => setFormData({ ...formData, age: value ? parseInt(value) : null })}
        placeholder="18"
      />

      <Select
        label="Assigned Teacher"
        value={formData.teacher_id || ''}
        onChange={(value) => setFormData({ ...formData, teacher_id: value || null })}
        options={teachers.map((t) => ({ value: t.teacher_id, label: t.name }))}
        placeholder="Select a teacher"
      />

      <div className="flex gap-3 mt-6">
        <Button type="submit" disabled={loading} className="flex-1">
          {loading ? 'Saving...' : student ? 'Update Student' : 'Add Student'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}
