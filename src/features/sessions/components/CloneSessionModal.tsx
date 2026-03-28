import { Button } from '@/shared/components/ui/Button';
import type { SessionWithDetails } from '@/features/sessions/constants/sessionConstants';
import { DAYS_OF_WEEK } from '@/features/sessions/constants/sessionConstants';
import { parseLocalDate, formatLocalDate } from '@/features/sessions/utils/sessionHelpers';

export function CloneSessionModal({
  cloneSource,
  cloneForm,
  setCloneForm,
  selectedCloneDays,
  setSelectedCloneDays,
  cloning,
  enrollmentCount,
  onClone,
  onClose,
}: {
  cloneSource: SessionWithDetails;
  cloneForm: {
    start_date: string;
    end_date: string;
    day: string;
    time: string;
    location: string;
    copyEnrollments: boolean;
  };
  setCloneForm: React.Dispatch<React.SetStateAction<typeof cloneForm>>;
  selectedCloneDays: string[];
  setSelectedCloneDays: React.Dispatch<React.SetStateAction<string[]>>;
  cloning: boolean;
  enrollmentCount: number;
  onClone: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Source info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          <strong>Cloning from:</strong> {cloneSource.course?.course_name || 'Unknown'} — {cloneSource.teacher?.name || 'Unknown'}
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Original: {cloneSource.day} · {cloneSource.time || 'No time set'} · {enrollmentCount} students
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Suggested clone starts the day after this session ends and keeps the same duration.
        </p>
      </div>

      {/* New date range */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Start Date <span className="text-red-500">*</span></label>
          <input
            type="date"
            value={cloneForm.start_date}
            onChange={e => {
              const nextStart = e.target.value;
              setCloneForm(f => {
                if (!nextStart) return { ...f, start_date: nextStart };
                if (f.end_date) return { ...f, start_date: nextStart };
                const originalStart = parseLocalDate(cloneSource.start_date);
                const originalEnd = parseLocalDate(cloneSource.end_date);
                const newStart = parseLocalDate(nextStart);
                if (!originalStart || !originalEnd || !newStart) return { ...f, start_date: nextStart };
                const durationDays = Math.max(0, Math.round((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)));
                const newEnd = new Date(newStart.getFullYear(), newStart.getMonth(), newStart.getDate() + durationDays);
                return { ...f, start_date: nextStart, end_date: formatLocalDate(newEnd) };
              });
            }}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New End Date <span className="text-red-500">*</span></label>
          <input
            type="date"
            value={cloneForm.end_date}
            onChange={e => setCloneForm(f => ({ ...f, end_date: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
          {cloneForm.start_date && !cloneForm.end_date && (
            <button
              type="button"
              onClick={() => setCloneForm(f => ({ ...f, end_date: f.start_date }))}
              className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Use same day
            </button>
          )}
        </div>
      </div>

      {/* Days */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Day(s) <span className="text-red-500">*</span></label>
        {cloneForm.start_date && (
          <button
            type="button"
            onClick={() => {
              const parsed = parseLocalDate(cloneForm.start_date);
              if (!parsed) return;
              const matchedDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parsed.getDay()];
              setSelectedCloneDays([matchedDay]);
            }}
            className="mb-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Match start date day
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          {DAYS_OF_WEEK.map(day => (
            <label key={day} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedCloneDays.includes(day)}
                onChange={e => {
                  const newDays = e.target.checked
                    ? [...selectedCloneDays, day]
                    : selectedCloneDays.filter(d => d !== day);
                  setSelectedCloneDays(newDays);
                }}
                className="h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{day}</span>
            </label>
          ))}
        </div>
        {selectedCloneDays.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">Selected: {selectedCloneDays.join(', ')}</p>
        )}
      </div>

      {/* Time */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Time Range</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="time"
            value={cloneForm.time?.split('-')[0]?.trim() || ''}
            onChange={e => {
              const endTime = cloneForm.time?.split('-')[1]?.trim() || '';
              setCloneForm(f => ({ ...f, time: endTime ? `${e.target.value}-${endTime}` : e.target.value }));
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
          <input
            type="time"
            value={cloneForm.time?.split('-')[1]?.trim() || ''}
            onChange={e => {
              const startTime = cloneForm.time?.split('-')[0]?.trim() || '';
              setCloneForm(f => ({ ...f, time: startTime ? `${startTime}-${e.target.value}` : e.target.value }));
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
        <input
          type="text"
          value={cloneForm.location}
          onChange={e => setCloneForm(f => ({ ...f, location: e.target.value }))}
          placeholder="e.g., Main Campus - Room 202"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
        />
        {cloneSource.location && (
          <button
            type="button"
            onClick={() => setCloneForm(f => ({ ...f, location: cloneSource.location || '' }))}
            className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Reuse original location
          </button>
        )}
      </div>

      {/* Copy enrollments toggle */}
      <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 cursor-pointer">
        <input
          type="checkbox"
          checked={cloneForm.copyEnrollments}
          onChange={e => setCloneForm(f => ({ ...f, copyEnrollments: e.target.checked }))}
          className="h-5 w-5 text-blue-600 rounded border-gray-300"
        />
        <div>
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            Copy all {enrollmentCount} students to new session
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Active enrollments will be duplicated automatically
          </p>
        </div>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={onClone}
          disabled={cloning || !cloneForm.start_date || !cloneForm.end_date || selectedCloneDays.length === 0}
        >
          {cloning ? 'Cloning...' : `📋 Clone Session${cloneForm.copyEnrollments ? ' + Students' : ''}`}
        </Button>
      </div>
    </div>
  );
}
