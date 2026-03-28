/**
 * Centralized date formatting utilities
 * Uses date-fns for consistency across the app.
 */
import { format, parseISO } from 'date-fns';

/**
 * Format a date string or Date object for display in tables/UI.
 * Returns 'MMM dd, yyyy' (e.g., "Jan 15, 2025")
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM dd, yyyy');
}

/**
 * Format a date with weekday.
 * Returns 'EEE, MMM dd, yyyy' (e.g., "Wed, Jan 15, 2025")
 */
export function formatDateWithDay(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'EEE, MMM dd, yyyy');
}

/**
 * Format a datetime string or Date for display.
 * Returns 'MMM dd, yyyy HH:mm' (e.g., "Jan 15, 2025 14:30")
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM dd, yyyy HH:mm');
}

/**
 * Format a date for short display (tables with limited space).
 * Returns 'MM/dd/yyyy' (e.g., "01/15/2025")
 */
export function formatDateShort(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MM/dd/yyyy');
}
