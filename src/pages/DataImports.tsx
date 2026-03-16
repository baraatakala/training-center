import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '../components/ui/Button';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { toast } from '../components/ui/toastUtils';
import {
  buildImportTemplate,
  importMasterData,
  MASTER_IMPORT_CONFIGS,
  parseImportFile,
  type MasterImportEntity,
  type MasterImportResult,
} from '../services/masterDataImportService';

function configLabel(entity: MasterImportEntity) {
  return MASTER_IMPORT_CONFIGS.find((config) => config.entity === entity)?.label || entity;
}

export function DataImports() {
  const { isTeacher } = useIsTeacher();
  const [activeImport, setActiveImport] = useState<MasterImportEntity | null>(null);
  const [results, setResults] = useState<Partial<Record<MasterImportEntity, MasterImportResult>>>({});

  const handleDownloadTemplate = (entity: MasterImportEntity) => {
    const workbook = buildImportTemplate(entity);
    XLSX.writeFile(workbook, `${entity}-import-template.xlsx`);
  };

  const handleFileSelected = async (entity: MasterImportEntity, file: File | null) => {
    if (!file) return;

    setActiveImport(entity);
    try {
      const rows = await parseImportFile(file);
      if (rows.length === 0) {
        toast.error('The selected file does not contain any import rows.');
        return;
      }

      const result = await importMasterData(entity, rows);
      setResults((previous) => ({ ...previous, [entity]: result }));

      if (result.errors.length > 0) {
        toast.warning(`${configLabel(entity)} import finished with ${result.errors.length} error(s).`);
      } else {
        toast.success(`${result.created + result.updated} ${entity} row(s) processed successfully.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setActiveImport(null);
    }
  };

  if (!isTeacher) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Master Data Imports</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Students cannot run administrative data imports.</p>
        </div>
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-5 text-amber-800 dark:text-amber-300">
          Import access is restricted to teachers and admins because these uploads create or update core master records.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Master Data Imports</h1>
        <p className="text-sm md:text-base text-gray-500 dark:text-gray-400">
          Attendance bulk import has been removed. Import master tables directly so teachers, students, courses, sessions, and enrollments stay explicit and auditable.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MASTER_IMPORT_CONFIGS.map((config) => {
          const result = results[config.entity];
          const isRunning = activeImport === config.entity;
          return (
            <section
              key={config.entity}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 p-5 shadow-lg"
            >
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{config.label}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">{config.description}</p>
              </div>

              <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-900/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Expected Columns</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {config.columns.map((column) => (
                    <span
                      key={column}
                      className="rounded-full bg-white dark:bg-gray-800 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <Button type="button" variant="outline" onClick={() => handleDownloadTemplate(config.entity)}>
                  Download Template
                </Button>
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 px-4 py-4 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    disabled={isRunning}
                    onChange={(event) => {
                      void handleFileSelected(config.entity, event.target.files?.[0] || null);
                      event.currentTarget.value = '';
                    }}
                  />
                  {isRunning ? 'Importing...' : 'Upload CSV or Excel'}
                </label>
              </div>

              {result && (
                <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{result.created}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Created</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">{result.updated}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Updated</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-red-600 dark:text-red-400">{result.errors.length}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Errors</div>
                    </div>
                  </div>
                  {result.errors.length > 0 && (
                    <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg bg-white dark:bg-gray-800 p-3 text-xs text-red-700 dark:text-red-300 border border-red-100 dark:border-red-900/40">
                      {result.errors.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}