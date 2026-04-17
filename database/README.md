# Database

Consolidated SQL files for the Training Center Supabase database.

## Run Order (Fresh Deployment)

| # | File | Description |
|---|------|-------------|
| 1 | `schema.sql` | All 32 table definitions in dependency order with table comments |
| 2 | `functions.sql` | Helper functions (SECURITY DEFINER + search_path hardened), trigger functions, and trigger bindings |
| 3 | `indexes.sql` | All performance indexes (functional, composite, partial) |
| 4 | `rls-policies.sql` | Row Level Security policies for all tables |
| 5 | `storage.sql` | Supabase storage bucket configuration |
| 6 | `seed-data.sql` | Essential seed data (admin user, specializations, feedback template) |

## Architecture

- **Roles**: Admin (full access via `FOR ALL`), Teacher (scoped read + write), Student (scoped read)
- **Auth**: Policies use `is_admin()`, `is_teacher()`, `get_my_student_id()` — all SECURITY DEFINER with `SET search_path = public`
- **UUIDs**: All primary keys use `gen_random_uuid()` (native PostgreSQL 13+, no extensions)
- **Timestamps**: `created_at` / `updated_at` are NOT NULL on all tables; `updated_at` triggers via shared `update_updated_at_column()`
- **Validation**: Business-logic triggers enforce data integrity (excuse date ↔ session day, book reference ↔ course, enrollment host status)
- **Self-documenting**: All 32 tables have `COMMENT ON TABLE` metadata (queryable via `\dt+` in psql)

## Migrations

Sequential SQL files in `migrations/`. Each migration is wrapped in `BEGIN; ... COMMIT;` for atomic rollback.

| Range | Description |
|-------|-------------|
| 001–010 | RLS fixes, schema evolution, session scheduling |
| 011–015 | Constraint + RLS audit passes |
| 016–018 | Dead column cleanup, duplicate index removal |
| 019 | QR session conflict fix |
| 020 | Schema hardening — UUID standardization, NOT NULL enforcement, FK corrections |
| 021 | Enterprise hardening — SECURITY DEFINER search_path, data integrity, self-documenting schema |
| 022 | Attendance-enrollment student_id consistency trigger |
| 023 | Feedback: remove emoji type, fix CRUD |
| 024 | Admin session_feedback RLS policy |
| 025 | scoring_config.teacher_id nullable for admin global config |
| 026 | Feedback correct_answer (test questions) |
| 027 | Allow 'other' host_type in session_date_host |
| 028 | parent_session_id for cloned sessions |
| 029 | Integrity & performance: CHECK constraints, FK cascades, composite indexes, unique constraints, attendance stats function |
| 030 | Feedback hardening: anonymize-on-delete trigger, redundant index cleanup |
| 031 | Feedback constraint hardening: NOT NULL enforcement, multiple-choice options check, single default template |
| 032 | Mega-hardening audit: drop duplicate constraints & redundant prefix indexes, SET NOT NULL on boolean columns |
| 033 | Drop parent_session_id from session (unused) |
| 034 | Feedback anti-cheat: tab_switch_count, is_auto_submitted on session_feedback |
| 035 | Add max_tab_switches to session (configurable tab switch limit) |
| 036 | Feedback allow_multiple on feedback_question |
| 037 | Feedback grading_mode on feedback_question |
| 038 | QR session: use effective time from session_time_change |
| 039 | Feedback timer: feedback_time_limit_seconds, answer_duration_seconds, submission_reason |
| 040 | Fix audit_log.changed_by UUID → TEXT |
| 041 | Allow 'other' host_type in session_date_host |
| 042 | QA hardening: search_path on 11 functions, 4 FK indexes, token default, description min-length |
