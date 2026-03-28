import { Button } from '@/shared/components/ui/Button';
import type { ImportRow } from '@/features/data-import/constants/importConstants';

interface ImportPreviewProps {
  previewData: ImportRow[];
  fileName: string;
  importing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportPreview({ previewData, fileName, importing, onConfirm, onCancel }: ImportPreviewProps) {
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300">📋 Preview Import Data</h3>
          <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
            File: <span className="font-medium">{fileName}</span> - {previewData.length} records found
          </p>
          <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
            Review the data below and click "Confirm Import" to proceed or "Cancel" to discard.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            ❌ Cancel
          </Button>
          <Button onClick={onConfirm} disabled={importing}>
            {importing ? '⏳ Importing...' : '✅ Confirm Import'}
          </Button>
        </div>
      </div>

      {/* Preview Stats */}
      <div className="bg-white dark:bg-gray-700 rounded-lg p-3 mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Summary:</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Unique Students:</span>
            <span className="font-bold ml-2 text-blue-600">
              {new Set(previewData.map(r => r.studentEmail)).size}
            </span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Unique Instructors:</span>
            <span className="font-bold ml-2 text-blue-600">
              {new Set(previewData.map(r => r.instructorEmail)).size}
            </span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Unique Courses:</span>
            <span className="font-bold ml-2 text-blue-600">
              {new Set(previewData.map(r => r.courseName)).size}
            </span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Attendance Records:</span>
            <span className="font-bold ml-2 text-blue-600">{previewData.length}</span>
          </div>
        </div>
      </div>

      {/* Preview Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Student</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Course</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Instructor</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">GPS</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {previewData.slice(0, 50).map((row, index) => (
              <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{index + 1}</td>
                <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                  <div>{row.studentName}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{row.studentEmail}</div>
                </td>
                <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{row.courseName}</td>
                <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                  <div>{row.instructorName}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{row.instructorEmail}</div>
                </td>
                <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{row.attendanceDate}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    row.status === 'present' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                    row.status === 'absent' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                    row.status === 'late' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                    row.status === 'excused' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {row.gpsLatitude && row.gpsLongitude ? '✔' : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {previewData.length > 50 && (
          <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 text-center border-t dark:border-gray-600">
            Showing first 50 of {previewData.length} records
          </div>
        )}
      </div>
    </div>
  );
}
