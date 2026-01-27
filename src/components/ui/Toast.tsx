import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

let toastId = 0;
const listeners: ((toast: Toast) => void)[] = [];

export const toast = {
  success: (message: string, duration = 3000) => {
    showToast({ message, type: 'success', duration });
  },
  error: (message: string, duration = 4000) => {
    showToast({ message, type: 'error', duration });
  },
  warning: (message: string, duration = 3500) => {
    showToast({ message, type: 'warning', duration });
  },
  info: (message: string, duration = 3000) => {
    showToast({ message, type: 'info', duration });
  }
};

function showToast({ message, type, duration = 3000 }: Omit<Toast, 'id'>) {
  const id = `toast-${toastId++}`;
  const newToast: Toast = { id, message, type, duration };
  listeners.forEach(listener => listener(newToast));
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

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const styles = {
    success: 'bg-green-50 text-green-800 border-green-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200'
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${styles[toast.type]} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in-right`}
        >
          <div className="flex-shrink-0 text-lg font-bold">
            {icons[toast.type]}
          </div>
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 hover:opacity-70 transition-opacity text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
