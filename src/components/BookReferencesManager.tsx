import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Input } from './ui/Input';
import { Tables, type CourseBookReference, type CreateCourseBookReference } from '../types/database.types';
import { toast } from './ui/toastUtils';
import { ConfirmDialog } from './ui/ConfirmDialog';

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
      toast.warning('Please fill all fields correctly. End page must be >= start page.');
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
      toast.error('Error adding reference: ' + error.message);
    }
  };

  const handleDelete = async (referenceId: string) => {
    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .delete()
      .eq('reference_id', referenceId);

    if (!error) {
      loadReferences();
    } else {
      toast.error('Error deleting reference: ' + error.message);
    }
  };

  const handleUpdate = async (reference: CourseBookReference) => {
    if (!reference.topic.trim() || reference.start_page > reference.end_page) {
      toast.warning('Please fill all fields correctly. End page must be >= start page.');
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
      toast.error('Error updating reference: ' + error.message);
    }
  };

  return (
    <div className="min-h-[600px] bg-gradient-to-br from-gray-50 via-purple-50 to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 rounded-2xl overflow-hidden">
      {/* Modern Header with Gradient */}
      <div className="bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-700 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Book References</h2>
            <p className="text-purple-100 text-sm mt-1">
              Managing: <span className="font-semibold">{courseName}</span>
            </p>
          </div>
        </div>
        <p className="text-purple-100 text-sm pl-14">
          Add book topics and page ranges that will be available for tracking in attendance
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-5 rounded-2xl shadow-lg border border-blue-100 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">Total References</p>
                <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">{references.length}</p>
              </div>
              <div className="bg-blue-200 dark:bg-blue-800 p-3 rounded-xl">
                <svg className="w-7 h-7 text-blue-700 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-5 rounded-2xl shadow-lg border border-green-100 dark:border-green-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">Total Pages</p>
                <p className="text-3xl font-bold text-green-900 dark:text-green-100">
                  {references.reduce((sum, ref) => sum + (ref.end_page - ref.start_page + 1), 0)}
                </p>
              </div>
              <div className="bg-green-200 dark:bg-green-800 p-3 rounded-xl">
                <svg className="w-7 h-7 text-green-700 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 p-5 rounded-2xl shadow-lg border border-amber-100 dark:border-amber-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">Avg Pages/Topic</p>
                <p className="text-3xl font-bold text-amber-900 dark:text-amber-100">
                  {references.length > 0 
                    ? Math.round(references.reduce((sum, ref) => sum + (ref.end_page - ref.start_page + 1), 0) / references.length)
                    : 0}
                </p>
              </div>
              <div className="bg-amber-200 dark:bg-amber-800 p-3 rounded-xl">
                <svg className="w-7 h-7 text-amber-700 dark:text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Add New Reference - Modern Card */}
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 p-6 rounded-2xl border border-purple-200 dark:border-purple-700 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-purple-200 dark:bg-purple-800 p-2 rounded-lg">
              <svg className="w-5 h-5 text-purple-700 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100">Add New Book Reference</h3>
          </div>
          <div className="space-y-4 bg-white dark:bg-gray-800 p-5 rounded-xl border border-purple-100 dark:border-purple-800">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                Topic/Chapter Name
              </label>
              <Input
                type="text"
                value={newReference.topic}
                onChange={(value) => setNewReference({ ...newReference, topic: value })}
                placeholder="e.g., Chapter 3: Advanced Functions"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Start Page
                </label>
                <Input
                  type="number"
                  min="1"
                  value={newReference.start_page.toString()}
                  onChange={(value) => setNewReference({ ...newReference, start_page: parseInt(value) || 1 })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  End Page
                </label>
                <Input
                  type="number"
                  min="1"
                  value={newReference.end_page.toString()}
                  onChange={(value) => setNewReference({ ...newReference, end_page: parseInt(value) || 1 })}
                  required
                />
              </div>
            </div>
            
            {newReference.start_page && newReference.end_page && newReference.start_page <= newReference.end_page && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <span className="font-semibold">Total pages:</span> {newReference.end_page - newReference.start_page + 1}
                </p>
              </div>
            )}
            
            <button
              onClick={handleAdd}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Reference
            </button>
          </div>
        </div>

        {/* List of References - Modern Cards */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-gray-200 dark:bg-gray-700 p-2 rounded-lg">
                <svg className="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Existing References 
                <span className="ml-2 px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-sm font-medium">
                  {references.length}
                </span>
              </h3>
            </div>
          </div>
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 font-medium">Loading references...</p>
            </div>
          ) : references.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4 bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
              <div className="bg-gray-100 dark:bg-gray-700 p-6 rounded-full">
                <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">No References Yet</h3>
              <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
                Start by adding your first book reference using the form above. Track book progress with specific topics and page ranges.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {references.map((ref, index) => (
                <div key={ref.reference_id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-xl transition-all duration-300 group">
                  {editingId === ref.reference_id ? (
                    <div className="p-6 space-y-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <h4 className="font-semibold text-gray-900 dark:text-white">Editing Reference</h4>
                      </div>
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
                      <div className="grid grid-cols-2 gap-4">
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
                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => handleUpdate(ref)}
                          className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Save Changes
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            loadReferences();
                          }}
                          className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-800 dark:to-indigo-800 text-purple-700 dark:text-purple-300 rounded-lg font-bold text-sm">
                              #{index + 1}
                            </span>
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                              {ref.topic}
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-3 ml-13">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-700">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span className="text-sm font-medium">Start: {ref.start_page}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg border border-indigo-200 dark:border-indigo-700">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              <span className="text-sm font-medium">End: {ref.end_page}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg border border-green-200 dark:border-green-700">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                              <span className="text-sm font-medium">{ref.end_page - ref.start_page + 1} pages</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => setEditingId(ref.reference_id)}
                            className="px-4 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border border-blue-200 dark:border-blue-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(ref.reference_id)}
                            className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border border-red-200 dark:border-red-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with Done Button */}
        <div className="flex justify-end gap-3 pt-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Done & Close
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        type="danger"
        title="Delete Book Reference"
        message="Are you sure you want to delete this book reference?"
        confirmText="Delete"
        onConfirm={() => {
          if (deleteConfirmId) handleDelete(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
