import { useEffect, useState } from 'react';
import { listeners } from './toastUtils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose: (id: string) => void;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export function Toast({ id, message, type, onClose }: ToastProps) {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const styles = {
    success: 'bg-green-50 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700',
    error: 'bg-red-50 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700',
    warning: 'bg-yellow-50 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-700',
    info: 'bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-700'
  };

  return (
    <div
      className={`${styles[type]} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in-right`}
    >
      <div className="flex-shrink-0 text-lg font-bold">
        {icons[type]}
      </div>
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={() => onClose(id)}
        className="flex-shrink-0 hover:opacity-70 transition-opacity text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      
      if (toast.duration) {
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, toast.duration);
      }
    };

    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={removeToast}
        />
      ))}
    </div>
  );
}
