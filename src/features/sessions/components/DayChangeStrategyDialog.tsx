export function DayChangeStrategyDialog({
  oldDay,
  newDay,
  lastAttendedDate,
  onExecute,
  onCancel,
}: {
  oldDay: string | null;
  newDay: string | null;
  lastAttendedDate: string | null;
  onExecute: (strategy: 'from_start' | 'after_last_attended' | 'from_today') => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          <strong>Day changed:</strong> {oldDay || 'None'} → {newDay || 'None'}
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Choose when the new day should start appearing in the Attendance page.
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => onExecute('from_start')}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <p className="font-medium text-gray-900 dark:text-white">From session start date</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Replace the old day entirely. All attendance dates will use the new day ({newDay}) from start to end.
          </p>
        </button>

        <button
          onClick={() => onExecute('after_last_attended')}
          disabled={!lastAttendedDate}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <p className="font-medium text-gray-900 dark:text-white">After last attended date</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {lastAttendedDate
              ? `Keep old ${oldDay} dates up to ${lastAttendedDate}, then switch to ${newDay}.`
              : 'No attendance records found — this option is not available.'}
          </p>
        </button>

        <button
          onClick={() => onExecute('from_today')}
          className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          <p className="font-medium text-gray-900 dark:text-white">From today onwards</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Keep old {oldDay} dates until today, switch to {newDay} starting tomorrow.
          </p>
        </button>
      </div>

      <button
        onClick={onCancel}
        className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-2"
      >
        Cancel — keep the old day
      </button>
    </div>
  );
}
