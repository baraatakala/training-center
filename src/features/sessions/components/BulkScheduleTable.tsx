import React, { useEffect, useState, useCallback } from 'react';
import { bulkScheduleDataService as supabase } from '@/features/sessions/services/bulkScheduleDataService';
import { Tables } from '@/shared/types/database.types';
import { logDelete } from '@/shared/services/auditService';
import { toast } from '@/shared/components/ui/toastUtils';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { format } from 'date-fns';
import { generateAttendanceDates, type DayChange } from '@/shared/utils/attendanceGenerator';
import type { EnrollmentRow, BulkScheduleTableProps } from '@/features/sessions/constants/bulkScheduleConstants';
import { ExportDialog } from '@/features/sessions/components/ExportDialog';

export const BulkScheduleTable: React.FC<BulkScheduleTableProps> = ({ sessionId, startDate, endDate, day }) => {
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  // all possible session dates (consistent with Attendance page via day-change history)
  const [fullDates, setFullDates] = useState<string[]>([]);
  // host date selection per enrollment
  const [hostDateMap, setHostDateMap] = useState<Record<string, string | null>>({});
  // Dates that already have attendance records (for filtering host date dropdown)
  const [attendedDates, setAttendedDates] = useState<Set<string>>(new Set());
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
  // ConfirmDialog state for cancel/uncancel session
  const [cancelConfirm, setCancelConfirm] = useState<{ date: string } | null>(null);
  const [uncancelConfirm, setUncancelConfirm] = useState<{ date: string } | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  // ConfirmDialog state for assigning a cancelled date
  const [cancelledDateAssign, setCancelledDateAssign] = useState<{ enrollmentId: string; date: string } | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [showRosterDetails, setShowRosterDetails] = useState(true);


  useEffect(() => {
    // Load day-change history and generate dates consistent with Attendance page
    const loadDates = async () => {
      let dayChanges: DayChange[] = [];
      try {
        const { data } = await supabase
          .from('session_day_change')
          .select('old_day, new_day, effective_date')
          .eq('session_id', sessionId)
          .order('effective_date', { ascending: true });
        if (data) dayChanges = data;
      } catch { /* non-critical */ }

      const dates = generateAttendanceDates(
        { session_id: sessionId, start_date: startDate, end_date: endDate, day: day ?? null, time: null, location: null },
        dayChanges
      ).map(d => d.date);
      setFullDates(dates);
      setHostDateMap({});
    };
    loadDates();
  }, [startDate, endDate, day, sessionId]);

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

  // Load dates that already have real attendance records (non-absent, non-cancelled)
  const loadAttendedDates = useCallback(async () => {
    try {
      const { data } = await supabase
        .from(Tables.ATTENDANCE)
        .select('attendance_date')
        .eq('session_id', sessionId)
        .not('status', 'eq', 'absent')
        .not('host_address', 'eq', 'SESSION_NOT_HELD');
      const dates = new Set((data || []).map(d => d.attendance_date));
      setAttendedDates(dates);
    } catch { /* non-critical */ }
  }, [sessionId]);

  const loadEnrollments = useCallback(async () => {
    try {
      // First, load the session to get teacher info
      const { data: sessionData, error: sessionError } = await supabase
        .from(Tables.SESSION)
        .select(`
          teacher_can_host,
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

      // Always show teacher row so admin can toggle can_host on/off
      const teacher = Array.isArray(sessionData?.teacher) ? sessionData?.teacher[0] : sessionData?.teacher;
      if (teacher) {
        // Load teacher's hosting date from teacher_host_schedule table
        let teacherHostDate: string | null = null;
        if (teacher.teacher_id) {
          const { data: teacherHostData } = await supabase
            .from('teacher_host_schedule')
            .select('host_date')
            .eq('teacher_id', teacher.teacher_id)
            .eq('session_id', sessionId)
            .maybeSingle();
          teacherHostDate = teacherHostData?.host_date || null;
        }

        const canHost = sessionData?.teacher_can_host ?? true;
        const hasAddress = !!(teacher.address && teacher.address.trim());
        const teacherRow: EnrollmentRow = {
          enrollment_id: `teacher-${teacher.teacher_id}`,
          student_id: teacher.teacher_id,
          student: {
            name: `ðŸŽ“ ${teacher.name} (Teacher)`,
            address: teacher.address,
            phone: teacher.phone
          },
          can_host: canHost,
          host_date: canHost && hasAddress ? teacherHostDate : null,
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
    loadAttendedDates();
  }, [loadEnrollments, loadCancelledDates, loadAttendedDates]);

  const toggleHost = async (enrollmentId: string, value: boolean) => {
    const enrollment = enrollments.find(e => e.enrollment_id === enrollmentId);
    
    if (enrollment?.is_teacher) {
      const { error } = await supabase
        .from(Tables.SESSION)
        .update({ teacher_can_host: value })
        .eq('session_id', sessionId);

      if (error) {
        console.error('Failed to update teacher_can_host:', error);
        toast.error('Failed to update teacher host availability: ' + error.message);
        loadEnrollments();
        return;
      }

      if (!value) {
        setHostDateMap((prev) => {
          const next = { ...prev };
          delete next[enrollmentId];
          return next;
        });
      }

      toast.success(value ? 'Teacher can host this session.' : 'Teacher hosting disabled for this session.');
      loadEnrollments();
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
  const saveHostDate = async (enrollmentId: string, hostDate: string | null, showErrorToast = true) => {
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
            if (showErrorToast) toast.error('Failed to save teacher hosting date: ' + error.message);
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
            if (showErrorToast) toast.error('Failed to clear teacher hosting date: ' + error.message);
          }
        }
      } catch (err) {
        const error = err as Error;
        console.error('Failed to save teacher host_date:', error.message);
        if (showErrorToast) toast.error('Failed to save teacher hosting date: ' + error.message);
      }
      return;
    }
    
    try {
      const { error } = await supabase.from(Tables.ENROLLMENT).update({ host_date: hostDate }).eq('enrollment_id', enrollmentId);
      if (error) {
        console.error('Failed to save host_date:', error);
        if (showErrorToast) toast.error('Failed to save host date: ' + error.message);
      }
    } catch (err) {
      const error = err as Error;
      console.error('Failed to save host_date:', error.message);
      if (showErrorToast) toast.error('Failed to save host date: ' + error.message);
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
          message: `âš ï¸ Duplicate: ${students.length} hosts on ${format(new Date(date), 'MMM dd, yyyy')} (${students.join(', ')})`
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
        message: `âš ï¸ ${hostsWithoutAddress.length} host(s) missing address: ${hostsWithoutAddress.map(e => e.student?.name).join(', ')}`
      });
    }
    
    // Check for unassigned hosts
    const unassignedHosts = displayedEnrollments.filter(
      e => !hostDateMap[e.enrollment_id]
    );
    if (unassignedHosts.length > 0) {
      issues.push({
        type: 'warning',
        message: `ðŸ“… ${unassignedHosts.length} host(s) without date: ${unassignedHosts.map(e => e.student?.name).join(', ')}`
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
        message: `ðŸ“Š Date Coverage: ${coveredCount}/${totalDates} dates covered â€¢ ${remainingDates} dates still need hosts`
      });
    } else if (remainingDates === 0 && unassignedHosts.length === 0) {
      issues.push({
        type: 'info',
        message: `âœ… Perfect! All ${totalDates} dates are covered`
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
        saveHostDate(e.enrollment_id, next[e.enrollment_id], false);
      });
      return next;
    });
    toast.success(dir > 0 ? 'Shifted all host dates forward.' : 'Shifted all host dates backward.');
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
        saveHostDate(e.enrollment_id, null, false);
      });
      return next;
    });
    toast.success('Cleared all host dates.');
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
          saveHostDate(host.enrollmentId, null, false);
        });
      });
      return next;
    });
    toast.success(`Fixed ${duplicateDates.length} duplicate date(s)`);
  };

  const autoAssignDates = async () => {
    const assignableDates = fullDates.filter(date => !cancelledDates.has(date));
    if (assignableDates.length === 0) {
      toast.warning('No active session dates are available to assign.');
      return;
    }

    const eligibleHosts = displayedEnrollments.filter(enrollment => enrollment.can_host);
    if (eligibleHosts.length === 0) {
      toast.warning('No hosts are enabled for automatic assignment.');
      return;
    }

    setBulkUpdating(true);
    const nextMap: Record<string, string | null> = { ...hostDateMap };
    const updates: Array<Promise<void>> = [];
    let assignedCount = 0;

    eligibleHosts.forEach((host, index) => {
      const assignedDate = index < assignableDates.length ? assignableDates[index] : null;
      nextMap[host.enrollment_id] = assignedDate;
      updates.push(saveHostDate(host.enrollment_id, assignedDate, false));
      if (assignedDate) assignedCount += 1;
    });

    displayedEnrollments
      .filter(enrollment => !eligibleHosts.some(host => host.enrollment_id === enrollment.enrollment_id) && hostDateMap[enrollment.enrollment_id])
      .forEach(enrollment => {
        nextMap[enrollment.enrollment_id] = null;
        updates.push(saveHostDate(enrollment.enrollment_id, null, false));
      });

    setHostDateMap(nextMap);
    await Promise.all(updates);
    setBulkUpdating(false);
    toast.success(`Auto-assigned ${assignedCount} host date${assignedCount === 1 ? '' : 's'}.`);
  };
  
  return (
    <div style={{ width: '80vw', maxWidth: '1100px', margin: '0 auto' }} className="p-6 bg-white dark:bg-gray-900 dark:text-white min-h-screen">
      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        enrollments={displayedEnrollments}
        hostDateMap={hostDateMap}
        sessionId={sessionId}
      />

      <div className="mb-6">
        <h3 className="text-2xl font-bold mb-4">Host Assignment Planner</h3>
        
        {/* Info Banner */}
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <strong>â„¹ï¸ How Rotation Works:</strong> The Attendance page automatically assigns hosts based on the <strong>Host Date</strong> order below. 
            Hosts are assigned in rotation (first host â†’ second host â†’ etc.) excluding cancelled sessions.
            Only <strong>active enrollments</strong> with <strong>Can Host</strong> checked will be included in the rotation.
          </p>
        </div>

        {/* Validation Panel */}
        {showValidation && validationIssues.length > 0 && (
          <div className="mb-4 border dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 flex items-center justify-between">
              <h4 className="font-semibold text-gray-700 dark:text-gray-300">ðŸ“‹ Validation Results</h4>
              <button
                onClick={() => setShowValidation(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
              >
                âœ• Hide
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
              {validationIssues.some(i => i.type === 'error') ? 'âš ï¸ Issues' : 'âœ“ OK'}
            </div>
          </div>
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)] lg:items-end">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Filter Hosts</label>
            <select
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value as 'all' | 'can-host' | 'cannot-host')}
              className="border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-4 py-2.5 text-base font-medium hover:border-blue-500 focus:outline-none focus:border-blue-600 w-full lg:max-w-sm"
            >
              <option value="all">All Students ({enrollments.length})</option>
              <option value="can-host">Can Host ({enrollments.filter(e => e.can_host).length})</option>
              <option value="cannot-host">Cannot Host ({enrollments.filter(e => !e.can_host).length})</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap gap-2 lg:gap-3">
            <button 
              className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white" 
              onClick={() => setShowCalendar(!showCalendar)}
              title="Toggle calendar view"
            >
              ðŸ“… {showCalendar ? 'Hide' : 'Show'} Calendar
            </button>
            <button
              className="btn btn-sm bg-blue-600 hover:bg-blue-700 text-white"
              onClick={autoAssignDates}
              disabled={bulkUpdating}
              title="Automatically assign host dates in order"
            >
              {bulkUpdating ? 'Assigning...' : 'âš¡ Auto Assign'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(-1)} title="Shift all host dates one session earlier">
              â† Previous
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => shiftAll(1)} title="Shift all host dates one session later">
              Next â†’
            </button>
            {validationIssues.some(i => i.type === 'error') && (
              <button 
                className="btn btn-sm bg-orange-600 hover:bg-orange-700 text-white" 
                onClick={quickFix}
                title="Auto-fix duplicate assignments"
              >
                ðŸ”§ Quick Fix
              </button>
            )}
            <button 
              className="btn btn-sm btn-ghost text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30" 
              onClick={clearAll}
              title="Clear all host dates"
            >
              ðŸ—‘ï¸ Clear All
            </button>
          </div>
        </div>


        {/* Calendar View */}
        {showCalendar && (
          <div className="mt-4 border dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">ðŸ“… Calendar Preview</h4>
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
                        {isCancelled ? 'âœ“ Restore' : 'âœ• Cancel'}
                      </button>
                    </div>
                    {isCancelled ? (
                      <div className="text-gray-600 dark:text-gray-400 italic font-semibold">âŒ Session Cancelled</div>
                    ) : hasNone ? (
                      <div className="text-gray-500 dark:text-gray-400 italic">No host assigned</div>
                    ) : (
                      <div className="space-y-1">
                        {hosts.map((host) => (
                          <div 
                            key={host.enrollmentId}
                            className={`flex items-center gap-1 ${hasMultiple ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}
                          >
                            {host.hasAddress ? 'ðŸ ' : 'âš ï¸'}
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
              <span>ðŸ  = Has address</span>
              <span>âš ï¸ = Missing address</span>
              <span className="text-red-600 dark:text-red-400">â— = Duplicate assignment</span>
              <span className="text-gray-500 dark:text-gray-400">â— = No host</span>
              <span className="text-gray-600 dark:text-gray-400">âŒ = Session cancelled</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Host Roster</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage host assignments, addresses, phone numbers, and scheduling per person.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowRosterDetails((value) => !value)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                showRosterDetails 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {showRosterDetails ? 'ðŸ‘ï¸ Hide Roster' : 'ðŸ‘ï¸ Show Roster'}
            </button>
            <button 
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors"
              onClick={() => setShowExportDialog(true)}
            >
              ðŸ“¤ Export
            </button>
          </div>
        </div>

      {/* Desktop Table View */}
      {showRosterDetails && (
      <div className="hidden lg:block overflow-x-auto border dark:border-gray-700 rounded-lg shadow mt-4">
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
                      {isTempEnrollment && <span title="Not enrolled in session" className="text-orange-600">ðŸ‘¤</span>}
                      {!hasAddress && <span title="Missing address" className="text-yellow-600">âš ï¸</span>}
                      {e.student?.name}
                    </div>
                  </td>
                  <td className="p-4 text-base dark:text-gray-300">
                    {e.student?.address || <span className="text-gray-400 dark:text-gray-500 italic">No address</span>}
                  </td>
                  <td className="p-4 text-center text-base dark:text-gray-300">{e.student?.phone || 'â€”'}</td>
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
                        <span className="text-red-600 font-semibold text-xs whitespace-nowrap">âš ï¸ DUPLICATE</span>
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
                        {fullDates
                          .filter((d) => !attendedDates.has(d) || d === assignedDate)
                          .map((d) => {
                          const isCancelled = cancelledDates.has(d);
                          return (
                            <option 
                              key={d} 
                              value={d}
                              style={isCancelled ? { textDecoration: 'line-through', color: '#999' } : {}}
                            >
                              {format(new Date(d), 'MMM dd, yyyy')}{isCancelled ? ' âŒ CANCELLED' : ''}
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
                        âœ• Clear
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Mobile Card View */}
      {showRosterDetails && (
      <div className="lg:hidden space-y-4 mt-4">
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
                <p className="text-base mt-1 dark:text-gray-300">{e.student?.address || 'â€”'}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">Phone</label>
                <p className="text-base mt-1">{e.student?.phone || 'â€”'}</p>
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
                  {fullDates
                    .filter((d) => !attendedDates.has(d) || d === (hostDateMap[e.enrollment_id] || ''))
                    .map((d) => {
                    const isCancelled = cancelledDates.has(d);
                    return (
                      <option 
                        key={d} 
                        value={d}
                        style={isCancelled ? { textDecoration: 'line-through', color: '#999' } : {}}
                      >
                        {format(new Date(d), 'MMM dd, yyyy')}{isCancelled ? ' âŒ CANCELLED' : ''}
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
                  âœ•
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
      </div>

      {/* ConfirmDialog for cancelling a session date */}
      <ConfirmDialog
        isOpen={!!cancelConfirm}
        title="Cancel Session"
        message={cancelConfirm ? `Mark ${format(new Date(cancelConfirm.date), 'MMM dd, yyyy')} as CANCELLED?\n\nThis will:\nâ€¢ Mark all students as EXCUSED for this date\nâ€¢ Set excuse reason to "Session Not Held"\nâ€¢ This date will be excluded from rotation` : ''}
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
