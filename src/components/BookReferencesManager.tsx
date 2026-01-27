import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Tables, type CourseBookReference, type CreateCourseBookReference } from '../types/database.types';

interface BookReferencesManagerProps {
  courseId: string;
  courseName: string;
  onClose: () => void;
}

export function BookReferencesManager({ courseId, courseName, onClose }: BookReferencesManagerProps) {
  const [references, setReferences] = useState<CourseBookReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [newReference, setNewReference] = useState<CreateCourseBookReference>({
    course_id: courseId,
    topic: '',
    start_page: 1,
    end_page: 1,
    display_order: 0,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadReferences = async () => {
    const { data, error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .select('*')
      .eq('course_id', courseId)
      .order('start_page', { ascending: true });

    if (!error && data) {
      setReferences(data);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await loadReferences();
      setLoading(false);
    };
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const handleAdd = async () => {
    if (!newReference.topic.trim() || newReference.start_page > newReference.end_page) {
      alert('Please fill all fields correctly. End page must be >= start page.');
      return;
    }

    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .insert([newReference]);

    if (!error) {
      setNewReference({
        course_id: courseId,
        topic: '',
        start_page: 1,
        end_page: 1,
        display_order: references.length,
      });
      loadReferences();
    } else {
      alert('Error adding reference: ' + error.message);
    }
  };

  const handleDelete = async (referenceId: string) => {
    if (!confirm('Are you sure you want to delete this book reference?')) return;

    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .delete()
      .eq('reference_id', referenceId);

    if (!error) {
      loadReferences();
    } else {
      alert('Error deleting reference: ' + error.message);
    }
  };

  const handleUpdate = async (reference: CourseBookReference) => {
    if (!reference.topic.trim() || reference.start_page > reference.end_page) {
      alert('Please fill all fields correctly. End page must be >= start page.');
      return;
    }

    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .update({
        topic: reference.topic,
        start_page: reference.start_page,
        end_page: reference.end_page,
      })
      .eq('reference_id', reference.reference_id);

    if (!error) {
      setEditingId(null);
      loadReferences();
    } else {
      alert('Error updating reference: ' + error.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h2 className="text-xl font-bold text-gray-900">📚 Book References for {courseName}</h2>
        <p className="text-sm text-gray-600 mt-1">
          Add book topics and page ranges that will be available in the attendance page
        </p>
      </div>

      {/* Add New Reference */}
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-gray-900 mb-3">➕ Add New Book Reference</h3>
        <div className="space-y-3">
          <Input
            label="Topic/Chapter Name"
            type="text"
            value={newReference.topic}
            onChange={(value) => setNewReference({ ...newReference, topic: value })}
            placeholder="e.g., Chapter 3: Advanced Functions"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Page"
              type="number"
              min="1"
              value={newReference.start_page.toString()}
              onChange={(value) => setNewReference({ ...newReference, start_page: parseInt(value) || 1 })}
              required
            />
            <Input
              label="End Page"
              type="number"
              min="1"
              value={newReference.end_page.toString()}
              onChange={(value) => setNewReference({ ...newReference, end_page: parseInt(value) || 1 })}
              required
            />
          </div>
          {newReference.start_page && newReference.end_page && newReference.start_page <= newReference.end_page && (
            <p className="text-sm text-gray-600">
              📄 Total pages: <span className="font-medium">{newReference.end_page - newReference.start_page + 1}</span>
            </p>
          )}
          <Button onClick={handleAdd} variant="primary" className="w-full">
            Add Reference
          </Button>
        </div>
      </div>

      {/* List of References */}
      <div className="space-y-3">
        <h3 className="font-semibold text-gray-900">📋 Existing References ({references.length})</h3>
        {loading ? (
          <p className="text-gray-500 text-center py-4">Loading...</p>
        ) : references.length === 0 ? (
          <p className="text-gray-500 text-center py-8 border rounded-lg bg-gray-50">
            No book references added yet. Add your first reference above.
          </p>
        ) : (
          <div className="space-y-2">
            {references.map((ref) => (
              <div key={ref.reference_id} className="border rounded-lg p-4 bg-white hover:bg-gray-50">
                {editingId === ref.reference_id ? (
                  <div className="space-y-3">
                    <Input
                      label="Topic"
                      type="text"
                      value={ref.topic}
                      onChange={(value) => {
                        setReferences(
                          references.map((r) =>
                            r.reference_id === ref.reference_id ? { ...r, topic: value } : r
                          )
                        );
                      }}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Start Page"
                        type="number"
                        min="1"
                        value={ref.start_page.toString()}
                        onChange={(value) => {
                          setReferences(
                            references.map((r) =>
                              r.reference_id === ref.reference_id
                                ? { ...r, start_page: parseInt(value) || 1 }
                                : r
                            )
                          );
                        }}
                      />
                      <Input
                        label="End Page"
                        type="number"
                        min="1"
                        value={ref.end_page.toString()}
                        onChange={(value) => {
                          setReferences(
                            references.map((r) =>
                              r.reference_id === ref.reference_id
                                ? { ...r, end_page: parseInt(value) || 1 }
                                : r
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => handleUpdate(ref)} variant="primary" size="sm">
                        Save
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingId(null);
                          loadReferences();
                        }}
                        variant="outline"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{ref.topic}</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        Pages {ref.start_page} - {ref.end_page}
                        <span className="text-gray-500 ml-2">
                          ({ref.end_page - ref.start_page + 1} pages)
                        </span>
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button onClick={() => setEditingId(ref.reference_id)} variant="secondary" size="sm">
                        Edit
                      </Button>
                      <Button onClick={() => handleDelete(ref.reference_id)} variant="outline" size="sm">
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button onClick={onClose} variant="primary">
          Done
        </Button>
      </div>
    </div>
  );
}
