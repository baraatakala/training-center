// Reusable Card component with dark mode support
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/30 p-6 transition-colors ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-2xl font-bold text-gray-800 dark:text-white ${className}`}>{children}</h2>;
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-gray-600 dark:text-gray-300 ${className}`}>{children}</div>;
}
