import { supabase } from '@/shared/lib/supabase';
import type { CreateSession, UpdateSession } from '@/shared/types/database.types';
import { Tables } from '@/shared/types/database.types';
import { logDelete, logUpdate, logInsert } from '@/shared/services/auditService';

export interface SessionScheduleConflict {
  sessionId: string;
  courseName: string;
  conflictDate: string;
  requestedTime: string | null;
  existingTime: string | null;
  reason: string;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function parseDayString(dayString?: string | null) {
  if (!dayString) return new Set<number>();

  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  return new Set(
    dayString
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .map((value) => dayMap[value])
      .filter((value): value is number => typeof value === 'number')
  );
}

function enumerateSessionDates(startDate: string, endDate: string, dayString?: string | null) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end || end < start) return [] as string[];

  const allowedDays = parseDayString(dayString);
  const dates: string[] = [];

  for (let date = new Date(start); date <= end; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if (allowedDays.size > 0 && !allowedDays.has(date.getDay())) {
      continue;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }

  return dates;
}

function parseTimeValue(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return (hours * 60) + minutes;
}

function parseTimeRange(value?: string | null) {
  if (!value) return null;

  const [rawStart, rawEnd] = value.split('-').map((part) => part.trim()).filter(Boolean);
  const start = rawStart ? parseTimeValue(rawStart) : null;
  const end = rawEnd ? parseTimeValue(rawEnd) : null;

  if (start == null) return null;
  if (end == null || end <= start) {
    return { start, end: start + 60 };
  }

  return { start, end };
}

function rangesOverlap(
  left: ReturnType<typeof parseTimeRange>,
  right: ReturnType<typeof parseTimeRange>
) {
  if (!left || !right) return true;
  return left.start < right.end && right.start < left.end;
}

/** Extract structured start_time/end_time from "HH:MM-HH:MM" string */
function extractTimeParts(time?: string | null): { start_time: string; end_time: string } | null {
  if (!time) return null;
  const [rawStart, rawEnd] = time.split('-').map((p) => p.trim());
  if (!rawStart || !rawEnd) return null;
  // Normalize to HH:MM:SS for TIME column
  const norm = (v: string) => (v.length === 5 ? `${v}:00` : v);
  return { start_time: norm(rawStart), end_time: norm(rawEnd) };
}

/** Convert comma-separated day names to day_of_week numbers (0=Sun…6=Sat) */
function dayNamesToDayOfWeek(dayStr?: string | null): number[] {
  if (!dayStr) return [];
  const map: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  return dayStr.split(',').map((d) => map[d.trim().toLowerCase()]).filter((n): n is number => n != null);
}

/** Map day_of_week number (0=Sun…6=Sat) to day name */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Upsert a schedule exception, merging with any existing exception on the same date.
 * If an exception already exists (e.g. a time_change), and we add a day_change,
 * the type is upgraded to time_and_day_change.
 */
async function upsertScheduleException(
  sessionId: string,
  originalDate: string,
  timeOverride: { startTime: string; endTime: string } | null,
  dayOverride: { dayOfWeek: number; oldDayOfWeek?: number } | null,
  reason: string | null,
  changedBy: string | null,
): Promise<void> {
  const { data: existing } = await supabase
    .from(Tables.SESSION_SCHEDULE_EXCEPTION)
    .select('new_start_time, new_end_time, new_day_of_week, old_day_of_week')
    .eq('session_id', sessionId)
    .eq('original_date', originalDate)
    .maybeSingle();

  const startTime = timeOverride?.startTime ?? existing?.new_start_time ?? null;
  const endTime = timeOverride?.endTime ?? existing?.new_end_time ?? null;
  const dayOfWeek = dayOverride?.dayOfWeek ?? existing?.new_day_of_week ?? null;
  const oldDayOfWeek = dayOverride?.oldDayOfWeek ?? existing?.old_day_of_week ?? null;

  const hasTime = startTime != null;
  const hasDay = dayOfWeek != null;
  const exceptionType = hasTime && hasDay ? 'time_and_day_change'
    : hasDay ? 'day_change'
    : 'time_change';

  await supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION).upsert({
    session_id: sessionId,
    original_date: originalDate,
    exception_type: exceptionType,
    new_start_time: startTime,
    new_end_time: endTime,
    new_day_of_week: dayOfWeek,
    old_day_of_week: oldDayOfWeek,
    reason,
    changed_by: changedBy,
  }, { onConflict: 'session_id,original_date' });
}

/** Remove day-related exceptions (delete pure day_change, downgrade time_and_day_change) */
async function cleanupDayExceptions(
  sessionId: string,
  dateFilter?: { gte?: string; lte?: string },
): Promise<void> {
  let delQuery = supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION)
    .delete().eq('session_id', sessionId).eq('exception_type', 'day_change');
  if (dateFilter?.gte) delQuery = delQuery.gte('original_date', dateFilter.gte);
  if (dateFilter?.lte) delQuery = delQuery.lte('original_date', dateFilter.lte);
  await delQuery;

  let downgradeQuery = supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION)
    .update({ exception_type: 'time_change', new_day_of_week: null, old_day_of_week: null })
    .eq('session_id', sessionId).eq('exception_type', 'time_and_day_change');
  if (dateFilter?.gte) downgradeQuery = downgradeQuery.gte('original_date', dateFilter.gte);
  if (dateFilter?.lte) downgradeQuery = downgradeQuery.lte('original_date', dateFilter.lte);
  await downgradeQuery;
}

/** Remove time-related exceptions (delete pure time_change, downgrade time_and_day_change) */
async function cleanupTimeExceptions(
  sessionId: string,
  dateFilter?: { gte?: string; lte?: string },
): Promise<void> {
  let delQuery = supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION)
    .delete().eq('session_id', sessionId).eq('exception_type', 'time_change');
  if (dateFilter?.gte) delQuery = delQuery.gte('original_date', dateFilter.gte);
  if (dateFilter?.lte) delQuery = delQuery.lte('original_date', dateFilter.lte);
  await delQuery;

  let downgradeQuery = supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION)
    .update({ exception_type: 'day_change', new_start_time: null, new_end_time: null })
    .eq('session_id', sessionId).eq('exception_type', 'time_and_day_change');
  if (dateFilter?.gte) downgradeQuery = downgradeQuery.gte('original_date', dateFilter.gte);
  if (dateFilter?.lte) downgradeQuery = downgradeQuery.lte('original_date', dateFilter.lte);
  await downgradeQuery;
}

function normalizeSessionMutationError(error: { message?: string; details?: string; hint?: string } | null) {
  if (!error) return null;

  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const isMissingDeliveryField = [
    'learning_method',
    'virtual_provider',
    'virtual_meeting_link',
    'requires_recording',
    'default_recording_visibility',
    'feedback_enabled',
    'feedback_anonymous_allowed',
    'teacher_can_host',
  ].some((field) => text.includes(field));

  if (isMissingDeliveryField) {
    return {
      ...error,
      message: 'The app is saving newer session settings, but your database is missing one or more required session columns. Run the latest session migration SQL files in Supabase, then retry.',
    };
  }

  return error;
}

export const sessionService = {
  // Get all sessions
  async getAll() {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name, email)
      `)
      .order('start_date', { ascending: false });
  },

  // Get session by ID
  async getById(id: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(*),
        teacher:teacher_id(*)
      `)
      .eq('session_id', id)
      .single();
  },

  // Get sessions for a specific course
  async getByCourse(courseId: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name),
        teacher:teacher_id(name)
      `)
      .eq('course_id', courseId)
      .order('start_date', { ascending: false });
  },

  // Get sessions for a specific teacher
  async getByTeacher(teacherId: string) {
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .eq('teacher_id', teacherId)
      .order('start_date', { ascending: false });
  },

  // Get active sessions (end_date >= today)
  async getActive() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .gte('end_date', today)
      .order('start_date', { ascending: false });
  },

  // Get upcoming sessions (start_date > today)
  async getUpcoming() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .gt('start_date', today)
      .order('start_date', { ascending: true });
  },

  // Get completed sessions (end_date < today)
  async getCompleted() {
    const today = new Date().toISOString().split('T')[0];
    return await supabase
      .from(Tables.SESSION)
      .select(`
        *,
        course:course_id(course_name, category),
        teacher:teacher_id(name)
      `)
      .lt('end_date', today)
      .order('start_date', { ascending: false });
  },

  // Create new session
  async create(session: CreateSession) {
    // Dual-write: populate structured time columns from legacy time string
    const timeParts = extractTimeParts(session.time);
    const sessionPayload = {
      ...session,
      ...(timeParts && { start_time: timeParts.start_time, end_time: timeParts.end_time }),
    };

    const result = await supabase
      .from(Tables.SESSION)
      .insert(sessionPayload)
      .select()
      .single();

    if (result.error) {
      return { ...result, error: normalizeSessionMutationError(result.error) };
    }

    if (result.data) {
      try { await logInsert('session', result.data.session_id, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }

      // Dual-write: populate session_schedule_day from legacy day string
      const dayNums = dayNamesToDayOfWeek(session.day);
      if (dayNums.length > 0) {
        try {
          await supabase.from(Tables.SESSION_SCHEDULE_DAY).insert(
            dayNums.map((d) => ({ session_id: result.data.session_id, day_of_week: d }))
          );
        } catch { /* non-critical dual-write */ }
      }
    }
    return result;
  },

  // Update session
  // dayChangeStrategy controls when the new day starts appearing in attendance:
  //   'from_start'        – reset all day-change history, new day covers entire range
  //   'after_last_attended' – new day starts after the last date with attendance records
  //   'from_today'        – effective from today (default / legacy)
  //   undefined           – auto (from_today when day changes)
  // timeChangeStrategy controls how session_time_change records are created:
  //   'from_start'          – clear all time-change records; new time applies to all dates (session.time updated)
  //   'after_last_attended' – insert time-change record from last attended + 1; earlier dates keep old time
  //   'from_today'          – insert time-change record from today; earlier dates keep old time
  //   undefined             – prompt handled by caller (Sessions.tsx shows TimeChangeStrategyDialog)
  async update(
    id: string,
    updates: UpdateSession,
    dayChangeStrategy?: 'from_start' | 'after_last_attended' | 'from_today' | 'from_date' | 'date_range',
    timeChangeStrategy?: 'from_start' | 'after_last_attended' | 'from_today' | 'from_date' | 'date_range',
    /** Required when dayChangeStrategy = 'from_date' or 'date_range' */
    dayChangeCutoffDate?: string,
    /** Required when timeChangeStrategy = 'from_date' or 'date_range' */
    timeChangeCutoffDate?: string,
    /** Required when dayChangeStrategy = 'date_range': last day the new schedule is active */
    dayChangeCutoffEndDate?: string,
    /** Required when timeChangeStrategy = 'date_range': last day the new schedule is active */
    timeChangeCutoffEndDate?: string,
  ) {
    const { data: oldData } = await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('session_id', id)
      .maybeSingle();

    // Dual-write: populate structured time columns when time changes
    const augmented = { ...updates };
    if (updates.time !== undefined) {
      const timeParts = extractTimeParts(updates.time);
      if (timeParts) {
        (augmented as Record<string, unknown>).start_time = timeParts.start_time;
        (augmented as Record<string, unknown>).end_time = timeParts.end_time;
      }
    }

    const result = await supabase
      .from(Tables.SESSION)
      .update(augmented)
      .eq('session_id', id)
      .select()
      .single();

    if (result.error) {
      return { ...result, error: normalizeSessionMutationError(result.error) };
    }

    if (oldData && result.data) {
      try { await logUpdate('session', id, oldData as Record<string, unknown>, result.data as Record<string, unknown>); } catch { /* audit non-critical */ }

      // Track day changes automatically
      if (updates.day !== undefined && oldData.day !== updates.day) {
        const strategy = dayChangeStrategy || 'from_today';

        // Helper: delete all day-change records for this session.
        // Needed by all strategies to prevent contradicting/overlapping records.
        const deleteAllChanges = async () => {
          const { error: delErr } = await supabase
            .from('session_day_change')
            .delete()
            .eq('session_id', id);
          // If DELETE fails (e.g. RLS), log it so we know
          if (delErr) console.warn('session_day_change delete failed (check RLS):', delErr.message);
          return !delErr;
        };

        // Helper: delete changes at or after a given date for this session
        const deleteFutureChanges = async (fromDate: string) => {
          const { error: delErr } = await supabase
            .from('session_day_change')
            .delete()
            .eq('session_id', id)
            .gte('effective_date', fromDate);
          if (delErr) console.warn('session_day_change future delete failed (check RLS):', delErr.message);
          return !delErr;
        };

        if (strategy === 'from_start') {
          // Wipe ALL day-change history — new day covers the entire session range
          await deleteAllChanges();
          // Dual-write: clean day-related exceptions (preserve time-only exceptions)
          try { await cleanupDayExceptions(id); } catch { /* non-critical */ }
          // No new record needed: session.day already updated to new value
        } else {
          // Compute effective_date based on strategy
          let effectiveDate = new Date().toISOString().split('T')[0]; // default: today

          if (strategy === 'date_range' && dayChangeCutoffDate && dayChangeCutoffEndDate) {
            // Bounded date range: new schedule applies [fromDate, toDate], reverts after
            const [ey, em, ed] = dayChangeCutoffEndDate.split('-').map(Number);
            const revertDate = new Date(ey, (em || 1) - 1, (ed || 1) + 1);
            const revertDateStr = revertDate.toISOString().split('T')[0];

            // Preserve the day active just before fromDate
            let rangePrevDay = oldData.day;
            try {
              const { data: earliest } = await supabase
                .from('session_day_change')
                .select('old_day')
                .eq('session_id', id)
                .gte('effective_date', dayChangeCutoffDate)
                .order('effective_date', { ascending: true })
                .limit(1)
                .maybeSingle();
              if (earliest?.old_day) rangePrevDay = earliest.old_day;
            } catch { /* fallback */ }

            // Delete existing records in [fromDate, revertDate] to avoid duplicates
            await supabase.from('session_day_change')
              .delete()
              .eq('session_id', id)
              .gte('effective_date', dayChangeCutoffDate)
              .lte('effective_date', revertDateStr);

            try {
              const { data: { user } } = await supabase.auth.getUser();
              // Insert start-of-range record
              await supabase.from('session_day_change').insert({
                session_id: id,
                old_day: rangePrevDay,
                new_day: updates.day,
                effective_date: dayChangeCutoffDate,
                changed_by: user?.email || null,
                reason: 'Date range start',
              });
              // Insert end-of-range revert record
              await supabase.from('session_day_change').insert({
                session_id: id,
                old_day: updates.day,
                new_day: rangePrevDay,
                effective_date: revertDateStr,
                changed_by: user?.email || null,
                reason: 'Date range end (revert)',
              });
              // Dual-write: exception table for date range
              const newDayNums = dayNamesToDayOfWeek(updates.day);
              const oldDayNums = dayNamesToDayOfWeek(rangePrevDay);
              await cleanupDayExceptions(id, { gte: dayChangeCutoffDate, lte: revertDateStr });
              await upsertScheduleException(id, dayChangeCutoffDate, null,
                newDayNums[0] != null ? { dayOfWeek: newDayNums[0], oldDayOfWeek: oldDayNums[0] } : null,
                'Date range start', user?.email || null);
              await upsertScheduleException(id, revertDateStr, null,
                oldDayNums[0] != null ? { dayOfWeek: oldDayNums[0], oldDayOfWeek: newDayNums[0] } : null,
                'Date range end (revert)', user?.email || null);
            } catch { /* day range log non-critical */ }
          } else {
            // from_date, from_today, after_last_attended: single-record insert
            if (strategy === 'from_date' && dayChangeCutoffDate) {
              effectiveDate = dayChangeCutoffDate;
            } else if (strategy === 'after_last_attended') {            try {
                const { data: lastAtt } = await supabase
                  .from(Tables.ATTENDANCE)
                  .select('attendance_date')
                  .eq('session_id', id)
                  .neq('status', 'absent')
                  .order('attendance_date', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (lastAtt?.attendance_date) {
                  // Day after the last attended date
                  const d = new Date(lastAtt.attendance_date);
                  d.setDate(d.getDate() + 1);
                  effectiveDate = d.toISOString().split('T')[0];
                }
              } catch { /* fallback to today */ }
            }

            // Before deleting overlapping records, preserve the earliest old_day
            // so the new record correctly reflects the day that was active before it
            let preservedOldDay = oldData.day;
            try {
              const { data: earliest } = await supabase
                .from('session_day_change')
                .select('old_day')
                .eq('session_id', id)
                .gte('effective_date', effectiveDate)
                .order('effective_date', { ascending: true })
                .limit(1)
                .maybeSingle();
              if (earliest?.old_day) preservedOldDay = earliest.old_day;
            } catch { /* use oldData.day fallback */ }

            // Remove any existing changes at or after the new effective date
            // to prevent overlapping/contradicting records
            await deleteFutureChanges(effectiveDate);

            try {
              const { data: { user } } = await supabase.auth.getUser();
              const dayReason = strategy === 'after_last_attended' ? 'After last attended date' : 'From today';
              await supabase.from('session_day_change').insert({
                session_id: id,
                old_day: preservedOldDay,
                new_day: updates.day,
                effective_date: effectiveDate,
                changed_by: user?.email || null,
                reason: dayReason,
              });
              // Dual-write: exception table
              await cleanupDayExceptions(id, { gte: effectiveDate });
              const newDayNums = dayNamesToDayOfWeek(updates.day);
              const oldDayNums = dayNamesToDayOfWeek(preservedOldDay);
              await upsertScheduleException(id, effectiveDate, null,
                newDayNums[0] != null ? { dayOfWeek: newDayNums[0], oldDayOfWeek: oldDayNums[0] } : null,
                dayReason, user?.email || null);
            } catch { /* day change log non-critical */ }
          }
        }
      }

      // When start_date advances, remove day_change records before the new start_date
      // so they don't generate phantom attendance dates in the old range
      if (updates.start_date && updates.start_date > (oldData.start_date || '')) {
        try {
          await supabase.from('session_day_change').delete()
            .eq('session_id', id)
            .lt('effective_date', updates.start_date);
          // Dual-write: also clean exceptions before new start_date
          await supabase.from(Tables.SESSION_SCHEDULE_EXCEPTION).delete()
            .eq('session_id', id)
            .lt('original_date', updates.start_date);
        } catch { /* cleanup non-critical */ }
      }

      // Handle time changes: insert session_time_change records
      // (mirrors session_day_change logic exactly)
      if (timeChangeStrategy && updates.time !== undefined && oldData.time !== updates.time) {
        const oldTime = oldData.time as string | null;
        const timeStrategy = timeChangeStrategy;

        // Helper: delete all time-change records for this session
        const deleteAllTimeChanges = async () => {
          const { error: delErr } = await supabase
            .from(Tables.SESSION_TIME_CHANGE)
            .delete()
            .eq('session_id', id);
          if (delErr) console.warn('session_time_change delete failed (check RLS):', delErr.message);
          return !delErr;
        };

        // Helper: delete time changes at or after a given date
        const deleteFutureTimeChanges = async (fromDate: string) => {
          const { error: delErr } = await supabase
            .from(Tables.SESSION_TIME_CHANGE)
            .delete()
            .eq('session_id', id)
            .gte('effective_date', fromDate);
          if (delErr) console.warn('session_time_change future delete failed (check RLS):', delErr.message);
          return !delErr;
        };

        try {
          if (timeStrategy === 'from_start') {
            // Wipe ALL time-change history — new time covers the entire session range
            await deleteAllTimeChanges();
            // Dual-write: clean time-related exceptions (preserve day-only exceptions)
            await cleanupTimeExceptions(id);
          } else {
            let effectiveDate = new Date().toISOString().split('T')[0]; // default: today

            if (timeStrategy === 'date_range' && timeChangeCutoffDate && timeChangeCutoffEndDate) {
              // Bounded date range: insert TWO records (start + revert)
              const [ey, em, ed] = timeChangeCutoffEndDate.split('-').map(Number);
              const revertDate = new Date(ey, (em || 1) - 1, (ed || 1) + 1);
              const revertDateStr = revertDate.toISOString().split('T')[0];

              let rangePrevTime = oldTime;
              try {
                const { data: earliest } = await supabase
                  .from(Tables.SESSION_TIME_CHANGE)
                  .select('old_time')
                  .eq('session_id', id)
                  .gte('effective_date', timeChangeCutoffDate)
                  .order('effective_date', { ascending: true })
                  .limit(1)
                  .maybeSingle();
                if (earliest?.old_time) rangePrevTime = earliest.old_time;
              } catch { /* fallback */ }

              await supabase.from(Tables.SESSION_TIME_CHANGE)
                .delete()
                .eq('session_id', id)
                .gte('effective_date', timeChangeCutoffDate)
                .lte('effective_date', revertDateStr);

              const { data: { user } } = await supabase.auth.getUser();
              await supabase.from(Tables.SESSION_TIME_CHANGE).insert({
                session_id: id,
                old_time: rangePrevTime,
                new_time: updates.time,
                effective_date: timeChangeCutoffDate,
                changed_by: user?.email || null,
                reason: 'Date range start',
              });
              await supabase.from(Tables.SESSION_TIME_CHANGE).insert({
                session_id: id,
                old_time: updates.time,
                new_time: rangePrevTime,
                effective_date: revertDateStr,
                changed_by: user?.email || null,
                reason: 'Date range end (revert)',
              });
              // Dual-write: exception table for time date range
              const newTimeParts = extractTimeParts(updates.time);
              const revertTimeParts = extractTimeParts(rangePrevTime);
              await cleanupTimeExceptions(id, { gte: timeChangeCutoffDate, lte: revertDateStr });
              await upsertScheduleException(id, timeChangeCutoffDate,
                newTimeParts ? { startTime: newTimeParts.start_time, endTime: newTimeParts.end_time } : null,
                null, 'Date range start', user?.email || null);
              await upsertScheduleException(id, revertDateStr,
                revertTimeParts ? { startTime: revertTimeParts.start_time, endTime: revertTimeParts.end_time } : null,
                null, 'Date range end (revert)', user?.email || null);
            } else {
              // from_date, from_today, after_last_attended: single-record insert
              if (timeStrategy === 'from_date' && timeChangeCutoffDate) {
                effectiveDate = timeChangeCutoffDate;
              } else if (timeStrategy === 'after_last_attended') {
                const { data: lastAtt } = await supabase
                  .from(Tables.ATTENDANCE)
                  .select('attendance_date')
                  .eq('session_id', id)
                  .neq('status', 'absent')
                  .neq('host_address', 'SESSION_NOT_HELD')
                  .order('attendance_date', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (lastAtt?.attendance_date) {
                  const d = new Date(lastAtt.attendance_date);
                  d.setDate(d.getDate() + 1);
                  effectiveDate = d.toISOString().split('T')[0];
                }
              }

              let preservedOldTime = oldTime;
              try {
                const { data: earliest } = await supabase
                  .from(Tables.SESSION_TIME_CHANGE)
                  .select('old_time')
                  .eq('session_id', id)
                  .gte('effective_date', effectiveDate)
                  .order('effective_date', { ascending: true })
                  .limit(1)
                  .maybeSingle();
                if (earliest?.old_time) preservedOldTime = earliest.old_time;
              } catch { /* fallback */ }

              await deleteFutureTimeChanges(effectiveDate);

              const { data: { user } } = await supabase.auth.getUser();
              const timeReason = timeStrategy === 'after_last_attended' ? 'After last attended date' : 'From today';
              await supabase.from(Tables.SESSION_TIME_CHANGE).insert({
                session_id: id,
                old_time: preservedOldTime,
                new_time: updates.time,
                effective_date: effectiveDate,
                changed_by: user?.email || null,
                reason: timeReason,
              });
              // Dual-write: exception table
              await cleanupTimeExceptions(id, { gte: effectiveDate });
              const timeParts = extractTimeParts(updates.time);
              await upsertScheduleException(id, effectiveDate,
                timeParts ? { startTime: timeParts.start_time, endTime: timeParts.end_time } : null,
                null, timeReason, user?.email || null);
            }
          }
        } catch { /* time change log non-critical */ }
      }

      // Dual-write: sync session_schedule_day when day changes (all strategies update session.day)
      if (updates.day !== undefined && oldData.day !== updates.day) {
        try {
          await supabase.from(Tables.SESSION_SCHEDULE_DAY).delete().eq('session_id', id);
          const dayNums = dayNamesToDayOfWeek(updates.day);
          if (dayNums.length > 0) {
            await supabase.from(Tables.SESSION_SCHEDULE_DAY).insert(
              dayNums.map((d) => ({ session_id: id, day_of_week: d }))
            );
          }
        } catch { /* non-critical dual-write */ }
      }
    }
    return result;
  },

  // Get the effective session time for a specific date.
  // Checks session_schedule_exception first (new), falls back to session_time_change (legacy).
  // Returns "HH:MM-HH:MM" override or null (meaning use session.time).
  async getEffectiveTimeForDate(sessionId: string, date: string): Promise<string | null> {
    try {
      // 1. Check new exception table for time overrides on this date
      const { data: exception } = await supabase
        .from(Tables.SESSION_SCHEDULE_EXCEPTION)
        .select('new_start_time, new_end_time, exception_type')
        .eq('session_id', sessionId)
        .eq('original_date', date)
        .maybeSingle();

      if (exception && exception.new_start_time && exception.new_end_time) {
        const start = exception.new_start_time.slice(0, 5); // "HH:MM:SS" → "HH:MM"
        const end = exception.new_end_time.slice(0, 5);
        return `${start}-${end}`;
      }

      // 2. Fall back to legacy session_time_change
      const { data } = await supabase
        .from(Tables.SESSION_TIME_CHANGE)
        .select('new_time')
        .eq('session_id', sessionId)
        .lte('effective_date', date)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.new_time) return data.new_time;

      // 3. If no change ≤ this date but changes exist AFTER this date,
      //    the selected date predates all changes — use old_time from the earliest change
      const { data: earliest } = await supabase
        .from(Tables.SESSION_TIME_CHANGE)
        .select('old_time')
        .eq('session_id', sessionId)
        .order('effective_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      return earliest?.old_time ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Get the effective day name for a specific date.
   * If the date falls before a day change, returns the old day.
   * Returns null if no day changes exist (caller should use session.day).
   */
  async getEffectiveDayForDate(sessionId: string, date: string): Promise<string | null> {
    try {
      // 1. Check new exception table for day override on this date
      const { data: exception } = await supabase
        .from(Tables.SESSION_SCHEDULE_EXCEPTION)
        .select('new_day_of_week, old_day_of_week, exception_type')
        .eq('session_id', sessionId)
        .eq('original_date', date)
        .in('exception_type', ['day_change', 'time_and_day_change'])
        .maybeSingle();

      if (exception && exception.new_day_of_week != null) {
        return DAY_NAMES[exception.new_day_of_week] ?? null;
      }

      // 2. Fall back to legacy session_day_change
      const { data } = await supabase
        .from('session_day_change')
        .select('new_day')
        .eq('session_id', sessionId)
        .lte('effective_date', date)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.new_day) return data.new_day;

      // 3. If no change ≤ this date but changes exist after, return old_day from earliest
      const { data: earliest } = await supabase
        .from('session_day_change')
        .select('old_day')
        .eq('session_id', sessionId)
        .order('effective_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      return earliest?.old_day ?? null;
    } catch {
      return null;
    }
  },

  // Get all time-change records for a session (for BulkScheduleTable display).
  async getTimeChanges(sessionId: string) {
    return supabase
      .from(Tables.SESSION_TIME_CHANGE)
      .select('change_id, old_time, new_time, effective_date, reason, changed_by, created_at')
      .eq('session_id', sessionId)
      .order('effective_date', { ascending: true });
  },

  // Get the last attendance date with actual records for a session
  async getLastAttendedDate(sessionId: string) {
    const { data } = await supabase
      .from(Tables.ATTENDANCE)
      .select('attendance_date')
      .eq('session_id', sessionId)
      .neq('status', 'absent')
      .neq('host_address', 'SESSION_NOT_HELD')
      .order('attendance_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.attendance_date || null;
  },

  // Delete session
  async delete(id: string) {
    // Fetch session data before deletion for audit log
    const { data: session } = await supabase
      .from(Tables.SESSION)
      .select('*')
      .eq('session_id', id)
      .maybeSingle();

    // Log the deletion
    if (session) {
      try { await logDelete('session', id, session as Record<string, unknown>); } catch { /* audit non-critical */ }
    }

    // Delete dependent records in FK order (most tables lack ON DELETE CASCADE).
    // Log but don't abort on individual cascade failures.
    const cascadeTables = [
      { table: Tables.ATTENDANCE },
      { table: 'qr_sessions' },
      { table: 'photo_checkin_sessions' },
      { table: Tables.SESSION_RECORDING },
      { table: Tables.SESSION_DATE_HOST },
      { table: Tables.SESSION_BOOK_COVERAGE },
      { table: Tables.FEEDBACK_QUESTION },
      { table: Tables.SESSION_FEEDBACK },
      { table: 'excuse_request' },
      { table: Tables.TEACHER_HOST_SCHEDULE },
      { table: 'session_day_change' },
      { table: Tables.SESSION_SCHEDULE_DAY },
      { table: Tables.SESSION_SCHEDULE_EXCEPTION },
      { table: Tables.ENROLLMENT },
    ] as const;
    for (const { table } of cascadeTables) {
      const { error: delErr } = await supabase.from(table).delete().eq('session_id', id);
      if (delErr) console.warn(`session.delete: failed to cascade-delete from ${table}:`, delErr.message);
    }

    return await supabase
      .from(Tables.SESSION)
      .delete()
      .eq('session_id', id);
  },

  // Check for scheduling conflicts
  async checkConflict(teacherId: string, startDate: string, endDate: string, excludeSessionId?: string) {
    let query = supabase
      .from(Tables.SESSION)
      .select('session_id, start_date, end_date')
      .eq('teacher_id', teacherId)
      .lte('start_date', endDate)
      .gte('end_date', startDate);

    if (excludeSessionId) {
      query = query.neq('session_id', excludeSessionId);
    }

    return await query;
  },

  async checkScheduleConflicts(input: {
    teacherId: string;
    startDate: string;
    endDate: string;
    day: string | null;
    time?: string | null;
    excludeSessionId?: string;
  }) {
    const requestedDates = enumerateSessionDates(input.startDate, input.endDate, input.day);
    if (requestedDates.length === 0) {
      return { data: [] as SessionScheduleConflict[], error: null };
    }

    let query = supabase
      .from(Tables.SESSION)
      .select('session_id, day, start_date, end_date, time, course:course_id(course_name)')
      .eq('teacher_id', input.teacherId)
      .lte('start_date', input.endDate)
      .gte('end_date', input.startDate);

    if (input.excludeSessionId) {
      query = query.neq('session_id', input.excludeSessionId);
    }

    const { data, error } = await query;
    if (error || !data) {
      return { data: [] as SessionScheduleConflict[], error };
    }

    const requestedDateSet = new Set(requestedDates);
    const requestedRange = parseTimeRange(input.time ?? null);
    const conflicts: SessionScheduleConflict[] = [];

    for (const session of data as Array<{
      session_id: string;
      day: string | null;
      start_date: string;
      end_date: string;
      time: string | null;
      course?: { course_name?: string } | { course_name?: string }[] | null;
    }>) {
      const existingDates = enumerateSessionDates(session.start_date, session.end_date, session.day);
      const existingRange = parseTimeRange(session.time);
      const course = Array.isArray(session.course) ? session.course[0] : session.course;

      for (const conflictDate of existingDates) {
        if (!requestedDateSet.has(conflictDate)) continue;
        if (!rangesOverlap(requestedRange, existingRange)) continue;

        conflicts.push({
          sessionId: session.session_id,
          courseName: course?.course_name || 'another session',
          conflictDate,
          requestedTime: input.time ?? null,
          existingTime: session.time,
          reason: requestedRange && existingRange
            ? 'The teacher is already assigned during an overlapping time range.'
            : 'The teacher is already assigned on the same teaching date, and at least one session has no complete time range.',
        });
      }
    }

    return { data: conflicts, error: null };
  },

  // Get session with enrollment count
  async getWithEnrollmentCount(id: string) {
    const [sessionRes, enrollmentRes] = await Promise.all([
      this.getById(id),
      supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id')
        .eq('session_id', id)
    ]);

    return {
      data: sessionRes.data ? {
        ...sessionRes.data,
        enrollmentCount: enrollmentRes.data?.length || 0
      } : null,
      error: sessionRes.error || enrollmentRes.error
    };
  },

  // Get day-change history for a session
  async getDayChangeHistory(sessionId: string) {
    return await supabase
      .from('session_day_change')
      .select('*')
      .eq('session_id', sessionId)
      .order('effective_date', { ascending: false });
  },

  // Generate expected session dates from start_date, end_date, and day(s)
  generateSessionDates(
    startDate: string,
    endDate: string,
    days: string | null,
    dayChanges?: Array<{ old_day: string; new_day: string; effective_date: string }>
  ): string[] {
    if (!days) return [];

    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];

    const dayMap: Record<string, number> = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6,
    };

    // Parse day changes to determine which days apply at which point
    const changes = (dayChanges || []).sort(
      (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
    );

    // Build date-range → days mapping
    const dayRanges: Array<{ from: Date; to: Date; dayNums: number[] }> = [];

    if (changes.length === 0) {
      // No changes: same days for entire range
      const dayNums = days.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
      dayRanges.push({ from: start, to: end, dayNums });
    } else {
      // Reconstruct initial day from the first change's old_day,
      // since session.day is already updated to the latest value
      let currentDays = changes[0].old_day || days;
      let rangeStart = start;

      for (const change of changes) {
        const effectiveDate = new Date(change.effective_date);
        // Skip changes before start, but absorb their effect
        if (effectiveDate <= start) {
          currentDays = change.new_day;
          continue;
        }
        if (effectiveDate > rangeStart) {
          const dayNums = currentDays.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
          if (dayNums.length > 0) {
            dayRanges.push({ from: rangeStart, to: new Date(effectiveDate.getTime() - 86400000), dayNums });
          }
        }
        currentDays = change.new_day;
        rangeStart = effectiveDate;
      }
      // Last range to end — clamp to at least start
      if (rangeStart < start) rangeStart = start;
      const dayNums = currentDays.split(',').map(d => dayMap[d.trim()]).filter(n => n !== undefined);
      if (dayNums.length > 0) {
        dayRanges.push({ from: rangeStart, to: end, dayNums });
      }
    }

    // Generate all matching dates
    for (const range of dayRanges) {
      const cursor = new Date(range.from);
      while (cursor <= range.to) {
        if (range.dayNums.includes(cursor.getDay())) {
          dates.push(cursor.toISOString().split('T')[0]);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return dates.sort();
  },

  // Lookups for SessionForm
  async getFormLookups() {
    const [teachers, courses, locations] = await Promise.all([
      supabase.from(Tables.TEACHER).select('teacher_id, name').order('name'),
      supabase.from(Tables.COURSE).select('course_id, course_name').order('course_name'),
      supabase.from(Tables.SESSION).select('location').not('location', 'is', null).order('created_at', { ascending: false }).limit(50),
    ]);
    return { teachers, courses, locations };
  },

  // Full session query with joins (for Sessions page)
  async getAllWithJoins() {
    return await supabase
      .from(Tables.SESSION)
      .select('*, course:course_id(course_name, description), teacher:teacher_id(name)')
      .order('start_date', { ascending: false });
  },

  // Update enrollment host date (for BulkScheduleTable)
  async updateEnrollmentHostDate(enrollmentId: string, hostDate: string | null) {
    return await supabase
      .from(Tables.ENROLLMENT)
      .update({ host_date: hostDate })
      .eq('enrollment_id', enrollmentId);
  },

  async getActiveEnrollmentCounts(sessionIds: string[]) {
    if (sessionIds.length === 0) return { data: [], error: null };
    return await supabase
      .from(Tables.ENROLLMENT)
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('status', 'active');
  },
};
