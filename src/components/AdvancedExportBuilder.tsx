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
  });

  const [activeTab, setActiveTab] = useState<'fields' | 'format' | 'preview'>('fields');
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
    
    return String(value);
  };

  // ==================== EXPORT FUNCTIONS ====================

  const exportToCSV = () => {
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
    const rows = data.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    const escapeCSV = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    const csvContent = [
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
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
    const rows = data.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    const wb = XLSX.utils.book_new();
    
    // Add summary sheet if enabled
    if (config.includeSummary) {
      const summaryData = [
        [isArabic ? 'التقرير' : 'Report', config.title],
        [isArabic ? 'التاريخ' : 'Generated', format(new Date(), 'MMM dd, yyyy HH:mm')],
        [isArabic ? 'عدد السجلات' : 'Total Records', data.length],
        [isArabic ? 'عدد الحقول' : 'Fields Exported', selectedFields.length],
      ];
      if (dateRange) {
        summaryData.push([isArabic ? 'من تاريخ' : 'From Date', dateRange.start]);
        summaryData.push([isArabic ? 'إلى تاريخ' : 'To Date', dateRange.end]);
      }
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, isArabic ? 'ملخص' : 'Summary');
    }
    
    // Add main data sheet
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, isArabic ? 'البيانات' : 'Data');
    
    XLSX.writeFile(wb, `${config.title.replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const exportToPDF = () => {
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
    if (config.subtitle || config.includeTimestamp) {
      doc.setFontSize(sizes.subtitle);
      let subtitleY = 22;
      
      if (config.subtitle) {
        doc.text(config.subtitle, pageWidth / 2, subtitleY, { align: 'center' });
        subtitleY += 6;
      }
      
      if (config.includeTimestamp) {
        doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, pageWidth / 2, subtitleY, { align: 'center' });
      }
    }

    // Table
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
    const rows = data.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    autoTable(doc, {
      startY: 35,
      head: [headers],
      body: rows,
      styles: { fontSize: sizes.table, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], fontSize: sizes.table },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { top: 35 },
    });

    doc.save(`${config.title.replace(/\s+/g, '-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const exportToWord = async () => {
    const selectedFields = getSelectedFieldsOrdered();
    const isArabic = config.language === 'ar';
    
    const headers = selectedFields.map(f => isArabic && f.labelAr ? f.labelAr : f.label);
    const rows = data.map(record => 
      selectedFields.map(field => formatValue(field, record))
    );

    // Use the word export service for consistent Word document creation
    await wordExportService.exportTableToWord(
      headers,
      rows,
      config.title,
      config.subtitle || '',
      isArabic
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
            {(['fields', 'format', 'preview'] as const).map(tab => (
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
                <div className="grid grid-cols-2 gap-4 text-sm">
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
