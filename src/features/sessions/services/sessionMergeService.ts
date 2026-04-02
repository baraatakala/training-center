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

export type MergePreview = {
  students: StudentMergePreview[];
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
          supabase.from(Tables.SESSION).select('course_id').eq('session_id', targetSessionId).single(),
        ]);
        return {
          data: {
            students: [],
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

      // 6. Count date/time overrides in source
      const { count: overrideCount } = await supabase
        .from(Tables.SESSION_DATE_HOST)
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sourceSessionId);

      // 7. Count teacher host schedule rows in source
      const { count: scheduleCount } = await supabase
        .from(Tables.TEACHER_HOST_SCHEDULE)
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sourceSessionId);

      // 8. Count recordings, book coverage, feedback questions
      const [
        { count: recordingCount },
        { count: bookCoverageCount },
        { count: feedbackQuestionCount },
        { data: srcSession },
        { data: tgtSession },
      ] = await Promise.all([
        supabase.from(Tables.SESSION_RECORDING).select('recording_id', { count: 'exact', head: true }).eq('session_id', sourceSessionId).is('deleted_at', null),
        supabase.from(Tables.SESSION_BOOK_COVERAGE).select('coverage_id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
        supabase.from(Tables.FEEDBACK_QUESTION).select('id', { count: 'exact', head: true }).eq('session_id', sourceSessionId),
        supabase.from(Tables.SESSION).select('course_id').eq('session_id', sourceSessionId).single(),
        supabase.from(Tables.SESSION).select('course_id').eq('session_id', targetSessionId).single(),
      ]);

      return {
        data: {
          students: studentStatuses,
          date_host_override_count: overrideCount || 0,
          teacher_host_schedule_count: scheduleCount || 0,
          recording_count: recordingCount || 0,
          book_coverage_count: bookCoverageCount || 0,
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
      for (const att of (sourceAttendance || [])) {
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
            // Reactivate if not already active
            if (existingEnroll.status !== 'active') {
              const { error: reactivateErr } = await supabase
                .from(Tables.ENROLLMENT)
                .update({ status: 'active' })
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
                can_host: false,
                enrollment_date: new Date().toISOString().split('T')[0],
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

      // ── 5. Transfer date/time overrides ──────────────────────────────────
      if (options.transfer_date_host_overrides) {
        const { data: sourceOverrides } = await supabase
          .from(Tables.SESSION_DATE_HOST)
          .select('*')
          .eq('session_id', sourceSessionId);

        for (const override of (sourceOverrides || [])) {
          // Strip identity/timestamp columns before upserting into target
          const {
            id: _id,
            created_at: _ca,
            updated_at: _ua,
            session_id: _sid,
            ...rest
          } = override;

          const { error: upsertErr } = await supabase
            .from(Tables.SESSION_DATE_HOST)
            .upsert(
              { ...rest, session_id: targetSessionId },
              { onConflict: 'session_id,attendance_date', ignoreDuplicates: true },
            );

          if (!upsertErr) result.date_host_overrides_transferred++;
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
        const { data: sourceRecordings } = await supabase
          .from(Tables.SESSION_RECORDING)
          .select('*')
          .eq('session_id', sourceSessionId)
          .is('deleted_at', null);

        for (const rec of (sourceRecordings || [])) {
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
          const { data: sourceBookCoverage } = await supabase
            .from(Tables.SESSION_BOOK_COVERAGE)
            .select('*')
            .eq('session_id', sourceSessionId);

          for (const cov of (sourceBookCoverage || [])) {
            const {
              coverage_id: _cid,
              created_at: _ca,
              updated_at: _ua,
              session_id: _sid,
              ...covRest
            } = cov;

            const { error: covErr } = await supabase
              .from(Tables.SESSION_BOOK_COVERAGE)
              .insert({ ...covRest, session_id: targetSessionId });

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

        // 6c. Feedback questions — copy question templates per date (not student responses)
        const { data: sourceFeedback } = await supabase
          .from(Tables.FEEDBACK_QUESTION)
          .select('*')
          .eq('session_id', sourceSessionId);

        for (const q of (sourceFeedback || [])) {
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
          await supabase.from(Tables.SESSION_BOOK_COVERAGE).delete().eq('session_id', sourceSessionId);
          // These tables have FK → session_id and must be deleted before the session row
          await supabase.from(Tables.FEEDBACK_QUESTION).delete().eq('session_id', sourceSessionId);
          await supabase.from('excuse_request').delete().eq('session_id', sourceSessionId);
          await supabase.from(Tables.TEACHER_HOST_SCHEDULE).delete().eq('session_id', sourceSessionId);

          // Delete session_feedback which references enrollment_id (not session_id directly)
          const { data: srcEnrollments } = await supabase
            .from(Tables.ENROLLMENT)
            .select('enrollment_id')
            .eq('session_id', sourceSessionId);

          const srcEnrollmentIds = (srcEnrollments || []).map((e) => e.enrollment_id);
          if (srcEnrollmentIds.length > 0) {
            await supabase
              .from(Tables.SESSION_FEEDBACK)
              .delete()
              .in('enrollment_id', srcEnrollmentIds);
          }

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
