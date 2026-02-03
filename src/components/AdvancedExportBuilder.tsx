import React, { useState, useCallback, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { wordExportService } from '../services/wordExportService';
import { format } from 'date-fns';

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
  sortByField?: string;              // Sort data by a field
  sortDirection?: 'asc' | 'desc';    // Sort direction
  filterEmptyValues?: boolean;       // Filter out rows with empty key values
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
  onFieldSelectionChange?: (fields: string[]) => void;
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
  onFieldSelectionChange,
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
    filterEmptyValues: false,
  });

  const [activeTab, setActiveTab] = useState<'fields' | 'format' | 'validation' | 'preview'>('fields');
  const [exporting, setExporting] = useState(false);

  // Reset config when modal opens or categories change
  useEffect(() => {
    if (isOpen) {
      const newSelectedFields = getDefaultSelectedFields();
      setConfig(prev => ({
        ...prev,
        selectedFields: newSelectedFields,
        title: defaultTitle,
        subtitle: dateRange ? `${dateRange.start} to ${dateRange.end}` : '',
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
          enableConditionalColoring: true,
          coloringFields: [],
          coloringTheme: 'default',
        },
      }));
      setActiveTab('fields');
    }
  }, [isOpen, getDefaultSelectedFields, defaultTitle, dateRange]);

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

  // Get selected fields in order
  const getSelectedFieldsOrdered = () => {
    return config.selectedFields
      .map(key => allFields.find(f => f.key === key))
      .filter(Boolean) as ExportField[];
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
    
    // Sort data if specified
    if (config.sortByField) {
      const sortField = config.sortByField;
      const sortDir = config.sortDirection === 'desc' ? -1 : 1;
      processedData.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (aVal === null || aVal === undefined) return 1 * sortDir;
        if (bVal === null || bVal === undefined) return -1 * sortDir;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * sortDir;
        }
        return String(aVal).localeCompare(String(bVal)) * sortDir;
      });
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
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
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
    const { processedData, validationIssues, stats } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
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
    
    // Apply column widths for better readability
    const colWidths = headers.map(h => ({ wch: Math.max(h.length + 2, 12) }));
    ws['!cols'] = colWidths;
    
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
  };

  const exportToPDF = () => {
    const { processedData, stats } = processDataForExport(data);
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const doc = new jsPDF({
      orientation: config.orientation,
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.width;
    
    // Font sizes based on config
    const fontSizes = {
      small: { title: 14, subtitle: 8, table: 6 },
      medium: { title: 16, subtitle: 10, table: 8 },
      large: { title: 18, subtitle: 12, table: 10 },
    };
    const sizes = fontSizes[config.fontSize];

    // Title
    doc.setFontSize(sizes.title);
    doc.text(config.title, pageWidth / 2, 15, { align: 'center' });

    // Subtitle / Date Range
    let currentY = 22;
    if (config.subtitle || config.includeTimestamp) {
      doc.setFontSize(sizes.subtitle);
      
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
        doc.setFontSize(sizes.subtitle - 1);
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
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
    const rows = processedData.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    autoTable(doc, {
      startY: currentY + 5,
      head: [headers],
      body: rows,
      styles: { fontSize: sizes.table, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: sizes.table },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { top: 35 },
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
      doc.setFontSize(sizes.subtitle - 1);
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
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
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
      alert('Please select at least one field to export');
      return;
    }

    setExporting(true);
    
    try {
      // Save field selection for use by main export buttons
      if (onFieldSelectionChange) {
        onFieldSelectionChange(config.selectedFields);
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
      alert('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };
  
  // Handle close - also save field selection
  const handleClose = () => {
    if (onFieldSelectionChange && config.selectedFields.length > 0) {
      onFieldSelectionChange(config.selectedFields);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                📤 Advanced Export Builder
              </h2>
              <p className="text-blue-100 text-sm mt-1">
                Customize your export with full control over fields and formatting
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            {(['fields', 'format', 'validation', 'preview'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === tab
                    ? 'bg-white text-blue-600'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {tab === 'fields' && '📋 Select Fields'}
                {tab === 'format' && '⚙️ Format Options'}
                {tab === 'validation' && '✅ Data Validation'}
                {tab === 'preview' && '👁️ Preview'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Fields Tab */}
          {activeTab === 'fields' && (
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2 pb-4 border-b">
                <button
                  onClick={selectAll}
                  className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition"
                >
                  ✓ Select All
                </button>
                <button
                  onClick={deselectAll}
                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition"
                >
                  ✕ Clear All
                </button>
                <span className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm">
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
                  <div key={category.id} className="border rounded-xl overflow-hidden">
                    {/* Category Header */}
                    <div
                      className="bg-gray-50 p-4 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition"
                      onClick={() => toggleCategory(category.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{category.icon}</span>
                        <div>
                          <h3 className="font-semibold text-gray-900">{category.label}</h3>
                          <p className="text-sm text-gray-500">
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
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {category.fields.map(field => (
                        <label
                          key={field.key}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                            config.selectedFields.includes(field.key)
                              ? 'bg-blue-50 border-2 border-blue-300'
                              : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={config.selectedFields.includes(field.key)}
                            onChange={() => toggleField(field.key)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">{field.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Format Tab */}
          {activeTab === 'format' && (
            <div className="space-y-6">
              {/* Export Format */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">Export Format</label>
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
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-3xl">{fmt.icon}</span>
                      <span className="font-medium text-gray-700">{fmt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">Language</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, language: 'en' }))}
                    className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                      config.language === 'en'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    🇺🇸 English
                  </button>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, language: 'ar' }))}
                    className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                      config.language === 'ar'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    🇸🇦 العربية
                  </button>
                </div>
              </div>

              {/* Document Title */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Document Title</label>
                <input
                  type="text"
                  value={config.title}
                  onChange={e => setConfig(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter report title"
                />
              </div>

              {/* Subtitle */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Subtitle (Optional)</label>
                <input
                  type="text"
                  value={config.subtitle || ''}
                  onChange={e => setConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter subtitle or date range"
                />
              </div>

              {/* PDF-specific options */}
              {config.format === 'pdf' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">Page Orientation</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, orientation: 'portrait' }))}
                        className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                          config.orientation === 'portrait'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        📄 Portrait
                      </button>
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, orientation: 'landscape' }))}
                        className={`px-6 py-3 rounded-lg border-2 font-medium transition ${
                          config.orientation === 'landscape'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        📃 Landscape
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">Font Size</label>
                    <div className="flex gap-3">
                      {(['small', 'medium', 'large'] as const).map(size => (
                        <button
                          key={size}
                          onClick={() => setConfig(prev => ({ ...prev, fontSize: size }))}
                          className={`px-6 py-3 rounded-lg border-2 font-medium transition capitalize ${
                            config.fontSize === size
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300'
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
                  <span className="text-sm font-medium text-gray-700">Include generation timestamp</span>
                </label>
                
                {(config.format === 'excel') && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeSummary}
                      onChange={e => setConfig(prev => ({ ...prev, includeSummary: e.target.checked }))}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Include summary sheet</span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Data Validation Tab */}
          {activeTab === 'validation' && (
            <div className="space-y-6">
              {/* Data Cleaning Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-blue-50 p-4 border-b">
                  <h3 className="font-semibold text-blue-900 flex items-center gap-2">
                    🧹 Data Cleaning
                  </h3>
                  <p className="text-sm text-blue-700 mt-1">Clean and prepare your data before export</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Remove duplicate rows</span>
                      <p className="text-xs text-gray-500 mt-1">Eliminates rows with identical values across all selected fields</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Remove empty rows</span>
                      <p className="text-xs text-gray-500 mt-1">Removes rows where all selected fields are empty or contain only "-"</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Trim whitespace</span>
                      <p className="text-xs text-gray-500 mt-1">Removes leading and trailing spaces from text values</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Data Validation Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-orange-50 p-4 border-b">
                  <h3 className="font-semibold text-orange-900 flex items-center gap-2">
                    ✅ Data Validation
                  </h3>
                  <p className="text-sm text-orange-700 mt-1">Validate data quality and identify issues</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Check for missing values</span>
                      <p className="text-xs text-gray-500 mt-1">Identifies and reports cells with empty or missing data</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Validate numeric ranges</span>
                      <p className="text-xs text-gray-500 mt-1">Checks that percentage values are between 0-100%</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Validate date formats</span>
                      <p className="text-xs text-gray-500 mt-1">Ensures all date fields contain valid, parseable dates</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Data Formatting Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-green-50 p-4 border-b">
                  <h3 className="font-semibold text-green-900 flex items-center gap-2">
                    🎨 Data Formatting
                  </h3>
                  <p className="text-sm text-green-700 mt-1">Format values for better readability</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Format numbers</span>
                      <p className="text-xs text-gray-500 mt-1">Adds thousand separators (e.g., 1,234 instead of 1234)</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Format percentages</span>
                      <p className="text-xs text-gray-500 mt-1">Ensures rate and percentage fields display with % symbol</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Standardize date format</span>
                      <p className="text-xs text-gray-500 mt-1">Ensures consistent date formatting across all date fields</p>
                    </div>
                  </label>
                  
                  {config.dataValidation.formatDates && (
                    <div className="ml-8 p-3 bg-gray-50 rounded-lg">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Date Format Style</label>
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
                                : 'bg-white border border-gray-300 hover:bg-gray-50'
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
                <div className="bg-purple-50 p-4 border-b">
                  <h3 className="font-semibold text-purple-900 flex items-center gap-2">
                    📊 Quality Report
                  </h3>
                  <p className="text-sm text-purple-700 mt-1">Include data quality information in export</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Include data quality report</span>
                      <p className="text-xs text-gray-500 mt-1">Adds a summary of data processing and any validation issues found</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Conditional Coloring Section */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-rose-50 p-4 border-b">
                  <h3 className="font-semibold text-rose-900 flex items-center gap-2">
                    🌈 Conditional Coloring
                  </h3>
                  <p className="text-sm text-rose-700 mt-1">Apply color-coding to percentage and score fields (Word, Excel, PDF)</p>
                </div>
                <div className="p-4 space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition">
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
                      <span className="text-sm font-medium text-gray-900">Enable conditional coloring</span>
                      <p className="text-xs text-gray-500 mt-1">Color-code cells based on values (green for high, red for low)</p>
                    </div>
                  </label>
                  
                  {config.dataValidation.enableConditionalColoring && (
                    <>
                      {/* Color Theme Selection */}
                      <div className="ml-8 p-3 bg-gray-50 rounded-lg space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Color Theme</label>
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
                                    ? 'border-rose-500 bg-rose-50'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Fields to Color
                            <span className="text-xs text-gray-500 ml-2">(leave empty for auto-detect)</span>
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
                                      ? 'bg-rose-100 text-rose-800' 
                                      : isAutoDetected && config.dataValidation.coloringFields.length === 0
                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                        : 'bg-white hover:bg-gray-50 border border-gray-200'
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
                        <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200">
                          <div className="text-xs font-medium text-gray-600 mb-2">Color Legend Preview:</div>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-1 rounded text-xs text-white font-medium" style={{ backgroundColor: '#10b981' }}>90%+ Excellent</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium" style={{ backgroundColor: '#3b82f6' }}>75-89% Good</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium" style={{ backgroundColor: '#f59e0b' }}>60-74% Moderate</span>
                            <span className="px-2 py-1 rounded text-xs text-white font-medium" style={{ backgroundColor: '#ef4444' }}>&lt;60% Needs Attention</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Sorting Options */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-indigo-50 p-4 border-b">
                  <h3 className="font-semibold text-indigo-900 flex items-center gap-2">
                    📑 Sort Data
                  </h3>
                  <p className="text-sm text-indigo-700 mt-1">Sort exported data by a specific field</p>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sort By Field</label>
                      <select
                        value={config.sortByField || ''}
                        onChange={e => setConfig(prev => ({ ...prev, sortByField: e.target.value || undefined }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">No sorting</option>
                        {allFields.filter(f => config.selectedFields.includes(f.key)).map(field => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))}
                      </select>
                    </div>
                    {config.sortByField && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfig(prev => ({ ...prev, sortDirection: 'asc' }))}
                            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                              config.sortDirection === 'asc'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            ↑ Ascending
                          </button>
                          <button
                            onClick={() => setConfig(prev => ({ ...prev, sortDirection: 'desc' }))}
                            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                              config.sortDirection === 'desc'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            ↓ Descending
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Preview Tab */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              {/* Warning if no data */}
              {data.length === 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-yellow-500 text-xl">⚠️</span>
                  <div>
                    <h4 className="font-semibold text-yellow-800">No Data Available</h4>
                    <p className="text-sm text-yellow-700 mt-1">There is no data to export. Please apply filters or load data first.</p>
                  </div>
                </div>
              )}
              
              {/* Warning if no fields selected */}
              {config.selectedFields.length === 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-orange-500 text-xl">⚠️</span>
                  <div>
                    <h4 className="font-semibold text-orange-800">No Fields Selected</h4>
                    <p className="text-sm text-orange-700 mt-1">Please go to the "Select Fields" tab and choose the fields you want to export.</p>
                  </div>
                </div>
              )}
              
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Export Preview</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Format:</span>
                    <span className="ml-2 font-medium text-gray-900 uppercase">{config.format}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Language:</span>
                    <span className="ml-2 font-medium text-gray-900">{config.language === 'en' ? 'English' : 'العربية'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Fields:</span>
                    <span className="ml-2 font-medium text-gray-900">{config.selectedFields.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Records:</span>
                    <span className="ml-2 font-medium text-gray-900">{data.length}</span>
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
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h4 className="font-medium text-gray-700 mb-2">Data Processing</h4>
                    <div className="flex flex-wrap gap-2">
                      {config.dataValidation.removeDuplicates && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          🔄 Remove Duplicates
                        </span>
                      )}
                      {config.dataValidation.removeEmptyRows && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          🗑️ Remove Empty Rows
                        </span>
                      )}
                      {config.dataValidation.trimWhitespace && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                          ✂️ Trim Whitespace
                        </span>
                      )}
                      {config.dataValidation.validateRequired && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
                          ✅ Check Missing Values
                        </span>
                      )}
                      {config.dataValidation.validateNumericRanges && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
                          📊 Validate Ranges
                        </span>
                      )}
                      {config.dataValidation.validateDates && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
                          📅 Validate Dates
                        </span>
                      )}
                      {config.dataValidation.enableConditionalColoring && (
                        <span className="px-2 py-1 bg-rose-100 text-rose-700 rounded text-xs font-medium">
                          🌈 Conditional Coloring ({config.dataValidation.coloringTheme})
                        </span>
                      )}
                      {config.sortByField && (
                        <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                          📑 Sort by {allFields.find(f => f.key === config.sortByField)?.label || config.sortByField} ({config.sortDirection})
                        </span>
                      )}
                      {config.dataValidation.showDataQualityReport && (
                        <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          📋 Include Quality Report
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 font-semibold text-gray-700">
                  Selected Fields ({config.selectedFields.length})
                </div>
                <div className="p-4 max-h-40 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {getSelectedFieldsOrdered().map(field => (
                      <span
                        key={field.key}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                      >
                        {field.label}
                      </span>
                    ))}
                    {config.selectedFields.length === 0 && (
                      <span className="text-gray-500 italic">No fields selected</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Data Preview Table */}
              {config.selectedFields.length > 0 && data.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 font-semibold text-gray-700">
                    Data Preview (First 5 rows)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {getSelectedFieldsOrdered().slice(0, 6).map(field => (
                            <th
                              key={field.key}
                              className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              {field.label}
                            </th>
                          ))}
                          {config.selectedFields.length > 6 && (
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400">
                              +{config.selectedFields.length - 6} more
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {data.slice(0, 5).map((record, idx) => (
                          <tr key={idx}>
                            {getSelectedFieldsOrdered().slice(0, 6).map(field => (
                              <td key={field.key} className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
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
        <div className="border-t bg-gray-50 p-4 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {data.length} records • {config.selectedFields.length} fields selected
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || config.selectedFields.length === 0}
              className={`px-6 py-2 bg-blue-600 text-white rounded-lg font-medium transition flex items-center gap-2 ${
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
