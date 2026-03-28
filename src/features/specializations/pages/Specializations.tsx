import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/components/ui/toastUtils';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { specializationService, type Specialization } from '@/features/specializations/services/specializationService';

export function Specializations() {
  const { isTeacher } = useIsTeacher();
  const [specializations, setSpecializations] = useState<Specialization[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingSpec, setDeletingSpec] = useState<Specialization | null>(null);
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({});

  const loadSpecializations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await specializationService.getAll();
    if (error) {
      toast.error('Failed to load specializations');
    } else if (data) {
      setSpecializations(data as Specialization[]);
      // Load student counts for each
      const counts: Record<string, number> = {};
      for (const spec of data as Specialization[]) {
        const { count } = await specializationService.studentCount(spec.name);
        counts[spec.id] = count;
      }
      setStudentCounts(counts);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSpecializations();
  }, [loadSpecializations]);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (specializations.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('This specialization already exists.');
      return;
    }
    setAdding(true);
    const { error } = await specializationService.create(trimmed);
    if (error) {
      toast.error('Failed to add: ' + (error.message || 'Unknown error'));
    } else {
      toast.success(`"${trimmed}" added`);
      setNewName('');
      loadSpecializations();
    }
    setAdding(false);
  };

  const handleRename = async (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    if (specializations.some(s => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('A specialization with that name already exists.');
      return;
    }
    const { error } = await specializationService.rename(id, trimmed);
    if (error) {
      toast.error('Failed to rename: ' + (error.message || 'Unknown error'));
    } else {
      toast.success('Renamed successfully. Students updated.');
      setEditingId(null);
      loadSpecializations();
    }
  };

  const handleDelete = async () => {
    if (!deletingSpec) return;
    const { error } = await specializationService.remove(deletingSpec.id);
    if (error) {
      toast.error('Failed to delete: ' + (error.message || 'Unknown error'));
    } else {
      toast.success(`"${deletingSpec.name}" deleted. Students cleared.`);
      loadSpecializations();
    }
    setDeletingSpec(null);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-56" />
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Specializations</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage the list of student specializations. Changes apply everywhere: forms, imports, analytics, and exports.
        </p>
      </div>

      {!isTeacher && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <p className="text-amber-700 dark:text-amber-300 text-sm">You are viewing as a student. Edit functions are disabled.</p>
        </div>
      )}

      {/* Add new */}
      {isTeacher && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Input
                label="New Specialization"
                value={newName}
                onChange={setNewName}
                placeholder="e.g. Pharmacy"
                disabled={adding}
              />
            </div>
            <Button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              variant="primary"
              className="mb-4 gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              {adding ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        {specializations.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No specializations yet. Add one above to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {specializations.map((spec) => (
              <li key={spec.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                {editingId === spec.id ? (
                  <>
                    <input
                      className="flex-1 px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(spec.id); if (e.key === 'Escape') setEditingId(null); }}
                      autoFocus
                    />
                    <button
                      onClick={() => handleRename(spec.id)}
                      className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 p-1"
                      title="Save"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                      title="Cancel"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{spec.name}</span>
                      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                        {studentCounts[spec.id] ?? 0} student{(studentCounts[spec.id] ?? 0) !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {isTeacher && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setEditingId(spec.id); setEditingName(spec.name); }}
                          className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          title="Rename"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button
                          onClick={() => setDeletingSpec(spec)}
                          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deletingSpec}
        title="Delete Specialization"
        message={
          deletingSpec
            ? `Delete "${deletingSpec.name}"? ${(studentCounts[deletingSpec.id] ?? 0) > 0 ? `${studentCounts[deletingSpec.id]} student(s) will have their specialization cleared.` : 'No students are using this specialization.'}`
            : ''
        }
        confirmText="Delete"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeletingSpec(null)}
      />
    </div>
  );
}
