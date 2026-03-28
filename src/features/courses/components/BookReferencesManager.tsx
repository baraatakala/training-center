import { useState, useEffect, useMemo, useCallback } from 'react';
import type { CourseBookReference } from '@/shared/types/database.types';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { courseService } from '@/features/courses/services/courseService';

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

  // New top-level chapter form — only needs topic (pages auto-computed from subtopics or set after)
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
    const { data, error } = await courseService.getBookReferences(courseId);

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

  // Build tree structure — chapters sorted by start_page
  const { chapters, tree } = useMemo(() => {
    const chaps = references.filter(r => !r.parent_id)
      .sort((a, b) => a.start_page - b.start_page || a.display_order - b.display_order);
    const treeMap = new Map<string, CourseBookReference[]>();
    for (const ref of references) {
      if (ref.parent_id) {
        if (!treeMap.has(ref.parent_id)) treeMap.set(ref.parent_id, []);
        treeMap.get(ref.parent_id)!.push(ref);
      }
    }
    // Sort subtopics by start_page within each chapter
    for (const [key, subs] of treeMap) {
      treeMap.set(key, subs.sort((a, b) => a.start_page - b.start_page));
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
  const subtopicCount = references.length - chapters.length;
  const totalPages = useMemo(() => {
    // Only count chapter-level pages (subtopics are within chapter range)
    let sum = 0;
    for (const ch of chapters) {
      sum += ch.end_page - ch.start_page + 1;
    }
    return sum;
  }, [chapters]);

  // Auto-compute next chapter start page = last chapter's end page
  const nextChapterStart = useMemo(() => {
    if (chapters.length === 0) return 1;
    const lastChapter = chapters[chapters.length - 1];
    return lastChapter.end_page;
  }, [chapters]);

  // Keep chapter form start/end synced when chapters load
  useEffect(() => {
    if (!newTopic) {
      setNewStartPage(nextChapterStart);
      setNewEndPage(nextChapterStart);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextChapterStart]);

  // Auto-update chapter range from its subtopics
  const syncChapterRange = useCallback(async (chapterId: string, subs: CourseBookReference[]) => {
    if (subs.length === 0) return;
    const minStart = Math.min(...subs.map(s => s.start_page));
    const maxEnd = Math.max(...subs.map(s => s.end_page));
    await courseService.updateBookReference(chapterId, { start_page: minStart, end_page: maxEnd });
  }, []);

  const handleAddChapter = async () => {
    if (!newTopic.trim()) {
      toast.warning('Please enter a chapter name / أدخل اسم الفصل');
      return;
    }
    if (newStartPage > newEndPage) {
      toast.warning('End page must be ≥ start page');
      return;
    }

    const { error } = await courseService.createBookReference({
      course_id: courseId,
      topic: newTopic.trim(),
      start_page: newStartPage,
      end_page: newEndPage,
      display_order: chapters.length,
      parent_id: null,
    });

    if (!error) {
      setNewTopic('');
      await loadReferences();
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
    const { error } = await courseService.createBookReference({
      course_id: courseId,
      topic: subTopic.trim(),
      start_page: subStartPage,
      end_page: subEndPage,
      display_order: existingSubs.length,
      parent_id: parentId,
    });

    if (!error) {
      // Auto-sync parent chapter range
      const updatedSubs = [...existingSubs, { start_page: subStartPage, end_page: subEndPage } as CourseBookReference];
      await syncChapterRange(parentId, updatedSubs);

      // Keep form open for continuous adding — advance start to this subtopic's end page
      setSubTopic('');
      setSubStartPage(subEndPage);
      setSubEndPage(subEndPage);
      // Keep addingSubtopicFor = parentId (don't close)
      await loadReferences();
      toast.success('Subtopic added — add next or press ✕ / تم إضافة العنوان الفرعي');
    } else {
      toast.error('Error: ' + error.message);
    }
  };

  const handleDelete = async (referenceId: string) => {
    // If deleting a subtopic, we'll need to re-sync chapter range after
    const ref = references.find(r => r.reference_id === referenceId);
    const parentId = ref?.parent_id;

    const { error } = await courseService.deleteBookReference(referenceId);

    if (!error) {
      // Re-sync parent chapter if we deleted a subtopic
      if (parentId) {
        const remainingSubs = (tree.get(parentId) || []).filter(s => s.reference_id !== referenceId);
        if (remainingSubs.length > 0) {
          await syncChapterRange(parentId, remainingSubs);
        }
      }
      await loadReferences();
    } else {
      toast.error('Error deleting: ' + error.message);
    }
  };

  const handleUpdate = async (reference: CourseBookReference) => {
    if (!reference.topic.trim() || reference.start_page > reference.end_page) {
      toast.warning('Please fill all fields correctly');
      return;
    }

    const { error } = await courseService.updateBookReference(reference.reference_id, {
      topic: reference.topic,
      start_page: reference.start_page,
      end_page: reference.end_page,
    });

    if (!error) {
      // If editing a subtopic, re-sync parent chapter range
      if (reference.parent_id) {
        const subs = (tree.get(reference.parent_id) || []).map(s =>
          s.reference_id === reference.reference_id ? reference : s
        );
        await syncChapterRange(reference.parent_id, subs);
      }
      setEditingId(null);
      await loadReferences();
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

  // Open add-subtopic form with smart defaults
  const openAddSubtopic = (chapter: CourseBookReference) => {
    const subs = tree.get(chapter.reference_id) || [];
    const lastSub = subs.length > 0 ? subs[subs.length - 1] : null;
    const startPage = lastSub ? lastSub.end_page : chapter.start_page;

    setAddingSubtopicFor(chapter.reference_id);
    setSubTopic('');
    setSubStartPage(startPage);
    setSubEndPage(startPage);
    // Auto-expand
    setCollapsedChapters(prev => {
      const next = new Set(prev);
      next.delete(chapter.reference_id);
      return next;
    });
  };

  // Helper: render inline edit form for a reference
  const renderEditForm = (ref: CourseBookReference) => (
    <div className="p-4 space-y-3 bg-gradient-to-br from-blue-50/80 to-indigo-50/80 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
      <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
        placeholder="Topic name / اسم الموضوع"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5 block">Start Page</label>
          <input
            type="number"
            min={1}
            value={ref.start_page}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 1;
              setReferences(references.map(r =>
                r.reference_id === ref.reference_id ? { ...r, start_page: v, end_page: Math.max(v, r.end_page) } : r
              ));
            }}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5 block">End Page</label>
          <input
            type="number"
            min={1}
            value={ref.end_page}
            onChange={(e) => {
              setReferences(references.map(r =>
                r.reference_id === ref.reference_id ? { ...r, end_page: parseInt(e.target.value) || 1 } : r
              ));
            }}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
      </div>
      {ref.start_page <= ref.end_page && (
        <div className="text-[10px] text-blue-600 dark:text-blue-400">
          📄 {ref.end_page - ref.start_page + 1} page{ref.end_page - ref.start_page + 1 !== 1 ? 's' : ''}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => handleUpdate(ref)}
          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
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
  const renderSubtopic = (sub: CourseBookReference, index: number, totalSubs: number) => {
    if (editingId === sub.reference_id) {
      return <div key={sub.reference_id} className="ml-6 mt-2">{renderEditForm(sub)}</div>;
    }
    const pages = sub.end_page - sub.start_page + 1;
    return (
      <div
        key={sub.reference_id}
        className="relative ml-6 mt-0 group/sub"
      >
        {/* Tree connector */}
        <div className="absolute -left-4 top-0 bottom-0 w-4">
          <div className={`absolute left-1.5 top-0 w-px bg-purple-200 dark:bg-purple-800 ${index === totalSubs - 1 ? 'h-5' : 'h-full'}`} />
          <div className="absolute left-1.5 top-5 w-2.5 h-px bg-purple-200 dark:bg-purple-800" />
        </div>
        <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
          <span className="text-[9px] font-mono font-bold bg-purple-100 dark:bg-purple-800/50 text-purple-600 dark:text-purple-300 w-5 h-5 rounded flex items-center justify-center shrink-0">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm text-gray-800 dark:text-gray-200 truncate ${isRTL(sub.topic) ? 'text-right' : ''}`}
              dir={isRTL(sub.topic) ? 'rtl' : 'ltr'}
            >
              {sub.topic}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            {sub.start_page}–{sub.end_page} <span className="text-gray-300 dark:text-gray-600">·</span> {pages}p
          </span>
          <div className="flex gap-0.5 sm:opacity-0 sm:group-hover/sub:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => setEditingId(sub.reference_id)}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
              title="Edit"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
            <button
              onClick={() => setDeleteConfirmId(sub.reference_id)}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
              title="Delete"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[600px] bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-700 to-indigo-700 text-white px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="bg-white/15 p-2.5 rounded-xl backdrop-blur-sm">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">Book References / مراجع الكتاب</h2>
            <p className="text-purple-200 text-sm mt-0.5">{courseName}</p>
          </div>

        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Compact Stats Bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-purple-600 dark:text-purple-400 font-bold">{topLevel}</span>
            <span className="text-gray-500 dark:text-gray-400">chapters</span>
          </div>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">{subtopicCount}</span>
            <span className="text-gray-500 dark:text-gray-400">subtopics</span>
          </div>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-blue-600 dark:text-blue-400 font-bold">{totalRefs}</span>
            <span className="text-gray-500 dark:text-gray-400">total</span>
          </div>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-amber-600 dark:text-amber-400 font-bold">{totalPages}</span>
            <span className="text-gray-500 dark:text-gray-400">pages</span>
          </div>
          {references.length > 3 && (
            <div className="flex-1 ml-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search... / بحث..."
                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-xs focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
          )}
        </div>


        {/* Add New Chapter — compact & smart */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/15 dark:to-indigo-900/15 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-100 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              Add Chapter / إضافة فصل
            </h3>
          </div>
          <div className="p-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  type="text"
                  value={newTopic}
                  dir={isRTL(newTopic) ? 'rtl' : 'ltr'}
                  onChange={e => setNewTopic(e.target.value)}
                  placeholder="Chapter name / اسم الفصل — e.g. الفصل الثالث: أحكام التجويد"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500"
                  onKeyDown={e => e.key === 'Enter' && handleAddChapter()}
                />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Start</label>
                <input
                  type="number"
                  min={1}
                  value={newStartPage}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 1;
                    setNewStartPage(v);
                    // End follows start if they were equal
                    if (newEndPage <= v) setNewEndPage(v);
                  }}
                  className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-center tabular-nums"
                />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">End</label>
                <input
                  type="number"
                  min={1}
                  value={newEndPage}
                  onChange={e => setNewEndPage(parseInt(e.target.value) || 1)}
                  className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-center tabular-nums"
                />
              </div>
              <button
                onClick={handleAddChapter}
                disabled={!newTopic.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                Add
              </button>
            </div>
            {newStartPage > 0 && newEndPage >= newStartPage && newTopic.trim() && (
              <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                📄 {newEndPage - newStartPage + 1} pages · Pages will auto-adjust when subtopics are added
              </p>
            )}
          </div>
        </div>

        {/* Chapter List */}
        <div className="space-y-2">
          {chapters.length > 1 && (
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Table of Contents · {topLevel} chapter{topLevel !== 1 ? 's' : ''}
              </h3>
              <button
                onClick={() => {
                  if (collapsedChapters.size === chapters.length) setCollapsedChapters(new Set());
                  else setCollapsedChapters(new Set(chapters.map(c => c.reference_id)));
                }}
                className="text-[10px] text-purple-600 dark:text-purple-400 hover:underline font-medium"
              >
                {collapsedChapters.size === chapters.length ? 'Expand All' : 'Collapse All'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <div className="w-10 h-10 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
              <p className="text-gray-400 text-sm">Loading...</p>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-2 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
              <span className="text-4xl">📖</span>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {searchQuery ? 'No matching references' : 'No References Yet'}
              </h3>
              <p className="text-gray-400 text-sm text-center max-w-sm">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Add a chapter above, then add subtopics inside it. Pages auto-adjust.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredChapters.map((chapter, chapterIndex) => {
                const subs = tree.get(chapter.reference_id) || [];
                const isCollapsed = collapsedChapters.has(chapter.reference_id);
                const hasSubs = subs.length > 0;
                const chapterPages = chapter.end_page - chapter.start_page + 1;

                return (
                  <div key={chapter.reference_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-shadow hover:shadow-sm">
                    {/* Chapter header */}
                    {editingId === chapter.reference_id ? (
                      <div className="p-4">{renderEditForm(chapter)}</div>
                    ) : (
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                        onClick={() => toggleCollapse(chapter.reference_id)}
                      >
                        {/* Collapse arrow + index */}
                        <div className="flex items-center gap-2 shrink-0">
                          <svg
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          <span className="flex items-center justify-center w-7 h-7 bg-purple-600 text-white rounded-lg font-bold text-xs">
                            {chapterIndex + 1}
                          </span>
                        </div>

                        {/* Chapter info */}
                        <div className="flex-1 min-w-0">
                          <h4
                            className={`text-sm font-semibold text-gray-900 dark:text-white truncate ${isRTL(chapter.topic) ? 'text-right' : ''}`}
                            dir={isRTL(chapter.topic) ? 'rtl' : 'ltr'}
                          >
                            {chapter.topic}
                          </h4>
                        </div>

                        {/* Page badge */}
                        <div className="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
                          <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md font-medium">
                            pp. {chapter.start_page}–{chapter.end_page}
                          </span>
                          <span className="text-gray-400">{chapterPages}p</span>
                          {hasSubs && (
                            <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-md font-medium">
                              {subs.length} sub{subs.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {hasSubs && (
                            <span className="px-1.5 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 rounded-md text-[10px]" title="Range auto-computed from subtopics">
                              auto
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              if (addingSubtopicFor === chapter.reference_id) {
                                setAddingSubtopicFor(null);
                              } else {
                                openAddSubtopic(chapter);
                              }
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              addingSubtopicFor === chapter.reference_id
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                            }`}
                            title="Add subtopic"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                          </button>
                          <button
                            onClick={() => setEditingId(chapter.reference_id)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(chapter.reference_id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title={hasSubs ? `Delete chapter + ${subs.length} subtopics` : 'Delete chapter'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Subtopics + add form (collapsible) */}
                    {!isCollapsed && editingId !== chapter.reference_id && (
                      <div className="border-t border-gray-100 dark:border-gray-700/60 px-4 pb-2">
                        {/* Subtopic list */}
                        {subs.length > 0 && (
                          <div className="pt-1 pl-4">
                            {subs.map((sub, idx) => renderSubtopic(sub, idx, subs.length))}
                          </div>
                        )}

                        {/* Add subtopic inline form */}
                        {addingSubtopicFor === chapter.reference_id && (
                          <div className="ml-6 mt-2 mb-1 p-3 bg-purple-50/60 dark:bg-purple-900/10 rounded-lg border border-dashed border-purple-300 dark:border-purple-700">
                            <div className="flex gap-2 items-end">
                              <div className="flex-1">
                                <label className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-0.5 block">
                                  Subtopic / عنوان فرعي
                                </label>
                                <input
                                  type="text"
                                  value={subTopic}
                                  dir={isRTL(subTopic) ? 'rtl' : 'ltr'}
                                  onChange={e => setSubTopic(e.target.value)}
                                  placeholder="Subtopic name / اسم العنوان الفرعي"
                                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-purple-500"
                                  onKeyDown={e => e.key === 'Enter' && handleAddSubtopic(chapter.reference_id)}
                                  autoFocus
                                />
                              </div>
                              <div className="w-16">
                                <label className="text-[10px] text-gray-500 block mb-0.5">Start</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={subStartPage}
                                  onChange={e => {
                                    const v = parseInt(e.target.value) || 1;
                                    setSubStartPage(v);
                                    if (subEndPage < v) setSubEndPage(v);
                                  }}
                                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-center tabular-nums"
                                />
                              </div>
                              <div className="w-16">
                                <label className="text-[10px] text-gray-500 block mb-0.5">End</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={subEndPage}
                                  onChange={e => setSubEndPage(parseInt(e.target.value) || 1)}
                                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-center tabular-nums"
                                />
                              </div>
                              <button
                                onClick={() => handleAddSubtopic(chapter.reference_id)}
                                disabled={!subTopic.trim()}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded text-xs font-medium transition-colors shrink-0"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => setAddingSubtopicFor(null)}
                                className="px-2 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs shrink-0"
                              >
                                ✕
                              </button>
                            </div>
                            {subStartPage <= subEndPage && subTopic.trim() && (
                              <p className="text-[10px] text-purple-500 dark:text-purple-400 mt-1.5">
                                📄 {subEndPage - subStartPage + 1} page{subEndPage - subStartPage + 1 !== 1 ? 's' : ''} · Chapter range will auto-update · Enter adds & keeps form open
                              </p>
                            )}
                          </div>
                        )}

                        {/* Empty subtopic hint */}
                        {subs.length === 0 && addingSubtopicFor !== chapter.reference_id && (
                          <div className="ml-6 py-2">
                            <button
                              onClick={() => openAddSubtopic(chapter)}
                              className="text-xs text-purple-500 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1"
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
        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Done
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
