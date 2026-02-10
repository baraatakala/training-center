import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Tables } from '../types/database.types';
import { logDelete } from '../services/auditService';
import { toast } from './ui/toastUtils';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { format } from 'date-fns';

type EnrollmentRow = {
  enrollment_id: string;
  student_id: string;
  student?: { name: string; address?: string | null; phone?: string | null };
  can_host?: boolean | null;
  host_date?: string | null;
  status?: string;
  is_teacher?: boolean; // Flag to identify teacher row
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
  return dates;
}

export const BulkScheduleTable: React.FC<Props> = ({ sessionId, startDate, endDate, day }) => {
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  // all possible session dates (filtered by day)
  const [fullDates, setFullDates] = useState<string[]>(() => getDatesBetween(startDate, endDate, day));
  // host date selection per enrollment
  const [hostDateMap, setHostDateMap] = useState<Record<string, string | null>>({});
  // Validation state
  const [showValidation, setShowValidation] = useState(true);
  // Calendar view state
  const [showCalendar, setShowCalendar] = useState(false);
  // Cancelled dates (marked as SESSION_NOT_HELD)
  const [cancelledDates, setCancelledDates] = useState<Set<string>>(new Set());
  // Host filter state - default to can-host
  const [hostFilter, setHostFilter] = useState<'all' | 'can-host' | 'cannot-host'>('can-host');
  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'csv-arabic' | 'pdf' | 'word' | 'word-arabic'>('csv');
  // ConfirmDialog state for cancel/uncancel session
  const [cancelConfirm, setCancelConfirm] = useState<{ date: string } | null>(null);
  const [uncancelConfirm, setUncancelConfirm] = useState<{ date: string } | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  // ConfirmDialog state for assigning a cancelled date
  const [cancelledDateAssign, setCancelledDateAssign] = useState<{ enrollmentId: string; date: string } | null>(null);
  const [exportFields, setExportFields] = useState({
    studentName: true,
    address: true,
    phone: true,
    canHost: true,
    hostDate: true,
    enrollmentStatus: false,
    studentId: false
  });

  // Export dialog focus trap
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showExportDialog) return;
    previousActiveElement.current = document.activeElement as HTMLElement;
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowExportDialog(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = exportDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      const focusable = exportDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable && focusable.length > 0) focusable[0].focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [showExportDialog]);

  useEffect(() => {
    const all = getDatesBetween(startDate, endDate, day);
    setFullDates(all);
    // reset hostDateMap when dates change
    setHostDateMap({});
  }, [startDate, endDate, day]);

  const loadCancelledDates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(Tables.ATTENDANCE)
        .select('attendance_date')
        .eq('session_id', sessionId)
        .eq('host_address', 'SESSION_NOT_HELD');

      if (error) {
        console.error('Failed to load cancelled dates:', error);
        return;
      }

      const cancelled = new Set(data?.map(d => d.attendance_date) || []);
      setCancelledDates(cancelled);
    } catch (err) {
      const error = err as Error;
      console.error('Exception loading cancelled dates:', error);
    }
  }, [sessionId]);

  const loadEnrollments = useCallback(async () => {
    try {
      // First, load the session to get teacher info
      const { data: sessionData, error: sessionError } = await supabase
        .from(Tables.SESSION)
        .select(`
          teacher_id,
          teacher:teacher_id (
            teacher_id,
            name,
            address,
            phone
          )
        `)
        .eq('session_id', sessionId)
        .single();

      if (sessionError) {
        console.error('Error loading session:', sessionError);
      }
      
      // Load ONLY students who are enrolled in this session
      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from(Tables.ENROLLMENT)
        .select(`
          enrollment_id,
          student_id,
          can_host,
          host_date,
          status,
          student:student_id (
            student_id,
            name,
            address,
            phone
          )
        `)
        .eq('session_id', sessionId)
        .eq('status', 'active');

      if (enrollmentError) {
        console.error('Error loading enrollments:', enrollmentError);
        toast.error('Failed to load enrollments: ' + enrollmentError.message);
        return;
      }

      if (!enrollmentData || enrollmentData.length === 0) {
        setEnrollments([]);
        return;
      }

      type EnrollmentData = {
        enrollment_id: string;
        student_id: string;
        can_host: boolean | null;
        host_date: string | null;
        status: string;
        student: { student_id: string; name: string; address: string | null; phone: string | null } | { student_id: string; name: string; address: string | null; phone: string | null }[];
      };

      // Map enrollments to rows, only include students with addresses
      const rows: EnrollmentRow[] = enrollmentData
        .filter((e: EnrollmentData) => {
          const student = Array.isArray(e.student) ? e.student[0] : e.student;
          return student?.address && student.address.trim() !== '';
        })
        .map((e: EnrollmentData) => {
          const student = Array.isArray(e.student) ? e.student[0] : e.student;
          return {
            enrollment_id: e.enrollment_id,
            student_id: e.student_id,
            student: student,
            can_host: e.can_host ?? false,
            host_date: e.host_date,
            status: e.status
          };
        });

      // Add teacher as potential host if they have an address
      const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
      if (teacher?.address && teacher.address.trim() !== '') {
        // Load teacher's hosting date from teacher_host_schedule table
        const { data: teacherHostData } = await supabase
          .from('teacher_host_schedule')
          .select('host_date')
          .eq('teacher_id', teacher.teacher_id)
          .eq('session_id', sessionId)
          .maybeSingle();

        const teacherRow: EnrollmentRow = {
          enrollment_id: `teacher-${teacher.teacher_id}`,
          student_id: teacher.teacher_id,
          student: {
            name: `🎓 ${teacher.name} (Teacher)`,
            address: teacher.address,
            phone: teacher.phone
          },
          can_host: true, // Teacher always can host
          host_date: teacherHostData?.host_date || null,
          status: 'active',
          is_teacher: true
        };
        rows.unshift(teacherRow); // Add teacher at the beginning
      }

      // Sort students by name (teacher already at top)
      const teacherRows = rows.filter(r => r.is_teacher);
      const studentRows = rows.filter(r => !r.is_teacher);
      studentRows.sort((a, b) => {
        const nameA = a.student?.name || '';
        const nameB = b.student?.name || '';
        return nameA.localeCompare(nameB);
      });

      setEnrollments([...teacherRows, ...studentRows]);

      // initialize hostDateMap from DB host_date values (convert DATE to ISO string yyyy-mm-dd)
      const hd: Record<string, string | null> = {};
      rows.forEach((row) => {
        hd[row.enrollment_id] = row.host_date || null;
      });
      setHostDateMap(hd);
    } catch (err) {
      const error = err as Error;
      console.error('Enrollment load exception:', error);
      toast.error('Error loading enrollments: ' + error.message);
    }
  }, [sessionId]);

  useEffect(() => {
    loadEnrollments();
    loadCancelledDates();
  }, [loadEnrollments, loadCancelledDates]);

  const toggleHost = async (enrollmentId: string, value: boolean) => {
    const enrollment = enrollments.find(e => e.enrollment_id === enrollmentId);
    
    // Prevent toggling teacher hosting status
    if (enrollment?.is_teacher) {
      toast.info('Teacher is always available to host. You cannot change this setting.');
      return;
    }
    
    // Check if this is a temp enrollment (student not enrolled in session yet)
    if (enrollmentId.startsWith('temp-')) {
      toast.warning('This student is not enrolled in this session. Please enroll them first in the Enrollments page.');
      return;
    }
    
    // Only allow toggling can_host for active enrollments
    if (enrollment?.status !== 'active') {
      toast.warning('Can only set hosting for active enrollments');
      return;
    }
    
    setEnrollments((prev) => prev.map((e) => (e.enrollment_id === enrollmentId ? { ...e, can_host: value } : e)));
    
    const { error } = await supabase
      .from(Tables.ENROLLMENT)
      .update({ can_host: value })
      .eq('enrollment_id', enrollmentId)
      .eq('status', 'active'); // Extra safety check
    
    if (error) {
      console.error('Failed to update can_host:', error);
      toast.error('Failed to update hosting status: ' + error.message);
      loadEnrollments(); // Reload to show correct state
    }
  };

  // Save host_date to DB for an enrollment
  const saveHostDate = async (enrollmentId: string, hostDate: string | null) => {
    // Skip if temp enrollment
    if (enrollmentId.startsWith('temp-')) {
      return;
    }
    
    // Handle teacher hosting dates separately
    if (enrollmentId.startsWith('teacher-')) {
      const teacherId = enrollmentId.replace('teacher-', '');
      
      try {
        if (hostDate) {
          // Upsert teacher hosting date
          const { error } = await supabase
            .from('teacher_host_schedule')
            .upsert({
              teacher_id: teacherId,
              session_id: sessionId,
              host_date: hostDate,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'teacher_id,session_id'
            });
          
          if (error) {
            console.error('Failed to save teacher host_date:', error);
          }
        } else {
          // Delete if hostDate is null
          const { error } = await supabase
            .from('teacher_host_schedule')
            .delete()
            .eq('teacher_id', teacherId)
            .eq('session_id', sessionId);
          
          if (error) {
            console.error('Failed to delete teacher host_date:', error);
          }
        }
      } catch (err) {
        const error = err as Error;
        console.error('Failed to save teacher host_date:', error.message);
      }
      return;
    }
    
    try {
      const { error } = await supabase.from(Tables.ENROLLMENT).update({ host_date: hostDate }).eq('enrollment_id', enrollmentId);
      if (error) {
        console.error('Failed to save host_date:', error);
      }
    } catch (err) {
      const error = err as Error;
      console.error('Failed to save host_date:', error.message);
    }
  };

  // Toggle session cancelled status for a specific date
  const toggleSessionCancelled = async (date: string) => {
    const isCancelled = cancelledDates.has(date);
    
    if (!isCancelled) {
      // Show confirm dialog for marking as cancelled
      setCancelConfirm({ date });
    } else {
      // Show confirm dialog for unmarking cancelled
      setUncancelConfirm({ date });
    }
  };

  const executeCancelSession = async (date: string) => {
    try {
      // Get all enrollments for this session
      const { data: enrollments } = await supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id, student_id')
        .eq('session_id', sessionId)
        .eq('status', 'active');
      
      if (!enrollments || enrollments.length === 0) {
        toast.warning('No active enrollments found for this session');
        return;
      }
      
      // Get authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'system';
      
      // Create/update attendance records
      const records = enrollments.map(e => ({
        enrollment_id: e.enrollment_id,
        session_id: sessionId,
        student_id: e.student_id,
        attendance_date: date,
        status: 'excused',
        excuse_reason: 'session not held',
        host_address: 'SESSION_NOT_HELD',
        check_in_time: null,
        marked_by: `${userEmail} - session cancelled`,
        marked_at: new Date().toISOString()
      }));
      
      // Upsert records
      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .upsert(records, { 
          onConflict: 'enrollment_id,attendance_date',
          ignoreDuplicates: false 
        });
      
      if (error) {
        console.error('Failed to mark session as cancelled:', error);
        toast.error('Failed to mark session as cancelled: ' + error.message);
        return;
      }
      
      setCancelledDates(prev => new Set([...prev, date]));
    } catch (err) {
      const error = err as Error;
      console.error('Exception marking session as cancelled:', error);
      toast.error(error.message);
    }
  };

  const executeUncancelSession = async (date: string) => {
    try {
      // Fetch records before deletion for audit log
      const { data: recordsToDelete } = await supabase
        .from(Tables.ATTENDANCE)
        .select('*')
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .eq('host_address', 'SESSION_NOT_HELD');

      // Log each deletion
      if (recordsToDelete && recordsToDelete.length > 0) {
        for (const record of recordsToDelete) {
          await logDelete(
            Tables.ATTENDANCE,
            record.attendance_id,
            record,
            `Unmarked cancelled session for date ${date}`
          );
        }
      }

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .delete()
        .eq('session_id', sessionId)
        .eq('attendance_date', date)
        .eq('host_address', 'SESSION_NOT_HELD');
      
      if (error) {
        console.error('Failed to unmark cancelled session:', error);
        toast.error('Failed to unmark cancelled session: ' + error.message);
        return;
      }
      
      setCancelledDates(prev => {
        const updated = new Set(prev);
        updated.delete(date);
        return updated;
      });
    } catch (err) {
      const error = err as Error;
      console.error('Exception unmarking cancelled session:', error);
      toast.error(error.message);
    }
  };

  const exportCSV = () => {
    const displayedEnrollments = getSortedDisplayedEnrollments();

    // Build header based on selected fields
    const header: string[] = [];
    if (exportFields.studentName) header.push('Student Name');
    if (exportFields.address) header.push('Address');
    if (exportFields.phone) header.push('Phone');
    if (exportFields.canHost) header.push('Can Host');
    if (exportFields.hostDate) header.push('Host Date');
    if (exportFields.enrollmentStatus) header.push('Status');
    if (exportFields.studentId) header.push('Student ID');

    // Build rows based on selected fields
    const rows = displayedEnrollments.map((e) => {
      const row: string[] = [];
      if (exportFields.studentName) row.push(e.student?.name || '');
      if (exportFields.address) row.push(e.student?.address || '');
      if (exportFields.phone) row.push(e.student?.phone || '');
      if (exportFields.canHost) row.push(e.can_host ? 'Yes' : 'No');
      if (exportFields.hostDate) row.push(hostDateMap[e.enrollment_id] || '');
      if (exportFields.enrollmentStatus) row.push(e.status || '');
      if (exportFields.studentId) row.push(e.student_id || '');
      return row;
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

  // Arabic CSV export
  const exportCSVArabic = () => {
    const displayedEnrollments = getSortedDisplayedEnrollments();
    
    // Build Arabic headers based on selected fields
    const header: string[] = [];
    if (exportFields.studentName) header.push('اسم الطالب');
    if (exportFields.address) header.push('العنوان');
    if (exportFields.phone) header.push('الهاتف');
    if (exportFields.canHost) header.push('يمكن الاستضافة');
    if (exportFields.hostDate) header.push('تاريخ الاستضافة');
    if (exportFields.enrollmentStatus) header.push('الحالة');
    if (exportFields.studentId) header.push('رقم الطالب');

    // Build rows based on selected fields
    const rows = displayedEnrollments.map((e) => {
      const row: string[] = [];
      if (exportFields.studentName) row.push(e.student?.name || '');
      if (exportFields.address) row.push(e.student?.address || '');
      if (exportFields.phone) row.push(e.student?.phone || '');
      if (exportFields.canHost) row.push(e.can_host ? 'نعم' : 'لا');
      if (exportFields.hostDate) row.push(hostDateMap[e.enrollment_id] || '');
      if (exportFields.enrollmentStatus) row.push(e.status || '');
      if (exportFields.studentId) row.push(e.student_id || '');
      return row;
    });
    
    // Add UTF-8 BOM for Excel compatibility
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `جدول_الاستضافة_${sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    try {
      const mod = await import('jspdf');
      // attempt to load autotable plugin; capture module if present
      let pluginMod: unknown = null;
      try { pluginMod = await import('jspdf-autotable'); } catch { /* plugin optional */ }
      const jsPDF = (mod as { default?: unknown; jsPDF?: unknown }).default || (mod as { default?: unknown; jsPDF?: unknown }).jsPDF;
      if (!jsPDF) throw new Error('Could not load jsPDF module');
      const displayedEnrollments = getSortedDisplayedEnrollments();

      type JsPDFConstructor = new (orientation: string) => {
        text: (text: string, x: number, y: number, options?: Record<string, unknown>) => void;
        setFontSize: (size: number) => void;
        save: (filename: string) => void;
        autoTable?: (options: Record<string, unknown>) => void;
      };
      const doc = new (jsPDF as unknown as JsPDFConstructor)('l'); // landscape mode for better column fit
      
      // Build table columns based on selected fields
      const tableColumn: string[] = [];
      if (exportFields.studentName) tableColumn.push('Student Name');
      if (exportFields.address) tableColumn.push('Address');
      if (exportFields.phone) tableColumn.push('Phone');
      if (exportFields.canHost) tableColumn.push('Can Host');
      if (exportFields.hostDate) tableColumn.push('Host Date');
      if (exportFields.enrollmentStatus) tableColumn.push('Status');
      if (exportFields.studentId) tableColumn.push('Student ID');

      // Build table rows based on selected fields
      const tableRows = displayedEnrollments.map((e) => {
        const row: string[] = [];
        if (exportFields.studentName) row.push(e.student?.name || '');
        if (exportFields.address) row.push(e.student?.address || '');
        if (exportFields.phone) row.push(e.student?.phone || '');
        if (exportFields.canHost) row.push(e.can_host ? 'Yes' : 'No');
        if (exportFields.hostDate) row.push(hostDateMap[e.enrollment_id] || '');
        if (exportFields.enrollmentStatus) row.push(e.status || '');
        if (exportFields.studentId) row.push(e.student_id || '');
        return row;
      });

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

  const openPrintableFallback = (tableColumn: string[], tableRows: (string | null)[][]) => {
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

  const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const exportWord = async () => {
    try {
      const isArabic = exportFormat === 'word-arabic';
      const displayedEnrollments = getSortedDisplayedEnrollments();

      // Build headers based on selected fields and language
      const headers: string[] = [];
      if (exportFields.studentName) headers.push(isArabic ? 'اسم الطالب' : 'Student Name');
      if (exportFields.address) headers.push(isArabic ? 'العنوان' : 'Address');
      if (exportFields.phone) headers.push(isArabic ? 'الهاتف' : 'Phone');
      if (exportFields.canHost) headers.push(isArabic ? 'يمكنه الاستضافة' : 'Can Host');
      if (exportFields.hostDate) headers.push(isArabic ? 'تاريخ الاستضافة' : 'Host Date');
      if (exportFields.enrollmentStatus) headers.push(isArabic ? 'الحالة' : 'Status');
      if (exportFields.studentId) headers.push(isArabic ? 'معرف الطالب' : 'Student ID');

      // Build rows based on selected fields
      const rows = displayedEnrollments.map((e) => {
        const row: string[] = [];
        if (exportFields.studentName) row.push(e.student?.name || '');
        if (exportFields.address) row.push(e.student?.address || '');
        if (exportFields.phone) row.push(e.student?.phone || '');
        if (exportFields.canHost) row.push(e.can_host ? (isArabic ? 'نعم' : 'Yes') : (isArabic ? 'لا' : 'No'));
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

      const titleText = isArabic ? 'جدول الاستضافة' : 'Host Schedule';

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
      const fileName = isArabic ? `جدول_الاستضافة_${sessionId}.docx` : `host_schedule_${sessionId}.docx`;
      saveAs(blob, fileName);
    } catch (err) {
      const error = err as Error;
      console.error('Word export error:', error);
      toast.error('Failed to export Word: ' + error.message);
    }
  };

  const getSortedDisplayedEnrollments = () => {
    // Apply host filter
    let arr = [...enrollments];
    if (hostFilter === 'can-host') {
      arr = arr.filter((e) => !!e.can_host);
    } else if (hostFilter === 'cannot-host') {
      arr = arr.filter((e) => !e.can_host);
    }
    // Sort by host date, then by name
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

  // Validation logic
  const getValidationIssues = () => {
    const issues: { type: 'error' | 'warning' | 'info'; message: string }[] = [];
    
    // Check for duplicate dates
    const dateCount: Record<string, string[]> = {};
    displayedEnrollments.forEach((e) => {
      const date = hostDateMap[e.enrollment_id];
      if (date) {
        if (!dateCount[date]) dateCount[date] = [];
        dateCount[date].push(e.student?.name || 'Unknown');
      }
    });
    
    Object.entries(dateCount).forEach(([date, students]) => {
      if (students.length > 1) {
        issues.push({
          type: 'error',
          message: `⚠️ Duplicate: ${students.length} hosts on ${format(new Date(date), 'MMM dd, yyyy')} (${students.join(', ')})`
        });
      }
    });
    
    // Check for missing addresses
    const hostsWithoutAddress = displayedEnrollments.filter(
      e => !e.student?.address || e.student.address.trim() === ''
    );
    if (hostsWithoutAddress.length > 0) {
      issues.push({
        type: 'warning',
        message: `⚠️ ${hostsWithoutAddress.length} host(s) missing address: ${hostsWithoutAddress.map(e => e.student?.name).join(', ')}`
      });
    }
    
    // Check for unassigned hosts
    const unassignedHosts = displayedEnrollments.filter(
      e => !hostDateMap[e.enrollment_id]
    );
    if (unassignedHosts.length > 0) {
      issues.push({
        type: 'warning',
        message: `📅 ${unassignedHosts.length} host(s) without date: ${unassignedHosts.map(e => e.student?.name).join(', ')}`
      });
    }
    
    // Check coverage - dates before first assigned date are considered covered
    const assignedDates = new Set(Object.values(hostDateMap).filter(Boolean));
    const assignedDatesArray = Array.from(assignedDates).sort();
    const firstAssignedDate = assignedDatesArray.length > 0 ? assignedDatesArray[0] : null;
    
    let coveredCount = assignedDates.size;
    if (firstAssignedDate) {
      // Count dates before first assignment as covered
      const datesBeforeFirst = fullDates.filter(d => d < firstAssignedDate).length;
      coveredCount += datesBeforeFirst;
    }
    
    const totalDates = fullDates.length;
    const remainingDates = totalDates - coveredCount;
    
    if (remainingDates > 0) {
      issues.push({
        type: 'info',
        message: `📊 Date Coverage: ${coveredCount}/${totalDates} dates covered • ${remainingDates} dates still need hosts`
      });
    } else if (remainingDates === 0 && unassignedHosts.length === 0) {
      issues.push({
        type: 'info',
        message: `✅ Perfect! All ${totalDates} dates are covered`
      });
    }
    
    return issues;
  };

  const validationIssues = getValidationIssues();

  // Get dates grouped by assignment
  const getCalendarView = () => {
    const dateMap: Record<string, { student: string; hasAddress: boolean; enrollmentId: string }[]> = {};
    
    fullDates.forEach(date => {
      dateMap[date] = [];
    });
    
    displayedEnrollments.forEach((e) => {
      const date = hostDateMap[e.enrollment_id];
      if (date && dateMap[date]) {
        dateMap[date].push({
          student: e.student?.name || 'Unknown',
          hasAddress: !!(e.student?.address && e.student.address.trim()),
          enrollmentId: e.enrollment_id
        });
      }
    });
    
    return dateMap;
  };

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

  const clearAll = () => {
    setShowClearAllConfirm(true);
  };

  const doClearAll = () => {
    setShowClearAllConfirm(false);
    setHostDateMap((prev) => {
      const next: Record<string, string | null> = { ...prev };
      displayedEnrollments.forEach((e) => {
        next[e.enrollment_id] = null;
        saveHostDate(e.enrollment_id, null);
      });
      return next;
    });
  };

  const quickFix = () => {
    // Auto-fix: Remove duplicates by keeping first occurrence, clear others
    const calendarView = getCalendarView();
    const duplicateDates = Object.entries(calendarView).filter(([, hosts]) => hosts.length > 1);
    
    if (duplicateDates.length === 0) {
      toast.info('No duplicates found!');
      return;
    }
    
    setHostDateMap((prev) => {
      const next = { ...prev };
      duplicateDates.forEach(([, hosts]) => {
        // Keep first, clear rest
        hosts.slice(1).forEach(host => {
          next[host.enrollmentId] = null;
          saveHostDate(host.enrollmentId, null);
        });
      });
      return next;
    });
    
    toast.success(`Fixed ${duplicateDates.length} duplicate date(s)`);
  };
  
  return (
    <div style={{ width: '80vw', maxWidth: '1100px', margin: '0 auto' }} className="p-6 bg-white dark:bg-gray-900 dark:text-white min-h-screen">
      {/* Export Dialog Modal */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Export Host Schedule" ref={exportDialogRef}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-6 border-b dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-700">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                📤 Export Host Schedule
              </h3>
              <button
                onClick={() => setShowExportDialog(false)}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Modal Body - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Format Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export Format</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'csv' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <input
                      type="radio"
                      name="format"
                      value="csv"
                      checked={exportFormat === 'csv'}
                      onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                      className="mr-3 text-blue-600"
                    />
                    <span className="text-sm font-medium dark:text-gray-200">📊 CSV (English)</span>
                  </label>
                  <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'csv-arabic' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <input
                      type="radio"
                      name="format"
                      value="csv-arabic"
                      checked={exportFormat === 'csv-arabic'}
                      onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                      className="mr-3 text-blue-600"
                    />
                    <span className="text-sm font-medium dark:text-gray-200">📊 CSV (عربي)</span>
                  </label>
                  <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'pdf' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <input
                      type="radio"
                      name="format"
                      value="pdf"
                      checked={exportFormat === 'pdf'}
                      onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                      className="mr-3 text-blue-600"
                    />
                    <span className="text-sm font-medium dark:text-gray-200">📄 PDF</span>
                  </label>
                  <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${exportFormat === 'word' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <input
                      type="radio"
                      name="format"
                      value="word"
                      checked={exportFormat === 'word'}
                      onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                      className="mr-3 text-blue-600"
                    />
                    <span className="text-sm font-medium dark:text-gray-200">📝 Word (English)</span>
                  </label>
                  <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all sm:col-span-2 ${exportFormat === 'word-arabic' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <input
                      type="radio"
                      name="format"
                      value="word-arabic"
                      checked={exportFormat === 'word-arabic'}
                      onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                      className="mr-3 text-blue-600"
                    />
                    <span className="text-sm font-medium dark:text-gray-200">📝 Word (عربي)</span>
                  </label>
                </div>
              </div>

              {/* Field Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Select Fields to Export</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-700/50">
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.studentName}
                      onChange={(e) => setExportFields({ ...exportFields, studentName: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">👤 Student Name</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.address}
                      onChange={(e) => setExportFields({ ...exportFields, address: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">📍 Address</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.phone}
                      onChange={(e) => setExportFields({ ...exportFields, phone: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">📱 Phone</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.canHost}
                      onChange={(e) => setExportFields({ ...exportFields, canHost: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">🏠 Can Host</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.hostDate}
                      onChange={(e) => setExportFields({ ...exportFields, hostDate: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">📅 Host Date</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={exportFields.enrollmentStatus}
                      onChange={(e) => setExportFields({ ...exportFields, enrollmentStatus: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">✓ Status</span>
                  </label>
                  <label className="flex items-center p-2 hover:bg-white dark:hover:bg-gray-700 rounded cursor-pointer transition-colors sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={exportFields.studentId}
                      onChange={(e) => setExportFields({ ...exportFields, studentId: e.target.checked })}
                      className="mr-3 rounded text-blue-600"
                    />
                    <span className="text-sm dark:text-gray-200">🆔 Student ID</span>
                  </label>
                </div>
              </div>

              {/* Preview */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                <div className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Preview:</div>
                <div className="text-sm text-blue-700 dark:text-blue-400">
                  {Object.values(exportFields).filter(Boolean).length} field(s) selected for {displayedEnrollments.length} student(s)
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowExportDialog(false)}
                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 font-semibold transition-colors order-2 sm:order-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (Object.values(exportFields).every(v => !v)) {
                    toast.warning('Please select at least one field to export');
                    return;
                  }
                  setShowExportDialog(false);
                  if (exportFormat === 'csv') exportCSV();
                  else if (exportFormat === 'csv-arabic') exportCSVArabic();
                  else if (exportFormat === 'pdf') exportPDF();
                  else if (exportFormat === 'word' || exportFormat === 'word-arabic') exportWord();
                }}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors flex items-center justify-center gap-2 order-1 sm:order-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export Data
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-4">Host Schedule Setup</h3>
        
        {/* Info Banner */}
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <strong>ℹ️ How Rotation Works:</strong> The Attendance page automatically assigns hosts based on the <strong>Host Date</strong> order below. 
            Hosts are assigned in rotation (first host → second host → etc.) excluding cancelled sessions.
            Only <strong>active enrollments</strong> with <strong>Can Host</strong> checked will be included in the rotation.
          </p>
        </div>

        {/* Validation Panel */}
        {showValidation && validationIssues.length > 0 && (
          <div className="mb-4 border dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 flex items-center justify-between">
              <h4 className="font-semibold text-gray-700 dark:text-gray-300">📋 Validation Results</h4>
              <button
                onClick={() => setShowValidation(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
              >
                ✕ Hide
              </button>
            </div>
            <div className="p-3 space-y-2">
              {validationIssues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded text-sm ${
                    issue.type === 'error'
                      ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700/50'
                      : issue.type === 'warning'
                      ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700/50'
                      : 'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50'
                  }`}
                >
                  {issue.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {!showValidation && validationIssues.length > 0 && (
          <button
            onClick={() => setShowValidation(true)}
            className="mb-4 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          >
            Show Validation ({validationIssues.length} issue{validationIssues.length !== 1 ? 's' : ''})
          </button>
        )}
        
        {/* Statistics Panel */}
        <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-lg p-3">
            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase">Total Dates</div>
            <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{fullDates.length}</div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700/50 rounded-lg p-3">
            <div className="text-xs text-green-600 dark:text-green-400 font-semibold uppercase">Active Hosts</div>
            <div className="text-2xl font-bold text-green-900 dark:text-green-100">{displayedEnrollments.length}</div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700/50 rounded-lg p-3">
            <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold uppercase">Assigned</div>
            <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
              {displayedEnrollments.filter(e => hostDateMap[e.enrollment_id]).length}
            </div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700/50 rounded-lg p-3">
            <div className="text-xs text-yellow-600 dark:text-yellow-400 font-semibold uppercase">Coverage</div>
            <div className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">
              {fullDates.length > 0 
                ? Math.round((new Set(Object.values(hostDateMap).filter(Boolean)).size / fullDates.length) * 100)
                : 0}%
            </div>
          </div>
          <div className={`border rounded-lg p-3 ${
            validationIssues.some(i => i.type === 'error')
              ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700/50'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            <div className={`text-xs font-semibold uppercase ${
              validationIssues.some(i => i.type === 'error') ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'
            }`}>
              Status
            </div>
            <div className={`text-2xl font-bold ${
              validationIssues.some(i => i.type === 'error')
                ? 'text-red-900 dark:text-red-100'
                : 'text-gray-900 dark:text-gray-100'
            }`}>
              {validationIssues.some(i => i.type === 'error') ? '⚠️ Issues' : '✓ OK'}
            </div>
          </div>
        </div>

        {/* Filter Dropdown */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter by Host Status:</label>
          <select
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value as 'all' | 'can-host' | 'cannot-host')}
            className="border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-4 py-2 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600"
          >
            <option value="all">All Students ({enrollments.length})</option>
            <option value="can-host">Can Host ({enrollments.filter(e => e.can_host).length})</option>
            <option value="cannot-host">Cannot Host ({enrollments.filter(e => !e.can_host).length})</option>
          </select>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap gap-2 lg:gap-3">
            <button 
              className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white" 
              onClick={() => setShowCalendar(!showCalendar)}
              title="Toggle calendar view"
            >
              📅 {showCalendar ? 'Hide' : 'Show'} Calendar
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(-1)} title="Shift all host dates one session earlier">
              ← Previous
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(1)} title="Shift all host dates one session later">
              Next →
            </button>
            {validationIssues.some(i => i.type === 'error') && (
              <button 
                className="btn btn-sm bg-orange-600 hover:bg-orange-700 text-white" 
                onClick={quickFix}
                title="Auto-fix duplicate assignments"
              >
                🔧 Quick Fix
              </button>
            )}
            <button 
              className="btn btn-sm btn-ghost text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30" 
              onClick={clearAll}
              title="Clear all host dates"
            >
              🗑️ Clear All
            </button>
          </div>
          
          {/* Export Button */}
          <button 
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
            onClick={() => setShowExportDialog(true)}
          >
            <span>📤</span>
            <span>Export Data</span>
          </button>
        </div>

        {/* Calendar View */}
        {showCalendar && (
          <div className="mt-4 border dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">📅 Calendar Preview</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
              {fullDates.map((date) => {
                const calendarView = getCalendarView();
                const hosts = calendarView[date] || [];
                const hasMultiple = hosts.length > 1;
                const hasNone = hosts.length === 0;
                const isCancelled = cancelledDates.has(date);
                
                return (
                  <div
                    key={date}
                    className={`p-2 rounded border text-sm ${
                      isCancelled
                        ? 'bg-gray-200 dark:bg-gray-700 border-gray-400 dark:border-gray-600 opacity-75'
                        : hasMultiple
                        ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700/50'
                        : hasNone
                        ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                        : 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className={`font-semibold ${isCancelled ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-700 dark:text-gray-300'}`}>
                        {format(new Date(date), 'EEE, MMM d')}
                      </div>
                      <button
                        onClick={() => toggleSessionCancelled(date)}
                        className={`text-xs px-2 py-0.5 rounded transition ${
                          isCancelled
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                        }`}
                        title={isCancelled ? 'Unmark as cancelled' : 'Mark as cancelled'}
                      >
                        {isCancelled ? '✓ Restore' : '✕ Cancel'}
                      </button>
                    </div>
                    {isCancelled ? (
                      <div className="text-gray-600 dark:text-gray-400 italic font-semibold">❌ Session Cancelled</div>
                    ) : hasNone ? (
                      <div className="text-gray-500 dark:text-gray-400 italic">No host assigned</div>
                    ) : (
                      <div className="space-y-1">
                        {hosts.map((host) => (
                          <div 
                            key={host.enrollmentId}
                            className={`flex items-center gap-1 ${hasMultiple ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}
                          >
                            {host.hasAddress ? '🏠' : '⚠️'}
                            <span className={hasMultiple ? 'font-semibold' : ''}>{host.student}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-4">
              <span>🏠 = Has address</span>
              <span>⚠️ = Missing address</span>
              <span className="text-red-600 dark:text-red-400">● = Duplicate assignment</span>
              <span className="text-gray-500 dark:text-gray-400">● = No host</span>
              <span className="text-gray-600 dark:text-gray-400">❌ = Session cancelled</span>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto border dark:border-gray-700 rounded-lg shadow">
        <table className="w-full border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="p-4 text-left font-semibold text-base min-w-[150px] dark:text-gray-200">Student</th>
              <th className="p-4 text-left font-semibold text-base min-w-[200px] dark:text-gray-200">Address</th>
              <th className="p-4 text-center font-semibold text-base min-w-[140px] dark:text-gray-200">Phone</th>
              <th className="p-4 text-center font-semibold text-base min-w-[100px] dark:text-gray-200">Can Host</th>
              <th className="p-4 text-left font-semibold text-base min-w-[220px] dark:text-gray-200">Host Date</th>
            </tr>
          </thead>
          <tbody>
            {displayedEnrollments.map((e) => {
              const assignedDate = hostDateMap[e.enrollment_id];
              const hasAddress = !!(e.student?.address && e.student.address.trim());
              const isUnassigned = !assignedDate;
              const isTempEnrollment = e.enrollment_id.startsWith('temp-');
              
              // Check if this date is assigned to multiple hosts
              const calendarView = getCalendarView();
              const isDuplicate = assignedDate && calendarView[assignedDate]?.length > 1;
              
              return (
                <tr 
                  key={e.enrollment_id} 
                  className={`border-b dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition ${
                    isTempEnrollment ? 'bg-gray-100 dark:bg-gray-800' : isDuplicate ? 'bg-red-50 dark:bg-red-900/20' : isUnassigned ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
                  }`}
                >
                  <td className="p-4 text-base font-medium">
                    <div className="flex items-center gap-2">
                      {isTempEnrollment && <span title="Not enrolled in session" className="text-orange-600">👤</span>}
                      {!hasAddress && <span title="Missing address" className="text-yellow-600">⚠️</span>}
                      {e.student?.name}
                    </div>
                  </td>
                  <td className="p-4 text-base dark:text-gray-300">
                    {e.student?.address || <span className="text-gray-400 dark:text-gray-500 italic">No address</span>}
                  </td>
                  <td className="p-4 text-center text-base dark:text-gray-300">{e.student?.phone || '—'}</td>
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
                      {isDuplicate && (
                        <span className="text-red-600 font-semibold text-xs whitespace-nowrap">⚠️ DUPLICATE</span>
                      )}
                      <select
                        value={assignedDate || ''}
                        onChange={(ev) => {
                          const newDate = ev.target.value || null;
                          if (e.enrollment_id.startsWith('temp-')) {
                            toast.warning('This student is not enrolled in this session. Please enroll them first.');
                            return;
                          }
                          if (newDate && cancelledDates.has(newDate)) {
                            setCancelledDateAssign({ enrollmentId: e.enrollment_id, date: newDate });
                            return;
                          }
                          setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: newDate }));
                          saveHostDate(e.enrollment_id, newDate);
                        }}
                        className={`border-2 rounded px-3 py-2 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600 w-full dark:bg-gray-700 dark:text-white ${
                          isDuplicate ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                        }`}
                        aria-label={`Host date for ${e.student?.name}`}
                      >
                        <option value="">-- choose date --</option>
                        {fullDates.map((d) => {
                          const isCancelled = cancelledDates.has(d);
                          return (
                            <option 
                              key={d} 
                              value={d}
                              style={isCancelled ? { textDecoration: 'line-through', color: '#999' } : {}}
                            >
                              {format(new Date(d), 'MMM dd, yyyy')}{isCancelled ? ' ❌ CANCELLED' : ''}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 whitespace-nowrap"
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-4">
        {displayedEnrollments.map((e) => (
          <div key={e.enrollment_id} className="border dark:border-gray-700 rounded-lg shadow p-4 bg-white dark:bg-gray-800 hover:shadow-lg transition">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Student</label>
                <p className="text-base font-medium mt-1">{e.student?.name}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Can Host</label>
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
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Address</label>
                <p className="text-base mt-1 dark:text-gray-300">{e.student?.address || '—'}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Phone</label>
                <p className="text-base mt-1">{e.student?.phone || '—'}</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Host Date</label>
              <div className="flex gap-2 items-center mt-2">
                <select
                  value={hostDateMap[e.enrollment_id] || ''}
                  onChange={(ev) => {
                    const newDate = ev.target.value || null;
                    if (e.enrollment_id.startsWith('temp-')) {
                      toast.warning('This student is not enrolled in this session. Please enroll them first.');
                      return;
                    }
                    if (newDate && cancelledDates.has(newDate)) {
                      setCancelledDateAssign({ enrollmentId: e.enrollment_id, date: newDate });
                      return;
                    }
                    setHostDateMap((prev) => ({ ...prev, [e.enrollment_id]: newDate }));
                    saveHostDate(e.enrollment_id, newDate);
                  }}
                  className="border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-3 py-2 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600 flex-1"
                  aria-label={`Host date for ${e.student?.name}`}
                >
                  <option value="">-- choose date --</option>
                  {fullDates.map((d) => {
                    const isCancelled = cancelledDates.has(d);
                    return (
                      <option 
                        key={d} 
                        value={d}
                        style={isCancelled ? { textDecoration: 'line-through', color: '#999' } : {}}
                      >
                        {format(new Date(d), 'MMM dd, yyyy')}{isCancelled ? ' ❌ CANCELLED' : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
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

      {/* ConfirmDialog for cancelling a session date */}
      <ConfirmDialog
        isOpen={!!cancelConfirm}
        title="Cancel Session"
        message={cancelConfirm ? `Mark ${format(new Date(cancelConfirm.date), 'MMM dd, yyyy')} as CANCELLED?\n\nThis will:\n• Mark all students as EXCUSED for this date\n• Set excuse reason to "Session Not Held"\n• This date will be excluded from rotation` : ''}
        confirmText="Mark Cancelled"
        cancelText="Cancel"
        type="warning"
        onConfirm={() => {
          if (cancelConfirm) executeCancelSession(cancelConfirm.date);
          setCancelConfirm(null);
        }}
        onCancel={() => setCancelConfirm(null)}
      />

      {/* ConfirmDialog for unmarking a cancelled session date */}
      <ConfirmDialog
        isOpen={!!uncancelConfirm}
        title="Unmark Cancelled Session"
        message={uncancelConfirm ? `Unmark ${format(new Date(uncancelConfirm.date), 'MMM dd, yyyy')} as cancelled?\n\nThis will delete all attendance records for this date.` : ''}
        confirmText="Unmark"
        cancelText="Cancel"
        type="danger"
        onConfirm={() => {
          if (uncancelConfirm) executeUncancelSession(uncancelConfirm.date);
          setUncancelConfirm(null);
        }}
        onCancel={() => setUncancelConfirm(null)}
      />

      {/* ConfirmDialog for assigning a cancelled date to a host */}
      <ConfirmDialog
        isOpen={!!cancelledDateAssign}
        title="Assign Cancelled Date"
        message={cancelledDateAssign ? `${format(new Date(cancelledDateAssign.date), 'MMM dd, yyyy')} is marked as CANCELLED. Assign anyway?` : ''}
        confirmText="Assign"
        cancelText="Cancel"
        type="warning"
        onConfirm={() => {
          if (cancelledDateAssign) {
            setHostDateMap((prev) => ({ ...prev, [cancelledDateAssign.enrollmentId]: cancelledDateAssign.date }));
            saveHostDate(cancelledDateAssign.enrollmentId, cancelledDateAssign.date);
          }
          setCancelledDateAssign(null);
        }}
        onCancel={() => setCancelledDateAssign(null)}
      />

      {/* ConfirmDialog for clearing all host assignments */}
      <ConfirmDialog
        isOpen={showClearAllConfirm}
        title="Clear All Assignments"
        message="Clear all host date assignments? This cannot be undone."
        confirmText="Clear All"
        cancelText="Cancel"
        type="danger"
        onConfirm={doClearAll}
        onCancel={() => setShowClearAllConfirm(false)}
      />
    </div>
  );
};

export default BulkScheduleTable;
