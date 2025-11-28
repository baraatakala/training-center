import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';

type EnrollmentRow = {
  enrollment_id: string;
  student_id: string;
  student?: { name: string; address?: string | null; phone?: string | null };
  can_host?: boolean | null;
  host_date?: string | null;
};

interface Props {
  sessionId: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  // optional comma-separated days from session (e.g. "Monday, Wednesday")
  day?: string | null;
  time?: string | null;
  onClose?: () => void;
}

function getDatesBetween(start: string, end: string, dayString?: string | null) {
  const dates: string[] = [];
  console.log('getDatesBetween called with:', { start, end, dayString });
  
  // Parse YYYY-MM-DD without timezone conversion to avoid off-by-one issues
  const parseYMD = (ymd: string) => {
    const [y, m, d] = (ymd || '').split('-').map((p) => parseInt(p, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const s = parseYMD(start);
  const e = parseYMD(end);
  if (!s || !e) return dates;

  // If dayString provided, parse allowed weekdays (0=Sunday..6=Saturday)
  let allowedWeekdays: Set<number> | null = null;
  if (dayString) {
    const map: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const parts = dayString.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    allowedWeekdays = new Set<number>();
    parts.forEach(p => {
      if (p in map) allowedWeekdays!.add(map[p]);
      else {
        // try matching short forms like Mon, Tue
        const short = p.slice(0,3);
        for (const [k,v] of Object.entries(map)) {
          if (k.slice(0,3) === short) allowedWeekdays!.add(v);
        }
      }
    });
    if (allowedWeekdays.size === 0) allowedWeekdays = null;
    console.log('Parsed allowedWeekdays:', Array.from(allowedWeekdays || []));
  }

  for (let d = new Date(s); d <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const weekday = d.getDay();
    if (allowedWeekdays) {
      if (allowedWeekdays.has(weekday)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
      }
    } else {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }
  }
  console.log('Generated dates count:', dates.length, 'first 3:', dates.slice(0, 3));
  return dates;
}

export const BulkScheduleTable: React.FC<Props> = ({ sessionId, startDate, endDate, day }) => {
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  // all possible session dates (filtered by day)
  const [fullDates, setFullDates] = useState<string[]>(() => getDatesBetween(startDate, endDate, day));
  // host date selection per enrollment
  const [hostDateMap, setHostDateMap] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const all = getDatesBetween(startDate, endDate, day);
    setFullDates(all);
    // reset hostDateMap when dates change
    setHostDateMap({});
  }, [startDate, endDate, day]);

  useEffect(() => {
    loadEnrollments();
  }, [sessionId]);

  const loadEnrollments = async () => {
    try {
      console.log('Loading enrollments for session:', sessionId, 'day:', day, 'startDate:', startDate, 'endDate:', endDate);
      
      const { data, error } = await supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id, student_id, can_host, host_date, student:student_id(name, address, phone)')
        .eq('session_id', sessionId);

      if (error) {
        console.error('Enrollment load error:', error);
        alert('Failed to load enrollments: ' + error.message);
        return;
      }

      if (!data || data.length === 0) {
        console.log('No enrollments found for session:', sessionId);
        setEnrollments([]);
        return;
      }

      console.log('Raw data from query:', data);

      const rows: EnrollmentRow[] = (data || []).map((r: any) => ({
        enrollment_id: r.enrollment_id,
        student_id: r.student_id,
        student: r.student,
        can_host: r.can_host,
        host_date: r.host_date,
      }));

      console.log('Mapped rows:', rows);

      // Sort by student name manually
      rows.sort((a, b) => {
        const nameA = a.student?.name || '';
        const nameB = b.student?.name || '';
        return nameA.localeCompare(nameB);
      });

      setEnrollments(rows);
      console.log('Loaded enrollments:', rows.length);

      // initialize hostDateMap from DB host_date values (convert DATE to ISO string yyyy-mm-dd)
      const hd: Record<string, string | null> = {};
      rows.forEach((row) => {
        hd[row.enrollment_id] = row.host_date || null;
      });
      setHostDateMap(hd);
    } catch (err: any) {
      console.error('Enrollment load exception:', err);
      alert('Error loading enrollments: ' + err.message);
    }
  };


  const toggleHost = async (enrollmentId: string, value: boolean) => {
    setEnrollments((prev) => prev.map((e) => (e.enrollment_id === enrollmentId ? { ...e, can_host: value } : e)));
    await supabase.from(Tables.ENROLLMENT).update({ can_host: value }).eq('enrollment_id', enrollmentId);
  };

  // Save host_date to DB for an enrollment
  const saveHostDate = async (enrollmentId: string, hostDate: string | null) => {
    try {
      console.log(`Saving host_date for enrollment ${enrollmentId}:`, hostDate);
      const { error } = await supabase.from(Tables.ENROLLMENT).update({ host_date: hostDate }).eq('enrollment_id', enrollmentId);
      if (error) {
        console.error('Failed to save host_date:', error);
      } else {
        console.log(`Successfully saved host_date for enrollment ${enrollmentId}`);
      }
    } catch (err: any) {
      console.error('Failed to save host_date:', err);
    }
  };

  const exportCSV = () => {
    const displayedEnrollments = getSortedDisplayedEnrollments();

    const header = ['Student Name', 'Address', 'Phone', 'Can Host', 'Host Date'];
    const rows = displayedEnrollments.map((e) => {
      const name = e.student?.name || '';
      const addr = e.student?.address || '';
      const phone = e.student?.phone || '';
      const host = e.can_host ? 'Yes' : 'No';
      const hd = hostDateMap[e.enrollment_id] || '';
      return [name, addr, phone, host, hd];
    });

    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `host_schedule_${sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    try {
      const mod = await import('jspdf');
      // attempt to load autotable plugin; capture module if present
      let pluginMod: any = null;
      try { pluginMod = await import('jspdf-autotable'); } catch { pluginMod = null; }
      const jsPDF = (mod as any).default || (mod as any).jsPDF;
      if (!jsPDF) throw new Error('Could not load jsPDF module');
      const displayedEnrollments = getSortedDisplayedEnrollments();

      const doc = new jsPDF('l'); // landscape mode for better column fit
      const tableColumn = ['Student Name', 'Address', 'Phone', 'Can Host', 'Host Date'];
      const tableRows = displayedEnrollments.map((e) => {
        const name = e.student?.name || '';
        const addr = e.student?.address || '';
        const phone = e.student?.phone || '';
        const host = e.can_host ? 'Yes' : 'No';
        const hd = hostDateMap[e.enrollment_id] || '';
        return [name, addr, phone, host, hd];
      });

      // Simple, frontend-like pdf layout (NO clickable links) - landscape orientation
      const pageWidth = (doc as any).internal?.pageSize?.width || (doc as any).internal?.pageSize?.getWidth?.() || 297;
      doc.setFontSize(16);
      doc.text('Host Schedule', pageWidth / 2, 15, { align: 'center' });

      const autoTableOptions: any = {
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
        columnStyles: {
          0: { halign: 'left' }, // Student Name
          1: { halign: 'left' }, // Address
          2: { halign: 'left' }, // Phone
          3: { halign: 'center' }, // Can Host
          4: { halign: 'center' }  // Host Date
        }
      };

      if (typeof (doc as any).autoTable === 'function') {
        (doc as any).autoTable(autoTableOptions);
        doc.save(`host_schedule_${sessionId}.pdf`);
      } else if (pluginMod) {
        const at = pluginMod.default || pluginMod.autoTable || pluginMod;
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
    } catch (err: any) {
      console.error('PDF export error:', err);
      alert('Failed to export PDF: ' + (err?.message || String(err)));
    }
  };

  const openPrintableFallback = (tableColumn: string[], tableRows: (string | null)[][]) => {
    const linkifyCell = (s: any) => {
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
    const w = window.open('', '_blank');
    if (!w) throw new Error('Popup blocked');
    w.document.write(html);
    w.document.close();
  };

  const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const getSortedDisplayedEnrollments = () => {
    const arr = [...enrollments.filter((e) => !!e.can_host)];
    arr.sort((a, b) => {
      const da = hostDateMap[a.enrollment_id];
      const db = hostDateMap[b.enrollment_id];
      if (!da && !db) return (a.student?.name || '').localeCompare(b.student?.name || '');
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
    return arr;
  };

  const displayedEnrollments = getSortedDisplayedEnrollments();

  const shiftAll = (dir: -1 | 1) => {
    if (!fullDates || fullDates.length === 0) return;
    setHostDateMap((prev) => {
      const next: Record<string, string | null> = { ...prev };
      displayedEnrollments.forEach((e) => {
        const cur = prev[e.enrollment_id];
        if (!cur) {
          next[e.enrollment_id] = dir > 0 ? fullDates[0] : fullDates[fullDates.length - 1];
        } else {
          const idx = fullDates.indexOf(cur);
          if (idx === -1) {
            next[e.enrollment_id] = dir > 0 ? fullDates[0] : fullDates[fullDates.length - 1];
          } else {
            const ni = Math.min(Math.max(0, idx + dir), fullDates.length - 1);
            next[e.enrollment_id] = fullDates[ni];
          }
        }
        saveHostDate(e.enrollment_id, next[e.enrollment_id]);
      });
      return next;
    });
  };
  

  return (
    <div style={{ width: '80vw', maxWidth: '1100px', margin: '0 auto' }} className="p-6 bg-white min-h-screen">
      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-4">Host Table</h3>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="text-base text-gray-700">
            <strong>Available dates:</strong> {fullDates.length}
          </div>
          <div className="flex flex-wrap gap-2 lg:gap-3">
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(-1)} title="Shift all host dates to previous session date">
              ← Shift All Previous
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(1)} title="Shift all host dates to next session date">
              Shift All Next →
            </button>
            <button className="btn btn-sm btn-outline" onClick={exportCSV}>
              📥 Export CSV
            </button>
            <button className="btn btn-sm btn-outline" onClick={exportPDF}>
              📄 Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto border rounded-lg shadow">
        <table className="w-full border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-4 text-left font-semibold text-base min-w-[150px]">Student</th>
              <th className="p-4 text-left font-semibold text-base min-w-[200px]">Address</th>
              <th className="p-4 text-center font-semibold text-base min-w-[140px]">Phone</th>
              <th className="p-4 text-center font-semibold text-base min-w-[100px]">Can Host</th>
              <th className="p-4 text-left font-semibold text-base min-w-[220px]">Host Date</th>
            </tr>
          </thead>
          <tbody>
            {displayedEnrollments.map((e) => (
              <tr key={e.enrollment_id} className="border-b hover:bg-blue-50 transition">
                <td className="p-4 text-base font-medium">{e.student?.name}</td>
                <td className="p-4 text-base">{e.student?.address || '—'}</td>
                <td className="p-4 text-center text-base">{e.student?.phone || '—'}</td>
                <td className="p-4 text-center">
                  <input
                    type="checkbox"
                    checked={!!e.can_host}
                    onChange={(ev) => toggleHost(e.enrollment_id, ev.target.checked)}
                    className="h-5 w-5 cursor-pointer"
                  />
                </td>
                <td className="p-4">
                  <div className="flex gap-2 items-center">
                    <select
                      value={hostDateMap[e.enrollment_id] || ''}
                      onChange={(ev) => {
                        const newDate = ev.target.value || null;
                        setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: newDate }));
                        saveHostDate(e.enrollment_id, newDate);
                      }}
                      className="border-2 border-gray-300 rounded px-3 py-2 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600 w-full"
                      aria-label={`Host date for ${e.student?.name}`}
                    >
                      <option value="">-- choose date --</option>
                      {fullDates.map((d) => (
                        <option key={d} value={d}>{new Date(d).toLocaleDateString()}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost text-red-600 hover:bg-red-100 whitespace-nowrap"
                      title="Clear Host Date"
                      onClick={() => {
                        setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: null }));
                        saveHostDate(e.enrollment_id, null);
                      }}
                    >
                      ✕ Clear
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-4">
        {displayedEnrollments.map((e) => (
          <div key={e.enrollment_id} className="border rounded-lg shadow p-4 bg-white hover:shadow-lg transition">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm font-semibold text-gray-600">Student</label>
                <p className="text-base font-medium mt-1">{e.student?.name}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600">Can Host</label>
                <div className="mt-2">
                  <input
                    type="checkbox"
                    checked={!!e.can_host}
                    onChange={(ev) => toggleHost(e.enrollment_id, ev.target.checked)}
                    className="h-5 w-5 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 mb-4">
              <div>
                <label className="text-sm font-semibold text-gray-600">Address</label>
                <p className="text-base mt-1">{e.student?.address || '—'}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600">Phone</label>
                <p className="text-base mt-1">{e.student?.phone || '—'}</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-600">Host Date</label>
              <div className="flex gap-2 items-center mt-2">
                <select
                  value={hostDateMap[e.enrollment_id] || ''}
                  onChange={(ev) => {
                    const newDate = ev.target.value || null;
                    setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: newDate }));
                    saveHostDate(e.enrollment_id, newDate);
                  }}
                  className="border-2 border-gray-300 rounded px-3 py-2 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600 flex-1"
                  aria-label={`Host date for ${e.student?.name}`}
                >
                  <option value="">-- choose date --</option>
                  {fullDates.map((d) => (
                    <option key={d} value={d}>{new Date(d).toLocaleDateString()}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost text-red-600 hover:bg-red-100"
                  title="Clear Host Date"
                  onClick={() => {
                    setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: null }));
                    saveHostDate(e.enrollment_id, null);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BulkScheduleTable;
