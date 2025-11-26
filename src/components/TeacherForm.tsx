import { useState, type FormEvent } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import type { Teacher, CreateTeacher } from '../types/database.types';

interface TeacherFormProps {
  teacher?: Teacher;
  onSubmit: (data: CreateTeacher) => Promise<void>;
  onCancel: () => void;
}

export function TeacherForm({ teacher, onSubmit, onCancel }: TeacherFormProps) {
  const [formData, setFormData] = useState<CreateTeacher>({
    name: teacher?.name || '',
    phone: teacher?.phone || '',
    email: teacher?.email || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        label="Name"
        type="text"
        value={formData.name}
        onChange={(value) => setFormData({ ...formData, name: value })}
        placeholder="Enter teacher name"
        required
      />

      <Input
        label="Email"
        type="email"
        value={formData.email}
        onChange={(value) => setFormData({ ...formData, email: value })}
        placeholder="teacher@example.com"
        required
      />

      <Input
        label="Phone"
        type="tel"
        value={formData.phone || ''}
        onChange={(value) => setFormData({ ...formData, phone: value || null })}
        placeholder="+1-555-0000"
      />

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : teacher ? 'Update Teacher' : 'Add Teacher'}
        </Button>
      </div>
    </form>
  );
}
