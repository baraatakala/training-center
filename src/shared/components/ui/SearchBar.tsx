type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

export function SearchBar({ value, onChange, placeholder = 'Search...', className = '', size = 'md' }: SearchBarProps) {
  const sizeClasses = {
    sm: 'pl-9 pr-3 py-1.5 text-sm',
    md: 'pl-11 pr-4 py-2.5',
    lg: 'pl-12 pr-4 py-3 text-lg',
  };

  const iconSizes = {
    sm: 'h-4 w-4 left-2.5',
    md: 'h-5 w-5 left-3.5',
    lg: 'h-6 w-6 left-4',
  };

  return (
    <div className={`relative ${className}`}>
      <div className={`absolute inset-y-0 ${iconSizes[size]} flex items-center pointer-events-none`}>
        <svg className={`${iconSizes[size].split(' ').slice(0, 2).join(' ')} text-gray-400 dark:text-gray-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`block w-full ${sizeClasses[size]} border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50/80 dark:bg-gray-700/50 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-0 transition-all backdrop-blur-sm`}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
