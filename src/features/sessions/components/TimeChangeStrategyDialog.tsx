export function TimeChangeStrategyDialog({
  oldTime,
  newTime,
  lastAttendedDate,
  onExecute,
  onCancel,
}: {
  oldTime: string | null;
  newTime: string | null;
  lastAttendedDate: string | null;
  onExecute: (strategy: 'from_start' | 'after_last_attended' | 'from_today') => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
        <p className="text-sm text-amber-800 dark:text-amber-300">
          <strong>Time changed:</strong> {oldTime || 'None'} → {newTime || 'None'}
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
          Choose which dates should use the new time in the Attendance page.
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => onExecute('from_start')}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <p className="font-medium text-gray-900 dark:text-white">All dates (from session start)</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Every date in this session will use {newTime} — past and future.
          </p>
        </button>

        <button
          onClick={() => onExecute('after_last_attended')}
          disabled={!lastAttendedDate}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <p className="font-medium text-gray-900 dark:text-white">From next date after last attendance</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {lastAttendedDate
              ? `Dates up to ${lastAttendedDate} keep ${oldTime || 'old time'}, dates after use ${newTime}.`
              : 'No attendance records found — this option is not available.'}
          </p>
        </button>

        <button
          onClick={() => onExecute('from_today')}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <p className="font-medium text-gray-900 dark:text-white">From today onwards</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Past dates keep {oldTime || 'old time'}, today and future dates use {newTime}.
          </p>
        </button>
      </div>

      <button
        onClick={onCancel}
        className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-2"
      >
        Cancel — keep the old time for all dates
      </button>
    </div>
  );
}
