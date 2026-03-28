// =====================================================
// CONSTANTS
// =====================================================

export const TEMPLATE_TYPES = [
  { value: 'completion', label: 'Course Completion', icon: '\u{1F393}' },
  { value: 'attendance', label: 'Perfect Attendance', icon: '\u{1F4D0}' },
  { value: 'achievement', label: 'Achievement Award', icon: '\u{1F3C6}' },
  { value: 'participation', label: 'Participation', icon: '\u{1F91D}' },
] as const;

export const BORDER_STYLES = [
  { value: 'classic', label: 'Classic Gold' },
  { value: 'modern', label: 'Modern Gradient' },
  { value: 'minimal', label: 'Minimal Clean' },
  { value: 'ornate', label: 'Ornate Decorative' },
] as const;

export const FONT_FAMILIES = [
  { value: 'serif', label: 'Serif (Traditional)' },
  { value: 'sans-serif', label: 'Sans-Serif (Modern)' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
] as const;

export const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  issued: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
} as const;
