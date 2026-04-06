# Production Database Audit Report

**Database**: PostgreSQL 17.6 on Supabase  
**Tables**: 32 | **Indexes**: 144 | **Functions**: 21 | **Triggers**: 21 | **RLS Policies**: 137  
**Audit Date**: Based on live JSON extracts synced 2026-04-03

---

## Section 1: LIVE vs LOCAL Mismatch Report

### 1.1 Missing VARCHAR Length Limits in Local Schema

**Severity: HIGH** — If schema.sql is used to recreate the database, columns will be unbounded.

| Table | Column | Live Limit | Local Definition |
|-------|--------|-----------|-----------------|
| teacher | name | VARCHAR(255) | VARCHAR |
| teacher | phone | VARCHAR(50) | VARCHAR |
| teacher | email | VARCHAR(255) | VARCHAR |
| teacher | specialization | VARCHAR(150) | VARCHAR |
| student | name | VARCHAR(255) | VARCHAR |
| student | phone | VARCHAR(50) | VARCHAR |
| student | email | VARCHAR(255) | VARCHAR |
| student | nationality | VARCHAR(100) | VARCHAR |
| session | time | VARCHAR(50) | VARCHAR |
| session_date_host | host_type | VARCHAR(20) | VARCHAR |
| session_recording | title | VARCHAR(200) | VARCHAR |
| session_recording | mime_type | VARCHAR(120) | VARCHAR |
| announcement | title | VARCHAR | VARCHAR (match) |
| announcement | priority | VARCHAR | VARCHAR (match) |
| announcement | category | VARCHAR | VARCHAR (match) |

**Fix**: Update schema.sql to specify explicit lengths matching the live database.

### 1.2 Missing UNIQUE Constraints in Local Schema

**Severity: HIGH** — These constraints exist in production but aren't captured locally.

| Table | Constraint Name | Columns | Impact |
|-------|----------------|---------|--------|
| session_book_coverage | session_book_coverage_session_id_attendance_date_key | (session_id, attendance_date) | Prevents duplicate book coverage per session/date |
| session_feedback | session_feedback_session_id_attendance_date_student_id_key | (session_id, attendance_date, student_id) | Prevents duplicate feedback per student |
| teacher_host_schedule | teacher_host_schedule_teacher_id_session_id_host_date_key | (teacher_id, session_id, host_date) | Triple uniqueness constraint |
| teacher_host_schedule | unique_teacher_session | (teacher_id, session_id) | One teacher per session schedule |

**Fix**: Add these constraints to schema.sql.

### 1.3 Missing Named CHECK Constraints in Local Schema

**Severity: MEDIUM** — Inline checks exist but live has additional named ones.

| Table | Constraint Name | Columns Involved |
|-------|----------------|-----------------|
| session | session_virtual_link_requirement_check | learning_method, virtual_provider, virtual_meeting_link |
| session | session_virtual_provider_check | virtual_provider |
| session | session_check | start_date, end_date (redundant with session_dates_ordered) |
| session | check_grace_period_range | grace_period_minutes (duplicate of inline CHECK) |

The `session_virtual_link_requirement_check` is the most important — it likely enforces that online/hybrid sessions require a virtual_provider and meeting link. **This business rule is NOT captured in local schema.sql**.

### 1.4 Dropped Column Gaps (Ordinal Position Holes)

These are expected from migrations that dropped columns, but confirm the local schema is clean.

| Table | Missing Positions | Probable Dropped Columns |
|-------|------------------|------------------------|
| student | Position 2 | Likely auth_user_id (moved or removed) |
| session | Positions 12-14 | override_day, override_time, override_end_time (migration 016-017) |
| session_recording | Positions 15-16 | Unknown dropped columns |

### 1.5 Functions & Triggers: SYNCED ✅

All 21 functions and 21 triggers match between live and local. No drift detected.

### 1.6 RLS Policies: SYNCED ✅

All 137 RLS policies match between live and local. All 32 tables have RLS enabled.

### 1.7 Indexes: Minor Differences

Local indexes.sql defines ~85 custom indexes. Live has 144 total (includes ~59 PK/UNIQUE auto-indexes). The custom indexes align. No missing performance indexes detected.

---

## Section 2: Critical Findings in Live Schema

### 2.1 🔴 UUID Generation Inconsistency

Two different UUID generators are in use across tables:

**`gen_random_uuid()` (PostgreSQL native)**:
admin, certificate_template, excuse_request, feedback_question, feedback_template, issued_certificate, message, photo_checkin_sessions, scoring_config, session_day_change, session_feedback, session_recording, session_time_change, specialization

**`uuid_generate_v4()` (requires uuid-ossp extension)**:
announcement_comment, announcement_reaction, attendance, audit_log, course, course_book_reference, enrollment, message_reaction, message_starred, qr_sessions, session, session_book_coverage, session_date_host, student, teacher, teacher_host_schedule

**Risk**: `uuid_generate_v4()` requires the `uuid-ossp` extension. If it's ever disabled, 16 tables break. `gen_random_uuid()` is native to PostgreSQL 13+ and doesn't need any extension.

**Recommendation**: Migrate all tables to `gen_random_uuid()` and remove the `uuid-ossp` extension dependency.

### 2.2 🔴 Nullable created_at / updated_at Timestamps

**30 of 32 tables** have `created_at` and `updated_at` as **nullable** (`DEFAULT now()` but `IS_NULLABLE = YES`). Only `admin` enforces `NOT NULL`.

This means:
- An explicit `INSERT INTO ... (created_at) VALUES (NULL)` bypasses the default
- ORMs can accidentally null-out timestamps
- Audit trail integrity is not guaranteed

**Affected tables**: ALL except admin.

**Recommendation**: `ALTER TABLE ... ALTER COLUMN created_at SET NOT NULL` for all tables. This is a zero-downtime change since existing rows already have values.

### 2.3 🔴 scoring_config.teacher_id References auth.users, Not teacher

```sql
CONSTRAINT scoring_config_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES auth.users(id)
```

This FK points to `auth.users(id)` instead of `teacher(teacher_id)`. This means:
- The column is named `teacher_id` but accepts any Supabase auth user ID
- It's possible to create scoring configs for students or admins
- It breaks the naming convention and confuses developers

**Recommendation**: Change FK to reference `teacher(teacher_id)` or rename column to `auth_user_id`.

### 2.4 🟡 Polymorphic Foreign Keys Without Referential Integrity

These tables use type/id pairs that can reference teacher, student, or admin — but have NO FK constraints:

| Table | Type Column | ID Column | Risk |
|-------|------------|-----------|------|
| message | sender_type | sender_id | Orphan messages if user deleted |
| message | recipient_type | recipient_id | Orphan messages if user deleted |
| announcement_comment | commenter_type | commenter_id | Orphan comments |
| message_reaction | reactor_type | reactor_id | Orphan reactions |
| message_starred | user_type | user_id | Orphan stars |
| session_date_host | host_type | host_id | Orphan host records |

**Risk**: Deleting a student or teacher leaves orphan records. No CASCADE behavior. No referential integrity check.

**Mitigation**: Add a trigger-based validation or application-level enforcement. True polymorphic FKs aren't supported in PostgreSQL natively.

### 2.5 🟡 announcement.created_by Has No FK Constraint

`announcement.created_by` is a UUID (`NOT NULL`) that references a teacher — but there's no FK constraint. The RLS policy cross-references `teacher.teacher_id`, but the database allows any UUID value.

### 2.6 🟡 admin.auth_user_id Has No FK to auth.users

The `admin.auth_user_id` column is nullable with no FK constraint visible in the public schema constraints. This should reference `auth.users(id)`.

### 2.7 🟡 session_feedback.student_id Is Nullable (By Design)

Nullable to support anonymous feedback. However, when `is_anonymous = false`, there's no CHECK constraint enforcing `student_id IS NOT NULL`. An entry could be non-anonymous with no student.

**Recommendation**: Add `CHECK (is_anonymous = true OR student_id IS NOT NULL)`.

### 2.8 🟡 session_recording.recording_uploaded_by FK Points to auth.users

Like scoring_config, this FK points to `auth.users(id)` instead of `teacher(teacher_id)`. However, since any authenticated user could upload recordings (teacher or admin), this may be intentional. Document the design decision.

### 2.9 🟡 course.teacher_id Is Nullable

A course can exist without an assigned teacher. This may be intentional for draft courses, but it means:
- Queries joining course→teacher need LEFT JOIN
- The session table requires teacher_id NOT NULL, creating an inconsistency

### 2.10 🟡 attendance.session_id Is Nullable

The attendance table has `session_id UUID` without NOT NULL. Sessions are the fundamental unit of scheduling — every attendance record should be tied to one. The existing FK and indexes assume session_id is populated, but the schema allows NULL.

---

## Section 3: Performance Analysis

### 3.1 Index Coverage Assessment

**Well-indexed tables** (comprehensive composite indexes):
- ✅ attendance: 7 custom indexes covering all major query patterns
- ✅ message: 7 indexes including sorted recipient/sender
- ✅ announcement: 7 indexes including course+created_at composite
- ✅ session: 7 indexes covering course, teacher, and date range queries
- ✅ audit_log: 8 indexes covering all audit query patterns

**Adequate indexing**:
- ✅ enrollment: 4 indexes (session-centric queries)
- ✅ excuse_request: 5 indexes including composite session/date/status
- ✅ qr_sessions: 4 indexes including partial indexes on is_valid
- ✅ session_recording: 3 indexes including a unique partial index for primary recordings

### 3.2 Potential Performance Concerns

#### 3.2.1 RLS Function Call Overhead
Every RLS policy calls `is_admin()`, `is_teacher()`, or `get_my_student_id()`. These are `SECURITY DEFINER` functions that query the `admin`, `teacher`, or `student` table respectively.

**Impact**: Every single query on any table (SELECT, INSERT, UPDATE, DELETE) triggers 1-3 function calls, each doing a table scan by email (LOWER(email) = LOWER(auth.jwt()->>'email')).

**Mitigation already present**:
- teacher.email has a UNIQUE index (email_key)
- student.email has a UNIQUE index (email_key)
- admin.email has a UNIQUE index

**Remaining concern**: The `LOWER()` call prevents these unique indexes from being used directly. PostgreSQL must do a sequential scan unless there's a functional index on `LOWER(email)`.

**Recommendation**: Create functional indexes:
```sql
CREATE INDEX idx_teacher_email_lower ON teacher (LOWER(email));
CREATE INDEX idx_student_email_lower ON student (LOWER(email));
CREATE INDEX idx_admin_email_lower ON admin (LOWER(email));
```

#### 3.2.2 Subquery-Heavy RLS Policies
Several policies use correlated subqueries (`EXISTS (SELECT 1 FROM session s JOIN teacher t ...)`):
- excuse_request (2 policies)
- session_feedback (2 policies)  
- feedback_question (1 policy)
- announcement (1 policy)
- message (6 policies with multiple OR branches)

For tables with high row counts (attendance, message), these subqueries execute per-row.

#### 3.2.3 Missing Index on session_book_coverage
`session_book_coverage.reference_id` has a FK but no standalone index. Queries joining to `course_book_reference` will be slow.

Wait — checking... `idx_session_book_coverage_session` covers session_id. The `reference_id` column has a FK but the live indexes show a `session_book_coverage_reference_id_idx` does not appear to exist. This could impact delete cascades on course_book_reference.

#### 3.2.4 Announcement view_count Hotspot
`announcement.view_count` is incremented via UPDATE. High-traffic announcements will create row-level contention. Consider a separate counter table or deferred aggregation.

### 3.3 Index Redundancies

| Redundant Index | Covered By |
|----------------|-----------|
| idx_enrollment_can_host ON (session_id) | idx_enrollment_session_canhost ON (session_id, can_host) |
| idx_enrollment_session_student ON (session_id, student_id) | enrollment_student_session_unique UNIQUE (student_id, session_id) |

The second one is debatable — the unique index leads with student_id, while the custom index leads with session_id. Both may be needed depending on query patterns.

---

## Section 4: Architecture Issues

### 4.1 No Soft-Delete Strategy (Except session_recording)

Only `session_recording` has a `deleted_at` column. All other tables use hard deletes. This means:
- No undo capability for accidental deletes
- The `audit_log` table partially compensates (captures DELETE operations with old_data)
- But audit_log is opt-in — there's no trigger automatically logging deletes

**Recommendation**: For critical data (attendance, enrollment, excuse_request), consider adding soft-delete support.

### 4.2 No Cascade Delete Strategy

Most FK constraints use the default `NO ACTION` (or `RESTRICT`) on delete. Only two tables use `ON DELETE CASCADE`:
- session_day_change.session_id → session (CASCADE)
- session_time_change.session_id → session (CASCADE)

This means deleting a session will fail if there are attendance records, enrollments, QR sessions, session_date_host records, book coverage records, feedback, or recordings referencing it. The application must handle cascading deletes manually.

### 4.3 Text-Based Day/Time Storage

`session.day` is TEXT storing day names like "Monday, Friday, Tuesday" as a comma-separated string. This pattern:
- Requires parsing in both SQL functions and frontend
- Makes day-of-week queries slow (no indexing on parsed values)
- Already created complexity in `validate_excuse_request_session_day` function
- Doesn't enforce valid day names at the database level

`session.time` is VARCHAR(50) storing human-readable time ranges like "09:00-11:00". This prevents:
- Timezone-aware time comparisons
- Duration calculations
- Session overlap detection at the database level

**Recommendation**: For a future major version, consider:
- A junction table `session_days(session_id, day_of_week INTEGER)` 
- TIME columns for start_time/end_time instead of text ranges

### 4.4 JSONB for UI Concerns in scoring_config.late_brackets

The `late_brackets` JSONB column stores Tailwind CSS classes (`"bg-green-100 text-green-800"`). This couples the database schema to a specific CSS framework.

### 4.5 Auth Model: Email-Based Resolution (Not auth.uid)

The system resolves user identity via `LOWER(email) = LOWER(auth.jwt()->>'email')` instead of `auth.uid()`. This means:
- User identity depends on email matching, not the Supabase auth user ID
- If a user changes their email in Supabase Auth, they lose access to all their data
- The `student`, `teacher`, and `admin` tables don't have an `auth_user_id` FK (except admin, which is nullable)
- Two Supabase auth accounts with the same email would conflict

**This is the single biggest architectural risk in the schema.** It works fine for now but will break if:
- Email changes are allowed
- SSO is added (different email domains)
- Multi-tenant auth is needed

### 4.6 Redundant Timestamp Trigger Functions

There are 6 separate trigger functions that all do exactly the same thing:
1. `update_updated_at_column()` — used by 10 tables
2. `update_certificate_template_timestamp()` — used by 1 table
3. `update_issued_certificate_timestamp()` — used by 1 table
4. `update_scoring_config_timestamp()` — used by 1 table
5. `update_excuse_request_updated_at()` — used by 1 table
6. `update_announcement_timestamp()` — used by 1 table

All 6 functions have identical bodies: `NEW.updated_at = now(); RETURN NEW;`. The 5 specialized functions are unnecessary.

### 4.7 Missing updated_at Triggers

Tables with `updated_at` columns but **NO update trigger**:
- feedback_question (has updated_at column? Actually no — only has `created_at`)
- photo_checkin_sessions (has `updated_at` but no trigger)

`photo_checkin_sessions` has an `updated_at` column that will never be automatically maintained.

### 4.8 session_date_host Dual Purpose

This table serves two purposes:
1. Recording who hosts a session on a given date (host_id, host_type, host_address, coordinates)
2. As an anchor for time overrides (migration 009 note: "nullable host_address when row is created only for a time override")

This dual purpose complicates queries and creates null-heavy rows.

---

## Section 5: Table-by-Table Summary

### Independent / Lookup Tables

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 1 | admin | 6 | admin_id | email, auth_user_id | 0 | 0 | 1 (PK) | 4 | 1 | Only table with NOT NULL timestamps |
| 2 | specialization | 3 | id | name | 0 | 0 | 2 (PK, name) | 2 | 0 | No updated_at column |
| 3 | audit_log | 11 | audit_id | — | 0 | 1 (operation) | 9 | 3 | 0 | No auto-logging trigger |

### Core Entity Tables

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 4 | teacher | 10 | teacher_id | email | 0 | 3 (lat, lon, spec) | 4 | 5 | 1 | uuid_generate_v4() |
| 5 | student | 15 | student_id | email | 0 | 3 (age, lat, lon) | 4 | 4 | 1 | uuid_generate_v4(); ordinal gap at pos 2 |
| 6 | course | 9 | course_id | — | 1 (teacher) | 2 (desc, format) | 3 | 5 | 1 | teacher_id nullable |
| 7 | session | 23 | session_id | — | 2 (course, teacher) | 8+ | 9 | 7 | 1 | Most columns; ordinal gaps 12-14 |
| 8 | enrollment | 9 | enrollment_id | (student,session) | 2 (student, session) | 1 (status) | 5 | 5 | 2 | can_host trigger |

### Attendance & Check-In

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 9 | attendance | 21 | attendance_id | (enrollment,date) | 3 (enrollment, student, session) | 2 (status, late/early) | 8 | 7 | 1 | session_id nullable! |
| 10 | qr_sessions | 12 | qr_session_id | token; (session,date,mode) partial | 1 (session) | 2 (check_in_mode, date) | 5 | 4 | 0 | Active unique partial index |
| 11 | photo_checkin_sessions | 8 | id | token | 1 (session) | 0 | 3 | 4 | 0 | Missing updated_at trigger |

### Session Management

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 12 | session_date_host | 10 | id | (session,date) | 1 (session) | 3 (lat, lon, type) | 2 | 5 | 1 | Dual-purpose table |
| 13 | session_day_change | 8 | change_id | (session,date) | 1 (session CASCADE) | 0 | 3 | 5 | 0 | No updated_at |
| 14 | session_time_change | 8 | change_id | (session,date) | 1 (session CASCADE) | 0 | 3 | 5 | 0 | No updated_at |
| 15 | teacher_host_schedule | 6 | id | (session,date);(teacher,session);(teacher,session,date) | 2 (teacher, session) | 0 | 4 | 7 | 0 | 3 UNIQUE constraints (overlap) |
| 16 | session_recording | 20 | recording_id | — | 2 (session, auth.users) | 5 (type, storage, visibility, duration, size) | 4 | 3 | 1 | Soft-delete (deleted_at); ordinal gaps 15-16 |

### Book Tracking

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 17 | course_book_reference | 9 | reference_id | — | 2 (course, parent self-ref) | 1 (start_page) | 4 | 6 | 1 | Tree structure via parent_id |
| 18 | session_book_coverage | 6 | coverage_id | (session,date) | 2 (session, reference) | 0 | 2 | 6 | 0 | UNIQUE not in local schema |

### Scoring

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 19 | scoring_config | 19 | id | (teacher,is_default) partial | 1 (auth.users!) | 1 (coverage_method) | 3 | 2 | 1 | FK points to auth.users not teacher |

### Excuses

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 20 | excuse_request | 14 | request_id | (student,session,date) | 2 (student, session) | 2 (status, review_fields) | 6 | 6 | 2 | Complex RLS; trigger validates day |

### Feedback

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 21 | feedback_question | 9 | id | (session,date,text) partial | 1 (session) | 1 (question_type) | 3 | 3 | 0 | No updated_at |
| 22 | feedback_template | 7 | id | — | 0 | 0 | 1 | 2 | 0 | created_by has no FK |
| 23 | session_feedback | 10 | id | (session,date,student) | 2 (session, student) | 1 (overall_rating) | 3 | 4 | 0 | student_id nullable; no updated_at |

### Certificates

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 24 | certificate_template | 13 | template_id | — | 0 | 1 (template_type) | 1 | 2 | 1 | |
| 25 | issued_certificate | 22 | certificate_id | certificate_number, verification_code | 5 (template, student, session, course, signer) | 2 (status, signer_source) | 5 | 3 | 1 | Most FK-rich table |

### Communication

| # | Table | Columns | PK | Unique | FKs | Checks | Indexes | RLS Policies | Triggers | Notes |
|---|-------|---------|-----|---------|-----|--------|---------|-------------|----------|-------|
| 26 | announcement | 15 | announcement_id | — | 1 (course) | 1 (priority) | 9 | 3 | 1 | created_by has no FK |
| 27 | announcement_read | 4 | read_id | — | 2 (announcement, student) | 0 | 2 | 3 | 0 | No unique on (announcement,student) |
| 28 | announcement_comment | 9 | comment_id | — | 2 (announcement, parent self-ref) | 1 (commenter_type) | 3 | 5 | 1 | Polymorphic commenter |
| 29 | announcement_reaction | 5 | reaction_id | — | 2 (announcement, student) | 0 | 3 | 4 | 0 | No unique on (announcement,student,emoji) |
| 30 | message | 11 | message_id | — | 1 (parent self-ref) | 2 (sender_type, recipient_type) | 9 | 7 | 0 | Polymorphic sender/recipient; no updated_at trigger |
| 31 | message_reaction | 6 | reaction_id | — | 1 (message) | 1 (reactor_type) | 2 | 4 | 0 | Polymorphic reactor |
| 32 | message_starred | 5 | id | — | 1 (message) | 1 (user_type) | 2 | 4 | 0 | Polymorphic user |

---

## Priority Action Items

### P0 — Fix Before Next Deploy
1. **Add functional indexes on LOWER(email)** for teacher, student, admin — every RLS policy depends on these
2. **Add NOT NULL to created_at columns** across all 30 tables — zero-downtime ALTER
3. **Add missing UNIQUE constraints to local schema.sql** (session_book_coverage, session_feedback, teacher_host_schedule)

### P1 — Fix This Quarter
4. **Fix scoring_config.teacher_id FK** — either reference teacher(teacher_id) or rename column
5. **Add CHECK constraint** on session_feedback: `(is_anonymous = true OR student_id IS NOT NULL)`
6. **Add session_virtual_link_requirement_check** to local schema.sql
7. **Add VARCHAR length limits** to local schema.sql to match live
8. **Standardize UUID generation** — migrate all to gen_random_uuid()
9. **Add missing updated_at trigger** for photo_checkin_sessions

### P2 — Plan for Next Major Version
10. **Auth model**: Add auth_user_id FK to student and teacher tables; migrate RLS from email-based to uid-based
11. **Replace text-based day/time storage** with proper data types or junction table
12. **Remove UI-specific data from late_brackets JSONB** (Tailwind CSS classes)
13. **Add announcement_read UNIQUE (announcement_id, student_id)** and **announcement_reaction UNIQUE (announcement_id, student_id, emoji)** to prevent duplicates
14. **Consolidate 6 timestamp trigger functions** into one
15. **Evaluate soft-delete strategy** for attendance and enrollment

### P3 — Technical Debt
16. Clean up redundant UNIQUE constraints on teacher_host_schedule (3 overlapping)
17. Document the session_date_host dual-purpose design decision
18. Add NOT NULL to attendance.session_id (requires data verification first)
19. Add FK for announcement.created_by → teacher(teacher_id)
20. Add FK for admin.auth_user_id → auth.users(id)
