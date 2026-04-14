import { format } from 'date-fns';

export interface ExportFormattingOptions {
  formatNumbers?: boolean;
  formatPercentages?: boolean;
  formatDates?: boolean;
  dateFormat?: 'short' | 'medium' | 'long';
  trimWhitespace?: boolean;
}

const dateFormatMap: Record<string, string> = {
  short: 'MM/dd/yy',
  medium: 'MMM dd, yyyy',
  long: 'MMMM dd, yyyy',
};

/**
 * Format a single cell value for export.
 * Used by both AdvancedExportBuilder and quick analytics exports.
 * Applies: number formatting, percentage symbols, date standardization, whitespace trimming.
 */
export function formatExportValue(
  value: unknown,
  fieldKey: string,
  fieldLabel: string,
  options: ExportFormattingOptions
): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');

  // --- Date handling ---
  const shouldFormatDates = options.formatDates !== false; // default true
  const dateFmt = dateFormatMap[options.dateFormat || 'medium'] || 'MMM dd, yyyy';

  if (value instanceof Date) {
    return format(value, shouldFormatDates ? dateFmt : 'MMM dd, yyyy');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return format(parsed, shouldFormatDates ? dateFmt : 'MMM dd, yyyy');
    }
  }

  let result = String(value);

  // --- Trim whitespace ---
  if ((options.trimWhitespace !== false) && typeof value === 'string') {
    result = result.trim();
  }

  // --- Number & Percentage formatting ---
  const isPercentageField =
    fieldKey.toLowerCase().includes('rate') ||
    fieldKey.toLowerCase().includes('percentage') ||
    fieldLabel.toLowerCase().includes('%');

  const shouldFormatNumbers = options.formatNumbers !== false; // default true
  const shouldFormatPercentages = options.formatPercentages !== false; // default true

  if (!isNaN(Number(value)) && value !== '' && value !== '-') {
    const num = Number(value);

    if (shouldFormatPercentages && isPercentageField) {
      // Percentage field: add %, with optional thousand separator
      result = shouldFormatNumbers ? `${num.toLocaleString()}%` : `${num}%`;
    } else if (shouldFormatNumbers) {
      // Regular number: add thousand separators
      if (Number.isInteger(num)) {
        result = num.toLocaleString();
      } else {
        result = num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
      }
    }
  }

  return result;
}
