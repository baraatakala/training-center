import { supabase } from '@/shared/lib/supabase';
import { Tables } from '@/shared/types/database.types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type StudentMergePreview = {
  student_id: string;
  student_name: string;
  student_email: string;
  source_enrollment_id: string;
  /** null means the student is not enrolled in the target session */
  target_enrollment_id: string | null;
  /** dates that can be cleanly inserted into the target (no existing record) */
  transferable_dates: string[];
  /** dates where the target already has an attendance record */
  conflict_dates: string[];
  /** per-date status from the source session */
  statuses: Record<string, string>;
};

/** Per-date breakdown used for the date-picker step in the merge modal. */
export type MergeDatePreview = {
  date: string;                           // YYYY-MM-DD
  transferable_count: number;             // students with no conflict on this date
  conflict_count: number;                 // students whose target record already exists
  unenrolled_count: number;              // students not enrolled in target session
  status_summary: Record<string, number>; // { present: 2, absent: 1, late: 0, excused: 1 }
  has_host_override: boolean;             // session_date_host row exists for this date
  has_time_change: boolean;              // session_time_change row with this effective_date
  has_day_change: boolean;               // session_day_change row with this effective_date
  has_recording: boolean;                // non-deleted session_recording for this date
  has_book_coverage: boolean;            // session_book_coverage row for this date
  /** true when this date falls outside the target session's start_date..end_date range */
  out_of_range: boolean;
};

export type MergePreview = {
  students: StudentMergePreview[];
  /** Per-date breakdown for the date-picker step. Sorted ascending by date. */
  dates: MergeDatePreview[];
  /** Target session start_date (YYYY-MM-DD) — used by UI to show out-of-range warning */
  target_start_date: string;
  /** Target session end_date (YYYY-MM-DD) — used by UI to show out-of-range warning */
  target_end_date: string;
  date_host_override_count: number;
  teacher_host_schedule_count: number;
  recording_count: number;
  book_coverage_count: number;
  feedback_question_count: number;
  /** true when source and target belong to the same course — required for book coverage transfer */
  same_course: boolean;
  summary: {
    students_count: number;
    total_transferable: number;
    total_conflicts: number;
    /** attendance records belonging to students NOT enrolled in target */
    total_unenrolled_records: number;
  };
};

export type MergeOptions = {
  conflict_resolution: 'skip' | 'overwrite';
  auto_enroll: boolean;
  transfer_date_host_overrides: boolean;
  /** Transfer per-date content: recording links, book coverage, feedback questions */
  transfer_per_date_content: boolean;
  delete_source_after: boolean;
  /**
   * When set, only attendance records / per-date content for these dates are merged.
   * All dates are merged when undefined or empty.
   */
  selected_dates?: string[];
};

export type MergeResult = {
  enrolled: number;
  transferred: number;
  overwritten: number;
  /** Records intentionally skipped (conflict_resolution=skip, or auto_enroll=false) */
  skipped: number;
  /** Records that failed due to DB errors (constraint violations, network, etc.) */
  failed: number;
  date_host_overrides_transferred: number;
  recordings_transferred: number;
  book_coverages_transferred: number;
  feedback_questions_transferred: number;
  source_deleted: boolean;
  errors: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export const sessionMergeService = {
  /**
   * Analyse what a merge would do WITHOUT writing anything.
   * Call this first to render the preview UI.
   */
  async previewMerge(
    sourceSessionId: string,
    targetSessionId: string,
  ): Promise<{ data: MergePreview | null; error: { message: string } | null }> {
    if (sourceSessionId === targetSessionId) {
      return { data: null, error: { message: 'Cannot merge a session into itself.' } };
    }
    try {
      // 1. Source attendance records (lightweight - only metadata needed)
      const { data: sourceAttendance, error: sourceErr } = await supabase
        .from(Tables.ATTENDANCE)
        .select('enrollment_id, student_id, attendance_date, status')
        .eq('session_id', sourceSessionId);

      if (sourceErr) return { data: null, error: { message: sourceErr.message } };

      if (!sourceAttendance || sourceAttendance.length === 0) {
        const [
          { count: earlyOverrideCount },
          { count: earlyScheduleCount },
          { count: earlyRecordingCount },
          { count: earlyBookCount },
          { count: earlyFeedbackCount },
          { data: srcSess },
          { data: tgtSess },
        ] = await Promise.all([
          supabase.from(Tables.SESSION_DATE_HOST).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
          supabase.from(Tables.TEACHER_HOST_SCHEDULE).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
          supabase.from(Tables.SESSION_RECORDING).select('recording_id', { count: 'exact', head: true }).eq('session_id', sourceSessionId).is('deleted_at', null),
          supabase.from(Tables.SESSION_BOOK_COVERAGE).select('coverage_id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
          supabase.from(Tables.FEEDBACK_QUESTION).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
          supabase.from(Tables.SESSION).select('course_id').eq('session_id', sourceSessionId).single(),
          supabase.from(Tables.SESSION).select('course_id, start_date, end_date').eq('session_id', targetSessionId).single(),
        ]);
        return {
          data: {
            students: [],
            dates: [],
            target_start_date: (tgtSess?.start_date as string) || '',
            target_end_date: (tgtSess?.end_date as string) || '',
            date_host_override_count: earlyOverrideCount || 0,
            teacher_host_schedule_count: earlyScheduleCount || 0,
            recording_count: earlyRecordingCount || 0,
            book_coverage_count: earlyBookCount || 0,
            feedback_question_count: earlyFeedbackCount || 0,
            same_course: srcSess?.course_id === tgtSess?.course_id,
            summary: {
              students_count: 0,
              total_transferable: 0,
              total_conflicts: 0,
              total_unenrolled_records: 0,
            },
          },
          error: null,
        };
      }

      // 2. Target session enrollments: student_id -> enrollment_id
      const { data: targetEnrollments, error: targetEnrollErr } = await supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id, student_id')
        .eq('session_id', targetSessionId);

      if (targetEnrollErr) return { data: null, error: { message: targetEnrollErr.message } };

      const targetEnrollmentMap = new Map<string, string>();
      for (const e of (targetEnrollments || [])) {
        targetEnrollmentMap.set(e.student_id, e.enrollment_id);
      }

      // 3. Existing target attendance records (for conflict detection)
      const targetEnrollmentIds = [...targetEnrollmentMap.values()];
      const targetAttendanceSet = new Set<string>(); // key: "enrollment_id|attendance_date"

      if (targetEnrollmentIds.length > 0) {
        const { data: targetAtt, error: targetAttErr } = await supabase
          .from(Tables.ATTENDANCE)
          .select('enrollment_id, attendance_date')
          .in('enrollment_id', targetEnrollmentIds);

        if (targetAttErr) return { data: null, error: { message: targetAttErr.message } };

        for (const a of (targetAtt || [])) {
          targetAttendanceSet.add(`${a.enrollment_id}|${a.attendance_date}`);
        }
      }

      // 4. Student names for display
      const studentIds = [...new Set(sourceAttendance.map((a) => a.student_id))];

      const { data: students, error: studErr } = await supabase
        .from(Tables.STUDENT)
        .select('student_id, name, email')
        .in('student_id', studentIds);

      if (studErr) return { data: null, error: { message: studErr.message } };

      const studentMap = new Map<string, { name: string; email: string }>();
      for (const s of (students || [])) {
        studentMap.set(s.student_id, { name: s.name, email: s.email });
      }

      // 5. Per-student breakdown
      const grouped = new Map<
        string,
        { source_enrollment_id: string; dates: Array<{ date: string; status: string }> }
      >();

      for (const att of sourceAttendance) {
        if (!grouped.has(att.student_id)) {
          grouped.set(att.student_id, {
            source_enrollment_id: att.enrollment_id,
            dates: [],
          });
        }
        grouped.get(att.student_id)!.dates.push({
          date: att.attendance_date,
          status: att.status,
        });
      }

      const studentStatuses: StudentMergePreview[] = [];
      let totalTransferable = 0;
      let totalConflicts = 0;
      let totalUnenrolledRecords = 0;

      for (const [student_id, group] of grouped) {
        const target_enrollment_id = targetEnrollmentMap.get(student_id) || null;
        const transferable_dates: string[] = [];
        const conflict_dates: string[] = [];
        const statuses: Record<string, string> = {};

        for (const { date, status } of group.dates) {
          statuses[date] = status;

          if (target_enrollment_id) {
            if (targetAttendanceSet.has(`${target_enrollment_id}|${date}`)) {
              conflict_dates.push(date);
            } else {
              transferable_dates.push(date);
            }
          } else {
            // Student not enrolled in target — count separately
            transferable_dates.push(date); // becomes transferable IF auto_enroll is on
          }
        }

        if (!target_enrollment_id) {
          totalUnenrolledRecords += group.dates.length;
        } else {
          totalTransferable += transferable_dates.length;
          totalConflicts += conflict_dates.length;
        }

        studentStatuses.push({
          student_id,
          student_name: studentMap.get(student_id)?.name || 'Unknown Student',
          student_email: studentMap.get(student_id)?.email || '',
          source_enrollment_id: group.source_enrollment_id,
          target_enrollment_id,
          transferable_dates,
          conflict_dates,
          statuses,
        });
      }

      // ── Build per-date breakdown ──────────────────────────────────────────
      // Group source attendance by date to compute per-date stats.
      // We reuse `targetEnrollmentMap` and `targetAttendanceSet` already computed above.
      const dateGroupMap = new Map<
        string,
        { transferable: number; conflicts: number; unenrolled: number; statuses: Record<string, number> }
      >();
      for (const att of (sourceAttendance || [])) {
        if (!dateGroupMap.has(att.attendance_date)) {
          dateGroupMap.set(att.attendance_date, { transferable: 0, conflicts: 0, unenrolled: 0, statuses: {} });
        }
        const dg = dateGroupMap.get(att.attendance_date)!;
        dg.statuses[att.status] = (dg.statuses[att.status] || 0) + 1;
        const tEnrollId = targetEnrollmentMap.get(att.student_id);
        if (!tEnrollId) {
          dg.unenrolled++;
        } else if (targetAttendanceSet.has(`${tEnrollId}|${att.attendance_date}`)) {
          dg.conflicts++;
        } else {
          dg.transferable++;
        }
      }

      // Fetch per-date content metadata in one parallel batch.
      // We only need the date field — not full rows — so queries stay lightweight.
      const [
        { data: hostDateRows },
        { count: scheduleCount },
        { data: recordingDateRows },
        { data: bookCoverageDateRows },
        { count: feedbackQuestionCount },
        { data: timeChangeDateRows },
        { data: dayChangeDateRows },
        { data: srcSession },
        { data: tgtSession },
      ] = await Promise.all([
        supabase.from(Tables.SESSION_DATE_HOST).select('attendance_date').eq('session_id', sourceSessionId),
        supabase.from(Tables.TEACHER_HOST_SCHEDULE).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
        supabase.from(Tables.SESSION_RECORDING).select('attendance_date').eq('session_id', sourceSessionId).is('deleted_at', null),
        supabase.from(Tables.SESSION_BOOK_COVERAGE).select('attendance_date').eq('session_id', sourceSessionId),
        supabase.from(Tables.FEEDBACK_QUESTION).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
        supabase.from(Tables.SESSION_TIME_CHANGE).select('effective_date').eq('session_id', sourceSessionId),
        supabase.from('session_day_change').select('effective_date').eq('session_id', sourceSessionId),
        supabase.from(Tables.SESSION).select('course_id').eq('session_id', sourceSessionId).single(),
        supabase.from(Tables.SESSION).select('course_id, start_date, end_date').eq('session_id', targetSessionId).single(),
      ]);

      const hostDateSet = new Set((hostDateRows || []).map((r) => r.attendance_date as string));
      const timeChangeDateSet = new Set((timeChangeDateRows || []).map((r) => r.effective_date as string));
      const dayChangeDateSet = new Set((dayChangeDateRows || []).map((r) => r.effective_date as string));
      const recordingDateSet = new Set((recordingDateRows || []).map((r) => r.attendance_date as string));
      const bookCoverageDateSet = new Set((bookCoverageDateRows || []).map((r) => r.attendance_date as string));

      // Target session date range — dates outside this range are flagged as out_of_range
      const targetStartDate = tgtSession?.start_date as string | undefined;
      const targetEndDate = tgtSession?.end_date as string | undefined;

      const datePreviews: MergeDatePreview[] = [...dateGroupMap.keys()].sort().map((date) => {
        const dg = dateGroupMap.get(date)!;
        const outOfRange = !!(
          (targetStartDate && date < targetStartDate) ||
          (targetEndDate && date > targetEndDate)
        );
        return {
          date,
          transferable_count: dg.transferable,
          conflict_count: dg.conflicts,
          unenrolled_count: dg.unenrolled,
          status_summary: dg.statuses,
          has_host_override: hostDateSet.has(date),
          has_time_change: timeChangeDateSet.has(date),
          has_day_change: dayChangeDateSet.has(date),
          has_recording: recordingDateSet.has(date),
          has_book_coverage: bookCoverageDateSet.has(date),
          out_of_range: outOfRange,
        };
      });

      return {
        data: {
          students: studentStatuses,
          dates: datePreviews,
          target_start_date: targetStartDate || '',
          target_end_date: targetEndDate || '',
          date_host_override_count: (hostDateRows || []).length,
          teacher_host_schedule_count: scheduleCount || 0,
          recording_count: (recordingDateRows || []).length,
          book_coverage_count: (bookCoverageDateRows || []).length,
          feedback_question_count: feedbackQuestionCount || 0,
          same_course: srcSession?.course_id === tgtSession?.course_id,
          summary: {
            students_count: studentStatuses.length,
            total_transferable: totalTransferable,
            total_conflicts: totalConflicts,
            total_unenrolled_records: totalUnenrolledRecords,
          },
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  },

  /**
   * Execute the merge. Re-fetches live data at execution time to handle
   * concurrent changes since the preview was computed.
   */
  async mergeSession(
    sourceSessionId: string,
    targetSessionId: string,
    options: MergeOptions,
  ): Promise<{ data: MergeResult | null; error: { message: string } | null }> {
    if (sourceSessionId === targetSessionId) {
      return { data: null, error: { message: 'Cannot merge a session into itself.' } };
    }
    const result: MergeResult = {
      enrolled: 0,
      transferred: 0,
      overwritten: 0,
      skipped: 0,
      failed: 0,
      date_host_overrides_transferred: 0,
      recordings_transferred: 0,
      book_coverages_transferred: 0,
      feedback_questions_transferred: 0,
      source_deleted: false,
      errors: [],
    };

    try {
      // ── 0. Fetch target session date range for validation ─────────────────
      const { data: targetSession, error: tsErr } = await supabase
        .from(Tables.SESSION)
        .select('start_date, end_date')
        .eq('session_id', targetSessionId)
        .single();

      if (tsErr || !targetSession) {
        return { data: null, error: { message: tsErr?.message || 'Target session not found.' } };
      }

      const targetStartDate = targetSession.start_date as string;
      const targetEndDate = targetSession.end_date as string;

      // ── 1. Re-fetch fresh target enrollments ──────────────────────────────
      const { data: targetEnrollments, error: teErr } = await supabase
        .from(Tables.ENROLLMENT)
        .select('enrollment_id, student_id')
        .eq('session_id', targetSessionId);

      if (teErr) return { data: null, error: { message: teErr.message } };

      const targetEnrollmentMap = new Map<string, string>(); // student_id -> enrollment_id
      for (const e of (targetEnrollments || [])) {
        targetEnrollmentMap.set(e.student_id, e.enrollment_id);
      }

      // ── 1b. Source enrollments — used to copy can_host when auto-enrolling ──
      const { data: sourceEnrollments } = await supabase
        .from(Tables.ENROLLMENT)
        .select('student_id, can_host')
        .eq('session_id', sourceSessionId);

      const sourceEnrollmentCanHost = new Map<string, boolean>();
      for (const e of (sourceEnrollments || [])) {
        sourceEnrollmentCanHost.set(e.student_id, e.can_host ?? false);
      }

      // ── 2. Re-fetch full source attendance records ────────────────────────
      const { data: sourceAttendance, error: saErr } = await supabase
        .from(Tables.ATTENDANCE)
        .select('*')
        .eq('session_id', sourceSessionId);

      if (saErr) return { data: null, error: { message: saErr.message } };

      // ── 3. Build conflict lookup from target attendance ───────────────────
      const allTargetEnrollmentIds = [...targetEnrollmentMap.values()];
      const existingTargetAttKeys = new Set<string>();
      const existingTargetAttIds: Record<string, string> = {}; // "enrollment_id|date" -> attendance_id

      if (allTargetEnrollmentIds.length > 0) {
        const { data: existingTargetAtt } = await supabase
          .from(Tables.ATTENDANCE)
          .select('attendance_id, enrollment_id, attendance_date')
          .in('enrollment_id', allTargetEnrollmentIds);

        for (const a of (existingTargetAtt || [])) {
          const key = `${a.enrollment_id}|${a.attendance_date}`;
          existingTargetAttKeys.add(key);
          existingTargetAttIds[key] = a.attendance_id;
        }
      }

      // ── 4. Process each source attendance record ──────────────────────────
      // When selected_dates is provided, restrict to only those dates.
      const dateFilter = options.selected_dates && options.selected_dates.length > 0
        ? new Set(options.selected_dates)
        : null;

      // Compute earliest attendance date being merged — used for enrollment_date
      // so students don't show as "not enrolled" for transferred dates.
      const earliestMergeDate = (dateFilter
        ? [...dateFilter].sort()[0]
        : (sourceAttendance || []).map((a) => a.attendance_date as string).sort()[0]
      ) || targetStartDate;

      for (const att of (sourceAttendance || [])) {
        // Skip dates not in the teacher's selection
        if (dateFilter && !dateFilter.has(att.attendance_date)) {
          continue;
        }

        // Skip dates outside the target session's date range
        if (att.attendance_date < targetStartDate || att.attendance_date > targetEndDate) {
          result.skipped++;
          result.errors.push(
            `Skipped ${att.attendance_date}: outside target session range (${targetStartDate} — ${targetEndDate})`,
          );
          continue;
        }

        let targetEnrollmentId = targetEnrollmentMap.get(att.student_id) || null;

        // Auto-enroll student in target session if not yet enrolled
        if (!targetEnrollmentId) {
          if (!options.auto_enroll) {
            result.skipped++;
            continue;
          }

          // Check for existing enrollment first — UNIQUE(student_id, session_id) means a raw
          // INSERT would throw 23505 if the student was previously dropped or completed.
          const { data: existingEnroll } = await supabase
            .from(Tables.ENROLLMENT)
            .select('enrollment_id, status')
            .eq('student_id', att.student_id)
            .eq('session_id', targetSessionId)
            .maybeSingle();

          if (existingEnroll) {
            // Reactivate if not already active, and backdate enrollment_date if needed
            const needsUpdate = existingEnroll.status !== 'active';
            const { data: existEnrollFull } = await supabase
              .from(Tables.ENROLLMENT)
              .select('enrollment_date')
              .eq('enrollment_id', existingEnroll.enrollment_id)
              .single();
            const needsBackdate = existEnrollFull && existEnrollFull.enrollment_date > earliestMergeDate;

            if (needsUpdate || needsBackdate) {
              const patch: Record<string, unknown> = {};
              if (needsUpdate) patch.status = 'active';
              if (needsBackdate) patch.enrollment_date = earliestMergeDate;

              const { error: reactivateErr } = await supabase
                .from(Tables.ENROLLMENT)
                .update(patch)
                .eq('enrollment_id', existingEnroll.enrollment_id);
              if (reactivateErr) {
                result.errors.push(
                  `Could not reactivate enrollment (${att.student_id}): ${reactivateErr.message}`,
                );
                result.failed++;
                continue;
              }
            }
            targetEnrollmentId = existingEnroll.enrollment_id;
            targetEnrollmentMap.set(att.student_id, existingEnroll.enrollment_id);
            result.enrolled++;
          } else {
            const { data: newEnroll, error: enrollErr } = await supabase
              .from(Tables.ENROLLMENT)
              .insert({
                student_id: att.student_id,
                session_id: targetSessionId,
                status: 'active',
                can_host: sourceEnrollmentCanHost.get(att.student_id) ?? false,
                enrollment_date: earliestMergeDate,
              })
              .select('enrollment_id')
              .single();

            if (enrollErr || !newEnroll) {
              result.errors.push(
                `Could not enroll student (${att.student_id}): ${enrollErr?.message || 'unknown error'}`,
              );
              result.failed++;
              continue;
            }

            targetEnrollmentId = newEnroll.enrollment_id;
            targetEnrollmentMap.set(att.student_id, newEnroll.enrollment_id);
            result.enrolled++;
          }
        }

        const conflictKey = `${targetEnrollmentId}|${att.attendance_date}`;
        const hasConflict = existingTargetAttKeys.has(conflictKey);

        if (hasConflict) {
          if (options.conflict_resolution === 'skip') {
            result.skipped++;
            continue;
          }

          // Overwrite: update the existing target attendance record
          const existingAttId = existingTargetAttIds[conflictKey];
          const { error: updateErr } = await supabase
            .from(Tables.ATTENDANCE)
            .update({
              status: att.status,
              excuse_reason: att.excuse_reason ?? null,
              check_in_time: att.check_in_time,
              notes: att.notes,
              host_address: att.host_address,
              late_minutes: att.late_minutes,
              check_in_method: att.check_in_method,
              distance_from_host: att.distance_from_host,
              early_minutes: att.early_minutes,
              marked_at: att.marked_at,
              marked_by: att.marked_by ?? null,
              gps_latitude: att.gps_latitude ?? null,
              gps_longitude: att.gps_longitude ?? null,
              gps_accuracy: att.gps_accuracy ?? null,
              gps_timestamp: att.gps_timestamp ?? null,
            })
            .eq('attendance_id', existingAttId);

          if (updateErr) {
            result.errors.push(
              `Overwrite failed for ${att.attendance_date}: ${updateErr.message}`,
            );
            result.failed++;
          } else {
            result.overwritten++;
          }
          continue;
        }

        // Clean insert — no conflict
        const { error: insertErr } = await supabase
          .from(Tables.ATTENDANCE)
          .insert({
            enrollment_id: targetEnrollmentId,
            student_id: att.student_id,
            session_id: targetSessionId,
            attendance_date: att.attendance_date,
            status: att.status,
            excuse_reason: att.excuse_reason ?? null,
            check_in_time: att.check_in_time,
            notes: att.notes,
            host_address: att.host_address,
            late_minutes: att.late_minutes,
            check_in_method: att.check_in_method,
            distance_from_host: att.distance_from_host,
            early_minutes: att.early_minutes,
            marked_at: att.marked_at,
            marked_by: att.marked_by ?? null,
            gps_latitude: att.gps_latitude ?? null,
            gps_longitude: att.gps_longitude ?? null,
            gps_accuracy: att.gps_accuracy ?? null,
            gps_timestamp: att.gps_timestamp ?? null,
          });

        if (insertErr) {
          result.errors.push(
            `Insert failed for ${att.attendance_date}: ${insertErr.message}`,
          );
          result.failed++;
        } else {
          result.transferred++;
        }
      }

      // ── 5. Transfer date-host data & time changes ──────────────────────
      if (options.transfer_date_host_overrides) {
        // 5a. Transfer host assignments from session_date_host (host identity & address only)
        const { data: allSourceHostRows } = await supabase
          .from(Tables.SESSION_DATE_HOST)
          .select('*')
          .eq('session_id', sourceSessionId);

        const sourceHostRows = (dateFilter
          ? (allSourceHostRows || []).filter((r) => dateFilter.has(r.attendance_date))
          : (allSourceHostRows || [])
        ).filter((r) => r.attendance_date >= targetStartDate && r.attendance_date <= targetEndDate);

        for (const row of sourceHostRows) {
          const hostPayload = {
            host_id: row.host_id ?? null,
            host_type: row.host_type ?? null,
            host_address: row.host_address ?? null,
            host_latitude: row.host_latitude ?? null,
            host_longitude: row.host_longitude ?? null,
          };

          const { data: existingRow } = await supabase
            .from(Tables.SESSION_DATE_HOST)
            .select('id')
            .eq('session_id', targetSessionId)
            .eq('attendance_date', row.attendance_date)
            .maybeSingle();

          let hostTransferOk = false;
          if (existingRow) {
            const { error: updateErr } = await supabase
              .from(Tables.SESSION_DATE_HOST)
              .update(hostPayload)
              .eq('id', existingRow.id);
            hostTransferOk = !updateErr;
            if (updateErr) result.errors.push(`Host update failed for ${row.attendance_date}: ${updateErr.message}`);
          } else {
            const { error: insertErr } = await supabase
              .from(Tables.SESSION_DATE_HOST)
              .insert({
                session_id: targetSessionId,
                attendance_date: row.attendance_date,
                ...hostPayload,
              });
            hostTransferOk = !insertErr;
            if (insertErr) result.errors.push(`Host insert failed for ${row.attendance_date}: ${insertErr.message}`);
          }

          if (hostTransferOk) {
            result.date_host_overrides_transferred++;

            // If the host is a student, ensure can_host=true on their target enrollment
            if (row.host_id && row.host_type === 'student') {
              const { data: hostEnroll } = await supabase
                .from(Tables.ENROLLMENT)
                .select('enrollment_id, can_host, host_date')
                .eq('session_id', targetSessionId)
                .eq('student_id', row.host_id)
                .maybeSingle();

              if (hostEnroll && !hostEnroll.can_host) {
                await supabase
                  .from(Tables.ENROLLMENT)
                  .update({
                    can_host: true,
                    ...(!hostEnroll.host_date ? { host_date: row.attendance_date } : {}),
                  })
                  .eq('enrollment_id', hostEnroll.enrollment_id);
              }
            }
          }
        }

        // 5b. Transfer session_time_change records from source to target
        const { data: allSourceTimeChanges } = await supabase
          .from(Tables.SESSION_TIME_CHANGE)
          .select('*')
          .eq('session_id', sourceSessionId)
          .order('effective_date', { ascending: true });

        const sourceTimeChanges = (dateFilter
          ? (allSourceTimeChanges || []).filter((tc) => dateFilter.has(tc.effective_date))
          : (allSourceTimeChanges || [])
        ).filter((tc) => tc.effective_date >= targetStartDate && tc.effective_date <= targetEndDate);

        for (const tc of sourceTimeChanges) {
          // Delete any existing time-change on the same effective_date in target
          await supabase
            .from(Tables.SESSION_TIME_CHANGE)
            .delete()
            .eq('session_id', targetSessionId)
            .eq('effective_date', tc.effective_date);

          const { error: tcErr } = await supabase
            .from(Tables.SESSION_TIME_CHANGE)
            .insert({
              session_id: targetSessionId,
              old_time: tc.old_time,
              new_time: tc.new_time,
              effective_date: tc.effective_date,
              reason: tc.reason ? `${tc.reason} (merged)` : 'Transferred from merged session',
              changed_by: tc.changed_by,
            });
          if (tcErr) {
            result.errors.push(`Time change transfer failed for ${tc.effective_date}: ${tcErr.message}`);
          }
        }

        // 5c. Transfer session_day_change records from source to target
        const { data: allSourceDayChanges } = await supabase
          .from('session_day_change')
          .select('*')
          .eq('session_id', sourceSessionId)
          .order('effective_date', { ascending: true });

        const sourceDayChanges = (dateFilter
          ? (allSourceDayChanges || []).filter((dc) => dateFilter.has(dc.effective_date))
          : (allSourceDayChanges || [])
        ).filter((dc) => dc.effective_date >= targetStartDate && dc.effective_date <= targetEndDate);

        for (const dc of sourceDayChanges) {
          await supabase
            .from('session_day_change')
            .delete()
            .eq('session_id', targetSessionId)
            .eq('effective_date', dc.effective_date);

          const { error: dcErr } = await supabase
            .from('session_day_change')
            .insert({
              session_id: targetSessionId,
              old_day: dc.old_day,
              new_day: dc.new_day,
              effective_date: dc.effective_date,
              reason: dc.reason ? `${dc.reason} (merged)` : 'Transferred from merged session',
              changed_by: dc.changed_by,
            });
          if (dcErr) {
            result.errors.push(`Day change transfer failed for ${dc.effective_date}: ${dcErr.message}`);
          }
        }

        // 5d. Transfer session_schedule_day rows (new table)
        const { data: sourceScheduleDays } = await supabase
          .from('session_schedule_day')
          .select('day_of_week')
          .eq('session_id', sourceSessionId);

        for (const sd of (sourceScheduleDays || [])) {
          const { error: sdErr } = await supabase
            .from('session_schedule_day')
            .upsert({
              session_id: targetSessionId,
              day_of_week: sd.day_of_week,
            }, { onConflict: 'session_id,day_of_week' });
          if (sdErr) {
            result.errors.push(`Schedule day transfer failed for dow ${sd.day_of_week}: ${sdErr.message}`);
          }
        }

        // 5e. Transfer session_schedule_exception rows (new table)
        const { data: allSourceExceptions } = await supabase
          .from('session_schedule_exception')
          .select('*')
          .eq('session_id', sourceSessionId)
          .order('original_date', { ascending: true });

        const sourceExceptions = (dateFilter
          ? (allSourceExceptions || []).filter((ex: Record<string, unknown>) => dateFilter.has(ex.original_date as string))
          : (allSourceExceptions || [])
        ).filter((ex: Record<string, unknown>) => (ex.original_date as string) >= targetStartDate && (ex.original_date as string) <= targetEndDate);

        for (const ex of sourceExceptions) {
          await supabase
            .from('session_schedule_exception')
            .delete()
            .eq('session_id', targetSessionId)
            .eq('original_date', (ex as Record<string, unknown>).original_date);

          const { exception_id: _eid, session_id: _sesid2, created_at: _ca3, ...exRest } = ex as Record<string, unknown>;
          const { error: exErr } = await supabase
            .from('session_schedule_exception')
            .insert({
              ...exRest,
              session_id: targetSessionId,
              reason: exRest.reason ? `${exRest.reason} (merged)` : 'Transferred from merged session',
            });
          if (exErr) {
            result.errors.push(`Schedule exception transfer failed for ${(ex as Record<string, unknown>).original_date}: ${exErr.message}`);
          }
        }

        // Also transfer teacher host schedule rows
        const { data: sourceSchedule } = await supabase
          .from(Tables.TEACHER_HOST_SCHEDULE)
          .select('*')
          .eq('session_id', sourceSessionId);

        for (const row of (sourceSchedule || [])) {
          const {
            id: _sid2,
            created_at: _ca2,
            session_id: _sesid,
            ...schedRest
          } = row;

          await supabase
            .from(Tables.TEACHER_HOST_SCHEDULE)
            .upsert(
              { ...schedRest, session_id: targetSessionId },
              { onConflict: 'session_id,host_date', ignoreDuplicates: true },
            );
        }
      }

      // ── 6. Transfer per-date content: recordings, book coverage, feedback questions ──
      if (options.transfer_per_date_content) {
        // 6a. Recording links — insert each non-deleted source recording into target
        const { data: allSourceRecordings } = await supabase
          .from(Tables.SESSION_RECORDING)
          .select('*')
          .eq('session_id', sourceSessionId)
          .is('deleted_at', null);

        const sourceRecordings = (dateFilter
          ? (allSourceRecordings || []).filter((r) => dateFilter.has(r.attendance_date))
          : (allSourceRecordings || [])
        ).filter((r) => r.attendance_date >= targetStartDate && r.attendance_date <= targetEndDate);

        // Pre-fetch existing target recordings to avoid duplicates
        const { data: existingTargetRecordings } = await supabase
          .from(Tables.SESSION_RECORDING)
          .select('attendance_date, recording_url')
          .eq('session_id', targetSessionId)
          .is('deleted_at', null);

        const targetRecordingKeys = new Set(
          (existingTargetRecordings || []).map(r => `${r.attendance_date}|${r.recording_url}`),
        );

        for (const rec of sourceRecordings) {
          // Skip if an identical recording (same date + URL) already exists in target
          if (targetRecordingKeys.has(`${rec.attendance_date}|${rec.recording_url}`)) {
            continue;
          }

          const {
            recording_id: _rid,
            created_at: _ca,
            updated_at: _ua,
            deleted_at: _da,
            session_id: _sid,
            ...recRest
          } = rec;

          const { error: recErr } = await supabase
            .from(Tables.SESSION_RECORDING)
            .insert({ ...recRest, session_id: targetSessionId });

          if (!recErr) result.recordings_transferred++;
          else result.errors.push(`Recording transfer failed (${rec.attendance_date}): ${recErr.message}`);
        }

        // 6b. Book coverage — only valid when both sessions share the same course
        const [{ data: srcSess }, { data: tgtSess }] = await Promise.all([
          supabase.from(Tables.SESSION).select('course_id').eq('session_id', sourceSessionId).single(),
          supabase.from(Tables.SESSION).select('course_id').eq('session_id', targetSessionId).single(),
        ]);

        if (srcSess?.course_id === tgtSess?.course_id) {
          const { data: allSourceBookCoverage } = await supabase
            .from(Tables.SESSION_BOOK_COVERAGE)
            .select('*')
            .eq('session_id', sourceSessionId);

          const sourceBookCoverage = (dateFilter
            ? (allSourceBookCoverage || []).filter((c) => dateFilter.has(c.attendance_date))
            : (allSourceBookCoverage || [])
          ).filter((c) => c.attendance_date >= targetStartDate && c.attendance_date <= targetEndDate);

          for (const cov of sourceBookCoverage) {
            // Check by date + reference_id for proper dedup when multiple books per date
            const { data: existingCov } = await supabase
              .from(Tables.SESSION_BOOK_COVERAGE)
              .select('coverage_id')
              .eq('session_id', targetSessionId)
              .eq('attendance_date', cov.attendance_date)
              .eq('reference_id', cov.reference_id)
              .maybeSingle();

            let covErr;
            if (existingCov) {
              // Update existing: swap the reference to match the source
              ({ error: covErr } = await supabase
                .from(Tables.SESSION_BOOK_COVERAGE)
                .update({ reference_id: cov.reference_id })
                .eq('coverage_id', existingCov.coverage_id));
            } else {
              // Insert fresh row
              const {
                coverage_id: _cid,
                created_at: _ca,
                updated_at: _ua,
                session_id: _sid,
                ...covRest
              } = cov;
              ({ error: covErr } = await supabase
                .from(Tables.SESSION_BOOK_COVERAGE)
                .insert({ ...covRest, session_id: targetSessionId }));
            }

            if (!covErr) result.book_coverages_transferred++;
            else result.errors.push(`Book coverage transfer failed (${cov.attendance_date}): ${covErr.message}`);
          }
        } else if (srcSess?.course_id !== tgtSess?.course_id) {
          const { count: bookCount } = await supabase
            .from(Tables.SESSION_BOOK_COVERAGE)
            .select('coverage_id', { count: 'exact', head: true })
            .eq('session_id', sourceSessionId);
          if ((bookCount || 0) > 0) {
            result.errors.push(
              `Book coverage skipped: source and target belong to different courses. Book references are course-specific and cannot be transferred across courses.`,
            );
          }
        }

        // 6c. Feedback questions — copy question templates per date (not student responses).
        // Global questions (attendance_date IS NULL) are always included.
        // Date-specific questions are filtered to selected dates when dateFilter is active.
        const { data: allSourceFeedback } = await supabase
          .from(Tables.FEEDBACK_QUESTION)
          .select('*')
          .eq('session_id', sourceSessionId);

        const sourceFeedback = (dateFilter
          ? (allSourceFeedback || []).filter(
              (q) => q.attendance_date === null || dateFilter.has(q.attendance_date),
            )
          : (allSourceFeedback || [])
        ).filter((q) => q.attendance_date === null || (q.attendance_date >= targetStartDate && q.attendance_date <= targetEndDate));

        // Pre-fetch existing target feedback questions to avoid duplicates
        const { data: existingTargetQuestions } = await supabase
          .from(Tables.FEEDBACK_QUESTION)
          .select('question_text, attendance_date')
          .eq('session_id', targetSessionId);

        const targetQuestionKeys = new Set(
          (existingTargetQuestions || []).map(q => `${q.attendance_date ?? ''}|${q.question_text}`),
        );

        for (const q of sourceFeedback) {
          // Skip if an identical question (same date + text) already exists in target
          const qKey = `${q.attendance_date ?? ''}|${q.question_text}`;
          if (targetQuestionKeys.has(qKey)) {
            continue;
          }

          const {
            id: _qid,
            created_at: _ca,
            session_id: _sid,
            ...qRest
          } = q;

          const { error: qErr } = await supabase
            .from(Tables.FEEDBACK_QUESTION)
            .insert({ ...qRest, session_id: targetSessionId });

          if (!qErr) result.feedback_questions_transferred++;
          else result.errors.push(`Feedback question transfer failed: ${qErr.message}`);
        }
      }

      // ── 7. Delete source session (optional) ──────────────────────────────
      if (options.delete_source_after) {
        try {
          // Delete in FK dependency order so constraints are satisfied
          await supabase.from(Tables.ATTENDANCE).delete().eq('session_id', sourceSessionId);
          await supabase.from('qr_sessions').delete().eq('session_id', sourceSessionId);
          await supabase.from('photo_checkin_sessions').delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.SESSION_RECORDING).delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.SESSION_DATE_HOST).delete().eq('session_id', sourceSessionId);
          await supabase.from('session_day_change').delete().eq('session_id', sourceSessionId);
          await supabase.from('session_schedule_day').delete().eq('session_id', sourceSessionId);
          await supabase.from('session_schedule_exception').delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.SESSION_BOOK_COVERAGE).delete().eq('session_id', sourceSessionId);
          // These tables have FK → session_id and must be deleted before the session row
          await supabase.from(Tables.FEEDBACK_QUESTION).delete().eq('session_id', sourceSessionId);
          await supabase.from('excuse_request').delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.TEACHER_HOST_SCHEDULE).delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.SESSION_TIME_CHANGE).delete().eq('session_id', sourceSessionId);

          // Delete session_feedback by session_id (it has session_id FK, not enrollment_id)
          await supabase
            .from(Tables.SESSION_FEEDBACK)
            .delete()
            .eq('session_id', sourceSessionId);

          // Delete issued certificates referencing the source session
          await supabase.from('issued_certificate').delete().eq('session_id', sourceSessionId);

          // Delete enrollments
          await supabase.from(Tables.ENROLLMENT).delete().eq('session_id', sourceSessionId);

          // Finally delete the session itself
          const { error: sessionDeleteErr } = await supabase
            .from(Tables.SESSION)
            .delete()
            .eq('session_id', sourceSessionId);

          if (sessionDeleteErr) {
            result.errors.push(
              `Merge complete, but source session could not be auto-deleted: ${sessionDeleteErr.message}. Please delete it manually.`,
            );
          } else {
            result.source_deleted = true;
          }
        } catch (e) {
          result.errors.push(
            `Merge complete, but source deletion failed: ${String(e)}. Please delete the source session manually.`,
          );
        }
      }

      return { data: result, error: null };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  },
};
