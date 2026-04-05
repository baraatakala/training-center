import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { toast } from '@/shared/components/ui/toastUtils';
import {
  excuseRequestService,
  EXCUSE_REASONS,
  type CreateExcuseRequest,
} from '@/features/excuses/services/excuseRequestService';

export function CreateRequestModal({
  onClose,
  onCreated,
  userEmail,
}: {
  onClose: () => void;
  onCreated: () => void;
  userEmail: string;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Select session + date
  const [sessions, setSessions] = useState<Array<{
    session_id: string;
    course_name: string;
    day: string | null;
    time: string | null;
  }>>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [attendanceDate, setAttendanceDate] = useState('');

  // Step 2: Reason + details
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [document, setDocument] = useState<File | null>(null);

  // Student ID from Supabase
  const [studentId, setStudentId] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);

  // Actual scheduled dates for the selected session (accounts for day changes)
  const [sessionDates, setSessionDates] = useState<Set<string>>(new Set());
  const [loadingDates, setLoadingDates] = useState(false);

  // Attendance status check for selected session + date
  const [attendanceStatus, setAttendanceStatus] = useState<{ status: string; excuse_reason: string | null } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Check attendance status when session + date are selected
  useEffect(() => {
    if (!studentId || !selectedSession || !attendanceDate) {
      setAttendanceStatus(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      setCheckingStatus(true);
      try {
        const result = await excuseRequestService.checkAttendanceStatus(studentId, selectedSession, attendanceDate);
        if (!cancelled) setAttendanceStatus(result);
      } catch {
        if (!cancelled) setAttendanceStatus(null);
      } finally {
        if (!cancelled) setCheckingStatus(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [studentId, selectedSession, attendanceDate]);

  // Fetch actual session dates when session changes — accounts for session_day_change
  useEffect(() => {
    if (!selectedSession) {
      setSessionDates(new Set());
      setAttendanceDate('');
      return;
    }
    let cancelled = false;
    const fetchDates = async () => {
      setLoadingDates(true);
      try {
        const { dates, error } = await excuseRequestService.getSessionDates(selectedSession);
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch session dates:', error);
          setSessionDates(new Set());
          return;
        }
        setSessionDates(dates);

        // Auto-fill: pick the nearest date (today or future) from the actual set
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const sorted = [...dates].sort();
        const nearest = sorted.find(d => d >= todayStr) || sorted[sorted.length - 1];
        if (nearest) setAttendanceDate(nearest);
      } finally {
        if (!cancelled) setLoadingDates(false);
      }
    };
    fetchDates();
    return () => { cancelled = true; };
  }, [selectedSession]);

  const isScheduledSessionDate = useCallback((dateStr: string) => {
    return sessionDates.has(dateStr);
  }, [sessionDates]);

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Reset calendar month when attendance date changes via auto-fill
  useEffect(() => {
    if (attendanceDate) {
      const d = new Date(attendanceDate + 'T00:00:00');
      setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
    }
  }, [attendanceDate]);

  useEffect(() => {
    const loadStudentSessions = async () => {
      setLoadingSessions(true);
      try {
        const { studentId: loadedStudentId, sessions: sessionList, error } = await excuseRequestService.getStudentSessionsByEmail(userEmail);

        if (error || !loadedStudentId) {
          toast.error(error ? `Failed to load profile: ${error.message}` : 'Student profile not found');
          onClose();
          return;
        }
        setStudentId(loadedStudentId);
        setSessions(sessionList);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load your sessions');
      } finally {
        setLoadingSessions(false);
      }
    };

    loadStudentSessions();
  }, [userEmail, onClose]);

  const handleSubmit = async () => {
    if (!selectedSession || !attendanceDate || !reason) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!isScheduledSessionDate(attendanceDate)) {
      toast.error('You can only submit an excuse for the scheduled session day');
      return;
    }

    setSubmitting(true);
    try {
      let docUrl: string | undefined;
      let docName: string | undefined;

      // Upload document if provided
      if (document) {
        const { url, error: uploadErr } = await excuseRequestService.uploadDocument(document, studentId);
        if (uploadErr) {
          toast.warning('Document upload failed, but request will be submitted without it');
        } else if (url) {
          docUrl = url;
          docName = document.name;
        }
      }

      const payload: CreateExcuseRequest = {
        student_id: studentId,
        session_id: selectedSession,
        attendance_date: attendanceDate,
        reason,
        description: description.trim() || undefined,
        supporting_doc_url: docUrl,
        supporting_doc_name: docName,
      };

      const { error } = await excuseRequestService.create(payload);
      if (error) {
        toast.error(error.message || 'Failed to submit request');
      } else {
        toast.success('Excuse request submitted successfully');
        onCreated();
      }
    } catch (err) {
      console.error(err);
      toast.error('Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Submit Excuse Request" size="lg">
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${step === 1 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">1</span>
            Session & Date
          </div>
          <div className="w-8 h-px bg-gray-300 dark:bg-gray-600" />
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${step === 2 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">2</span>
            Reason & Details
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {loadingSessions ? (
              <div className="py-8 text-center text-gray-400">Loading your sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-3xl mb-2">📭</div>
                <p className="text-gray-500 dark:text-gray-400">No active enrollments found.</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Session / Course <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedSession}
                    onChange={e => setSelectedSession(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a session...</option>
                    {sessions.map(s => (
                      <option key={s.session_id} value={s.session_id}>
                        {s.course_name} {s.day ? `(${s.day})` : ''} {s.time ? `@ ${s.time}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Absence Date <span className="text-red-500">*</span>
                  </label>

                  {/* Custom Calendar */}
                  {loadingDates ? (
                    <div className="py-6 text-center text-gray-400 text-sm">Loading session dates...</div>
                  ) : (() => {
                    const { year, month } = calendarMonth;
                    const firstDay = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const monthName = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
                    const today = new Date();
                    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                    const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

                    const cells: Array<{ day: number; dateStr: string; isSessionDay: boolean; isToday: boolean; isSelected: boolean; isPast: boolean }> = [];
                    for (let d = 1; d <= daysInMonth; d++) {
                      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      cells.push({
                        day: d,
                        dateStr: ds,
                        isSessionDay: sessionDates.has(ds),
                        isToday: ds === todayStr,
                        isSelected: ds === attendanceDate,
                        isPast: new Date(year, month, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate()),
                      });
                    }

                    // Determine which weekday columns have at least one session date in this month
                    const activeWeekdayCols = new Set<number>();
                    for (const c of cells) {
                      if (c.isSessionDay) {
                        activeWeekdayCols.add(new Date(c.dateStr + 'T00:00:00').getDay());
                      }
                    }

                    return (
                      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                        {/* Month Navigation */}
                        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500">
                          <button
                            type="button"
                            onClick={() => setCalendarMonth(prev => {
                              const d = new Date(prev.year, prev.month - 1);
                              return { year: d.getFullYear(), month: d.getMonth() };
                            })}
                            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                          </button>
                          <span className="text-sm font-bold text-white">{monthName}</span>
                          <button
                            type="button"
                            onClick={() => setCalendarMonth(prev => {
                              const d = new Date(prev.year, prev.month + 1);
                              return { year: d.getFullYear(), month: d.getMonth() };
                            })}
                            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        </div>

                        {/* Day Headers */}
                        <div className="grid grid-cols-7 text-center">
                          {dayLabels.map((dl, i) => (
                            <div key={dl} className={`py-2 text-[11px] font-semibold uppercase tracking-wider ${
                              activeWeekdayCols.has(i)
                                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                : 'text-gray-400 dark:text-gray-500'
                            }`}>{dl}</div>
                          ))}
                        </div>

                        {/* Date Grid */}
                        <div className="grid grid-cols-7 text-center gap-px bg-gray-100 dark:bg-gray-700/30 p-1">
                          {/* Empty cells for offset */}
                          {Array.from({ length: firstDay }).map((_, i) => (
                            <div key={`empty-${i}`} className="h-9" />
                          ))}
                          {/* Day cells */}
                          {cells.map(({ day, dateStr, isSessionDay, isToday, isSelected }) => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => isSessionDay && setAttendanceDate(dateStr)}
                              disabled={!isSessionDay}
                              className={`h-9 w-full rounded-lg text-sm font-medium relative transition-all ${
                                isSelected
                                  ? 'bg-blue-600 text-white shadow-md scale-105 ring-2 ring-blue-300 dark:ring-blue-500'
                                  : isToday
                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold ring-1 ring-indigo-300 dark:ring-indigo-600'
                                    : isSessionDay
                                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 font-semibold'
                                      : 'text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-gray-800 cursor-not-allowed opacity-60'
                              }`}
                            >
                              {day}
                              {isSessionDay && !isSelected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                              )}
                              {isToday && !isSelected && (
                                <span className="absolute top-0.5 right-1 text-[8px]">●</span>
                              )}
                            </button>
                          ))}
                        </div>

                        {/* Legend */}
                        <div className="flex items-center justify-center gap-4 px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Session Day</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 ring-1 ring-indigo-300" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Today</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400">Selected</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Only actual scheduled session dates (accounting for schedule changes) can be selected.</p>
                </div>

                {/* Attendance Status Indicator */}
                {selectedSession && attendanceDate && (
                  <div className="rounded-lg border p-3 text-sm">
                    {checkingStatus ? (
                      <span className="text-gray-400">Checking attendance status...</span>
                    ) : attendanceStatus ? (
                      attendanceStatus.status === 'excused' ? (
                        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                          <span>ℹ️</span>
                          <span>Your attendance is already marked as <strong>excused</strong>{attendanceStatus.excuse_reason ? ` (${attendanceStatus.excuse_reason})` : ''}. No request needed.</span>
                        </div>
                      ) : attendanceStatus.status === 'on time' ? (
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                          <span>✅</span>
                          <span>You are marked as <strong>present (on time)</strong> for this date.</span>
                        </div>
                      ) : attendanceStatus.status === 'late' ? (
                        <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2">
                          <span>⚡</span>
                          <span>You are marked as <strong>late</strong> for this date.</span>
                        </div>
                      ) : attendanceStatus.status === 'absent' ? (
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                          <span>❗</span>
                          <span>You are marked as <strong>absent</strong> — submitting an excuse may change this to excused.</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <span>📝</span>
                          <span>Current status: <strong>{attendanceStatus.status}</strong></span>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                        <span>📝</span>
                        <span>No attendance record yet for this date.</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!selectedSession || !attendanceDate || !isScheduledSessionDate(attendanceDate) || attendanceStatus?.status === 'excused'}
              >
                Next →
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reason <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXCUSE_REASONS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-sm transition-all
                      ${reason === r.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                  >
                    <span className="text-lg">{r.icon}</span>
                    <span className="font-medium">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Additional Details
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Provide any additional details about your absence..."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Supporting Document (optional)
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 10 * 1024 * 1024) {
                    toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`);
                    e.target.value = '';
                    setDocument(null);
                    return;
                  }
                  setDocument(file || null);
                }}
                className="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/20 dark:file:text-blue-300 hover:file:bg-blue-100"
              />
              {document && (
                <p className="text-xs text-gray-400 mt-1">📎 {document.name} ({(document.size / 1024).toFixed(1)} KB)</p>
              )}
              <p className="text-xs text-gray-400 mt-1">Max 10MB. Accepted: PDF, images, Office docs</p>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={!reason || submitting}>
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting...
                    </span>
                  ) : '📤 Submit Request'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
