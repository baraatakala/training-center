import React, { useState, useRef } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';

interface AttendanceImportGuidelinesProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File) => void;
  onDownloadTemplate: () => void;
  importing: boolean;
}

const FieldBadge = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-xs bg-blue-100 dark:bg-blue-800 px-1.5 py-0.5 rounded">{children}</span>
);

const CategoryBadge = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1 font-semibold">
    <span>{icon}</span>{children}
  </span>
);

export const AttendanceImportGuidelines: React.FC<AttendanceImportGuidelinesProps> = ({
  isOpen,
  onClose,
  onImport,
  onDownloadTemplate,
  importing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'guidelines' | 'confirm-template'>('guidelines');

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.tsv')) {
      toast.error('Unsupported file format. Use CSV, XLSX, XLS, or TSV.');
      return;
    }

    onImport(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-t-2xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📥</span>
            <h2 className="text-lg font-bold text-white">Import Attendance</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {step === 'guidelines' && (
            <>
              {/* Export Builder Step-by-Step */}
              <section>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                  📤 How to Export Records for Import
                </h3>
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-200 space-y-3">
                  <ol className="list-decimal list-inside space-y-2 ml-1">
                    <li>Go to <strong>Attendance Records</strong> page and open the <strong>Advanced Export Builder</strong></li>
                    <li>Ensure data type is <strong>Records</strong> (the default view)</li>
                    <li>
                      Select these fields from the categories below:
                      <div className="mt-2 space-y-1.5 ml-4">
                        <div>
                          <CategoryBadge icon="👤">Student Info</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Student Name</FieldBadge>
                          <span className="text-blue-600 dark:text-blue-300 text-xs ml-1">(required)</span>
                        </div>
                        <div>
                          <CategoryBadge icon="📋">Basic Info</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Date</FieldBadge>
                          <span className="text-blue-600 dark:text-blue-300 text-xs ml-1">(required)</span>
                        </div>
                        <div>
                          <CategoryBadge icon="✅">Attendance Details</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Status</FieldBadge>
                          <span className="text-blue-600 dark:text-blue-300 text-xs ml-1">(required)</span>
                        </div>
                        <div>
                          <CategoryBadge icon="⏰">Timing Details</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Late Duration (min)</FieldBadge>,{' '}
                          <FieldBadge>Check-in Method</FieldBadge>
                          <span className="text-blue-600/70 dark:text-blue-300/70 text-xs ml-1">(recommended)</span>
                        </div>
                        <div>
                          <CategoryBadge icon="📝">Excuse Info</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Excuse Reason</FieldBadge>
                          <span className="text-blue-600/70 dark:text-blue-300/70 text-xs ml-1">(recommended)</span>
                        </div>
                        <div>
                          <CategoryBadge icon="📍">Location Info</CategoryBadge>
                          {' '}&rarr;{' '}<FieldBadge>Host Address</FieldBadge>
                          <span className="text-blue-600/70 dark:text-blue-300/70 text-xs ml-1">(optional)</span>
                        </div>
                      </div>
                    </li>
                    <li><strong>Filter by date range</strong> to limit the export to a specific period — this prevents out-of-range or duplicate records</li>
                    <li>Export as <strong>CSV</strong> or <strong>Excel</strong> format</li>
                    <li>Import the exported file here</li>
                  </ol>
                </div>
              </section>

              {/* Accepted Columns Summary */}
              <section>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                  <span className="text-red-500">*</span> Required &amp; Optional Columns
                </h3>
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-sm space-y-1.5">
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-indigo-600 dark:text-indigo-400 font-mono text-xs">Student Name *</code>
                    <span className="text-gray-600 dark:text-gray-300">Must match an enrolled student&apos;s name in this session</span>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-indigo-600 dark:text-indigo-400 font-mono text-xs">Date *</code>
                    <span className="text-gray-600 dark:text-gray-300">YYYY-MM-DD or DD/MM/YYYY format</span>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-indigo-600 dark:text-indigo-400 font-mono text-xs">Status *</code>
                    <span className="text-gray-600 dark:text-gray-300">
                      <span className="inline-flex gap-1 flex-wrap">
                        {['on time', 'absent', 'late', 'excused'].map((s) => (
                          <span key={s} className="bg-white dark:bg-gray-600 px-1.5 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-500">{s}</span>
                        ))}
                      </span>
                    </span>
                  </div>
                  <hr className="border-gray-200 dark:border-gray-600 my-1" />
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-gray-500 dark:text-gray-400 font-mono text-xs">Excuse Reason</code>
                    <span className="text-gray-600 dark:text-gray-300">Required when status is <em>excused</em></span>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-gray-500 dark:text-gray-400 font-mono text-xs">Late Duration (min)</code>
                    <span className="text-gray-600 dark:text-gray-300">Minutes late (defaults to 1 for <em>late</em> status)</span>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-gray-500 dark:text-gray-400 font-mono text-xs">Check-in Method</code>
                    <span className="text-gray-600 dark:text-gray-300">qr_code, photo, manual, or bulk (defaults to manual)</span>
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-1">
                    <code className="text-gray-500 dark:text-gray-400 font-mono text-xs">Host Address</code>
                    <span className="text-gray-600 dark:text-gray-300">Location where the session was held</span>
                  </div>
                </div>
              </section>

              {/* Important Notes */}
              <section>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                  ⚠️ Important Notes
                </h3>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-200 space-y-1">
                  <p>• Students must already be <strong>enrolled</strong> in this session before importing</p>
                  <p>• Students are matched by <strong>name</strong> — make sure names match exactly as in the system</p>
                  <p>• Existing records for the same student + date are <strong>updated</strong> (not duplicated)</p>
                  <p>• If you <strong>renamed columns</strong> in the Export Builder, revert them to defaults before exporting for import</p>
                  <p>• Column headers are <strong>case-insensitive</strong>; spaces and underscores are interchangeable</p>
                  <p>• Supported formats: <strong>CSV, XLSX, XLS, TSV</strong></p>
                </div>
              </section>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  onClick={() => setStep('confirm-template')}
                  variant="outline"
                  className="flex-1 gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Template
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  variant="primary"
                  className="flex-1 gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {importing ? 'Importing...' : 'Select File & Import'}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </>
          )}

          {step === 'confirm-template' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">📄</div>
              <p className="text-gray-700 dark:text-gray-300">
                The template uses the same column headers as the Advanced Export Builder&apos;s <strong>Records</strong> view.
                It includes a sample row with an enrolled student from this session.
              </p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => setStep('guidelines')} variant="outline">
                  Back
                </Button>
                <Button
                  onClick={() => {
                    onDownloadTemplate();
                    setStep('guidelines');
                  }}
                  variant="primary"
                  className="gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Template
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
