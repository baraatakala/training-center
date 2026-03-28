export function SessionSummaryCards({
  total,
  active,
  upcoming,
  completed,
}: {
  total: number;
  active: number;
  upcoming: number;
  completed: number;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-900/30">
        <div className="text-3xl font-bold text-gray-900 dark:text-white">{total}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Total Sessions</div>
      </div>
      <div className="bg-green-50 dark:bg-green-900/30 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-green-200 dark:border-green-700">
        <div className="text-3xl font-bold text-green-700 dark:text-green-400">{active}</div>
        <div className="text-sm text-green-600 dark:text-green-400 mt-1">Active Now</div>
      </div>
      <div className="bg-yellow-50 dark:bg-yellow-900/30 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-yellow-200 dark:border-yellow-700">
        <div className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{upcoming}</div>
        <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">Upcoming</div>
      </div>
      <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg shadow dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-600">
        <div className="text-3xl font-bold text-gray-700 dark:text-gray-300">{completed}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Completed</div>
      </div>
    </div>
  );
}
