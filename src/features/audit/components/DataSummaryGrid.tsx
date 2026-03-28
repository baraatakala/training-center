import { getSummaryEntries } from '@/features/audit/utils/auditHelpers';

export function DataSummaryGrid({ tableName, data, color }: {
  tableName: string;
  data: Record<string, unknown>;
  color: 'red' | 'green';
}) {
  const summary = getSummaryEntries(tableName, data);
  const bg = color === 'red'
    ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'
    : 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30';

  if (summary.length === 0) return <p className="text-xs text-gray-500 italic">No data recorded</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {summary.map(({ label, value }) => (
        <div key={label} className={`rounded-lg px-3 py-2 border ${bg}`}>
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-500 tracking-wider">{label}</p>
          <p className="text-xs text-gray-800 dark:text-gray-300 break-all">{value}</p>
        </div>
      ))}
    </div>
  );
}
