type TableProps = {
  children: React.ReactNode;
  className?: string;
};

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y divide-gray-200 dark:divide-gray-700 ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <thead className={`bg-gray-50 dark:bg-gray-700/50 ${className}`}>{children}</thead>;
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>;
}

export function TableRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${className}`}>{children}</tr>;
}

export function TableHead({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${className}`}>
      {children}
    </th>
  );
}

export function TableCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 ${className}`}>{children}</td>;
}
