import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Input } from './ui/Input';
import { Tables, type CourseBookReference } from '../types/database.types';
import { toast } from './ui/toastUtils';
import { ConfirmDialog } from './ui/ConfirmDialog';

interface BookReferencesManagerProps {
  courseId: string;
  courseName: string;
  onClose: () => void;
}

/** Detect if text is primarily RTL (Arabic/Hebrew) */
function isRTL(text: string): boolean {
  const rtlChars = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]/;
  return rtlChars.test(text);
}

export function BookReferencesManager({ courseId, courseName, onClose }: BookReferencesManagerProps) {
  const [references, setReferences] = useState<CourseBookReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());

  // Which chapter is currently showing its "add subtopic" form
  const [addingSubtopicFor, setAddingSubtopicFor] = useState<string | null>(null);

  // New top-level chapter form
  const [newTopic, setNewTopic] = useState('');
  const [newStartPage, setNewStartPage] = useState(1);
  const [newEndPage, setNewEndPage] = useState(1);

  // Subtopic add form
  const [subTopic, setSubTopic] = useState('');
  const [subStartPage, setSubStartPage] = useState(1);
  const [subEndPage, setSubEndPage] = useState(1);

  // Search / filter
  const [searchQuery, setSearchQuery] = useState('');

  const loadReferences = async () => {
    const { data, error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .select('*')
      .eq('course_id', courseId)
      .order('display_order', { ascending: true })
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

  // Build tree structure
  const { chapters, tree } = useMemo(() => {
    const chaps = references.filter(r => !r.parent_id);
    const treeMap = new Map<string, CourseBookReference[]>();
    for (const ref of references) {
      if (ref.parent_id) {
        if (!treeMap.has(ref.parent_id)) treeMap.set(ref.parent_id, []);
        treeMap.get(ref.parent_id)!.push(ref);
      }
    }
    return { chapters: chaps, tree: treeMap };
  }, [references]);

  // Filtered view
  const filteredChapters = useMemo(() => {
    if (!searchQuery.trim()) return chapters;
    const q = searchQuery.toLowerCase();
    return chapters.filter(ch => {
      if (ch.topic.toLowerCase().includes(q)) return true;
      const subs = tree.get(ch.reference_id) || [];
      return subs.some(s => s.topic.toLowerCase().includes(q));
    });
  }, [chapters, tree, searchQuery]);

  // Stats
  const totalRefs = references.length;
  const topLevel = chapters.length;
  const subtopics = references.length - chapters.length;
  const totalPages = references.reduce((sum, ref) => sum + (ref.end_page - ref.start_page + 1), 0);

  const handleAddChapter = async () => {
    if (!newTopic.trim()) {
      toast.warning('Please enter a topic name / أدخل اسم الموضوع');
      return;
    }
    if (newStartPage > newEndPage) {
      toast.warning('End page must be ≥ start page');
      return;
    }

    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .insert([{
        course_id: courseId,
        topic: newTopic.trim(),
        start_page: newStartPage,
        end_page: newEndPage,
        display_order: chapters.length,
        parent_id: null,
      }]);

    if (!error) {
      setNewTopic('');
      // Auto-advance: next chapter starts where this one ended
      setNewStartPage(newEndPage);
      setNewEndPage(newEndPage);
      loadReferences();
      toast.success('Chapter added / تم إضافة الفصل');
    } else {
      toast.error('Error: ' + error.message);
    }
  };

  const handleAddSubtopic = async (parentId: string) => {
    if (!subTopic.trim()) {
      toast.warning('Please enter a subtopic name / أدخل اسم العنوان الفرعي');
      return;
    }
    if (subStartPage > subEndPage) {
      toast.warning('End page must be ≥ start page');
      return;
    }

    const existingSubs = tree.get(parentId) || [];
    const { error } = await supabase
      .from(Tables.COURSE_BOOK_REFERENCE)
      .insert([{
        course_id: courseId,
        topic: subTopic.trim(),
        start_page: subStartPage,
        end_page: subEndPage,
        display_order: existingSubs.length,
        parent_id: parentId,
      }]);

    if (!error) {
      setSubTopic('');
      // Auto-advance: next subtopic starts where this one ended
      setSubStartPage(subEndPage);
      setSubEndPage(subEndPage);
      // Keep form open for quick sequential entry
      loadReferences();
      toast.success('Subtopic added / تم إضافة العنوان الفرعي');
    } else {
      toast.error('Error: ' + error.message);
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
      toast.error('Error deleting: ' + error.message);
    }
  };

  const handleUpdate = async (reference: CourseBookReference) => {
    if (!reference.topic.trim() || reference.start_page > reference.end_page) {
      toast.warning('Please fill all fields correctly');
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
      toast.error('Error updating: ' + error.message);
    }
  };

  const toggleCollapse = (chapterId: string) => {
    setCollapsedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  // Helper: render inline edit form for a reference
  const renderEditForm = (ref: CourseBookReference) => (
    <div className="p-4 space-y-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
      <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Editing
      </div>
      <input
        type="text"
        value={ref.topic}
        dir={isRTL(ref.topic) ? 'rtl' : 'ltr'}
        onChange={(e) => {
          setReferences(references.map(r =>
            r.reference_id === ref.reference_id ? { ...r, topic: e.target.value } : r
          ));
        }}
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        placeholder="Topic name / اسم الموضوع"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Start Page"
          type="number"
          min="1"
          value={ref.start_page.toString()}
          onChange={(value) => {
            setReferences(references.map(r =>
              r.reference_id === ref.reference_id ? { ...r, start_page: parseInt(value) || 1 } : r
            ));
          }}
        />
        <Input
          label="End Page"
          type="number"
          min="1"
          value={ref.end_page.toString()}
          onChange={(value) => {
            setReferences(references.map(r =>
              r.reference_id === ref.reference_id ? { ...r, end_page: parseInt(value) || 1 } : r
            ));
          }}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleUpdate(ref)}
          className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          Save
        </button>
        <button
          onClick={() => { setEditingId(null); loadReferences(); }}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // Helper: render a subtopic item
  const renderSubtopic = (sub: CourseBookReference, index: number) => {
    if (editingId === sub.reference_id) {
      return <div key={sub.reference_id} className="ml-8 mt-2">{renderEditForm(sub)}</div>;
    }
    return (
      <div
        key={sub.reference_id}
        className="ml-8 mt-1.5 flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-600 transition-colors group/sub"
      >
        {/* Connector line visual */}
        <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M4 0v8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400">
            {index + 1}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium text-gray-800 dark:text-gray-200 truncate ${isRTL(sub.topic) ? 'text-right' : ''}`} dir={isRTL(sub.topic) ? 'rtl' : 'ltr'}>
            {sub.topic}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
            <span>pp. {sub.start_page}–{sub.end_page}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span>{sub.end_page - sub.start_page + 1} pages</span>
          </div>
        </div>
        <div className="flex gap-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
          <button
            onClick={() => setEditingId(sub.reference_id)}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button
            onClick={() => setDeleteConfirmId(sub.reference_id)}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[600px] bg-gradient-to-br from-gray-50 via-purple-50 to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-700 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">📚 Book References / مراجع الكتاب</h2>
            <p className="text-purple-100 text-sm mt-1">
              <span className="font-semibold">{courseName}</span>
            </p>
          </div>
        </div>
        <p className="text-purple-100 text-sm pl-14">
          Organize chapters and subtopics with page ranges — supports Arabic & English
          <br />
          <span dir="rtl" className="text-purple-200 text-xs">نظّم الفصول والعناوين الفرعية مع نطاقات الصفحات</span>
        </p>
      </div>

      <div className="p-6 space-y-5">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/30 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300">Chapters / فصول</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-0.5">{topLevel}</p>
              </div>
              <span className="text-2xl">📖</span>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-900/30 p-4 rounded-xl border border-purple-200 dark:border-purple-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-purple-700 dark:text-purple-300">Subtopics / عناوين فرعية</p>
                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-0.5">{subtopics}</p>
              </div>
              <span className="text-2xl">📑</span>
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/30 p-4 rounded-xl border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-green-700 dark:text-green-300">Total Entries</p>
                <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-0.5">{totalRefs}</p>
              </div>
              <span className="text-2xl">📋</span>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-900/30 p-4 rounded-xl border border-amber-200 dark:border-amber-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">Total Pages</p>
                <p className="text-2xl font-bold text-amber-900 dark:text-amber-100 mt-0.5">{totalPages}</p>
              </div>
              <span className="text-2xl">📄</span>
            </div>
          </div>
        </div>

        {/* Search bar */}
        {references.length > 3 && (
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search topics... / ابحث عن المواضيع..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
        )}

        {/* Add New Chapter */}
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-5 rounded-2xl border border-purple-200 dark:border-purple-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">➕</span>
            <h3 className="text-base font-semibold text-purple-900 dark:text-purple-100">
              Add Chapter / إضافة فصل
            </h3>
          </div>
          <div className="space-y-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-purple-100 dark:border-purple-800">
            <input
              type="text"
              value={newTopic}
              dir={isRTL(newTopic) ? 'rtl' : 'ltr'}
              onChange={e => setNewTopic(e.target.value)}
              placeholder="Chapter name / اسم الفصل — e.g. الفصل الثالث: أحكام التجويد"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500"
              onKeyDown={e => e.key === 'Enter' && handleAddChapter()}
            />
            <div className="grid grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Start Page</label>
                <input
                  type="number"
                  min={1}
                  value={newStartPage}
                  onChange={e => {
                    const val = parseInt(e.target.value) || 1;
                    setNewStartPage(val);
                    // Auto-fill end page: find next chapter that starts after this page
                    const sorted = chapters.slice().sort((a, b) => a.start_page - b.start_page);
                    const next = sorted.find(c => c.start_page > val);
                    setNewEndPage(next ? next.start_page : val);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">End Page</label>
                <input
                  type="number"
                  min={1}
                  value={newEndPage}
                  onChange={e => setNewEndPage(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
              <button
                onClick={handleAddChapter}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-medium transition-all text-sm flex items-center justify-center gap-1.5 shadow-md hover:shadow-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                Add
              </button>
            </div>
            {newStartPage > 0 && newEndPage >= newStartPage && (
              <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <span>📄</span> {newEndPage - newStartPage + 1} pages
              </div>
            )}
          </div>
        </div>

        {/* Chapter List with Subtopics */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span>📚</span>
              Table of Contents
              <span className="ml-1 text-xs font-normal bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
                {topLevel} {topLevel === 1 ? 'chapter' : 'chapters'}
              </span>
            </h3>
            {chapters.length > 1 && (
              <button
                onClick={() => {
                  if (collapsedChapters.size === chapters.length) {
                    setCollapsedChapters(new Set());
                  } else {
                    setCollapsedChapters(new Set(chapters.map(c => c.reference_id)));
                  }
                }}
                className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 font-medium"
              >
                {collapsedChapters.size === chapters.length ? '▶ Expand All' : '▼ Collapse All'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Loading references...</p>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600">
              <span className="text-5xl">📖</span>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {searchQuery ? 'No matching references' : 'No References Yet'}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm text-center max-w-md">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Start by adding a chapter above. Each chapter can have subtopics for detailed tracking.'
                }
              </p>
              {!searchQuery && (
                <p className="text-gray-400 dark:text-gray-500 text-xs text-center" dir="rtl">
                  ابدأ بإضافة فصل أعلاه. يمكن لكل فصل أن يحتوي على عناوين فرعية للتتبع التفصيلي
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredChapters.map((chapter, chapterIndex) => {
                const subs = tree.get(chapter.reference_id) || [];
                const isCollapsed = collapsedChapters.has(chapter.reference_id);
                const chapterPages = chapter.end_page - chapter.start_page + 1;
                const totalSubPages = subs.reduce((s, r) => s + (r.end_page - r.start_page + 1), 0);
                const topicIsRTL = isRTL(chapter.topic);

                return (
                  <div key={chapter.reference_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    {/* Chapter header */}
                    {editingId === chapter.reference_id ? (
                      <div className="p-4">{renderEditForm(chapter)}</div>
                    ) : (
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Expand/collapse + chapter number */}
                          <button
                            onClick={() => toggleCollapse(chapter.reference_id)}
                            className="flex items-center gap-1.5 mt-0.5 shrink-0"
                          >
                            <svg
                              className={`w-4 h-4 text-purple-500 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-purple-500 to-indigo-600 text-white rounded-lg font-bold text-sm shadow-sm">
                              {chapterIndex + 1}
                            </span>
                          </button>

                          {/* Chapter info */}
                          <div className="flex-1 min-w-0">
                            <h4
                              className={`text-base font-semibold text-gray-900 dark:text-white ${topicIsRTL ? 'text-right' : ''}`}
                              dir={topicIsRTL ? 'rtl' : 'ltr'}
                            >
                              {chapter.topic}
                            </h4>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md border border-blue-200 dark:border-blue-700">
                                📄 pp. {chapter.start_page}–{chapter.end_page} ({chapterPages} pages)
                              </span>
                              {subs.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-md border border-purple-200 dark:border-purple-700">
                                  📑 {subs.length} subtopic{subs.length !== 1 ? 's' : ''} ({totalSubPages} pages)
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                if (addingSubtopicFor === chapter.reference_id) {
                                  setAddingSubtopicFor(null);
                                } else {
                                  setAddingSubtopicFor(chapter.reference_id);
                                  setSubTopic('');
                                  setSubStartPage(chapter.start_page);
                                  setSubEndPage(chapter.end_page);
                                  // Auto-expand
                                  setCollapsedChapters(prev => {
                                    const next = new Set(prev);
                                    next.delete(chapter.reference_id);
                                    return next;
                                  });
                                }
                              }}
                              className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                                addingSubtopicFor === chapter.reference_id
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                  : 'text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 dark:text-purple-400'
                              }`}
                              title="Add subtopic / إضافة عنوان فرعي"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            </button>
                            <button
                              onClick={() => setEditingId(chapter.reference_id)}
                              className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:text-blue-400 rounded-lg transition-colors"
                              title="Edit chapter"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(chapter.reference_id)}
                              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 dark:text-red-400 rounded-lg transition-colors"
                              title={subs.length > 0 ? 'Delete chapter and all subtopics' : 'Delete chapter'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Subtopics + add form (collapsible) */}
                    {!isCollapsed && editingId !== chapter.reference_id && (
                      <div className="border-t border-gray-100 dark:border-gray-700">
                        {/* Subtopic list */}
                        {subs.length > 0 && (
                          <div className="px-4 pt-2 pb-1">
                            {subs.map((sub, idx) => renderSubtopic(sub, idx))}
                          </div>
                        )}

                        {/* Add subtopic inline form */}
                        {addingSubtopicFor === chapter.reference_id && (
                          <div className="mx-4 my-3 ml-8 p-3 bg-purple-50 dark:bg-purple-900/15 rounded-xl border border-purple-200 dark:border-purple-700 border-dashed">
                            <div className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                              Add Subtopic / إضافة عنوان فرعي
                            </div>
                            <input
                              type="text"
                              value={subTopic}
                              dir={isRTL(subTopic) ? 'rtl' : 'ltr'}
                              onChange={e => setSubTopic(e.target.value)}
                              placeholder="Subtopic name / اسم العنوان الفرعي"
                              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm mb-2 focus:ring-2 focus:ring-purple-500"
                              onKeyDown={e => e.key === 'Enter' && handleAddSubtopic(chapter.reference_id)}
                              autoFocus
                            />
                            <div className="grid grid-cols-3 gap-2 items-end">
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-0.5">Start</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={subStartPage}
                                  onChange={e => setSubStartPage(parseInt(e.target.value) || 1)}
                                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-0.5">End</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={subEndPage}
                                  onChange={e => setSubEndPage(parseInt(e.target.value) || 1)}
                                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                                />
                              </div>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleAddSubtopic(chapter.reference_id)}
                                  className="flex-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium transition-colors"
                                >
                                  Add
                                </button>
                                <button
                                  onClick={() => setAddingSubtopicFor(null)}
                                  className="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400 rounded text-xs transition-colors"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Empty subtopic hint */}
                        {subs.length === 0 && addingSubtopicFor !== chapter.reference_id && (
                          <div className="px-4 py-2 ml-8">
                            <button
                              onClick={() => {
                                setAddingSubtopicFor(chapter.reference_id);
                                setSubTopic('');
                                setSubStartPage(chapter.start_page);
                                setSubEndPage(chapter.end_page);
                              }}
                              className="text-xs text-purple-500 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 font-medium"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                              Add subtopic / إضافة عنوان فرعي
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all flex items-center gap-2 shadow-lg hover:shadow-xl"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Done & Close
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        type="danger"
        title="Delete Reference / حذف المرجع"
        message={
          deleteConfirmId && tree.has(deleteConfirmId)
            ? `This will delete the chapter and its ${tree.get(deleteConfirmId)!.length} subtopic(s). This action cannot be undone.`
            : 'Are you sure you want to delete this reference? This action cannot be undone.'
        }
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
