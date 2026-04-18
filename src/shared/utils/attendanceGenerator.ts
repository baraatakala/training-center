/**
 * Attendance Date Generation Utility
 * Generates attendance dates based on session schedule,
 * with support for day-change history (schedule versioning).
 */

import { format } from 'date-fns';

export interface SessionSchedule {
  session_id: string;
  start_date: string;
  end_date: string;
  day: string | null; // e.g., "Monday", "Tuesday,Thursday" (comma-separated)
  time: string | null;
  location: string | null;
}

export interface DayChange {
  old_day: string | null;
  new_day: string;
  effective_date: string; // YYYY-MM-DD
}

export interface AttendanceDate {
  date: string; // ISO date format YYYY-MM-DD
  day_name: string;
  session_id: string;
  location: string | null;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DAY_MAP: Record<string, number> = {
  'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
  'thursday': 4, 'friday': 5, 'saturday': 6,
};

/**
 * Parse a YYYY-MM-DD string as a local-timezone Date (midnight local).
 * Avoids the UTC-midnight pitfall of `new Date('2025-01-15')`.
 */
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/**
 * Format a local Date as YYYY-MM-DD without UTC shift.
 */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parses comma-separated day string to array of day numbers (0=Sun..6=Sat)
 */
function parseDayNums(days: string | null): number[] {
  if (!days) return [];
  return days.split(',')
    .map(d => DAY_MAP[d.trim().toLowerCase()])
    .filter(n => n !== undefined);
}

/**
 * Generates all attendance dates for a session based on its schedule,
 * respecting day-change history for schedule versioning.
 * 
 * @param session The session with start_date, end_date, and day
 * @param dayChanges Optional array of day changes (sorted by effective_date ascending)
 * @returns Array of attendance dates
 */
export function generateAttendanceDates(
  session: SessionSchedule,
  dayChanges?: DayChange[]
): AttendanceDate[] {
  if (!session.start_date || !session.end_date) {
    return [];
  }

  const startDate = parseLocalDate(session.start_date);
  const endDate = parseLocalDate(session.end_date);

  // Build date-range → dayNums segments based on day change history
  const changes = (dayChanges || [])
    .filter(c => c.effective_date)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  const segments: Array<{ from: Date; to: Date; dayNums: number[] }> = [];

  if (changes.length === 0) {
    // No changes: same days for entire range
    const dayNums = parseDayNums(session.day);
    if (dayNums.length === 0) return [];
    segments.push({ from: startDate, to: endDate, dayNums });
  } else {
    // Build segments from day-change history.
    // IMPORTANT: session.day is already updated to the LATEST value, so we must
    // reconstruct the initial day from the first change's old_day field.
    // Changes are sorted by effective_date ascending.
    let currentDays: string | null = changes[0].old_day;
    let rangeStart = startDate;

    for (const change of changes) {
      const effectiveDate = parseLocalDate(change.effective_date);
      // Skip changes that fall before the session's current start date
      // but absorb their effect so we start the next segment with the right day
      if (effectiveDate <= startDate) {
        currentDays = change.new_day;
        continue;
      }
      if (effectiveDate > rangeStart && currentDays) {
        const dayNums = parseDayNums(currentDays);
        if (dayNums.length > 0) {
          const segEnd = new Date(effectiveDate.getTime() - 86400000);
          segments.push({ from: rangeStart, to: segEnd, dayNums });
        }
      }
      currentDays = change.new_day;
      rangeStart = effectiveDate;
    }
    // Last range to end — clamp to at least startDate
    if (rangeStart < startDate) rangeStart = startDate;
    const dayNums = parseDayNums(currentDays);
    if (dayNums.length > 0) {
      segments.push({ from: rangeStart, to: endDate, dayNums });
    }
  }

  // Generate all matching dates from segments
  const dates: AttendanceDate[] = [];
  for (const seg of segments) {
    const cursor = new Date(seg.from);
    while (cursor <= seg.to && cursor <= endDate) {
      if (seg.dayNums.includes(cursor.getDay())) {
        dates.push({
          date: formatLocalDate(cursor),
          day_name: DAYS_OF_WEEK[cursor.getDay()],
          session_id: session.session_id,
          location: session.location,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Day-change exception from the session_schedule_exception table.
 * Used by generateAttendanceDatesFromExceptions.
 */
export interface ScheduleDayException {
  original_date: string;          // effective date of the change
  new_day_of_week: number;        // 0=Sun…6=Sat
  old_day_of_week: number | null; // day before this change (null for time-only)
}

/**
 * Generates attendance dates using the new session_schedule_exception table
 * instead of legacy DayChange records. Falls back to base schedule when no
 * day-change exceptions exist.
 *
 * @param session  Session with start_date, end_date, location
 * @param baseDayNums  Current schedule days from session_schedule_day (0=Sun…6=Sat)
 * @param dayExceptions  Day-change exceptions sorted by original_date ascending
 */
export function generateAttendanceDatesFromExceptions(
  session: { session_id: string; start_date: string; end_date: string; location: string | null },
  baseDayNums: number[],
  dayExceptions?: ScheduleDayException[],
): AttendanceDate[] {
  if (!session.start_date || !session.end_date) return [];

  const startDate = parseLocalDate(session.start_date);
  const endDate = parseLocalDate(session.end_date);

  const changes = (dayExceptions || [])
    .filter(e => e.original_date && e.new_day_of_week != null)
    .sort((a, b) => a.original_date.localeCompare(b.original_date));

  const segments: Array<{ from: Date; to: Date; dayNums: number[] }> = [];

  if (changes.length === 0) {
    if (baseDayNums.length === 0) return [];
    segments.push({ from: startDate, to: endDate, dayNums: [...baseDayNums] });
  } else {
    // Reconstruct initial days from the first exception's old_day_of_week.
    // If unavailable, fall back to baseDayNums (may be incorrect for first segment).
    let currentDayNums: number[] = changes[0].old_day_of_week != null
      ? [changes[0].old_day_of_week]
      : [...baseDayNums];
    let rangeStart = startDate;

    for (const change of changes) {
      const effectiveDate = parseLocalDate(change.original_date);
      if (effectiveDate <= startDate) {
        currentDayNums = [change.new_day_of_week];
        continue;
      }
      if (effectiveDate > rangeStart && currentDayNums.length > 0) {
        const segEnd = new Date(effectiveDate.getTime() - 86400000);
        segments.push({ from: rangeStart, to: segEnd, dayNums: currentDayNums });
      }
      currentDayNums = [change.new_day_of_week];
      rangeStart = effectiveDate;
    }
    if (rangeStart < startDate) rangeStart = startDate;
    if (currentDayNums.length > 0) {
      segments.push({ from: rangeStart, to: endDate, dayNums: currentDayNums });
    }
  }

  const dates: AttendanceDate[] = [];
  for (const seg of segments) {
    const cursor = new Date(seg.from);
    while (cursor <= seg.to && cursor <= endDate) {
      if (seg.dayNums.includes(cursor.getDay())) {
        dates.push({
          date: formatLocalDate(cursor),
          day_name: DAYS_OF_WEEK[cursor.getDay()],
          session_id: session.session_id,
          location: session.location,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Generates a display label for a session date
 */
export function generateDateLabel(date: string, location: string | null): string {
  const dateObj = parseLocalDate(date);
  const formattedDate = format(dateObj, 'MMM dd, yyyy');
  return location ? `${formattedDate} - ${location}` : formattedDate;
}

/**
 * Gets the next upcoming attendance date for a session
 */
export function getNextAttendanceDate(
  session: SessionSchedule,
  dayChanges?: DayChange[]
): AttendanceDate | null {
  const dates = generateAttendanceDates(session, dayChanges);
  const today = formatLocalDate(new Date());
  const upcomingDates = dates.filter(d => d.date >= today);
  return upcomingDates.length > 0 ? upcomingDates[0] : null;
}

/**
 * Checks if a session is currently active (today is within date range)
 */
export function isSessionActive(session: SessionSchedule): boolean {
  const today = formatLocalDate(new Date());
  return session.start_date <= today && session.end_date >= today;
}

/**
 * Gets all dates formatted for dropdown selection
 */
export function getAttendanceDateOptions(
  session: SessionSchedule,
  dayChanges?: DayChange[]
): Array<{ value: string; label: string }> {
  const dates = generateAttendanceDates(session, dayChanges);
  return dates.map(d => ({
    value: d.date,
    label: generateDateLabel(d.date, d.location)
  }));
}
