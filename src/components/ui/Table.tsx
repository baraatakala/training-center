type TableProps = {
  children: React.ReactNode;
  className?: string;
};

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200/80 dark:border-gray-700/50">
      <table className={`min-w-full divide-y divide-gray-200/80 dark:divide-gray-700/50 ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <thead className={`bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm ${className}`}>{children}</thead>;
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="bg-white/50 dark:bg-gray-800/50 divide-y divide-gray-100 dark:divide-gray-700/50">{children}</tbody>;
}

export function TableRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <tr className={`hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors ${className}`}>{children}</tr>;
}

export function TableHead({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <th className={`px-6 py-4 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider ${className}`} onClick={onClick}>
      {children}
    </th>
  );
}

export function TableCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 ${className}`}>{children}</td>;
}
