/**
 * Smart Scheduling Service
 * 
 * Provides:
 * - Auto-generation of expected session dates from day/week patterns
 * - Conflict detection (teacher double-booking, room conflicts)
 * - Host rotation scheduling based on enrolled students
 * - Holiday/vacation skipping
 * - Schedule suggestions and optimization
 */

import { supabase } from '../lib/supabase';

// =====================================================
// TYPES
// =====================================================

export interface ScheduleConflict {
  type: 'teacher' | 'room' | 'student';
  date: string;
  description: string;
  conflictingSessionId?: string;
  severity: 'error' | 'warning';
}

export interface GeneratedDate {
  date: string;
  dayName: string;
  hostStudentId?: string | null;
  hostStudentName?: string | null;
  isHoliday?: boolean;
  holidayName?: string;
  conflict?: ScheduleConflict;
}

export interface HostCandidate {
  student_id: string;
  name: string;
  can_host: boolean;
  times_hosted: number;
  last_hosted_date: string | null;
  address: string | null;
}

export interface ScheduleSuggestion {
  dates: GeneratedDate[];
  totalSessions: number;
  conflicts: ScheduleConflict[];
  hostRotation: Array<{ date: string; host: HostCandidate | null }>;
  estimatedEndDate: string;
}

// =====================================================
// CONSTANTS
// =====================================================

const DAY_MAP: Record<string, number> = {
  'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
  'Thursday': 4, 'Friday': 5, 'Saturday': 6,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Common Islamic/regional holidays (can be expanded or made configurable)
const DEFAULT_HOLIDAYS: Array<{ date: string; name: string }> = [];

// =====================================================
// SERVICE
// =====================================================

class SmartSchedulingService {
  private holidays: Array<{ date: string; name: string }> = [...DEFAULT_HOLIDAYS];

  /**
   * Set custom holidays for the scheduling period
   */
  setHolidays(holidays: Array<{ date: string; name: string }>) {
    this.holidays = holidays;
  }

  /**
   * Generate expected session dates from day pattern and date range
   */
  generateDates(
    startDate: string,
    endDate: string,
    days: string,
    options?: {
      skipHolidays?: boolean;
      excludeDates?: string[];
    }
  ): GeneratedDate[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dayNums = days.split(',').map(d => DAY_MAP[d.trim()]).filter(n => n !== undefined);
    const dates: GeneratedDate[] = [];
    const excludeSet = new Set(options?.excludeDates || []);
    const holidayMap = new Map(this.holidays.map(h => [h.date, h.name]));

    const cursor = new Date(start);
    while (cursor <= end) {
      const dateStr = cursor.toISOString().split('T')[0];
      const dayOfWeek = cursor.getDay();

      if (dayNums.includes(dayOfWeek)) {
        const isHoliday = holidayMap.has(dateStr);
        const isExcluded = excludeSet.has(dateStr);

        if (!isExcluded && !(options?.skipHolidays && isHoliday)) {
          dates.push({
            date: dateStr,
            dayName: DAY_NAMES[dayOfWeek],
            isHoliday,
            holidayName: holidayMap.get(dateStr),
          });
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
  }

  /**
   * Check for scheduling conflicts for a teacher on given dates
   */
  async checkConflicts(
    teacherId: string,
    dates: string[],
    excludeSessionId?: string
  ): Promise<ScheduleConflict[]> {
    if (dates.length === 0) return [];

    const conflicts: ScheduleConflict[] = [];

    // Get all teacher sessions overlapping with our date range
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    let query = supabase
      .from('session')
      .select('session_id, course:course_id(course_name), day, start_date, end_date, time')
      .eq('teacher_id', teacherId)
      .lte('start_date', maxDate)
      .gte('end_date', minDate);

    if (excludeSessionId) {
      query = query.neq('session_id', excludeSessionId);
    }

    const { data: existingSessions } = await query;

    if (existingSessions) {
      for (const session of existingSessions) {
        const sessionDays = (session.day || '').split(',').map((d: string) => d.trim());
        const sessionStart = new Date(session.start_date);
        const sessionEnd = new Date(session.end_date);

        for (const dateStr of dates) {
          const date = new Date(dateStr);
          const dayName = DAY_NAMES[date.getDay()];

          if (
            date >= sessionStart &&
            date <= sessionEnd &&
            sessionDays.includes(dayName)
          ) {
            conflicts.push({
              type: 'teacher',
              date: dateStr,
              description: `Teacher already assigned to "${(session as any).course?.course_name || 'another session'}" on ${dayName}`,
              conflictingSessionId: session.session_id,
              severity: 'error',
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Generate an optimized host rotation for a session's dates
   * Distributes hosting duties evenly among eligible students
   */
  async generateHostRotation(
    sessionId: string,
    dates: string[]
  ): Promise<Array<{ date: string; host: HostCandidate | null }>> {
    // Get enrolled students who can host
    const { data: enrollments } = await supabase
      .from('enrollment')
      .select(`
        student_id,
        can_host,
        student:student_id(name, address)
      `)
      .eq('session_id', sessionId)
      .eq('status', 'active');

    if (!enrollments || enrollments.length === 0) {
      return dates.map(d => ({ date: d, host: null }));
    }

    // Get existing host assignments
    const { data: existingHosts } = await supabase
      .from('session_date_host')
      .select('attendance_date, host_id')
      .eq('session_id', sessionId);

    const hostCountMap = new Map<string, number>();
    const existingHostMap = new Map<string, string>();

    if (existingHosts) {
      for (const h of existingHosts) {
        existingHostMap.set(h.attendance_date, h.host_id);
        hostCountMap.set(h.host_id, (hostCountMap.get(h.host_id) || 0) + 1);
      }
    }

    // Build host candidates
    const candidates: HostCandidate[] = enrollments
      .filter((e: any) => e.can_host)
      .map((e: any) => ({
        student_id: e.student_id,
        name: e.student?.name || 'Unknown',
        can_host: true,
        address: e.student?.address || null,
        times_hosted: hostCountMap.get(e.student_id) || 0,
        last_hosted_date: null,
      }));

    if (candidates.length === 0) {
      return dates.map(d => ({ date: d, host: null }));
    }

    // Round-robin with load balancing: assign fewest-hosted first 
    const rotation = dates.map(dateStr => {
      // If already assigned, use existing
      const existingHostId = existingHostMap.get(dateStr);
      if (existingHostId) {
        const existing = candidates.find(c => c.student_id === existingHostId);
        return { date: dateStr, host: existing || null };
      }

      // Pick least-hosted candidate
      candidates.sort((a, b) => a.times_hosted - b.times_hosted);
      const chosen = candidates[0];

      if (chosen) {
        chosen.times_hosted++;
        chosen.last_hosted_date = dateStr;
        return { date: dateStr, host: { ...chosen } };
      }

      return { date: dateStr, host: null };
    });

    return rotation;
  }

  /**
   * Generate a full schedule suggestion for a session
   */
  async generateScheduleSuggestion(
    teacherId: string,
    startDate: string,
    endDate: string,
    days: string,
    sessionId?: string,
    options?: {
      skipHolidays?: boolean;
      excludeDates?: string[];
    }
  ): Promise<ScheduleSuggestion> {
    // 1. Generate dates
    const dates = this.generateDates(startDate, endDate, days, options);

    // 2. Check conflicts
    const dateStrings = dates.map(d => d.date);
    const conflicts = await this.checkConflicts(
      teacherId,
      dateStrings,
      sessionId
    );

    // 3. Mark conflicts on dates
    const conflictMap = new Map<string, ScheduleConflict>();
    for (const c of conflicts) {
      conflictMap.set(c.date, c);
    }
    for (const date of dates) {
      if (conflictMap.has(date.date)) {
        date.conflict = conflictMap.get(date.date);
      }
    }

    // 4. Generate host rotation if session exists
    let hostRotation: Array<{ date: string; host: HostCandidate | null }> = [];
    if (sessionId) {
      hostRotation = await this.generateHostRotation(sessionId, dateStrings);
    }

    return {
      dates,
      totalSessions: dates.length,
      conflicts,
      hostRotation,
      estimatedEndDate: dates.length > 0 ? dates[dates.length - 1].date : endDate,
    };
  }

  /**
   * Auto-fill missing attendance records for a generated schedule
   * Creates "absent" records for all enrolled students on dates without records
   */
  async backfillMissingRecords(
    sessionId: string,
    dates: string[]
  ): Promise<{ created: number; error: string | null }> {
    // Get enrolled students
    const { data: enrollments } = await supabase
      .from('enrollment')
      .select('student_id, enrollment_id, enrollment_date')
      .eq('session_id', sessionId)
      .eq('status', 'active');

    if (!enrollments || enrollments.length === 0) {
      return { created: 0, error: 'No active enrollments found' };
    }

    // Get existing attendance records for these dates
    const { data: existingRecords } = await supabase
      .from('attendance')
      .select('student_id, attendance_date')
      .eq('session_id', sessionId)
      .in('attendance_date', dates);

    const existingSet = new Set(
      (existingRecords || []).map(r => `${r.student_id}:${r.attendance_date}`)
    );

    // Build missing records (only for dates after enrollment)
    const missingRecords: Array<{
      student_id: string;
      enrollment_id: string;
      session_id: string;
      attendance_date: string;
      status: string;
    }> = [];

    for (const enrollment of enrollments) {
      for (const dateStr of dates) {
        const key = `${enrollment.student_id}:${dateStr}`;
        if (!existingSet.has(key) && dateStr >= enrollment.enrollment_date) {
          missingRecords.push({
            student_id: enrollment.student_id,
            enrollment_id: enrollment.enrollment_id,
            session_id: sessionId,
            attendance_date: dateStr,
            status: 'absent',
          });
        }
      }
    }

    if (missingRecords.length === 0) {
      return { created: 0, error: null };
    }

    // Insert in batches of 100
    let created = 0;
    for (let i = 0; i < missingRecords.length; i += 100) {
      const batch = missingRecords.slice(i, i + 100);
      const { error } = await supabase.from('attendance').insert(batch);
      if (error) {
        return { created, error: error.message };
      }
      created += batch.length;
    }

    return { created, error: null };
  }
}

export const smartSchedulingService = new SmartSchedulingService();
