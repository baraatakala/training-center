// Loading Skeleton Component
export function Skeleton({ className = '', variant = 'default' }: { className?: string; variant?: 'default' | 'text' | 'circle' | 'card' }) {
  const baseClass = 'animate-pulse bg-gray-200 rounded';
  
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
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className={j === 0 ? 'w-1/4' : 'flex-1'} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Card Skeleton
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton variant="card" />
      <div className="flex gap-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
