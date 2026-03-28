import { useState, type FormEvent } from 'react';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import type { Teacher, CreateTeacher } from '@/shared/types/database.types';

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
    address: teacher?.address || '',
    specialization: teacher?.specialization || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Client-side validation
    const trimmedName = formData.name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setError('Name must be at least 2 characters');
      setLoading(false);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    if (formData.phone && !/^[+\d][\d\s\-().]{6,}$/.test(formData.phone)) {
      setError('Please enter a valid phone number');
      setLoading(false);
      return;
    }

    const trimmedSpecialization = formData.specialization?.trim() || '';
    if (trimmedSpecialization && (trimmedSpecialization.length < 2 || trimmedSpecialization.length > 150)) {
      setError('Specialization must be between 2 and 150 characters');
      setLoading(false);
      return;
    }

    try {
      await onSubmit({
        ...formData,
        name: trimmedName,
        email: formData.email.trim(),
        specialization: trimmedSpecialization || null,
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

      <Input
        label="Address (for hosting sessions)"
        type="text"
        value={formData.address || ''}
        onChange={(value) => setFormData({ ...formData, address: value || null })}
        placeholder="Enter address where sessions can be hosted"
      />

      <Input
        label="Specialization"
        type="text"
        value={formData.specialization || ''}
        onChange={(value) => setFormData({ ...formData, specialization: value || null })}
        placeholder="e.g. Mathematics, Machine Learning"
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
