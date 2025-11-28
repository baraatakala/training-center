import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { supabase } from '../lib/supabase';
import { Tables, type Session } from '../types/database.types';
import { format } from 'date-fns';
import { getAttendanceDateOptions } from '../utils/attendanceGenerator';

type AttendanceRecord = {
  attendance_id: string;
  enrollment_id: string;
  student_id: string;
  status: string;
  check_in_time: string | null;
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  attendance_date: string;
  student: {
    student_id: string;
    name: string;
    email: string;
  };
};

export function Attendance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const passedDate = (location.state as { selectedDate?: string })?.selectedDate;
  const [session, setSession] = useState<Session | null>(null);
  const [availableDates, setAvailableDates] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedDate, setSelectedDate] = useState<string>(passedDate || '');
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  // GPS Geolocation capture function
  const captureGPSLocation = (): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  } | null> => {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        console.warn('Geolocation is not supported by this browser');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString()
          });
        },
        (error) => {
          console.error('Error getting location:', error.message);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  };

  const loadSession = useCallback(async () => {
    if (!sessionId) return;

    const { data } = await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name)
      `)
      .eq('session_id', sessionId)
      .single();

    if (data) {
      setSession(data);
      
      // Generate attendance dates based on session schedule
      const dates = getAttendanceDateOptions(data);
      setAvailableDates(dates);
      
      // If a date was passed via navigation, use it; otherwise select the date nearest to today
      if (!passedDate) {
        const today = new Date();
        // Find the available date with the smallest absolute difference to today
        let nearest = dates[0]?.value || '';
        let minDiff = Number.POSITIVE_INFINITY;
        for (const d of dates) {
          try {
            const dt = new Date(d.value + 'T00:00:00');
            const diff = Math.abs(dt.getTime() - today.getTime());
            if (diff < minDiff) {
              minDiff = diff;
              nearest = d.value;
            }
          } catch (e) {
            // ignore parse errors
          }
        }
        setSelectedDate(nearest);
      }
      // If passedDate exists, it's already set in the initial state
    }
    setLoading(false);
  }, [sessionId, passedDate]);

  const loadAttendance = useCallback(async () => {
    if (!sessionId || !selectedDate) return;

    // Get all enrollments for this session
    const { data: enrollments } = await supabase
      .from(Tables.ENROLLMENT)
      .select(`
        enrollment_id,
        student_id,
        student:student_id(student_id, name, email)
      `)
      .eq('session_id', sessionId)
      .eq('status', 'active');

    if (!enrollments || enrollments.length === 0) {
      setAttendance([]);
      return;
    }

    // Check existing attendance records for this date
    const { data: existingAttendance } = await supabase
      .from(Tables.ATTENDANCE)
      .select(`
        attendance_id,
        status,
        check_in_time,
        notes,
        gps_latitude,
        gps_longitude,
        gps_accuracy,
        attendance_date,
        student_id,
        student:student_id(student_id, name, email)
      `)
      .eq('session_id', sessionId)
      .eq('attendance_date', selectedDate);

    // Build attendance list: combine enrollments with existing records
    const attendanceList = enrollments.map((enrollment: any) => {
      const existingRecord = existingAttendance?.find(
        (a: any) => a.student_id === enrollment.student_id
      );

      if (existingRecord) {
        // Return existing attendance record
        return {
          ...existingRecord,
          student: Array.isArray(existingRecord.student) 
            ? existingRecord.student[0] 
            : existingRecord.student,
          enrollment_id: enrollment.enrollment_id
        };
      } else {
        // Return placeholder (not saved to DB yet)
        return {
          attendance_id: `temp-${enrollment.student_id}`,
          enrollment_id: enrollment.enrollment_id,
          student_id: enrollment.student_id,
          status: 'pending',
          check_in_time: null,
          notes: null,
          gps_latitude: null,
          gps_longitude: null,
          gps_accuracy: null,
          attendance_date: selectedDate,
          student: enrollment.student
        };
      }
    });

    setAttendance(attendanceList as AttendanceRecord[]);
  }, [sessionId, selectedDate]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (selectedDate) {
      loadAttendance();
    }
  }, [selectedDate, loadAttendance]);

  const updateAttendance = async (attendanceId: string, status: string) => {
    const record = attendance.find(a => a.attendance_id === attendanceId);
    if (!record) return;

    // Capture GPS location
    const gpsData = await captureGPSLocation();

    // Check if this is a temporary/unsaved record
    if (attendanceId.startsWith('temp-')) {
      // Create new attendance record
      const newRecord = {
        enrollment_id: record.enrollment_id,
        session_id: sessionId,
        student_id: record.student_id,
        attendance_date: selectedDate,
        status: status,
        check_in_time: (status === 'present' || status === 'late') ? new Date().toISOString() : null,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: 'system',
        marked_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .insert([newRecord]);

      if (error) {
        console.error('Error creating attendance:', error);
        alert(`Error: ${error.message}`);
      } else {
        loadAttendance();
      }
    } else {
      // Update existing record
      const updates: {
        status: string;
        check_in_time?: string | null;
        gps_latitude?: number | null;
        gps_longitude?: number | null;
        gps_accuracy?: number | null;
        gps_timestamp?: string | null;
        marked_by?: string;
        marked_at?: string;
      } = {
        status,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: 'system',
        marked_at: new Date().toISOString()
      };
      
      if (status === 'present' || status === 'late') {
        updates.check_in_time = new Date().toISOString();
      } else {
        updates.check_in_time = null;
      }

      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .update(updates)
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('Error updating attendance:', error);
        alert(`Error: ${error.message}`);
      } else {
        loadAttendance();
      }
    }
  };

  // Clear attendance for a single record: delete saved record or reset a temp placeholder
  const clearAttendance = async (attendanceId: string) => {
    const ok = window.confirm('Clear attendance for this student? This will remove the recorded status.');
    if (!ok) return;

    // If this is a temp (not-yet-saved) record, just reset locally
    if (attendanceId.startsWith('temp-')) {
      setAttendance((prev) => prev.map(a => a.attendance_id === attendanceId ? { ...a, status: 'pending', check_in_time: null } : a));
      // no DB change required
      return;
    }

    try {
      const { error } = await supabase
        .from(Tables.ATTENDANCE)
        .delete()
        .eq('attendance_id', attendanceId);

      if (error) {
        console.error('Error deleting attendance record:', error);
        alert('Failed to clear attendance: ' + error.message);
        return;
      }

      // Optimistically update UI
      setAttendance((prev) => prev.map(a => a.attendance_id === attendanceId ? { ...a, status: 'pending', check_in_time: null } : a));
      // Reload to ensure consistent state
      loadAttendance();
    } catch (err: any) {
      console.error('Exception clearing attendance:', err);
      alert('Failed to clear attendance: ' + (err?.message || String(err)));
    }
  };

  const handleBulkUpdate = async (status: string) => {
    if (selectedStudents.size === 0) {
      alert('Please select students first');
      return;
    }

    // Capture GPS location once for bulk operation
    const gpsData = await captureGPSLocation();

    const attendanceIds = Array.from(selectedStudents);
    const tempIds = attendanceIds.filter(id => id.startsWith('temp-'));
    const realIds = attendanceIds.filter(id => !id.startsWith('temp-'));

    // Create new records for temp IDs
    if (tempIds.length > 0) {
      const newRecords = tempIds.map(tempId => {
        const record = attendance.find(a => a.attendance_id === tempId);
        if (!record) return null;
        
        return {
          enrollment_id: record.enrollment_id,
          session_id: sessionId,
          student_id: record.student_id,
          attendance_date: selectedDate,
          status: status,
          check_in_time: (status === 'present' || status === 'late') ? new Date().toISOString() : null,
          gps_latitude: gpsData?.latitude || null,
          gps_longitude: gpsData?.longitude || null,
          gps_accuracy: gpsData?.accuracy || null,
          gps_timestamp: gpsData?.timestamp || null,
          marked_by: 'system',
          marked_at: new Date().toISOString()
        };
      }).filter(r => r !== null);

      const { error: insertError } = await supabase
        .from(Tables.ATTENDANCE)
        .insert(newRecords);

      if (insertError) {
        console.error('Error creating attendance:', insertError);
        alert(`Error: ${insertError.message}`);
        return;
      }
    }

    // Update existing records
    if (realIds.length > 0) {
      const updates: {
        status: string;
        check_in_time?: string | null;
        gps_latitude?: number | null;
        gps_longitude?: number | null;
        gps_accuracy?: number | null;
        gps_timestamp?: string | null;
        marked_by?: string;
        marked_at?: string;
      } = {
        status,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_timestamp: gpsData?.timestamp || null,
        marked_by: 'system',
        marked_at: new Date().toISOString()
      };
      
      if (status === 'present' || status === 'late') {
        updates.check_in_time = new Date().toISOString();
      } else {
        updates.check_in_time = null;
      }

      const { error: updateError } = await supabase
        .from(Tables.ATTENDANCE)
        .update(updates)
        .in('attendance_id', realIds);

      if (updateError) {
        console.error('Error updating attendance:', updateError);
        alert(`Error: ${updateError.message}`);
        return;
      }
    }

    setSelectedStudents(new Set());
    loadAttendance();
  };

  const handleSelectAll = () => {
    if (selectedStudents.size === attendance.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(attendance.map(a => a.attendance_id)));
    }
  };

  const handleSelectStudent = (attendanceId: string) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(attendanceId)) {
      newSelected.delete(attendanceId);
    } else {
      newSelected.add(attendanceId);
    }
    setSelectedStudents(newSelected);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'present':
        return <Badge variant="success">Present</Badge>;
      case 'absent':
        return <Badge variant="danger">Absent</Badge>;
      case 'late':
        return <Badge variant="warning">Late</Badge>;
      case 'excused':
        return <Badge variant="info">Excused</Badge>;
      case 'pending':
        return <Badge variant="default">Not Marked</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Session not found</p>
      </div>
    );
  }

  const sessionInfo = (session as any).course;
  const courseName = sessionInfo?.course_name || 'Unknown Course';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Mark Attendance</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Class Date</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedDate}
            onChange={(value) => setSelectedDate(value)}
            options={availableDates}
            placeholder="Select a date"
          />
          {availableDates.length === 0 && (
            <p className="text-sm text-gray-500 mt-2">
              No attendance dates available. Please check the session schedule.
            </p>
          )}
        </CardContent>
      </Card>

      {selectedDate && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    Attendance for {format(new Date(selectedDate), 'MMMM dd, yyyy')}
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    {session.location || 'No location specified'} • {session.time || 'No time specified'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Course: {courseName}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  {selectedStudents.size > 0 ? (
                    <>
                      <Button
                        onClick={() => handleBulkUpdate('present')}
                        className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm"
                      >
                        Present ({selectedStudents.size})
                      </Button>
                      <Button
                        onClick={() => handleBulkUpdate('absent')}
                        className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm"
                      >
                        Absent ({selectedStudents.size})
                      </Button>
                      <Button
                        onClick={() => handleBulkUpdate('late')}
                        className="bg-yellow-600 hover:bg-yellow-700 text-xs sm:text-sm"
                      >
                        Late ({selectedStudents.size})
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={handleSelectAll}
                      className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm"
                    >
                      Select All ({attendance.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {attendance.length === 0 ? (
                <p className="text-center text-gray-500 py-8">
                  No students enrolled in this session
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg">
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-gray-900">{attendance.length}</div>
                      <div className="text-xs text-gray-600">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-green-600">
                        {attendance.filter(a => a.status === 'present').length}
                      </div>
                      <div className="text-xs text-gray-600">Present</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-red-600">
                        {attendance.filter(a => a.status === 'absent').length}
                      </div>
                      <div className="text-xs text-gray-600">Absent</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl sm:text-2xl font-bold text-yellow-600">
                        {attendance.filter(a => a.status === 'late').length}
                      </div>
                      <div className="text-xs text-gray-600">Late</div>
                    </div>
                    <div className="text-center col-span-3 sm:col-span-1">
                      <div className="text-xl sm:text-2xl font-bold text-gray-400">
                        {attendance.filter(a => a.status === 'pending').length}
                      </div>
                      <div className="text-xs text-gray-600">Not Marked</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={selectedStudents.size === attendance.length && attendance.length > 0}
                      onChange={handleSelectAll}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium">Select All</span>
                  </div>
                  {attendance.map((record) => (
                    <div
                      key={record.attendance_id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg hover:bg-gray-50 gap-3"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(record.attendance_id)}
                          onChange={() => handleSelectStudent(record.attendance_id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{record.student.name}</h3>
                          <p className="text-sm text-gray-500 truncate">{record.student.email}</p>
                          {record.check_in_time && (
                            <p className="text-xs text-gray-400 mt-1">
                              Checked in: {format(new Date(record.check_in_time), 'HH:mm:ss')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        {getStatusBadge(record.status)}
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'present')}
                          className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          Present
                        </Button>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'absent')}
                          className="bg-red-600 hover:bg-red-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          Absent
                        </Button>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'late')}
                          className="bg-yellow-600 hover:bg-yellow-700 text-xs sm:text-sm px-2 sm:px-4"
                        >
                          Late
                        </Button>
                        <Button
                          onClick={() => updateAttendance(record.attendance_id, 'excused')}
                          className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm px-2 sm:px-4"
                          size="sm"
                        >
                          Excused
                        </Button>
                        <Button
                          onClick={() => clearAttendance(record.attendance_id)}
                          className="bg-gray-200 hover:bg-gray-300 text-xs sm:text-sm px-2 sm:px-4 text-gray-700"
                          size="sm"
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
