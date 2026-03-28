import type { EnrollmentRow, ExportFields } from '@/features/sessions/constants/bulkScheduleConstants';
import { AR } from '@/features/sessions/constants/bulkScheduleConstants';
import { toast } from '@/shared/components/ui/toastUtils';

export interface ExportContext {
  enrollments: EnrollmentRow[];
  exportFields: ExportFields;
  hostDateMap: Record<string, string | null>;
  sessionId: string;
}

export const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const buildHeaderAndRows = (
  enrollments: EnrollmentRow[],
  exportFields: ExportFields,
  hostDateMap: Record<string, string | null>,
  arabic: boolean
) => {
  const header: string[] = [];
  if (exportFields.studentName) header.push(arabic ? AR.STUDENT_NAME : 'Student Name');
  if (exportFields.address) header.push(arabic ? AR.ADDRESS : 'Address');
  if (exportFields.phone) header.push(arabic ? AR.PHONE : 'Phone');
  if (exportFields.canHost) header.push(arabic ? AR.CAN_HOST : 'Can Host');
  if (exportFields.hostDate) header.push(arabic ? AR.HOST_DATE : 'Host Date');
  if (exportFields.enrollmentStatus) header.push(arabic ? AR.STATUS : 'Status');
  if (exportFields.studentId) header.push(arabic ? AR.STUDENT_ID : 'Student ID');

  const rows = enrollments.map((e) => {
    const row: string[] = [];
    if (exportFields.studentName) row.push(e.student?.name || '');
    if (exportFields.address) row.push(e.student?.address || '');
    if (exportFields.phone) row.push(e.student?.phone || '');
    if (exportFields.canHost) row.push(e.can_host ? (arabic ? AR.YES : 'Yes') : (arabic ? AR.NO : 'No'));
    if (exportFields.hostDate) row.push(hostDateMap[e.enrollment_id] || '');
    if (exportFields.enrollmentStatus) row.push(e.status || '');
    if (exportFields.studentId) row.push(e.student_id || '');
    return row;
  });

  return { header, rows };
};

const downloadCsv = (csv: string, filename: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportCSV = ({ enrollments, exportFields, hostDateMap, sessionId }: ExportContext) => {
  const { header, rows } = buildHeaderAndRows(enrollments, exportFields, hostDateMap, false);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCsv(csv, `host_schedule_${sessionId}.csv`);
};

export const exportCSVArabic = ({ enrollments, exportFields, hostDateMap, sessionId }: ExportContext) => {
  const { header, rows } = buildHeaderAndRows(enrollments, exportFields, hostDateMap, true);
  // Add UTF-8 BOM for Excel compatibility
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCsv(csv, `${AR.HOST_SCHEDULE_FILE}_${sessionId}.csv`);
};

export const openPrintableFallback = (tableColumn: string[], tableRows: (string | null)[][]) => {
  const linkifyCell = (s: unknown) => {
    const str = String(s || '');
    if (!str) return '';
    if (str.trim().match(/^https?:\/\//i)) {
      const href = escapeHtml(str.trim());
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
    }
    return escapeHtml(str);
  };

  const headerHtml = tableColumn.map((h) => `<th style="padding:8px;border:1px solid #ddd;text-align:left">${escapeHtml(String(h))}</th>`).join('');
  const bodyHtml = tableRows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px;border:1px solid #ddd">${linkifyCell(c)}</td>`).join('')}</tr>`).join('');

  const hasArabic = (tableRows.flat().join(' ') || '').match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/);
  const htmlDir = hasArabic ? 'rtl' : 'ltr';
  const fontLink = hasArabic ? '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&display=swap" rel="stylesheet">' : '';
  const bodyFont = hasArabic ? "'Noto Sans Arabic', Arial, sans-serif" : 'Arial, Helvetica, sans-serif';

  const html = `<!doctype html><html lang="${hasArabic ? 'ar' : 'en'}" dir="${htmlDir}"><head><meta charset="utf-8"><title>Host Schedule</title>${fontLink}<style>body{font-family:${bodyFont};padding:20px}table{border-collapse:collapse;width:100%}th{background:#f4f4f4;text-align:left}td,th{word-break:break-word}</style></head><body><h2 style="text-align:${hasArabic ? 'right' : 'left'}">Host Schedule</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></body></html>`;
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) throw new Error('Popup blocked');
  w.document.write(html);
  w.document.close();
};

export const exportPDF = async ({ enrollments, exportFields, hostDateMap, sessionId }: ExportContext) => {
  try {
    const mod = await import('jspdf');
    // attempt to load autotable plugin; capture module if present
    let pluginMod: unknown = null;
    try { pluginMod = await import('jspdf-autotable'); } catch { /* plugin optional */ }
    const jsPDF = (mod as { default?: unknown; jsPDF?: unknown }).default || (mod as { default?: unknown; jsPDF?: unknown }).jsPDF;
    if (!jsPDF) throw new Error('Could not load jsPDF module');

    const { header: tableColumn, rows: tableRows } = buildHeaderAndRows(enrollments, exportFields, hostDateMap, false);

    type JsPDFConstructor = new (orientation: string) => {
      text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
      setFontSize: (size: number) => void;
      save: (filename: string) => void;
      autoTable?: (options: Record<string, unknown>) => void;
    };
    const doc = new (jsPDF as unknown as JsPDFConstructor)('l'); // landscape mode for better column fit

    // Simple, frontend-like pdf layout (NO clickable links) - landscape orientation
    const docInternal = (doc as { internal?: { pageSize?: { width?: number; getWidth?: () => number } } }).internal;
    const pageWidth = docInternal?.pageSize?.width || docInternal?.pageSize?.getWidth?.() || 297;
    doc.setFontSize(16);
    doc.text('Host Schedule', pageWidth / 2, 15, { align: 'center' });

    const autoTableOptions: Record<string, unknown> = {
      head: [tableColumn],
      body: tableRows,
      margin: { top: 20, left: 8, right: 8, bottom: 8 },
      startY: 20,
      styles: {
        fontSize: 10,
        cellPadding: 3,
        overflow: 'linebreak',
        halign: 'left',
        valign: 'middle'
      },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 10,
        cellPadding: 4
      },
      columnStyles: tableColumn.reduce((acc, _, idx) => {
        acc[idx] = { halign: idx >= tableColumn.length - 2 ? 'center' : 'left' };
        return acc;
      }, {} as Record<number, { halign: string }>)
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (doc as any).autoTable === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc as any).autoTable(autoTableOptions);
      doc.save(`host_schedule_${sessionId}.pdf`);
    } else if (pluginMod) {
      const pluginModTyped = pluginMod as { default?: unknown; autoTable?: unknown };
      const at = pluginModTyped.default || pluginModTyped.autoTable || pluginMod;
      if (typeof at === 'function') {
        try {
          at(doc, autoTableOptions);
          doc.save(`host_schedule_${sessionId}.pdf`);
        } catch (inner) {
          console.warn('autotable plugin call failed, falling back to HTML', inner);
          openPrintableFallback(tableColumn, tableRows);
        }
      } else {
        openPrintableFallback(tableColumn, tableRows);
      }
    } else {
      openPrintableFallback(tableColumn, tableRows);
    }
  } catch (err) {
    const error = err as Error;
    console.error('PDF export error:', error);
    toast.error('Failed to export PDF: ' + error.message);
  }
};

export const exportWord = async ({ enrollments, exportFields, hostDateMap, sessionId }: ExportContext, isArabic: boolean) => {
  try {
    // Build headers based on selected fields and language
    const headers: string[] = [];
    if (exportFields.studentName) headers.push(isArabic ? AR.STUDENT_NAME : 'Student Name');
    if (exportFields.address) headers.push(isArabic ? AR.ADDRESS : 'Address');
    if (exportFields.phone) headers.push(isArabic ? AR.PHONE : 'Phone');
    if (exportFields.canHost) headers.push(isArabic ? AR.CAN_HOST_HE : 'Can Host');
    if (exportFields.hostDate) headers.push(isArabic ? AR.HOST_DATE : 'Host Date');
    if (exportFields.enrollmentStatus) headers.push(isArabic ? AR.STATUS : 'Status');
    if (exportFields.studentId) headers.push(isArabic ? AR.STUDENT_ID_ALT : 'Student ID');

    // Build rows based on selected fields
    const rows = enrollments.map((e) => {
      const row: string[] = [];
      if (exportFields.studentName) row.push(e.student?.name || '');
      if (exportFields.address) row.push(e.student?.address || '');
      if (exportFields.phone) row.push(e.student?.phone || '');
      if (exportFields.canHost) row.push(e.can_host ? (isArabic ? AR.YES : 'Yes') : (isArabic ? AR.NO : 'No'));
      if (exportFields.hostDate) row.push(hostDateMap[e.enrollment_id] || '');
      if (exportFields.enrollmentStatus) row.push(e.status || '');
      if (exportFields.studentId) row.push(e.student_id || '');
      return row;
    });

    // Use wordExportService to create a simple table document
    const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, AlignmentType, WidthType, BorderStyle, HeadingLevel, convertInchesToTwip } = await import('docx');
    const { saveAs } = await import('file-saver');

    const borderStyle = {
      style: BorderStyle.SINGLE,
      size: 1,
      color: '000000',
    };

    // Create header row
    const headerRow = new TableRow({
      children: headers.map(
        (header) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: header,
                    bold: true,
                    font: isArabic ? 'Arial' : 'Calibri',
                    size: 22,
                  }),
                ],
                alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.CENTER,
                bidirectional: isArabic,
              }),
            ],
            shading: { fill: 'D9E1F2' },
            borders: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          })
      ),
      cantSplit: true,
    });

    // Create data rows
    const dataRows = rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell,
                        font: isArabic ? 'Arial' : 'Calibri',
                        size: 20,
                      }),
                    ],
                    alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
                    bidirectional: isArabic,
                  }),
                ],
                borders: {
                  top: borderStyle,
                  bottom: borderStyle,
                  left: borderStyle,
                  right: borderStyle,
                },
              })
          ),
        })
    );

    const table = new Table({
      rows: [headerRow, ...dataRows],
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
      margins: {
        top: convertInchesToTwip(0.05),
        bottom: convertInchesToTwip(0.05),
        left: convertInchesToTwip(0.05),
        right: convertInchesToTwip(0.05),
      },
    });

    const titleText = isArabic ? AR.HOST_SCHEDULE : 'Host Schedule';

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                right: convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(0.75),
              },
            },
          },
          children: [
            new Paragraph({
              text: titleText,
              heading: HeadingLevel.HEADING_1,
              alignment: isArabic ? AlignmentType.RIGHT : AlignmentType.LEFT,
              spacing: { after: 200, before: 200 },
              bidirectional: isArabic,
            }),
            new Paragraph({ text: '', spacing: { after: 200 } }),
            table,
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const fileName = isArabic ? `${AR.HOST_SCHEDULE_FILE}_${sessionId}.docx` : `host_schedule_${sessionId}.docx`;
    saveAs(blob, fileName);
  } catch (err) {
    const error = err as Error;
    console.error('Word export error:', error);
    toast.error('Failed to export Word: ' + error.message);
  }
};
