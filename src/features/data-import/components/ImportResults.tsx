import type { ImportResult } from '@/features/data-import/constants/importConstants';

interface ImportResultsProps {
  result: ImportResult;
}

export function ImportResults({ result }: ImportResultsProps) {
  return (
    <div className={`p-4 rounded-lg border ${result.success ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
      <h3 className="font-semibold mb-2 dark:text-white">{result.success ? '✅ Import Results' : '⚠️ Import Results'}</h3>
      <p className="mb-3 dark:text-gray-300">{result.message}</p>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3 text-sm">
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Teachers Created:</span>
          <span className="font-bold ml-2 dark:text-white">{result.teachersCreated}</span>
        </div>
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Students Created:</span>
          <span className="font-bold ml-2 dark:text-white">{result.studentsCreated}</span>
        </div>
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Courses Created:</span>
          <span className="font-bold ml-2 dark:text-white">{result.coursesCreated}</span>
        </div>
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Sessions Created:</span>
          <span className="font-bold ml-2 dark:text-white">{result.sessionsCreated}</span>
        </div>
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Enrollments Created:</span>
          <span className="font-bold ml-2 dark:text-white">{result.enrollmentsCreated}</span>
        </div>
        <div className="bg-white dark:bg-gray-700 p-2 rounded border dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Attendance Records:</span>
          <span className="font-bold ml-2 dark:text-white">{result.attendanceCreated}</span>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-3 rounded border border-red-200 dark:border-red-800 max-h-40 overflow-y-auto">
          <h4 className="font-semibold text-red-900 dark:text-red-400 mb-2">Errors ({result.errors.length}):</h4>
          <ul className="list-disc list-inside text-sm text-red-800 dark:text-red-400 space-y-1">
            {result.errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
