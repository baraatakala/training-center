// ─── Attendance Status Constants ──────────────────────────────────────
// Single source of truth for attendance status values across the app.
// Eliminates magic strings and ensures consistency.

export const ATTENDANCE_STATUS = {
  ON_TIME: 'on time',
  ABSENT: 'absent',
  LATE: 'late',
  EXCUSED: 'excused',
  NOT_ENROLLED: 'not enrolled',
  SESSION_NOT_HELD: 'session not held',
} as const;

export type AttendanceStatus = typeof ATTENDANCE_STATUS[keyof typeof ATTENDANCE_STATUS];

// Check-in methods
export const CHECK_IN_METHOD = {
  MANUAL: 'manual',
  QR_CODE: 'qr_code',
  PHOTO: 'photo',
  BULK: 'bulk',
} as const;

export type CheckInMethod = typeof CHECK_IN_METHOD[keyof typeof CHECK_IN_METHOD];

// Risk levels for analytics
export const RISK_LEVEL = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  WATCH: 'watch',
} as const;

export type RiskLevel = typeof RISK_LEVEL[keyof typeof RISK_LEVEL];

// Attendance rate thresholds
export const RATE_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 75,
  WARNING: 60,
  CRITICAL: 50,
} as const;

// Grace period defaults (minutes)
export const GRACE_PERIOD = {
  DEFAULT: 15,
  MIN: 0,
  MAX: 60,
} as const;

// GPS defaults
export const GPS_CONFIG = {
  HIGH_ACCURACY_TIMEOUT: 10000,
  LOW_ACCURACY_TIMEOUT: 20000,
  DEFAULT_PROXIMITY_RADIUS: 100, // meters
  MAX_ACCURACY: 50, // meters - ignore readings worse than this
} as const;

// Scoring defaults
export const SCORING_DEFAULTS = {
  ON_TIME_SCORE: 1.0,
  ABSENT_SCORE: 0.0,
  EXCUSED_SCORE: 0.5,
  LATE_BASE_SCORE: 0.7,
  SESSION_NOT_HELD_SCORE: null, // excluded from calculations
} as const;
