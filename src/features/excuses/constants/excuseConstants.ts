export const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    icon: '⏳',
    ring: 'ring-amber-300 dark:ring-amber-700',
  },
  approved: {
    label: 'Approved',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: '✅',
    ring: 'ring-emerald-300 dark:ring-emerald-700',
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    icon: '❌',
    ring: 'ring-red-300 dark:ring-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
    icon: '🚫',
    ring: 'ring-gray-300 dark:ring-gray-700',
  },
} as const;
