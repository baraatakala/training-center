import React, { useId } from 'react';

// Reusable Input component
type InputProps = {
  label?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  error?: string;
  min?: string;
  max?: string;
  step?: string;
  icon?: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  id?: string;
};

export function Input({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  className = '',
  error,
  min,
  max,
  step,
  icon,
  hint,
  disabled = false,
  id: externalId,
}: InputProps) {
  const autoId = useId();
  const inputId = externalId || autoId;
  return (
    <div className={`mb-4 ${className}`}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={`w-full ${icon ? 'pl-11' : 'px-4'} py-2.5 border-2 rounded-xl focus:outline-none focus:ring-0 bg-gray-50 dark:bg-gray-700/50 dark:text-white dark:placeholder-gray-400 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
            error 
              ? 'border-red-400 focus:border-red-500 dark:border-red-500' 
              : 'border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400'
          }`}
        />
      </div>
      {hint && !error && (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{hint}</p>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
