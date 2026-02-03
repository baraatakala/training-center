// Loading Skeleton Component
export function Skeleton({ className = '', variant = 'default' }: { className?: string; variant?: 'default' | 'text' | 'circle' | 'card' }) {
  const baseClass = 'animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 rounded-lg';
  
  const variantClasses = {
    default: 'h-4 w-full',
    text: 'h-3 w-3/4',
    circle: 'h-12 w-12 rounded-full',
    card: 'h-32 w-full'
  };
  
  return <div className={`${baseClass} ${variantClasses[variant]} ${className}`} />;
}

// Table Skeleton
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-4 p-4">
      {/* Header skeleton */}
      <div className="flex gap-4 pb-4 border-b border-gray-200 dark:border-gray-700">
        {Array.from({ length: columns }).map((_, j) => (
          <Skeleton key={j} className={`h-4 ${j === 0 ? 'w-1/4' : 'flex-1'}`} />
        ))}
      </div>
      {/* Rows skeleton */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className={`h-5 ${j === 0 ? 'w-1/4' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Card Skeleton
export function CardSkeleton() {
  return (
    <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 space-y-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton variant="card" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-28 rounded-xl" />
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>
    </div>
  );
}

// Stat Card Skeleton
export function StatCardSkeleton() {
  return (
    <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </div>
  );
}
