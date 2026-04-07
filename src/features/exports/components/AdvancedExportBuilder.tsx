import React, { useState, useCallback, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { wordExportService } from '@/features/exports/services/wordExportService';
import { format } from 'date-fns';
import { toast } from '@/shared/components/ui/toastUtils';

// ==================== TYPES ====================

export interface ExportField {
  key: string;
  label: string;
  labelAr?: string;
  category: string;
  defaultSelected?: boolean;
  formatter?: (value: unknown, record: Record<string, unknown>) => string;
}

export interface ExportCategory {
  id: string;
  label: string;
  labelAr?: string;
  icon: string;
  fields: ExportField[];
}

export interface DataValidationOptions {
  // Data cleaning options
  removeEmptyRows: boolean;          // Remove rows with all empty values
  removeDuplicates: boolean;         // Remove duplicate rows
  trimWhitespace: boolean;           // Trim whitespace from text values
  
  // Data validation
  validateRequired: boolean;         // Highlight missing required values
  validateNumericRanges: boolean;    // Validate numeric values are in expected ranges
  validateDates: boolean;            // Validate date formats
  
  // Data formatting
  formatNumbers: boolean;            // Format numbers with thousand separators
  formatPercentages: boolean;        // Add % symbol to percentage fields
  formatDates: boolean;              // Standardize date formats
  dateFormat: 'short' | 'medium' | 'long'; // Date format option
  
  // Excel-specific validation
  addExcelValidation: boolean;       // Add Excel data validation rules
  protectSheet: boolean;             // Protect sheet from accidental edits
  
  // Data quality indicators
  showDataQualityReport: boolean;    // Include data quality summary
  highlightIssues: boolean;          // Highlight cells with issues (Excel only)
  
  // Conditional coloring (Word/Excel/PDF)
  enableConditionalColoring: boolean;  // Enable color-coding for percentage/score fields
  coloringFields: string[];             // Specific fields to apply coloring to (empty = auto-detect)
  coloringTheme: 'default' | 'traffic' | 'heatmap' | 'status'; // Color theme for conditional formatting
}

export interface ExportConfig {
  format: 'csv' | 'excel' | 'pdf' | 'word';
  language: 'en' | 'ar';
  selectedFields: string[];
  title: string;
  subtitle?: string;
  includeTimestamp: boolean;
  includeSummary: boolean;
  orientation: 'portrait' | 'landscape';
  fontSize: 'small' | 'medium' | 'large';
  // Data validation options
  dataValidation: DataValidationOptions;
  // Advanced options
  groupByField?: string;             // Group data by a field (for reports)
  sortByField?: string;              // Sort data by a field (legacy single-sort)
  sortDirection?: 'asc' | 'desc';    // Sort direction (legacy single-sort)
  sortLayers?: Array<{field: string; direction: 'asc' | 'desc'}>;  // Multi-layer sort
  filterEmptyValues?: boolean;       // Filter out rows with empty key values
  // Layout & Spacing options
  rowDensity?: 'compact' | 'normal' | 'comfortable'; // Row height / cell padding
  pageSize?: 'a4' | 'a3' | 'letter' | 'legal';       // PDF page size
  columnWidths?: Record<string, number>;              // Per-field column width (Excel chars / PDF% fraction)
  showGridlines?: boolean;                            // Show cell borders in export
  headerBgColor?: string;                             // Header background (6-char hex, no #)
  headerFontSizePt?: number;                          // Header font override in pt
  bodyFontSizePt?: number;                            // Body font override in pt
  repeatHeaders?: boolean;                            // Repeat headers on each page (PDF)
  alternateRowColors?: boolean;                       // Zebra-stripe rows
}

// Export settings to pass back to parent
export interface ExportSettings {
  fields: string[];
  sortByField?: string;
  sortDirection?: 'asc' | 'desc';
  sortLayers?: Array<{field: string; direction: 'asc' | 'desc'}>;  // Multi-layer sort
  enableConditionalColoring?: boolean;
  coloringFields?: string[];
  coloringTheme?: 'default' | 'traffic' | 'heatmap' | 'status';
  excludedRows?: string[];  // Row values to exclude (e.g., specific dates)
  fieldRenames?: Record<string, string>;  // Custom column header labels
}

interface AdvancedExportBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  categories: ExportCategory[];
  data: Record<string, unknown>[];
  defaultTitle?: string;
  onExport?: (config: ExportConfig) => void;
  dateRange?: { start: string; end: string };
  savedFields?: string[];
  savedSettings?: ExportSettings;
  onFieldSelectionChange?: (fields: string[]) => void;
  onSettingsChange?: (settings: ExportSettings) => void;
  rowFilterKey?: string;  // If set, enables row filtering UI using this data key (e.g., "date")
  rowFilterLabel?: string;  // Label for the row filter section (e.g., "Date Rows")
}

// ==================== COMPONENT ====================

export const AdvancedExportBuilder: React.FC<AdvancedExportBuilderProps> = ({
  isOpen,
  onClose,
  categories,
  data,
  defaultTitle = 'Report',
  onExport,
  dateRange,
  savedFields,
  savedSettings,
  onFieldSelectionChange,
  onSettingsChange,
  rowFilterKey,
  rowFilterLabel = 'Row Filter',
}) => {
  // Build initial selected fields from categories
  const getDefaultSelectedFields = useCallback(() => {
    // If savedFields provided and not empty, use those
    if (savedFields && savedFields.length > 0) {
      return savedFields;
    }
    // Otherwise use defaults from categories
    const fields: string[] = [];
    categories.forEach(cat => {
      cat.fields.forEach(field => {
        if (field.defaultSelected !== false) {
          fields.push(field.key);
        }
      });
    });
    return fields;
  }, [categories, savedFields]);

  // Default data validation options
  const defaultDataValidation: DataValidationOptions = {
    removeEmptyRows: false,
    removeDuplicates: false,
    trimWhitespace: true,
    validateRequired: false,
    validateNumericRanges: false,
    validateDates: false,
    formatNumbers: true,
    formatPercentages: true,
    formatDates: true,
    dateFormat: 'medium',
    addExcelValidation: false,
    protectSheet: false,
    showDataQualityReport: false,
    highlightIssues: false,
    enableConditionalColoring: true,
    coloringFields: [],
    coloringTheme: 'default',
  };

  const [config, setConfig] = useState<ExportConfig>({
    format: 'excel',
    language: 'en',
    selectedFields: getDefaultSelectedFields(),
    title: defaultTitle,
    subtitle: dateRange ? `${dateRange.start} to ${dateRange.end}` : '',
    includeTimestamp: true,
    includeSummary: true,
    orientation: 'landscape',
    fontSize: 'medium',
    dataValidation: defaultDataValidation,
    sortDirection: 'asc',
    sortLayers: [],
    filterEmptyValues: false,
    // Layout defaults
    rowDensity: 'normal',
    pageSize: 'a4',
    columnWidths: {},
    showGridlines: true,
    headerBgColor: '3b82f6',
    headerFontSizePt: undefined,
    bodyFontSizePt: undefined,
    repeatHeaders: true,
    alternateRowColors: true,
  });

  const [activeTab, setActiveTab] = useState<'fields' | 'format' | 'layout' | 'validation' | 'preview'>('fields');
  const [exporting, setExporting] = useState(false);
  const [excludedRows, setExcludedRows] = useState<Set<string>>(
    new Set(savedSettings?.excludedRows || [])
  );

  // Field label renames — lets user override column headers for export
  const [fieldRenames, setFieldRenames] = useState<Record<string, string>>(
    savedSettings?.fieldRenames || {}
  );
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);

  const getFieldLabel = useCallback((f: ExportField, isArabic: boolean): string => {
    if (fieldRenames[f.key]) return fieldRenames[f.key];
    return isArabic && f.labelAr ? f.labelAr : f.label;
  }, [fieldRenames]);

  // Reset config when modal opens or categories change - use saved settings
  useEffect(() => {
    if (isOpen) {
      const newSelectedFields = getDefaultSelectedFields();
      setConfig(prev => ({
        ...prev,
        selectedFields: newSelectedFields,
        title: defaultTitle,
        subtitle: dateRange ? `${dateRange.start} to ${dateRange.end}` : '',
        // Restore saved sort settings
        sortByField: savedSettings?.sortByField || undefined,
        sortDirection: savedSettings?.sortDirection || 'asc',
        sortLayers: savedSettings?.sortLayers || [],
        dataValidation: {
          removeEmptyRows: false,
          removeDuplicates: false,
          trimWhitespace: true,
          validateRequired: false,
          validateNumericRanges: false,
          validateDates: false,
          formatNumbers: true,
          formatPercentages: true,
          formatDates: true,
          dateFormat: 'medium',
          addExcelValidation: false,
          protectSheet: false,
          showDataQualityReport: false,
          highlightIssues: false,
          enableConditionalColoring: savedSettings?.enableConditionalColoring ?? true,
          coloringFields: savedSettings?.coloringFields || [],
          coloringTheme: savedSettings?.coloringTheme || 'default',
        },
      }));
      setActiveTab('fields');
      // Restore excluded rows from saved settings
      setExcludedRows(new Set(savedSettings?.excludedRows || []));
      // Restore field renames from saved settings
      setFieldRenames(savedSettings?.fieldRenames || {});
    }
  }, [isOpen, getDefaultSelectedFields, defaultTitle, dateRange, savedSettings]);

  // Get all fields flat
  const allFields = categories.flatMap(cat => cat.fields);

  // Toggle field selection
  const toggleField = (fieldKey: string) => {
    setConfig(prev => ({
      ...prev,
      selectedFields: prev.selectedFields.includes(fieldKey)
        ? prev.selectedFields.filter(f => f !== fieldKey)
        : [...prev.selectedFields, fieldKey],
    }));
  };

  // Toggle entire category
  const toggleCategory = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const categoryFieldKeys = category.fields.map(f => f.key);
    const allSelected = categoryFieldKeys.every(k => config.selectedFields.includes(k));

    setConfig(prev => ({
      ...prev,
      selectedFields: allSelected
        ? prev.selectedFields.filter(f => !categoryFieldKeys.includes(f))
        : [...new Set([...prev.selectedFields, ...categoryFieldKeys])],
    }));
  };

  // Select all / deselect all
  const selectAll = () => {
    setConfig(prev => ({
      ...prev,
      selectedFields: allFields.map(f => f.key),
    }));
  };

  const deselectAll = () => {
    setConfig(prev => ({
      ...prev,
      selectedFields: [],
    }));
  };

  // Reorder field: move up
  const moveFieldUp = (fieldKey: string) => {
    setConfig(prev => {
      const idx = prev.selectedFields.indexOf(fieldKey);
      if (idx <= 0) return prev;
      const newFields = [...prev.selectedFields];
      [newFields[idx - 1], newFields[idx]] = [newFields[idx], newFields[idx - 1]];
      return { ...prev, selectedFields: newFields };
    });
  };

  // Reorder field: move down
  const moveFieldDown = (fieldKey: string) => {
    setConfig(prev => {
      const idx = prev.selectedFields.indexOf(fieldKey);
      if (idx < 0 || idx >= prev.selectedFields.length - 1) return prev;
      const newFields = [...prev.selectedFields];
      [newFields[idx], newFields[idx + 1]] = [newFields[idx + 1], newFields[idx]];
      return { ...prev, selectedFields: newFields };
    });
  };

  // Reorder field: move to specific position
  const moveFieldToPosition = (fieldKey: string, newIndex: number) => {
    setConfig(prev => {
      const oldIndex = prev.selectedFields.indexOf(fieldKey);
      if (oldIndex < 0) return prev;
      const newFields = [...prev.selectedFields];
      newFields.splice(oldIndex, 1);
      newFields.splice(newIndex, 0, fieldKey);
      return { ...prev, selectedFields: newFields };
    });
  };

  // State for drag-and-drop reordering
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Get selected fields in order
  const getSelectedFieldsOrdered = () => {
    return config.selectedFields
      .map(key => allFields.find(f => f.key === key))
      .filter(Boolean) as ExportField[];
  };

  // Multi-layer compare helper
  // Detect if a string looks like a formatted date (e.g., "Feb 07, 2026", "MMM dd, yyyy")
  const tryParseDate = (val: unknown): number | null => {
    if (val instanceof Date) return val.getTime();
    if (typeof val !== 'string') return null;
    const s = val.trim();
    // Match common date formats: "MMM dd, yyyy", "MMM dd, yyyy HH:mm:ss", "yyyy-MM-dd", etc.
    const monthNames = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
    const isoLike = /^\d{4}-\d{2}-\d{2}/;
    if (monthNames.test(s) || isoLike.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
  };

  const multiLayerCompare = (a: Record<string, unknown>, b: Record<string, unknown>, layers: Array<{field: string; direction: 'asc' | 'desc'}>): number => {
    for (const layer of layers) {
      const sortDir = layer.direction === 'desc' ? -1 : 1;
      const aVal = a[layer.field];
      const bVal = b[layer.field];
      
      if (aVal == null && bVal == null) continue;
      if (aVal == null) return sortDir;
      if (bVal == null) return -sortDir;
      
      // Try date comparison first (handles "Feb 07, 2026" etc.)
      const aDate = tryParseDate(aVal);
      const bDate = tryParseDate(bVal);
      if (aDate !== null && bDate !== null) {
        if (aDate !== bDate) return (aDate - bDate) * sortDir;
        continue;
      }
      
      // Try numeric comparison (strip non-numeric chars for values like "85%", "±10m")
      const aNum = typeof aVal === 'string' ? parseFloat(aVal.replace(/[^0-9.-]/g, '')) : aVal;
      const bNum = typeof bVal === 'string' ? parseFloat(bVal.replace(/[^0-9.-]/g, '')) : bVal;
      
      if (typeof aNum === 'number' && typeof bNum === 'number' && !isNaN(aNum) && !isNaN(bNum)) {
        if (aNum !== bNum) return (aNum - bNum) * sortDir;
        continue;
      }
      
      // Fallback: string comparison
      const cmp = String(aVal).localeCompare(String(bVal));
      if (cmp !== 0) return cmp * sortDir;
    }
    return 0;
  };

  // Get effective sort layers (multi-layer or legacy single-field)
  const getEffectiveSortLayers = (): Array<{field: string; direction: 'asc' | 'desc'}> => {
    if (config.sortLayers && config.sortLayers.length > 0) return config.sortLayers;
    if (config.sortByField) return [{ field: config.sortByField, direction: config.sortDirection || 'asc' }];
    return [];
  };

  // Get sorted preview data based on current sort settings
  const getSortedPreviewData = (): Record<string, unknown>[] => {
    const layers = getEffectiveSortLayers();
    if (layers.length === 0) return data;
    return [...data].sort((a, b) => multiLayerCompare(a, b, layers));
  };

  // Format value for export
  const formatValue = (field: ExportField, record: Record<string, unknown>): string => {
    const value = record[field.key];
    
    if (field.formatter) {
      return field.formatter(value, record);
    }
    
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    if (value instanceof Date) return format(value, 'MMM dd, yyyy');
    
    // Apply formatting options from config
    let result = String(value);
    
    // Trim whitespace if enabled
    if (config.dataValidation.trimWhitespace && typeof value === 'string') {
      result = result.trim();
    }
    
    // Format numbers if enabled
    if (config.dataValidation.formatNumbers && !isNaN(Number(value)) && value !== '') {
      const num = Number(value);
      // Check if it's a percentage field
      if (config.dataValidation.formatPercentages && 
          (field.key.toLowerCase().includes('rate') || 
           field.key.toLowerCase().includes('percentage') ||
           field.label.toLowerCase().includes('%'))) {
        result = `${num.toLocaleString()}%`;
      } else if (Number.isInteger(num)) {
        result = num.toLocaleString();
      } else {
        result = num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
      }
    }
    
    return result;
  };

  // ==================== DATA VALIDATION & PROCESSING ====================
  
  // Process and validate data before export
  const processDataForExport = (inputData: Record<string, unknown>[]): {
    processedData: Record<string, unknown>[];
    validationIssues: { row: number; field: string; issue: string }[];
    stats: { totalRows: number; cleanedRows: number; issuesFound: number };
  } => {
    let processedData = [...inputData];
    const validationIssues: { row: number; field: string; issue: string }[] = [];
    const selectedFields = getSelectedFieldsOrdered();
    
    // Filter out excluded rows if rowFilterKey is set
    if (rowFilterKey && excludedRows.size > 0) {
      processedData = processedData.filter(record => 
        !excludedRows.has(String(record[rowFilterKey] ?? ''))
      );
    }
    
    // Remove duplicates if enabled
    if (config.dataValidation.removeDuplicates) {
      const seen = new Set<string>();
      processedData = processedData.filter(record => {
        const key = selectedFields.map(f => String(record[f.key] || '')).join('|');
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
    
    // Remove empty rows if enabled
    if (config.dataValidation.removeEmptyRows) {
      processedData = processedData.filter(record => {
        return selectedFields.some(f => {
          const val = record[f.key];
          return val !== null && val !== undefined && val !== '' && val !== '-';
        });
      });
    }
    
    // Validate and collect issues
    processedData.forEach((record, rowIndex) => {
      selectedFields.forEach(field => {
        const value = record[field.key];
        
        // Check for missing required values
        if (config.dataValidation.validateRequired) {
          if (value === null || value === undefined || value === '' || value === '-') {
            validationIssues.push({
              row: rowIndex + 1,
              field: field.label,
              issue: 'Missing value'
            });
          }
        }
        
        // Validate numeric ranges
        if (config.dataValidation.validateNumericRanges) {
          if (field.key.toLowerCase().includes('rate') || 
              field.key.toLowerCase().includes('percentage')) {
            const num = parseFloat(String(value).replace('%', ''));
            if (!isNaN(num) && (num < 0 || num > 100)) {
              validationIssues.push({
                row: rowIndex + 1,
                field: field.label,
                issue: `Value ${num}% outside expected range (0-100)`
              });
            }
          }
        }
        
        // Validate dates
        if (config.dataValidation.validateDates && 
            (field.key.toLowerCase().includes('date') || 
             field.label.toLowerCase().includes('date'))) {
          if (value && value !== '-') {
            const dateVal = new Date(String(value));
            if (isNaN(dateVal.getTime())) {
              validationIssues.push({
                row: rowIndex + 1,
                field: field.label,
                issue: 'Invalid date format'
              });
            }
          }
        }
      });
    });
    
    // Sort data using multi-layer sort
    const layers = getEffectiveSortLayers();
    if (layers.length > 0) {
      processedData.sort((a, b) => multiLayerCompare(a, b, layers));
    }
    
    return {
      processedData,
      validationIssues,
      stats: {
        totalRows: inputData.length,
        cleanedRows: processedData.length,
        issuesFound: validationIssues.length
      }
    };
  };

  // ==================== EXPORT FUNCTIONS ====================

  const exportToCSV = () => {
    const { processedData, stats } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => getFieldLabel(f, isArabic));
    const rows = processedData.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    const escapeCSV = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    // Add data quality report at the top if enabled
    let csvContent = '';
    if (config.dataValidation.showDataQualityReport) {
      csvContent += `# Data Quality Report\n`;
      csvContent += `# Original Records: ${stats.totalRows}\n`;
      csvContent += `# Exported Records: ${stats.cleanedRows}\n`;
      csvContent += `# Records Removed: ${stats.totalRows - stats.cleanedRows}\n`;
      csvContent += `#\n`;
    }

    csvContent += [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.title.replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToExcel = () => {
    try {
    const { processedData, validationIssues, stats } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => getFieldLabel(f, isArabic));
    const rows = processedData.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    const wb = XLSX.utils.book_new();
    
    // Add summary sheet if enabled
    if (config.includeSummary) {
      const summaryData: (string | number)[][] = [
        [isArabic ? 'التقرير' : 'Report', config.title],
        [isArabic ? 'التاريخ' : 'Generated', format(new Date(), 'MMM dd, yyyy HH:mm')],
        [isArabic ? 'عدد السجلات الأصلية' : 'Original Records', stats.totalRows],
        [isArabic ? 'عدد السجلات المصدرة' : 'Exported Records', stats.cleanedRows],
        [isArabic ? 'عدد الحقول' : 'Fields Exported', selectedFields.length],
      ];
      if (dateRange) {
        summaryData.push([isArabic ? 'من تاريخ' : 'From Date', dateRange.start]);
        summaryData.push([isArabic ? 'إلى تاريخ' : 'To Date', dateRange.end]);
      }
      
      // Add data processing info
      summaryData.push(['', '']);
      summaryData.push([isArabic ? 'معالجة البيانات' : 'Data Processing', '']);
      if (config.dataValidation.removeDuplicates) {
        summaryData.push([isArabic ? 'إزالة المكررات' : 'Duplicates Removed', 'Yes']);
      }
      if (config.dataValidation.removeEmptyRows) {
        summaryData.push([isArabic ? 'إزالة الصفوف الفارغة' : 'Empty Rows Removed', 'Yes']);
      }
      if (config.dataValidation.trimWhitespace) {
        summaryData.push([isArabic ? 'تنظيف المسافات' : 'Whitespace Trimmed', 'Yes']);
      }
      
      // Add conditional coloring note
      if (config.dataValidation.enableConditionalColoring) {
        summaryData.push(['', '']);
        summaryData.push([isArabic ? 'تلوين الخلايا' : 'Conditional Coloring', isArabic ? 'مفعّل' : 'Enabled']);
        summaryData.push([isArabic ? 'ملاحظة' : 'Note', isArabic ? 'التلوين متاح في تصدير Word و PDF' : 'Cell coloring is available in Word and PDF exports']);
        summaryData.push(['', '']);
        summaryData.push([isArabic ? 'دليل الألوان' : 'Color Legend:', '']);
        summaryData.push([isArabic ? 'أخضر (ممتاز)' : 'Green (Excellent)', '90%+']);
        summaryData.push([isArabic ? 'أزرق (جيد)' : 'Blue (Good)', '75-89%']);
        summaryData.push([isArabic ? 'برتقالي (متوسط)' : 'Orange (Moderate)', '60-74%']);
        summaryData.push([isArabic ? 'أحمر (يحتاج تحسين)' : 'Red (Needs Attention)', '<60%']);
      }
      
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, isArabic ? 'ملخص' : 'Summary');
    }
    
    // Add main data sheet
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    
    // Apply RTL direction for Arabic — fixes disconnected letter display
    if (isArabic) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any)['!rtl'] = true;
    }

    // Apply column widths for better readability
    const colWidths = selectedFields.map(f => ({
      wch: config.columnWidths?.[f.key] ?? Math.max(getFieldLabel(f, isArabic).length + 4, 12),
    }));
    ws['!cols'] = colWidths;

    // Apply row height based on density
    const rowHeightMap = { compact: 15, normal: 20, comfortable: 30 };
    const rowH = rowHeightMap[config.rowDensity || 'normal'];
    ws['!rows'] = [{ hpt: rowH + 6 }, ...rows.map(() => ({ hpt: rowH }))];
    
    XLSX.utils.book_append_sheet(wb, ws, isArabic ? 'البيانات' : 'Data');
    
    // Add data quality report sheet if enabled
    if (config.dataValidation.showDataQualityReport && validationIssues.length > 0) {
      const qualityHeaders = [
        isArabic ? 'الصف' : 'Row',
        isArabic ? 'الحقل' : 'Field',
        isArabic ? 'المشكلة' : 'Issue'
      ];
      const qualityRows = validationIssues.map(issue => [
        issue.row,
        issue.field,
        issue.issue
      ]);
      const wsQuality = XLSX.utils.aoa_to_sheet([qualityHeaders, ...qualityRows]);
      XLSX.utils.book_append_sheet(wb, wsQuality, isArabic ? 'جودة البيانات' : 'Data Quality');
    }
    
    XLSX.writeFile(wb, `${config.title.replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const exportToPDF = () => {
    const { processedData, stats } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';

    // Arabic warning — jsPDF cannot shape Arabic script
    if (isArabic) {
      toast.warning('Arabic text in PDF may appear garbled. Use Word or Excel export for perfect Arabic rendering.');
    }
    
    const doc = new jsPDF({
      orientation: config.orientation,
      unit: 'mm',
      format: config.pageSize || 'a4',
    });

    const pageWidth = doc.internal.pageSize.width;
    
    // Font sizes based on config
    const fontSizes = {
      small: { title: 14, subtitle: 8, table: 6 },
      medium: { title: 16, subtitle: 10, table: 8 },
      large: { title: 18, subtitle: 12, table: 10 },
    };
    const sizes = fontSizes[config.fontSize];

    // Apply numeric overrides from Layout tab
    const effectiveTitleSize = config.headerFontSizePt ?? sizes.title;
    const effectiveBodySize = config.bodyFontSizePt ?? sizes.table;
    const effectiveSubtitleSize = Math.max(effectiveTitleSize - 4, 7);

    // Row density → cell padding
    const cellPaddingMap = { compact: 1, normal: 2, comfortable: 4 };
    const cellPad = cellPaddingMap[config.rowDensity || 'normal'];

    // Header background color from config
    const hexColor = config.headerBgColor || '3b82f6';
    const headerFillColor: [number, number, number] = [
      parseInt(hexColor.substring(0, 2), 16),
      parseInt(hexColor.substring(2, 4), 16),
      parseInt(hexColor.substring(4, 6), 16),
    ];

    // Title
    doc.setFontSize(effectiveTitleSize);
    doc.text(config.title, pageWidth / 2, 15, { align: 'center' });

    // Subtitle / Date Range
    let currentY = 22;
    if (config.subtitle || config.includeTimestamp) {
      doc.setFontSize(effectiveSubtitleSize);
      
      if (config.subtitle) {
        doc.text(config.subtitle, pageWidth / 2, currentY, { align: 'center' });
        currentY += 6;
      }
      
      if (config.includeTimestamp) {
        doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 5;
      }
      
      // Add data processing summary if enabled
      if (config.dataValidation.showDataQualityReport && stats.totalRows !== stats.cleanedRows) {
        doc.setFontSize(effectiveSubtitleSize - 1);
        doc.setTextColor(100, 100, 100);
        doc.text(`${stats.cleanedRows} of ${stats.totalRows} records (${stats.totalRows - stats.cleanedRows} filtered)`, pageWidth / 2, currentY, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        currentY += 5;
      }
    }

    // Determine color columns for PDF conditional coloring
    let colorColumns: number[] = [];
    if (config.dataValidation.enableConditionalColoring) {
      if (config.dataValidation.coloringFields.length > 0) {
        colorColumns = config.dataValidation.coloringFields
          .map(fieldKey => selectedFields.findIndex(f => f.key === fieldKey))
          .filter(idx => idx !== -1);
      } else {
        const percentagePatterns = [
          /rate/i, /percentage/i, /percent/i, /%/, /score/i, /weighted/i,
          /attendance/i, /punctuality/i, /consistency/i, /avg/i, /average/i,
        ];
        colorColumns = selectedFields
          .map((field, idx) => {
            const matchesPattern = percentagePatterns.some(pattern => 
              pattern.test(field.key) || pattern.test(field.label)
            );
            return matchesPattern ? idx : -1;
          })
          .filter(idx => idx !== -1);
      }
    }

    // Color function for PDF
    const getColorForValue = (value: number): [number, number, number] => {
      if (value >= 90) return [16, 185, 129]; // Green (success)
      if (value >= 75) return [59, 130, 246]; // Blue (good)
      if (value >= 60) return [245, 158, 11]; // Yellow (moderate)
      return [239, 68, 68]; // Red (needs attention)
    };

    // Table
    const headers = selectedFields.map(f => getFieldLabel(f, isArabic));
    const rows = processedData.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    // Build column widths for PDF (relative, using custom widths or auto)
    const colStyles: Record<number, { cellWidth: number | 'auto' | 'wrap' }> = {};
    selectedFields.forEach((f, idx) => {
      const custom = config.columnWidths?.[f.key];
      if (custom) colStyles[idx] = { cellWidth: custom };
    });

    autoTable(doc, {
      startY: currentY + 5,
      head: [headers],
      body: rows,
      styles: {
        fontSize: effectiveBodySize,
        cellPadding: cellPad,
        lineColor: config.showGridlines !== false ? [200, 200, 200] : [255, 255, 255],
        lineWidth: config.showGridlines !== false ? 0.1 : 0,
      },
      headStyles: { fillColor: headerFillColor, fontSize: effectiveBodySize, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: config.alternateRowColors !== false ? { fillColor: [245, 248, 255] } : {},
      margin: { top: 35 },
      showHead: config.repeatHeaders !== false ? 'everyPage' : 'firstPage',
      columnStyles: colStyles,
      // Apply conditional coloring to cells
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && colorColumns.includes(hookData.column.index)) {
          const cellText = hookData.cell.text.join('');
          const numMatch = cellText.match(/(\d+\.?\d*)/);
          if (numMatch) {
            const value = parseFloat(numMatch[1]);
            if (!isNaN(value) && value >= 0 && value <= 100) {
              hookData.cell.styles.fillColor = getColorForValue(value);
              hookData.cell.styles.textColor = [255, 255, 255];
              hookData.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });

    // Add color legend if conditional coloring is enabled
    if (colorColumns.length > 0) {
      const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || currentY + 50;
      doc.setFontSize(effectiveSubtitleSize - 1);
      doc.setTextColor(100, 100, 100);
      doc.text('Color Legend:', 14, finalY + 8);
      
      // Draw legend boxes
      const legendItems = [
        { label: '90%+ Excellent', color: [16, 185, 129] as [number, number, number] },
        { label: '75-89% Good', color: [59, 130, 246] as [number, number, number] },
        { label: '60-74% Moderate', color: [245, 158, 11] as [number, number, number] },
        { label: '<60% Needs Attention', color: [239, 68, 68] as [number, number, number] },
      ];
      
      let legendX = 40;
      legendItems.forEach(item => {
        doc.setFillColor(item.color[0], item.color[1], item.color[2]);
        doc.rect(legendX, finalY + 5, 8, 4, 'F');
        doc.setTextColor(60, 60, 60);
        doc.text(item.label, legendX + 10, finalY + 8);
        legendX += 45;
      });
      
      doc.setTextColor(0, 0, 0);
    }

    doc.save(`${config.title.replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const exportToWord = async () => {
    const { processedData } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => getFieldLabel(f, isArabic));
    const rows = processedData.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    // Determine which columns should have conditional coloring
    let colorColumns: number[] = [];
    if (config.dataValidation.enableConditionalColoring) {
      if (config.dataValidation.coloringFields.length > 0) {
        // Use explicitly specified fields
        colorColumns = config.dataValidation.coloringFields
          .map(fieldKey => selectedFields.findIndex(f => f.key === fieldKey))
          .filter(idx => idx !== -1);
      } else {
        // Auto-detect percentage/score fields based on field keys and labels
        const percentagePatterns = [
          /rate/i, /percentage/i, /percent/i, /%/, /score/i, /weighted/i,
          /attendance/i, /punctuality/i, /consistency/i, /avg/i, /average/i,
          /معدل/, /نسبة/, /متوسط/ // Arabic patterns
        ];
        
        colorColumns = selectedFields
          .map((field, idx) => {
            const matchesPattern = percentagePatterns.some(pattern => 
              pattern.test(field.key) || pattern.test(field.label) || (field.labelAr && pattern.test(field.labelAr))
            );
            return matchesPattern ? idx : -1;
          })
          .filter(idx => idx !== -1);
      }
    }

    // Use the word export service for consistent Word document creation
    await wordExportService.exportTableToWord(
      headers,
      rows,
      config.title,
      config.subtitle || '',
      isArabic,
      undefined, // filename
      colorColumns.length > 0 ? colorColumns : undefined,
      config.dataValidation.coloringTheme
    );
  };

  // Main export handler
  const handleExport = async () => {
    if (config.selectedFields.length === 0) {
      toast.warning('Please select at least one field to export');
      return;
    }

    setExporting(true);
    
    try {
      // Save field selection for use by main export buttons
      if (onFieldSelectionChange) {
        onFieldSelectionChange(config.selectedFields);
      }
      
      // Save all export settings (sort, coloring, etc.)
      if (onSettingsChange) {
        onSettingsChange({
          fields: config.selectedFields,
          sortByField: config.sortByField,
          sortDirection: config.sortDirection,
          sortLayers: config.sortLayers || [],
          enableConditionalColoring: config.dataValidation.enableConditionalColoring,
          coloringFields: config.dataValidation.coloringFields,
          coloringTheme: config.dataValidation.coloringTheme,
          excludedRows: [...excludedRows],
          fieldRenames: Object.keys(fieldRenames).length > 0 ? fieldRenames : undefined,
        });
      }
      
      // Call custom export handler if provided
      if (onExport) {
        onExport(config);
      }

      switch (config.format) {
        case 'csv':
          exportToCSV();
          break;
        case 'excel':
          exportToExcel();
          break;
        case 'pdf':
          exportToPDF();
          break;
        case 'word':
          await exportToWord();
          break;
      }
      
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };
  
  // Handle close - save field selection and all settings
  const handleClose = () => {
    // Save field selection
    if (onFieldSelectionChange && config.selectedFields.length > 0) {
      onFieldSelectionChange(config.selectedFields);
    }
    // Save all export settings (sort, coloring, etc.)
    if (onSettingsChange) {
      onSettingsChange({
        fields: config.selectedFields,
        sortByField: config.sortLayers?.[0]?.field || config.sortByField,
        sortDirection: config.sortLayers?.[0]?.direction || config.sortDirection,
        sortLayers: config.sortLayers || [],
        enableConditionalColoring: config.dataValidation.enableConditionalColoring,
        coloringFields: config.dataValidation.coloringFields,
        coloringTheme: config.dataValidation.coloringTheme,
        excludedRows: [...excludedRows],
        fieldRenames: Object.keys(fieldRenames).length > 0 ? fieldRenames : undefined,
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 sm:p-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                📤 Advanced Export Builder
              </h2>
              <p className="text-blue-100 text-xs sm:text-sm mt-1 hidden sm:block">
                Customize your export with full control over fields and formatting
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex flex-wrap gap-2 mt-4">
            {(['fields', 'format', 'layout', 'validation', 'preview'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                  activeTab === tab
                    ? 'bg-white text-blue-600'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {tab === 'fields' && '📋 Fields'}
                {tab === 'format' && '⚙️ Format'}
                {tab === 'layout' && '📐 Layout'}
                {tab === 'validation' && '✅ Validation'}
                {tab === 'preview' && '👁️ Preview'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 dark:bg-gray-800">
          {/* Fields Tab */}
          {activeTab === 'fields' && (
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 pb-4 border-b dark:border-gray-700">
                <button
                  onClick={selectAll}
                  className="px-3 py-1.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg text-sm font-medium hover:bg-green-200 dark:hover:bg-green-900/60 transition"
                >
                  ✓ Select All
                </button>
                <button
                  onClick={deselectAll}
                  className="px-3 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition"
                >
                  ✕ Clear All
                </button>
                <span className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm">
                  {config.selectedFields.length} / {allFields.length} fields selected
                </span>
              </div>

              {/* Categories */}
              {categories.map(category => {
                const categoryFieldKeys = category.fields.map(f => f.key);
                const selectedInCategory = categoryFieldKeys.filter(k => config.selectedFields.includes(k)).length;
                const allSelected = selectedInCategory === categoryFieldKeys.length;
                const someSelected = selectedInCategory > 0 && !allSelected;

                return (
                  <div key={category.id} className="border dark:border-gray-700 rounded-xl overflow-hidden">
                    {/* Category Header */}
                    <div
                      className="bg-gray-50 dark:bg-gray-700 p-4 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition"
                      onClick={() => toggleCategory(category.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{category.icon}</span>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white">{category.label}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {selectedInCategory} of {category.fields.length} fields selected
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={input => {
                            if (input) input.indeterminate = someSelected;
                          }}
                          onChange={() => toggleCategory(category.id)}
                          onClick={e => e.stopPropagation()}
                          className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 dark:bg-gray-800">
                      {category.fields.map(field => (
                        <div
                          key={field.key}
                          className={`flex items-center gap-3 p-3 rounded-lg transition ${
                            config.selectedFields.includes(field.key)
                              ? 'bg-blue-50 dark:bg-blue-900/40 border-2 border-blue-300 dark:border-blue-600'
                              : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={config.selectedFields.includes(field.key)}
                            onChange={() => toggleField(field.key)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            {editingFieldKey === field.key ? (
                              <input
                                type="text"
                                autoFocus
                                defaultValue={fieldRenames[field.key] || field.label}
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  setFieldRenames(prev => {
                                    const next = { ...prev };
                                    if (!val || val === field.label) delete next[field.key];
                                    else next[field.key] = val;
                                    return next;
                                  });
                                  setEditingFieldKey(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') { setEditingFieldKey(null); }
                                }}
                                className="w-full text-sm font-medium px-1.5 py-0.5 rounded border border-blue-400 dark:border-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            ) : (
                              <span
                                className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 truncate block"
                                title="Click to rename this column header for export"
                                onClick={() => setEditingFieldKey(field.key)}
                              >
                                {fieldRenames[field.key] || field.label}
                                {fieldRenames[field.key] && (
                                  <span className="ml-1 text-[10px] text-blue-500">✏️</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Field Order Section — drag-and-drop + arrows to reorder selected fields */}
              {config.selectedFields.length > 1 && (
                <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/30 dark:to-blue-900/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">↕️</span>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white">Column Order</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Drag or use arrows to reorder export columns ({config.selectedFields.length} fields)
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 dark:bg-gray-800 max-h-72 overflow-y-auto space-y-1">
                    {config.selectedFields.map((key, index) => {
                      const field = allFields.find(f => f.key === key);
                      if (!field) return null;
                      const isFirst = index === 0;
                      const isLast = index === config.selectedFields.length - 1;
                      return (
                        <div
                          key={key}
                          draggable
                          onDragStart={() => setDraggedField(key)}
                          onDragEnd={() => { setDraggedField(null); setDragOverIndex(null); }}
                          onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedField && draggedField !== key) {
                              moveFieldToPosition(draggedField, index);
                            }
                            setDraggedField(null);
                            setDragOverIndex(null);
                          }}
                          className={`flex items-center gap-2 p-2.5 rounded-lg transition-all ${
                            draggedField === key
                              ? 'opacity-50 bg-blue-100 dark:bg-blue-900/40'
                              : dragOverIndex === index
                                ? 'bg-blue-50 dark:bg-blue-900/20 border-t-2 border-blue-400'
                                : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                          } cursor-grab active:cursor-grabbing`}
                        >
                          {/* Drag handle */}
                          <span className="text-gray-400 dark:text-gray-500 select-none" title="Drag to reorder">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-12a2 2 0 10-.001 4.001A2 2 0 0013 2zm0 6a2 2 0 10-.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10-.001 4.001A2 2 0 0013 14z" />
                            </svg>
                          </span>
                          {/* Position number */}
                          <span className="w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded text-xs font-bold flex-shrink-0">
                            {index + 1}
                          </span>
                          {/* Field name */}
                          <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                            {fieldRenames[field.key] || field.label}
                            {fieldRenames[field.key] && <span className="ml-1 text-[10px] text-blue-500">✏️</span>}
                          </span>
                          {/* Up/Down arrows */}
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); moveFieldUp(key); }}
                              disabled={isFirst}
                              className={`p-1 rounded transition ${isFirst ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'}`}
                              title="Move up"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveFieldDown(key); }}
                              disabled={isLast}
                              className={`p-1 rounded transition ${isLast ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'}`}
                              title="Move down"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Row Filter Section - only shown when rowFilterKey is set */}
              {rowFilterKey && data.length > 0 && (() => {
                // Extract unique row values from data using rowFilterKey
                const allRowValues = [...new Set(data.map(d => String(d[rowFilterKey] ?? '')))].filter(v => v !== '');
                const includedCount = allRowValues.filter(v => !excludedRows.has(v)).length;
                
                return (
                  <div className="border dark:border-gray-700 rounded-xl overflow-hidden mt-4">
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📋</span>
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-white">{rowFilterLabel}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {includedCount} of {allRowValues.length} rows included in export
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setExcludedRows(new Set())}
                            className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/60 transition"
                          >
                            Include All
                          </button>
                          <button
                            onClick={() => setExcludedRows(new Set(allRowValues))}
                            className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition"
                          >
                            Exclude All
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 dark:bg-gray-800 max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {allRowValues.map(rowValue => {
                          const isIncluded = !excludedRows.has(rowValue);
                          return (
                            <label
                              key={rowValue}
                              className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition text-sm ${
                                isIncluded
                                  ? 'bg-green-50 dark:bg-green-900/30 border-2 border-green-300 dark:border-green-600'
                                  : 'bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 opacity-60'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isIncluded}
                                onChange={() => {
                                  setExcludedRows(prev => {
                                    const next = new Set(prev);
                                    if (next.has(rowValue)) {
                                      next.delete(rowValue);
                                    } else {
                                      next.add(rowValue);
                                    }
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                              />
                              <span className={`font-medium ${isIncluded ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                                {rowValue}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Format Tab */}
          {activeTab === 'format' && (
            <div className="space-y-6">
              {/* Export Format */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export Format</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { value: 'excel', icon: '📊', label: 'Excel' },
                    { value: 'csv', icon: '📄', label: 'CSV' },
                    { value: 'pdf', icon: '📑', label: 'PDF' },
                    { value: 'word', icon: '📝', label: 'Word' },
                  ].map(fmt => (
                    <button
                      key={fmt.value}
                      onClick={() => setConfig(prev => ({ ...prev, format: fmt.value as ExportConfig['format'] }))}
                      className={`p-4 rounded-xl border-2 transition flex flex-col items-center gap-2 ${
                        config.format === fmt.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <span className="text-3xl">{fmt.icon}</span>
                      <span className="font-medium text-gray-700 dark:text-gray-200">{fmt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Language</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, language: 'en' }))}
                    className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                      config.language === 'en'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 dark:text-gray-300'
                    }`}
                  >
                    🇺🇸 English
                  </button>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, language: 'ar' }))}
                    className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                      config.language === 'ar'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 dark:text-gray-300'
                    }`}
                  >
                    🇸🇦 العربية
                  </button>
                </div>
              </div>

              {/* Document Title */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Document Title</label>
                <input
                  type="text"
                  value={config.title}
                  onChange={e => setConfig(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter report title"
                />
              </div>

              {/* Subtitle */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Subtitle (Optional)</label>
                <input
                  type="text"
                  value={config.subtitle || ''}
                  onChange={e => setConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter subtitle or date range"
                />
              </div>

              {/* PDF-specific options */}
              {config.format === 'pdf' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Page Orientation</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, orientation: 'portrait' }))}
                        className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                          config.orientation === 'portrait'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500 dark:text-gray-300'
                        }`}
                      >
                        📄 Portrait
                      </button>
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, orientation: 'landscape' }))}
                        className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                          config.orientation === 'landscape'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500 dark:text-gray-300'
                        }`}
                      >
                        📃 Landscape
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Font Size</label>
                    <div className="flex gap-3">
                      {(['small', 'medium', 'large'] as const).map(size => (
                        <button
                          key={size}
                          onClick={() => setConfig(prev => ({ ...prev, fontSize: size }))}
                          className={`px-6 py-3 rounded-lg border-2 font-medium transition capitalize ${
                            config.fontSize === size
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                              : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500 dark:text-gray-300'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.includeTimestamp}
                    onChange={e => setConfig(prev => ({ ...prev, includeTimestamp: e.target.checked }))}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Include generation timestamp</span>
                </label>
                
                {(config.format === 'excel') && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeSummary}
                      onChange={e => setConfig(prev => ({ ...prev, includeSummary: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Include summary sheet</span>
                  </label>
                )}
              </div>

              {/* Arabic + PDF Warning */}
              {config.language === 'ar' && config.format === 'pdf' && (
                <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-amber-500 text-2xl flex-shrink-0">⚠️</span>
                  <div>
                    <h4 className="font-semibold text-amber-800 dark:text-amber-200">تحذير: ملف PDF لا يدعم العربية</h4>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                      محرك PDF الحالي (jsPDF) لا يدعم تشكيل الحروف العربية بشكل صحيح — قد تظهر الحروف منفصلة أو مقلوبة.
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                      <strong>للحصول على نتائج مثالية باللغة العربية: استخدم تصدير Word أو Excel بدلاً من PDF.</strong>
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                      Arabic PDF Limitation: Use <strong>Word (.docx)</strong> or <strong>Excel (.xlsx)</strong> for proper Arabic text rendering with full RTL support.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Layout Tab */}
          {activeTab === 'layout' && (
            <div className="space-y-6">
              {/* Row Density */}
              <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-900/30 dark:to-cyan-900/30 p-4 border-b dark:border-teal-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">↕️</span>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Row Density / حجم الصفوف</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Control cell padding and row height in exported tables</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 dark:bg-gray-800">
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { value: 'compact', label: 'Compact', labelAr: 'مضغوط', preview: 'py-0.5 px-2 text-xs', desc: 'Minimal padding, fits more rows' },
                      { value: 'normal', label: 'Normal', labelAr: 'عادي', preview: 'py-1.5 px-3 text-sm', desc: 'Standard spacing (default)' },
                      { value: 'comfortable', label: 'Comfortable', labelAr: 'مريح', preview: 'py-3 px-4 text-base', desc: 'Generous padding, easier to read' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setConfig(prev => ({ ...prev, rowDensity: opt.value }))}
                        className={`p-3 rounded-xl border-2 transition flex flex-col items-center gap-2 ${
                          config.rowDensity === opt.value
                            ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/40'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        <div className="w-full border border-gray-300 dark:border-gray-600 rounded overflow-hidden text-xs">
                          <div className={`bg-teal-100 dark:bg-teal-900/50 ${opt.preview} text-center text-gray-700 dark:text-gray-300 font-semibold border-b border-gray-300 dark:border-gray-600`}>Header</div>
                          <div className={`${opt.preview} text-center text-gray-600 dark:text-gray-400`}>Cell Value</div>
                          <div className={`${opt.preview} text-center text-gray-500 dark:text-gray-500 bg-gray-50 dark:bg-gray-700`}>Cell Value</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-gray-900 dark:text-white text-sm">{opt.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{opt.labelAr}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Font Sizes */}
              <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/30 p-4 border-b dark:border-violet-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔤</span>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Font Sizes / أحجام الخطوط</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Control exact font sizes for each section (applies to PDF &amp; Word)</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 dark:bg-gray-800 space-y-5">
                  {/* Header Font Size */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Header Font Size</label>
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400">{config.headerFontSizePt ?? (config.fontSize === 'small' ? 14 : config.fontSize === 'large' ? 18 : 16)}pt</span>
                    </div>
                    <input
                      type="range" min={8} max={24} step={1}
                      value={config.headerFontSizePt ?? (config.fontSize === 'small' ? 14 : config.fontSize === 'large' ? 18 : 16)}
                      onChange={e => setConfig(prev => ({ ...prev, headerFontSizePt: parseInt(e.target.value) }))}
                      className="w-full accent-violet-600"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1"><span>8pt</span><span>16pt</span><span>24pt</span></div>
                  </div>
                  {/* Body Font Size */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Body / Table Font Size</label>
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400">{config.bodyFontSizePt ?? (config.fontSize === 'small' ? 6 : config.fontSize === 'large' ? 10 : 8)}pt</span>
                    </div>
                    <input
                      type="range" min={6} max={16} step={1}
                      value={config.bodyFontSizePt ?? (config.fontSize === 'small' ? 6 : config.fontSize === 'large' ? 10 : 8)}
                      onChange={e => setConfig(prev => ({ ...prev, bodyFontSizePt: parseInt(e.target.value) }))}
                      className="w-full accent-violet-600"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1"><span>6pt</span><span>11pt</span><span>16pt</span></div>
                  </div>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, headerFontSizePt: undefined, bodyFontSizePt: undefined }))}
                    className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Reset to defaults (based on Size setting in Format tab)
                  </button>
                </div>
              </div>

              {/* PDF Page Size */}
              {config.format === 'pdf' && (
                <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-900/30 dark:to-sky-900/30 p-4 border-b dark:border-blue-800">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Page Size / حجم الصفحة</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">PDF paper size</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 dark:bg-gray-800">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {([
                        { value: 'a4', label: 'A4', dim: '210×297mm' },
                        { value: 'a3', label: 'A3', dim: '297×420mm' },
                        { value: 'letter', label: 'Letter', dim: '216×279mm' },
                        { value: 'legal', label: 'Legal', dim: '216×356mm' },
                      ] as const).map(sz => (
                        <button
                          key={sz.value}
                          onClick={() => setConfig(prev => ({ ...prev, pageSize: sz.value }))}
                          className={`p-3 rounded-xl border-2 transition text-center ${
                            config.pageSize === sz.value
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <div className="font-semibold text-gray-900 dark:text-white">{sz.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sz.dim}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Table Style Options */}
              <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/30 dark:to-pink-900/30 p-4 border-b dark:border-rose-800">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🎨</span>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Table Style / نمط الجدول</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Appearance controls for exported tables</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 dark:bg-gray-800 space-y-4">
                  {/* Gridlines */}
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={config.showGridlines !== false}
                      onChange={e => setConfig(prev => ({ ...prev, showGridlines: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Show Gridlines / إظهار خطوط الشبكة</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Display cell borders in the exported table</p>
                    </div>
                  </label>

                  {/* Alternate Row Colors */}
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={config.alternateRowColors !== false}
                      onChange={e => setConfig(prev => ({ ...prev, alternateRowColors: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Alternate Row Colors / ألوان متناوبة للصفوف</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Zebra-stripe alternate rows for easier reading</p>
                    </div>
                  </label>

                  {/* Repeat Headers */}
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={config.repeatHeaders !== false}
                      onChange={e => setConfig(prev => ({ ...prev, repeatHeaders: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Repeat Headers on Each Page</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">PDF: Show column headers at the top of every page</p>
                    </div>
                  </label>

                  {/* Header Color */}
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Header Background Color / لون خلفية الرأس</label>
                    <div className="flex items-center gap-3 flex-wrap">
                      {['3b82f6', '6366f1', '8b5cf6', '0891b2', '047857', 'd97706', 'dc2626', '1f2937', '0f766e'].map(hex => (
                        <button
                          key={hex}
                          onClick={() => setConfig(prev => ({ ...prev, headerBgColor: hex }))}
                          style={{ backgroundColor: `#${hex}` }}
                          className={`w-8 h-8 rounded-full flex-shrink-0 transition transform hover:scale-110 ${config.headerBgColor === hex ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white scale-110' : ''}`}
                          title={`#${hex}`}
                        />
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Custom:</span>
                        <input
                          type="color"
                          value={`#${config.headerBgColor || '3b82f6'}`}
                          onChange={e => setConfig(prev => ({ ...prev, headerBgColor: e.target.value.replace('#', '') }))}
                          className="w-8 h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Column Widths */}
              {config.selectedFields.length > 0 && (
                <div className="border dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/30 p-4 border-b dark:border-amber-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📏</span>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-white">Column Widths / عرض الأعمدة</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Set custom width for each column (Excel: characters, PDF: relative proportion)</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, columnWidths: {} }))}
                        className="text-xs text-amber-600 dark:text-amber-400 hover:underline px-2"
                      >
                        Reset All
                      </button>
                    </div>
                  </div>
                  <div className="p-4 dark:bg-gray-800 max-h-72 overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {getSelectedFieldsOrdered().map(field => (
                        <div key={field.key} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{fieldRenames[field.key] || field.label}</div>
                            {field.labelAr && !fieldRenames[field.key] && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{field.labelAr}</div>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <input
                              type="number"
                              min={5}
                              max={80}
                              placeholder="auto"
                              value={config.columnWidths?.[field.key] ?? ''}
                              onChange={e => {
                                const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                                setConfig(prev => ({
                                  ...prev,
                                  columnWidths: {
                                    ...(prev.columnWidths || {}),
                                    ...(val !== undefined ? { [field.key]: val } : {}),
                                    ...(val === undefined ? Object.fromEntries(Object.entries(prev.columnWidths || {}).filter(([k]) => k !== field.key)) : {}),
                                  }
                                }));
                              }}
                              className="w-16 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-white rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-center"
                            />
                            <span className="text-xs text-gray-400 dark:text-gray-500">ch</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Leave blank to use automatic width based on content. Range: 5–80 characters.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Data Validation Tab */}
          {activeTab === 'validation' && (
            <div className="space-y-6">
              {/* Data Cleaning Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 border-b dark:border-blue-800">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                    🧹 Data Cleaning
                  </h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">Clean and prepare your data before export</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.removeDuplicates}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, removeDuplicates: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Remove duplicate rows</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Eliminates rows with identical values across all selected fields</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.removeEmptyRows}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, removeEmptyRows: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Remove empty rows</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Removes rows where all selected fields are empty or contain only "-"</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.trimWhitespace}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, trimWhitespace: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Trim whitespace</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Removes leading and trailing spaces from text values</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Data Validation Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-orange-50 dark:bg-orange-900/30 p-4 border-b dark:border-orange-800">
                  <h3 className="font-semibold text-orange-900 dark:text-orange-200 flex items-center gap-2">
                    ✅ Data Validation
                  </h3>
                  <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">Validate data quality and identify issues</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.validateRequired}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, validateRequired: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Check for missing values</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Identifies and reports cells with empty or missing data</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.validateNumericRanges}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, validateNumericRanges: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Validate numeric ranges</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Checks that percentage values are between 0-100%</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.validateDates}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, validateDates: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Validate date formats</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ensures all date fields contain valid, parseable dates</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Data Formatting Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-green-50 dark:bg-green-900/30 p-4 border-b dark:border-green-800">
                  <h3 className="font-semibold text-green-900 dark:text-green-200 flex items-center gap-2">
                    🎨 Data Formatting
                  </h3>
                  <p className="text-sm text-green-700 dark:text-green-400 mt-1">Format values for better readability</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.formatNumbers}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, formatNumbers: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Format numbers</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Adds thousand separators (e.g., 1,234 instead of 1234)</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.formatPercentages}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, formatPercentages: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Format percentages</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ensures rate and percentage fields display with % symbol</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.formatDates}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, formatDates: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Standardize date format</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ensures consistent date formatting across all date fields</p>
                    </div>
                  </label>
                  
                  {config.dataValidation.formatDates && (
                    <div className="ml-8 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Date Format Style</label>
                      <div className="flex gap-2">
                        {(['short', 'medium', 'long'] as const).map(fmt => (
                          <button
                            key={fmt}
                            onClick={() => setConfig(prev => ({
                              ...prev,
                              dataValidation: { ...prev.dataValidation, dateFormat: fmt }
                            }))}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                              config.dataValidation.dateFormat === fmt
                                ? 'bg-green-500 text-white'
                                : 'bg-white border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                            }`}
                          >
                            {fmt === 'short' && '01/15/26'}
                            {fmt === 'medium' && 'Jan 15, 2026'}
                            {fmt === 'long' && 'January 15, 2026'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Report Options Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-purple-50 dark:bg-purple-900/30 p-4 border-b dark:border-purple-800">
                  <h3 className="font-semibold text-purple-900 dark:text-purple-200 flex items-center gap-2">
                    📊 Quality Report
                  </h3>
                  <p className="text-sm text-purple-700 dark:text-purple-400 mt-1">Include data quality information in export</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.showDataQualityReport}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, showDataQualityReport: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Include data quality report</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Adds a summary of data processing and any validation issues found</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Conditional Coloring Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-rose-50 dark:bg-rose-900/30 p-4 border-b dark:border-rose-800">
                  <h3 className="font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-2">
                    🌈 Conditional Coloring
                  </h3>
                  <p className="text-sm text-rose-700 dark:text-rose-400 mt-1">Apply color-coding to percentage and score fields (Word, Excel, PDF)</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <input
                      type="checkbox"
                      checked={config.dataValidation.enableConditionalColoring}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        dataValidation: { ...prev.dataValidation, enableConditionalColoring: e.target.checked }
                      }))}
                      className="w-5 h-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500 mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Enable conditional coloring</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Color-code cells based on values (green for high, red for low)</p>
                    </div>
                  </label>
                  
                  {config.dataValidation.enableConditionalColoring && (
                    <>
                      {/* Color Theme Selection */}
                      <div className="ml-8 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Color Theme</label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {([
                              { id: 'default', label: 'Professional', colors: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'] },
                              { id: 'traffic', label: 'Traffic Light', colors: ['#22c55e', '#eab308', '#f97316', '#ef4444'] },
                              { id: 'heatmap', label: 'Heatmap', colors: ['#0ea5e9', '#8b5cf6', '#f97316', '#dc2626'] },
                              { id: 'status', label: 'Status', colors: ['#16a34a', '#2563eb', '#d97706', '#b91c1c'] },
                            ] as const).map(theme => (
                              <button
                                key={theme.id}
                                onClick={() => setConfig(prev => ({
                                  ...prev,
                                  dataValidation: { ...prev.dataValidation, coloringTheme: theme.id }
                                }))}
                                className={`p-3 rounded-lg text-sm font-medium transition text-center border-2 ${
                                  config.dataValidation.coloringTheme === theme.id
                                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/40'
                                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-gray-500'
                                }`}
                              >
                                <div className="text-xs mb-2">{theme.label}</div>
                                <div className="flex justify-center gap-1">
                                  {theme.colors.map((color, i) => (
                                    <div
                                      key={i}
                                      className="w-4 h-4 rounded-sm"
                                      style={{ backgroundColor: color }}
                                    />
                                  ))}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Field Selection for Coloring */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Fields to Color
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(leave empty for auto-detect)</span>
                          </label>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                            {allFields.filter(f => config.selectedFields.includes(f.key)).map(field => {
                              const isAutoDetected = /rate|percentage|percent|%|score|weighted|attendance|punctuality|consistency|avg|average|معدل|نسبة|متوسط/i.test(field.key + field.label);
                              const isSelected = config.dataValidation.coloringFields.includes(field.key);
                              return (
                                <label
                                  key={field.key}
                                  className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer transition ${
                                    isSelected 
                                      ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200' 
                                      : isAutoDetected && config.dataValidation.coloringFields.length === 0
                                        ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700'
                                        : 'bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={e => {
                                      const newFields = e.target.checked
                                        ? [...config.dataValidation.coloringFields, field.key]
                                        : config.dataValidation.coloringFields.filter(f => f !== field.key);
                                      setConfig(prev => ({
                                        ...prev,
                                        dataValidation: { ...prev.dataValidation, coloringFields: newFields }
                                      }));
                                    }}
                                    className="w-3 h-3 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                                  />
                                  <span className="truncate">{field.label}</span>
                                  {isAutoDetected && config.dataValidation.coloringFields.length === 0 && (
                                    <span className="text-green-600 text-[10px]">auto</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          {config.dataValidation.coloringFields.length === 0 && (
                            <p className="text-xs text-gray-500 mt-2 italic">
                              ✨ Auto-detecting: Rate, Score, Percentage, Average, and similar fields
                            </p>
                          )}
                        </div>
                        
                        {/* Color Legend Preview */}
                        <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Color Legend Preview:</div>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded text-xs text-white font-medium bg-emerald-500">90%+ Excellent</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium bg-blue-500">75-89% Good</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium bg-amber-500">60-74% Moderate</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium bg-red-500">&lt;60% Needs Attention</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Multi-Layer Sorting Options */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 border-b dark:border-indigo-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                        📑 Sort Data
                      </h3>
                      <p className="text-sm text-indigo-700 dark:text-indigo-400 mt-1">
                        Add multiple sort layers for precise ordering
                      </p>
                    </div>
                    {(config.sortLayers?.length || 0) > 0 && (
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, sortLayers: [], sortByField: undefined, sortDirection: 'asc' }))}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {/* Existing sort layers */}
                  {(config.sortLayers || []).map((layer, idx) => {
                    return (
                      <div key={`${layer.field}-${idx}`} className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <span className="w-6 h-6 flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded text-xs font-bold flex-shrink-0">
                          {idx + 1}
                        </span>
                        <select
                          value={layer.field}
                          onChange={e => {
                            const newField = e.target.value;
                            setConfig(prev => {
                              const newLayers = [...(prev.sortLayers || [])];
                              newLayers[idx] = { ...newLayers[idx], field: newField };
                              return { ...prev, sortLayers: newLayers, sortByField: newLayers[0]?.field, sortDirection: newLayers[0]?.direction };
                            });
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                          {allFields.filter(f => config.selectedFields.includes(f.key)).map(f => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => {
                              setConfig(prev => {
                                const newLayers = [...(prev.sortLayers || [])];
                                newLayers[idx] = { ...newLayers[idx], direction: 'asc' };
                                return { ...prev, sortLayers: newLayers, sortByField: newLayers[0]?.field, sortDirection: newLayers[0]?.direction };
                              });
                            }}
                            className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                              layer.direction === 'asc'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-600 dark:text-gray-300'
                            }`}
                          >
                            ↑ Asc
                          </button>
                          <button
                            onClick={() => {
                              setConfig(prev => {
                                const newLayers = [...(prev.sortLayers || [])];
                                newLayers[idx] = { ...newLayers[idx], direction: 'desc' };
                                return { ...prev, sortLayers: newLayers, sortByField: newLayers[0]?.field, sortDirection: newLayers[0]?.direction };
                              });
                            }}
                            className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                              layer.direction === 'desc'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-600 dark:text-gray-300'
                            }`}
                          >
                            ↓ Desc
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            setConfig(prev => {
                              const newLayers = (prev.sortLayers || []).filter((_, i) => i !== idx);
                              return { ...prev, sortLayers: newLayers, sortByField: newLayers[0]?.field || undefined, sortDirection: newLayers[0]?.direction || 'asc' };
                            });
                          }}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition flex-shrink-0"
                          title="Remove sort layer"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}

                  {/* Add sort layer button */}
                  {(() => {
                    const usedFields = new Set((config.sortLayers || []).map(l => l.field));
                    const availableFields = allFields.filter(f => config.selectedFields.includes(f.key) && !usedFields.has(f.key));
                    if (availableFields.length === 0 && (config.sortLayers?.length || 0) > 0) return null;
                    return (
                      <button
                        onClick={() => {
                          const usedF = new Set((config.sortLayers || []).map(l => l.field));
                          const nextField = allFields.find(f => config.selectedFields.includes(f.key) && !usedF.has(f.key));
                          if (!nextField) return;
                          setConfig(prev => {
                            const newLayers = [...(prev.sortLayers || []), { field: nextField.key, direction: 'asc' as const }];
                            return { ...prev, sortLayers: newLayers, sortByField: newLayers[0]?.field, sortDirection: newLayers[0]?.direction };
                          });
                        }}
                        className="w-full px-4 py-2.5 border-2 border-dashed border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                        </svg>
                        {(config.sortLayers?.length || 0) === 0 ? 'Add Sort Layer' : 'Add Another Sort Layer'}
                      </button>
                    );
                  })()}

                  {(config.sortLayers?.length || 0) === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
                      No sorting applied — data will export in original order
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Preview Tab */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              {/* Warning if no data */}
              {data.length === 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700/50 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-yellow-500 text-xl">⚠️</span>
                  <div>
                    <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">No Data Available</h4>
                    <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">There is no data to export. Please apply filters or load data first.</p>
                  </div>
                </div>
              )}
              
              {/* Warning if no fields selected */}
              {config.selectedFields.length === 0 && (
                <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700/50 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-orange-500 text-xl">⚠️</span>
                  <div>
                    <h4 className="font-semibold text-orange-800 dark:text-orange-200">No Fields Selected</h4>
                    <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">Please go to the "Select Fields" tab and choose the fields you want to export.</p>
                  </div>
                </div>
              )}
              
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Export Preview</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Format:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white uppercase">{config.format}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Language:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">{config.language === 'en' ? 'English' : 'العربية'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Fields:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">{config.selectedFields.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Records:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">{data.length}</span>
                  </div>
                </div>
                
                {/* Data Validation Summary */}
                {(config.dataValidation.removeDuplicates || 
                  config.dataValidation.removeEmptyRows || 
                  config.dataValidation.validateRequired ||
                  config.dataValidation.validateNumericRanges ||
                  config.dataValidation.validateDates ||
                  config.dataValidation.enableConditionalColoring ||
                  config.sortByField) && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Data Processing</h4>
                    <div className="flex flex-wrap gap-2">
                      {config.dataValidation.removeDuplicates && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                          🔄 Remove Duplicates
                        </span>
                      )}
                      {config.dataValidation.removeEmptyRows && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                          🗑️ Remove Empty Rows
                        </span>
                      )}
                      {config.dataValidation.trimWhitespace && (
                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                          ✂️ Trim Whitespace
                        </span>
                      )}
                      {config.dataValidation.validateRequired && (
                        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs font-medium">
                          ✅ Check Missing Values
                        </span>
                      )}
                      {config.dataValidation.validateNumericRanges && (
                        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs font-medium">
                          📊 Validate Ranges
                        </span>
                      )}
                      {config.dataValidation.validateDates && (
                        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs font-medium">
                          📅 Validate Dates
                        </span>
                      )}
                      {config.dataValidation.enableConditionalColoring && (
                        <span className="px-2 py-1 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 rounded text-xs font-medium">
                          🌈 Conditional Coloring ({config.dataValidation.coloringTheme})
                        </span>
                      )}
                      {config.sortByField && (
                        <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded text-xs font-medium">
                          📑 Sort by {allFields.find(f => f.key === config.sortByField)?.label || config.sortByField} ({config.sortDirection})
                        </span>
                      )}
                      {config.dataValidation.showDataQualityReport && (
                        <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs font-medium">
                          📋 Include Quality Report
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 font-semibold text-gray-700 dark:text-gray-300">
                  Selected Fields ({config.selectedFields.length})
                </div>
                <div className="p-4 max-h-40 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {getSelectedFieldsOrdered().map(field => (
                      <span
                        key={field.key}
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium"
                      >
                        {fieldRenames[field.key] || field.label}
                        {fieldRenames[field.key] && <span className="ml-1 opacity-60">✏️</span>}
                      </span>
                    ))}
                    {config.selectedFields.length === 0 && (
                      <span className="text-gray-500 dark:text-gray-400 italic">No fields selected</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data Preview Table - Shows sorted data */}
              {config.selectedFields.length > 0 && data.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 font-semibold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                    <span>Data Preview (First 5 rows{config.sortByField ? ', sorted' : ''})</span>
                    {config.sortByField && (
                      <span className="text-xs text-indigo-600 font-normal">
                        Sorted by {allFields.find(f => f.key === config.sortByField)?.label || config.sortByField} {config.sortDirection === 'desc' ? '↓' : '↑'}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          {getSelectedFieldsOrdered().slice(0, 6).map(field => (
                            <th
                              key={field.key}
                              className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${
                                field.key === config.sortByField ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {fieldRenames[field.key] || field.label}
                              {field.key === config.sortByField && (
                                <span className="ml-1">{config.sortDirection === 'desc' ? '↓' : '↑'}</span>
                              )}
                            </th>
                          ))}
                          {config.selectedFields.length > 6 && (
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 dark:text-gray-500">
                              +{config.selectedFields.length - 6} more
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {getSortedPreviewData().slice(0, 5).map((record, idx) => (
                          <tr key={idx}>
                            {getSelectedFieldsOrdered().slice(0, 6).map(field => (
                              <td key={field.key} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                {formatValue(field, record).substring(0, 30)}
                                {formatValue(field, record).length > 30 && '...'}
                              </td>
                            ))}
                            {config.selectedFields.length > 6 && (
                              <td className="px-4 py-2 text-sm text-gray-400">...</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {data.length} records • {config.selectedFields.length} fields selected
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || config.selectedFields.length === 0}
              className={`flex-1 sm:flex-none px-6 py-2 bg-blue-600 text-white rounded-lg font-medium transition flex items-center justify-center gap-2 ${
                exporting || config.selectedFields.length === 0
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-blue-700'
              }`}
            >
              {exporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>📤 Export</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvancedExportBuilder;
