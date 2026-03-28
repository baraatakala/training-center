import type { ToastType } from './Toast';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

let toastId = 0;
export const listeners: ((toast: Toast) => void)[] = [];

function showToast({ message, type, duration = 3000 }: Omit<Toast, 'id'>) {
  const id = `toast-${toastId++}`;
  const newToast: Toast = { id, message, type, duration };
  listeners.forEach(listener => listener(newToast));
}

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
