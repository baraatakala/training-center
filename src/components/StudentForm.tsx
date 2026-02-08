import { useState, useEffect } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import type { Student, CreateStudent } from '../types/database.types';

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
    photo_url: null,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (student) {
      setFormData({
        name: student.name,
        email: student.email,
        phone: student.phone || '',
        address: student.address || '',
        location: student.location || '',
        nationality: student.nationality || '',
        age: student.age,
        photo_url: student.photo_url || null,
      });
    }
  }, [student]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

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

    if (formData.age !== null && formData.age !== undefined) {
      if (formData.age < 1 || formData.age > 150) {
        setError('Age must be between 1 and 150');
        setLoading(false);
        return;
      }
    }

    try {
      await onSubmit({ ...formData, name: trimmedName, email: formData.email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg">
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
