import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/shared/components/ui/Button';
import {
  sessionMergeService,
  type MergePreview,
  type MergeOptions,
  type MergeResult,
} from '@/features/sessions/services/sessionMergeService';
import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { formatDate } from '@/shared/utils/formatDate';

type Step = 'select' | 'options' | 'done';

// ─────────────────────────────────────────────────────────────────────────────
// Small helper to render a coloured stat card
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: 'green' | 'orange' | 'blue' | 'purple' | 'gray';
}) {
  const colors = {
    green: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 [&>span]:text-green-600 dark:[&>span]:text-green-400',
    orange: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 [&>span]:text-orange-600 dark:[&>span]:text-orange-400',
    blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 [&>span]:text-blue-600 dark:[&>span]:text-blue-400',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 [&>span]:text-purple-600 dark:[&>span]:text-purple-400',
    gray: 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 [&>span]:text-gray-500 dark:[&>span]:text-gray-400',
  };

  return (
    <div className={`rounded-lg p-3 text-center ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <span className="text-xs">{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function SessionMergeModal({
  targetSession,
  allSessions,
  onClose,
  onSuccess,
}: {
  targetSession: SessionWithDetails;
  allSessions: SessionWithDetails[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<Step>('select');
  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [options, setOptions] = useState<MergeOptions>({
    conflict_resolution: 'skip',
    auto_enroll: true,
    transfer_date_host_overrides: true,
    transfer_per_date_content: true,
    delete_source_after: false,
  });

  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ── Filtered session list (excludes target) ─────────────────────────────
  const filteredSessions = useMemo(() => {
    const q = sourceSearch.toLowerCase();
    return allSessions
      .filter((s) => s.session_id !== targetSession.session_id)
      .filter(
        (s) =>
          (s.course?.course_name || '').toLowerCase().includes(q) ||
          (s.teacher?.name || '').toLowerCase().includes(q) ||
          (s.start_date || '').includes(q) ||
          (s.day || '').toLowerCase().includes(q),
      );
  }, [allSessions, targetSession.session_id, sourceSearch]);

  // ── Auto-fetch preview when source is selected ──────────────────────────
  useEffect(() => {
    if (!selectedSourceId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);

    sessionMergeService
      .previewMerge(selectedSourceId, targetSession.session_id)
      .then(({ data, error }) => {
        if (cancelled) return;
        setPreviewLoading(false);
        if (error) {
          setPreviewError(error.message);
        } else {
          setPreview(data);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSourceId, targetSession.session_id]);

  const selectedSession = allSessions.find((s) => s.session_id === selectedSourceId);

  // ── Execute merge ────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!selectedSourceId) return;
    setExecuting(true);
    setExecuteError(null);

    const { data, error } = await sessionMergeService.mergeSession(
      selectedSourceId,
      targetSession.session_id,
      options,
    );

    setExecuting(false);

    if (error) {
      setExecuteError(error.message);
      return;
    }

    setResult(data);
    setStep('done');
    onSuccess();
  };

  const canDelete =
    !options.delete_source_after ||
    deleteConfirmText === (selectedSession?.course?.course_name || '');

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 1 — Select source session
  // ════════════════════════════════════════════════════════════════════════════
  if (step === 'select') {
    return (
      <div className="space-y-4">
        {/* Target session indicator */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wide mb-0.5">
            Merging attendance INTO
          </p>
          <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
            {targetSession.course?.course_name}
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            {targetSession.teacher?.name} &middot; {formatDate(targetSession.start_date)} &rarr;{' '}
            {formatDate(targetSession.end_date)}
            {targetSession.day ? ` &middot; ${targetSession.day}` : ''}
          </p>
        </div>

        {/* Source search */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Select the session to pull attendance FROM:
          </label>
          <input
            type="text"
            value={sourceSearch}
            onChange={(e) => setSourceSearch(e.target.value)}
            placeholder="Search by course, teacher, day..."
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Session list */}
        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {filteredSessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No other sessions found.
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = selectedSourceId === session.session_id;
                return (
                  <button
                    key={session.session_id}
                    type="button"
                    onClick={() => setSelectedSourceId(session.session_id)}
                    className={`w-full text-left px-4 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-l-[3px] border-l-blue-500'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-l-[3px] border-l-transparent'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-white">
                      {session.course?.course_name || 'Unknown Course'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {session.teacher?.name} &middot; {formatDate(session.start_date)} &rarr;{' '}
                      {formatDate(session.end_date)}
                      {session.day ? ` &middot; ${session.day}` : ''}
                      {session.time ? ` @ ${session.time}` : ''}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Inline preview after source is selected */}
        {selectedSourceId && (
          <div>
            {previewLoading && (
              <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 py-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Analysing attendance records...
              </div>
            )}

            {previewError && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3">
                Error loading preview: {previewError}
              </div>
            )}

            {preview && !previewLoading && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3">
                {preview.summary.students_count === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">
                    This session has no attendance records to transfer.
                  </p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      Merge preview
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatCard
                        value={preview.summary.total_transferable}
                        label="Ready to transfer"
                        color="green"
                      />
                      <StatCard
                        value={preview.summary.total_conflicts}
                        label="Conflicts"
                        color="orange"
                      />
                      <StatCard
                        value={preview.summary.total_unenrolled_records}
                        label="Not enrolled"
                        color="blue"
                      />
                      <StatCard
                        value={preview.date_host_override_count}
                        label="Date overrides"
                        color="purple"
                      />
                      {preview.teacher_host_schedule_count > 0 && (
                        <StatCard
                          value={preview.teacher_host_schedule_count}
                          label="Teacher schedule"
                          color="gray"
                        />
                      )}
                      {preview.recording_count > 0 && (
                        <StatCard
                          value={preview.recording_count}
                          label="Recordings"
                          color="purple"
                        />
                      )}
                      {preview.book_coverage_count > 0 && (
                        <StatCard
                          value={preview.book_coverage_count}
                          label="Book refs"
                          color="gray"
                        />
                      )}
                      {preview.feedback_question_count > 0 && (
                        <StatCard
                          value={preview.feedback_question_count}
                          label="Feedback Qs"
                          color="gray"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selectedSourceId || previewLoading || !preview}
            onClick={() => setStep('options')}
          >
            Review Options &rarr;
          </Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 2 — Options + full preview table
  // ════════════════════════════════════════════════════════════════════════════
  if (step === 'options' && preview) {
    const { summary } = preview;
    const sourceName = selectedSession?.course?.course_name || 'Source session';

    return (
      <div className="space-y-4">
        {/* FROM → TO header */}
        <div className="flex items-stretch gap-3">
          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
              FROM
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {sourceName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {selectedSession?.teacher?.name}
            </p>
          </div>

          <div className="flex items-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </div>

          <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2.5">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-0.5">
              INTO
            </p>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200 truncate">
              {targetSession.course?.course_name}
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
              {targetSession.teacher?.name}
            </p>
          </div>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            value={summary.total_transferable}
            label="Clean transfers"
            color="green"
          />
          <StatCard value={summary.total_conflicts} label="Conflicts" color="orange" />
          <StatCard
            value={summary.total_unenrolled_records}
            label="Unenrolled records"
            color="blue"
          />
          <StatCard
            value={preview.date_host_override_count}
            label="Date overrides"
            color="purple"
          />
          {preview.teacher_host_schedule_count > 0 && (
            <StatCard
              value={preview.teacher_host_schedule_count}
              label="Teacher schedule"
              color="gray"
            />
          )}
          {preview.recording_count > 0 && (
            <StatCard
              value={preview.recording_count}
              label="Recordings"
              color="purple"
            />
          )}
          {preview.book_coverage_count > 0 && (
            <StatCard
              value={preview.book_coverage_count}
              label="Book refs"
              color="gray"
            />
          )}
          {preview.feedback_question_count > 0 && (
            <StatCard
              value={preview.feedback_question_count}
              label="Feedback Qs"
              color="gray"
            />
          )}
        </div>

        {/* Student preview table */}
        {preview.students.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {preview.students.length} students with attendance records
            </div>

            <div className="max-h-44 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50">
              {preview.students.map((student) => (
                <div
                  key={student.student_id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {student.student_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{student.student_email}</p>
                  </div>

                  <div className="flex gap-1 flex-shrink-0">
                    {student.target_enrollment_id && student.transferable_dates.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-medium">
                        {student.transferable_dates.length} ready
                      </span>
                    )}
                    {student.target_enrollment_id && (() => {
                      const excusedCount = student.transferable_dates.filter(
                        (d) => student.statuses[d] === 'excused',
                      ).length;
                      return excusedCount > 0 ? (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 font-medium">
                          {excusedCount} excused
                        </span>
                      ) : null;
                    })()}
                    {student.conflict_dates.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 font-medium">
                        {student.conflict_dates.length} conflict
                      </span>
                    )}
                    {!student.target_enrollment_id && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                        not enrolled &middot;{' '}
                        {student.transferable_dates.length + student.conflict_dates.length} records
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Options panel */}
        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
          <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Options
          </div>

          {/* Conflict resolution — only shown when conflicts exist */}
          {summary.total_conflicts > 0 && (
            <div className="px-4 py-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                When a student already has attendance on the same date:
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="conflict_resolution"
                    checked={options.conflict_resolution === 'skip'}
                    onChange={() =>
                      setOptions((o) => ({ ...o, conflict_resolution: 'skip' }))
                    }
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">Skip</span> — keep existing target record
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="conflict_resolution"
                    checked={options.conflict_resolution === 'overwrite'}
                    onChange={() =>
                      setOptions((o) => ({ ...o, conflict_resolution: 'overwrite' }))
                    }
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium">Overwrite</span> — replace with source record
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Auto-enroll — only shown when unenrolled students exist */}
          {summary.total_unenrolled_records > 0 && (
            <div className="px-4 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.auto_enroll}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, auto_enroll: e.target.checked }))
                  }
                  className="mt-0.5 text-blue-600 focus:ring-blue-500 rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Auto-enroll missing students</span> — automatically
                  enroll students in the target session so their records can be transferred
                </span>
              </label>
              {!options.auto_enroll && (
                <div className="mt-2 ml-7 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                  ⚠️ {summary.total_unenrolled_records} attendance record{summary.total_unenrolled_records !== 1 ? 's' : ''} will be <strong>skipped</strong> — those students are not enrolled in the target session.
                </div>
              )}
            </div>
          )}

          {/* Transfer date/time overrides — shown when overrides or teacher schedule exist */}
          {(preview.date_host_override_count > 0 || preview.teacher_host_schedule_count > 0) && (
            <div className="px-4 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.transfer_date_host_overrides}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      transfer_date_host_overrides: e.target.checked,
                    }))
                  }
                  className="mt-0.5 text-blue-600 focus:ring-blue-500 rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Transfer scheduling data</span> — copy per-date
                  host address &amp; identity ({preview.date_host_override_count} date{preview.date_host_override_count !== 1 ? 's' : ''}) and teacher host schedule
                  ({preview.teacher_host_schedule_count} entries). Session time overrides from the source are not applied to the target.
                </span>
              </label>
            </div>
          )}

          {/* Transfer per-date content: recordings, book coverage, feedback questions */}
          {(preview.recording_count > 0 || preview.book_coverage_count > 0 || preview.feedback_question_count > 0) && (
            <div className="px-4 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.transfer_per_date_content}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, transfer_per_date_content: e.target.checked }))
                  }
                  className="mt-0.5 text-blue-600 focus:ring-blue-500 rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Transfer per-date content</span> — copy recording
                  links ({preview.recording_count}),
                  book references ({preview.book_coverage_count}{!preview.same_course && preview.book_coverage_count > 0 ? ' — skipped, different courses' : ''}),
                  and feedback questions ({preview.feedback_question_count})
                </span>
              </label>
              {preview.book_coverage_count > 0 && !preview.same_course && (
                <p className="mt-1.5 ml-7 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ Book references cannot be transferred — source and target belong to different courses.
                </p>
              )}
            </div>
          )}

          {/* Delete source — always shown, danger zone */}
          <div className="px-4 py-3 bg-red-50/60 dark:bg-red-900/10">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={options.delete_source_after}
                onChange={(e) => {
                  setOptions((o) => ({ ...o, delete_source_after: e.target.checked }));
                  setDeleteConfirmText('');
                }}
                className="mt-0.5 text-red-600 focus:ring-red-500 rounded"
              />
              <span className="text-sm text-red-700 dark:text-red-400">
                <span className="font-medium">Delete source session after merge</span> — permanently
                deletes &quot;{sourceName}&quot; and all its remaining data
              </span>
            </label>

            {options.delete_source_after && (
              <div className="mt-2.5 ml-7">
                <p className="text-xs text-red-600 dark:text-red-400 mb-1.5">
                  Type the course name to confirm:{' '}
                  <span className="font-mono font-semibold">{sourceName}</span>
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={sourceName}
                  className="w-full border border-red-300 dark:border-red-700 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Execute error */}
        {executeError && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3">
            {executeError}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between gap-2 pt-1">
          <Button variant="secondary" onClick={() => setStep('select')} disabled={executing}>
            &larr; Back
          </Button>

          <Button
            variant={options.delete_source_after ? 'danger' : 'primary'}
            disabled={executing || !canDelete}
            onClick={handleExecute}
          >
            {executing ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Merging...
              </span>
            ) : options.delete_source_after ? (
              'Merge & Delete Source'
            ) : (
              'Execute Merge'
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 3 — Result
  // ════════════════════════════════════════════════════════════════════════════
  if (step === 'done' && result) {
    const total =
      result.transferred + result.overwritten + result.skipped + result.failed + result.enrolled;
    const contentTotal =
      result.recordings_transferred + result.book_coverages_transferred + result.feedback_questions_transferred;

    return (
      <div className="space-y-4">
        {/* Success header */}
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-8 h-8 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Merge Complete!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} attendance record{total !== 1 ? 's' : ''} processed
            {contentTotal > 0 ? ` · ${contentTotal} content item${contentTotal !== 1 ? 's' : ''} copied` : ''}
            {result.source_deleted ? ' — source session deleted' : ''}
          </p>
        </div>

        {/* Result stat grid */}
        <div className="grid grid-cols-2 gap-2">
          {result.transferred > 0 && (
            <StatCard value={result.transferred} label="Records transferred" color="green" />
          )}
          {result.overwritten > 0 && (
            <StatCard value={result.overwritten} label="Records overwritten" color="orange" />
          )}
          {result.enrolled > 0 && (
            <StatCard value={result.enrolled} label="Students enrolled" color="blue" />
          )}
          {result.skipped > 0 && (
            <StatCard value={result.skipped} label="Records skipped" color="gray" />
          )}
          {result.failed > 0 && (
            <StatCard value={result.failed} label="Records failed" color="orange" />
          )}
          {result.date_host_overrides_transferred > 0 && (
            <StatCard
              value={result.date_host_overrides_transferred}
              label="Overrides transferred"
              color="purple"
            />
          )}
          {result.recordings_transferred > 0 && (
            <StatCard
              value={result.recordings_transferred}
              label="Recordings copied"
              color="purple"
            />
          )}
          {result.book_coverages_transferred > 0 && (
            <StatCard
              value={result.book_coverages_transferred}
              label="Book refs copied"
              color="gray"
            />
          )}
          {result.feedback_questions_transferred > 0 && (
            <StatCard
              value={result.feedback_questions_transferred}
              label="Feedback Qs copied"
              color="gray"
            />
          )}
        </div>

        {/* Non-fatal errors */}
        {result.errors.length > 0 && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-orange-700 dark:text-orange-400 mb-2">
              {result.errors.length} warning{result.errors.length !== 1 ? 's' : ''} during merge:
            </p>
            <ul className="text-xs text-orange-600 dark:text-orange-400 space-y-1 max-h-28 overflow-y-auto">
              {result.errors.map((err, i) => (
                <li key={i} className="flex gap-1">
                  <span className="flex-shrink-0">&bull;</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
