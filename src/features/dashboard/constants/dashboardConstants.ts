// Dashboard types
// Message template types for the composer
export type MessageTemplate = 'attendance_alert' | 'encouragement' | 'reminder' | 'custom';
export type MessageChannel = 'email' | 'sms' | 'whatsapp';

export type DashboardStats = {
  totalStudents: number;
  totalTeachers: number;
  activeEnrollments: number;
  totalSessions: number;
  todaySessions: number;
  totalCourses: number;
  pendingFeedback: number;
  issuedCertificates: number;
  loading: boolean;
};


export type HealthCheck = {
  label: string;
  status: 'ok' | 'warn' | 'error';
  count: number;
  detail: string;
  icon: string;
  actionLabel?: string;
  actionPath?: string;
};

// Risk level styling
export const RISK_STYLES = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    border: 'border-red-300 dark:border-red-700',
    hover: 'hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/50',
    badge: 'bg-red-600 text-white',
    icon: 'Ã°Å¸Å¡Â¨'
  },
  high: {
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    border: 'border-orange-300 dark:border-orange-700',
    hover: 'hover:bg-orange-100 hover:border-orange-400 dark:hover:bg-orange-900/50',
    badge: 'bg-orange-600 text-white',
    icon: 'Ã¢Å¡Â Ã¯Â¸Â'
  },
  medium: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/30',
    border: 'border-yellow-300 dark:border-yellow-700',
    hover: 'hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/50',
    badge: 'bg-yellow-600 text-white',
    icon: 'Ã¢Å¡Â¡'
  },
  watch: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-700',
    hover: 'hover:bg-blue-100 hover:border-blue-400 dark:hover:bg-blue-900/50',
    badge: 'bg-blue-600 text-white',
    icon: 'Ã°Å¸â€˜ÂÃ¯Â¸Â'
  }
} as const;

export const TREND_ICONS = {
  improving: { icon: 'Ã°Å¸â€œË†', text: 'Improving', color: 'text-green-600 dark:text-green-400' },
  declining: { icon: 'Ã°Å¸â€œâ€°', text: 'Declining', color: 'text-red-600 dark:text-red-400' },
  stable: { icon: 'Ã¢â€ â€™', text: 'Stable', color: 'text-gray-600 dark:text-gray-400' }
} as const;

