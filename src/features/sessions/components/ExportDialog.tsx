import React, { useState, useRef, useEffect } from 'react';
import type { EnrollmentRow, ExportFields } from '@/features/sessions/constants/bulkScheduleConstants';
import { DEFAULT_EXPORT_FIELDS, AR } from '@/features/sessions/constants/bulkScheduleConstants';
import { exportCSV, exportCSVArabic, exportPDF, exportWord } from '@/features/sessions/utils/bulkScheduleExport';
import { toast } from '@/shared/components/ui/toastUtils';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  enrollments: EnrollmentRow[];
  hostDateMap: Record<string, string | null>;
  sessionId: string;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  enrollments,
  hostDateMap,
  sessionId,
}) => {
  const [exportFormat, setExportFormat] = useState<'csv' | 'csv-arabic' | 'pdf' | 'word' | 'word-arabic'>('csv');
  const [exportFields, setExportFields] = useState<ExportFields>(DEFAULT_EXPORT_FIELDS);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousActiveElement.current = document.activeElement as HTMLElement;
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = exportDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      const focusable = exportDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable && focusable.length > 0) focusable[0].focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen, onClose]);

  const handleExport = () => {
    if (Object.values(exportFields).every(v => !v)) {
      toast.warning('Please select at least one field to export');
      return;
    }
    onClose();
    const ctx = { enrollments, exportFields, hostDateMap, sessionId };
    if (exportFormat === 'csv') exportCSV(ctx);
    else if (exportFormat === 'csv-arabic') exportCSVArabic(ctx);
    else if (exportFormat === 'pdf') exportPDF(ctx);
    else if (exportFormat === 'word' || exportFormat === 'word-arabic') exportWord(ctx, exportFormat === 'word-arabic');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Export Host Schedule" ref={exportDialogRef}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-700">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {'\uD83D\uDCE4'} Export Host Schedule
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export Format</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'csv' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={exportFormat === 'csv'}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  className="mr-3 text-blue-600"
                />
                <span className="text-sm font-medium dark:text-gray-200">{'\uD83D\uDCCA'} CSV (English)</span>
              </label>
              <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'csv-arabic' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <input
                  type="radio"
                  name="format"
                  value="csv-arabic"
                  checked={exportFormat === 'csv-arabic'}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  className="mr-3 text-blue-600"
                />
                <span className="text-sm font-medium dark:text-gray-200">{'\uD83D\uDCCA'} CSV ({AR.ARABIC})</span>
              </label>
              <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'pdf' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <input
                  type="radio"
                  name="format"
                  value="pdf"
                  checked={exportFormat === 'pdf'}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  className="mr-3 text-blue-600"
                />
                <span className="text-sm font-medium dark:text-gray-200">{'\uD83D\uDCC4'} PDF</span>
              </label>
              <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'word' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <input
                  type="radio"
                  name="format"
                  value="word"
                  checked={exportFormat === 'word'}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  className="mr-3 text-blue-600"
                />
                <span className="text-sm font-medium dark:text-gray-200">{'\uD83D\uDCDD'} Word (English)</span>
              </label>
              <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all sm:col-span-2 ${exportFormat === 'word-arabic' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                <input
                  type="radio"
                  name="format"
                  value="word-arabic"
                  checked={exportFormat === 'word-arabic'}
                  onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                  className="mr-3 text-blue-600"
                />
                <span className="text-sm font-medium dark:text-gray-200">{'\uD83D\uDCDD'} Word ({AR.ARABIC})</span>
              </label>
            </div>
          </div>

          {/* Field Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Select Fields to Export</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-700/50">
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.studentName}
                  onChange={(e) => setExportFields({ ...exportFields, studentName: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83D\uDC64'} Student Name</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.address}
                  onChange={(e) => setExportFields({ ...exportFields, address: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83D\uDCCD'} Address</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.phone}
                  onChange={(e) => setExportFields({ ...exportFields, phone: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83D\uDCF1'} Phone</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.canHost}
                  onChange={(e) => setExportFields({ ...exportFields, canHost: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83C\uDFE0'} Can Host</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.hostDate}
                  onChange={(e) => setExportFields({ ...exportFields, hostDate: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83D\uDCC5'} Host Date</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={exportFields.enrollmentStatus}
                  onChange={(e) => setExportFields({ ...exportFields, enrollmentStatus: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\u2714'} Status</span>
              </label>
              <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors sm:col-span-2">
                <input
                  type="checkbox"
                  checked={exportFields.studentId}
                  onChange={(e) => setExportFields({ ...exportFields, studentId: e.target.checked })}
                  className="mr-3 rounded text-blue-600"
                />
                <span className="text-sm dark:text-gray-200">{'\uD83C\uDD94'} Student ID</span>
              </label>
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
            <div className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Preview:</div>
            <div className="text-sm text-blue-700 dark:text-blue-400">
              {Object.values(exportFields).filter(Boolean).length} field(s) selected for {enrollments.length} student(s)
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 font-semibold transition-colors order-2 sm:order-1"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors flex items-center justify-center gap-2 order-1 sm:order-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Export Data
          </button>
        </div>
      </div>
    </div>
  );
};
