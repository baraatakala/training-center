// Reusable Card component with glassmorphism and modern styling
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  gradient?: 'none' | 'blue' | 'purple' | 'green' | 'orange' | 'pink';
}

export function Card({ children, className = '', hover = false, gradient = 'none' }: CardProps) {
  const gradientStyles = {
    none: '',
    blue: 'bg-gradient-to-br from-blue-500/10 to-cyan-500/10 dark:from-blue-500/20 dark:to-cyan-500/20',
    purple: 'bg-gradient-to-br from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20',
    green: 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20',
    orange: 'bg-gradient-to-br from-orange-500/10 to-amber-500/10 dark:from-orange-500/20 dark:to-amber-500/20',
    pink: 'bg-gradient-to-br from-pink-500/10 to-rose-500/10 dark:from-pink-500/20 dark:to-rose-500/20',
  };

  return (
    <div className={`
      bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm
      rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50
      border border-gray-100 dark:border-gray-700/50
      p-6 transition-all duration-200
      ${hover ? 'hover:shadow-xl hover:scale-[1.02] hover:border-gray-200 dark:hover:border-gray-600 cursor-pointer' : ''}
      ${gradientStyles[gradient]}
      ${className}
    `}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-xl font-bold text-gray-900 dark:text-white ${className}`}>{children}</h2>;
}

export function CardDescription({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-gray-500 dark:text-gray-400 mt-1 ${className}`}>{children}</p>;
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-gray-600 dark:text-gray-300 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 ${className}`}>{children}</div>;
}
