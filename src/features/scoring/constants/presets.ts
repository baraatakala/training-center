import type { ScoringConfig } from '@/features/scoring/services/scoringConfigService';

export const PRESETS: { name: string; emoji: string; description: string; config: Partial<ScoringConfig> }[] = [
  {
    name: 'Balanced (Default)',
    emoji: '\u2696\uFE0F',
    description: 'Equal emphasis on quality, attendance, and timeliness',
    config: { weight_quality: 55, weight_attendance: 35, weight_punctuality: 10, late_decay_constant: 43.3, late_minimum_credit: 0.05 },
  },
  {
    name: 'Strict Punctuality',
    emoji: '\u23F0',
    description: 'Heavy penalty for lateness, low tolerance',
    config: { weight_quality: 45, weight_attendance: 25, weight_punctuality: 30, late_decay_constant: 20, late_minimum_credit: 0.01 },
  },
  {
    name: 'Lenient',
    emoji: '\u{1F555}\uFE0F',
    description: 'Forgiving \u2014 focus on showing up, mild late penalties',
    config: { weight_quality: 30, weight_attendance: 60, weight_punctuality: 10, late_decay_constant: 80, late_minimum_credit: 0.20 },
  },
  {
    name: 'Quality First',
    emoji: '\u{1F3C6}',
    description: 'Maximum weight on quality-adjusted rate',
    config: { weight_quality: 70, weight_attendance: 20, weight_punctuality: 10, late_decay_constant: 35, late_minimum_credit: 0.05 },
  },
  {
    name: 'Attendance Only',
    emoji: '\u{1F4CB}',
    description: 'Pure attendance tracking \u2014 lateness barely affects score',
    config: { weight_quality: 10, weight_attendance: 85, weight_punctuality: 5, late_decay_constant: 100, late_minimum_credit: 0.50 },
  },
  {
    name: 'Military Precision',
    emoji: '\u{1F396}\uFE0F',
    description: 'Zero tolerance \u2014 late is almost as bad as absent',
    config: { weight_quality: 50, weight_attendance: 15, weight_punctuality: 35, late_decay_constant: 10, late_minimum_credit: 0.01 },
  },
];
