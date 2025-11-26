/**
 * Attendance Date Generation Utility
 * Automatically generates attendance dates based on session schedule
 */

export interface SessionSchedule {
  session_id: string;
  start_date: string;
  end_date: string;
  day: string | null; // e.g., "Monday", "Tuesday,Thursday" (comma-separated)
  time: string | null;
  location: string | null;
}

export interface AttendanceDate {
  date: string; // ISO date format YYYY-MM-DD
  day_name: string;
  session_id: string;
  location: string | null;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generates all attendance dates for a session based on its schedule
 * @param session The session with start_date, end_date, and day
 * @returns Array of attendance dates
 */
export function generateAttendanceDates(session: SessionSchedule): AttendanceDate[] {
  const dates: AttendanceDate[] = [];
  
  if (!session.start_date || !session.end_date) {
    return dates;
  }

  const startDate = new Date(session.start_date);
  const endDate = new Date(session.end_date);
  
  // Parse the days (could be comma-separated like "Monday,Wednesday")
  const scheduledDays = session.day 
    ? session.day.split(',').map(d => d.trim().toLowerCase())
    : [];

  // If no specific days are set, include all days
  const includeAllDays = scheduledDays.length === 0;

  // Iterate through all dates in the range
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayName = DAYS_OF_WEEK[currentDate.getDay()];
    const shouldInclude = includeAllDays || 
      scheduledDays.some(d => dayName.toLowerCase() === d);

    if (shouldInclude) {
      dates.push({
        date: currentDate.toISOString().split('T')[0], // YYYY-MM-DD format
        day_name: dayName,
        session_id: session.session_id,
        location: session.location,
      });
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

/**
 * Generates a display label for a session date
 * @param date The date string (YYYY-MM-DD)
 * @param location The location string
 * @returns Formatted label like "Feb 02, 2025 - Main Campus - Room 202"
 */
export function generateDateLabel(date: string, location: string | null): string {
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
  
  return location ? `${formattedDate} - ${location}` : formattedDate;
}

/**
 * Gets the next upcoming attendance date for a session
 * @param session The session schedule
 * @returns The next date or null if session has ended
 */
export function getNextAttendanceDate(session: SessionSchedule): AttendanceDate | null {
  const dates = generateAttendanceDates(session);
  const today = new Date().toISOString().split('T')[0];
  
  const upcomingDates = dates.filter(d => d.date >= today);
  return upcomingDates.length > 0 ? upcomingDates[0] : null;
}

/**
 * Checks if a session is currently active (today is within date range)
 * @param session The session schedule
 * @returns True if session is active today
 */
export function isSessionActive(session: SessionSchedule): boolean {
  const today = new Date().toISOString().split('T')[0];
  return session.start_date <= today && session.end_date >= today;
}

/**
 * Gets all dates formatted for dropdown selection
 * @param session The session schedule
 * @returns Array of {value, label} for Select component
 */
export function getAttendanceDateOptions(session: SessionSchedule): Array<{ value: string; label: string }> {
  const dates = generateAttendanceDates(session);
  return dates.map(d => ({
    value: d.date,
    label: generateDateLabel(d.date, d.location)
  }));
}
