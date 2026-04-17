# Future Improvements — Feedback, Attendance & Architecture

> Written: April 2026. Context: React 19 + Supabase (PostgreSQL), 32 tables, ~142 RLS policies.

---

## Table of Contents

1. [Feedback System Overhaul](#1-feedback-system-overhaul)
2. [Attendance & Check-In System](#2-attendance--check-in-system)
3. [Session Scheduling Redesign](#3-session-scheduling-redesign)
4. [Database Architecture: Unified User Table Debate](#4-database-architecture-unified-user-table-debate)
5. [Role & Permission System](#5-role--permission-system)
6. [Analytics & Reporting](#6-analytics--reporting)

---

## 1. Feedback System Overhaul

### 1.1 Current System Critique

The feedback system today has a **fundamental identity crisis**: it serves two entirely different use-cases through the same pipeline — casual post-session feedback and formal test/exam mode. This creates friction at every level.

**Problems:**

| Issue | Impact |
|---|---|
| **Feedback is coupled to check-in** | Students can ONLY answer feedback after scanning a QR code or completing face check-in. There is no standalone feedback route. If a teacher wants to run a quiz outside of attendance time, it's impossible. |
| **Test mode is bolted onto feedback** | `correct_answer` on `feedback_question` determines test vs. feedback. This means the same table, same UI, same service handles both satisfaction surveys and graded exams. Teachers rightly say "test mode is not feedback." |
| **Timing problem for tests** | Students check in at different times (20:00, 20:15, 20:30). If test mode is enabled, each student sees the test as they check in — not simultaneously. A teacher cannot say "everyone open the test now" because there is no shared start trigger. |
| **No proctoring for staggered arrivals** | Anti-cheat (tab switch detection, copy-paste blocking) is client-side and trivially bypassed. Early arrivals could share answers with late arrivals since there's no randomization or locking. |
| **No standalone test link** | Teacher cannot share a test URL independently of check-in flow. |
| **No per-student score history** | Test results are buried in `session_feedback.responses` JSONB. No aggregated score table, no student grade book, no pass/fail tracking. |
| **3 question types only** | `rating`, `text`, `multiple_choice`. No file upload, matching, ordering, fill-in-the-blank, or scale questions. |
| **No question bank** | Questions are created per-session. No cross-session question repository for reuse. |

### 1.2 Proposed Solution: Separate Feedback from Assessment

**Split into two independent systems:**

#### A. Feedback System (satisfaction surveys)
- Keep the existing `feedback_question` + `session_feedback` tables but strip all test-related columns.
- Remove: `correct_answer`, `grading_mode`, `allow_multiple` (exam semantics), `tab_switch_count`, `is_auto_submitted`, `max_tab_switches`, `feedback_time_limit_seconds`.
- Keep tied to attendance dates for "how was today's session?" use-case.
- Add a new option: **standalone feedback link** — teacher generates a URL that students can open anytime (not only after check-in). Implemented as a new `feedback_session` table with a shareable token.
- Consider adding NPS (Net Promoter Score) as a built-in question type.

#### B. Assessment System (quizzes, tests, exams) — New Module
Create a new `assessments` feature module:

```
src/features/assessments/
  pages/
    AssessmentBuilder.tsx    -- Teacher creates/edits assessment
    AssessmentTake.tsx       -- Student takes the assessment
    AssessmentResults.tsx    -- Teacher views results
    AssessmentGradebook.tsx  -- Student score history
  services/
    assessmentService.ts
  components/
    QuestionEditor.tsx
    QuestionRenderer.tsx
    ProctorShield.tsx        -- Anti-cheat wrapper
    TimerBar.tsx
```

**New tables:**

```sql
-- Question bank (reusable across assessments)
CREATE TABLE question_bank (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID REFERENCES teacher(teacher_id),
  course_id   UUID REFERENCES course(course_id),   -- optional scope
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL,  -- 'mcq' | 'text' | 'fill_blank' | 'matching' | 'ordering' | 'true_false'
  options     JSONB,
  correct_answer JSONB NOT NULL,   -- structured: { value: "A" } or { values: ["A","C"] } or { pairs: [...] }
  grading_mode TEXT DEFAULT 'exact',
  difficulty   TEXT DEFAULT 'medium',  -- 'easy' | 'medium' | 'hard'
  tags         TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Assessment (a test/exam instance)
CREATE TABLE assessment (
  assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES session(session_id),
  title         TEXT NOT NULL,
  description   TEXT,
  time_limit_seconds INTEGER,
  max_tab_switches   INTEGER DEFAULT 3,
  shuffle_questions   BOOLEAN DEFAULT false,
  shuffle_options     BOOLEAN DEFAULT false,
  show_results_after  TEXT DEFAULT 'submission',  -- 'submission' | 'deadline' | 'manual' | 'never'
  passing_score       NUMERIC(5,2),  -- e.g., 60.00 for 60%
  start_at     TIMESTAMPTZ,   -- teacher-controlled start (NULL = open immediately)
  deadline_at  TIMESTAMPTZ,
  status       TEXT DEFAULT 'draft',  -- 'draft' | 'published' | 'active' | 'closed'
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Link assessment to questions (with per-assessment overrides)
CREATE TABLE assessment_question (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  UUID REFERENCES assessment(assessment_id) ON DELETE CASCADE,
  question_id    UUID REFERENCES question_bank(question_id),
  sort_order     INTEGER,
  points         NUMERIC(5,2) DEFAULT 1.00,
  UNIQUE(assessment_id, question_id)
);

-- Student submission
CREATE TABLE assessment_submission (
  submission_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  UUID REFERENCES assessment(assessment_id),
  student_id     UUID REFERENCES student(student_id),
  responses      JSONB NOT NULL,  -- { questionId: answer }
  score          NUMERIC(5,2),    -- computed after grading
  max_score      NUMERIC(5,2),
  percentage     NUMERIC(5,2),
  passed         BOOLEAN,
  started_at     TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  tab_switch_count INTEGER DEFAULT 0,
  submission_reason TEXT,  -- 'completed' | 'timer_expired' | 'tab_violation'
  graded_at      TIMESTAMPTZ,
  UNIQUE(assessment_id, student_id)
);
```

**Key design decisions:**
- **Shared start trigger**: Teacher publishes assessment with `start_at` timestamp. All students see "Assessment starts in X minutes" countdown. No one can begin early.
- **Question bank per course**: Teachers build a question library. Assessments pull from it. Questions are reusable across sessions.
- **Shuffle**: Both question order and option order can be randomized per student, preventing easy copying.
- **Standalone URL**: Assessment has its own route `/assessment/:assessmentId` — NOT tied to check-in flow.
- **Gradebook**: `assessment_submission` has computed `score`, `percentage`, `passed`. A student dashboard can show all their test results.

### 1.3 Migration Path

1. Ship the new assessment module as a parallel feature. Don't modify existing feedback tables.
2. Add a toggle in session settings: "Use new Assessment system" vs. legacy test mode.
3. Deprecate `correct_answer`/`grading_mode` on `feedback_question` after migration.
4. Eventually remove test-mode code from `SessionFeedbackForm` and `feedbackService`.

---

## 2. Attendance & Check-In System

### 2.1 Current System Critique

**Strengths:**
- Multiple check-in methods (QR, face, manual, GPS) is genuinely useful
- Grace period system is well-designed
- Host rotation with GPS proximity is unique and powerful

**Weaknesses:**

| Issue | Impact |
|---|---|
| **Attendance.tsx is 1,200+ lines** | God component with transitional Supabase facades. Direct queries inside a page component violate the service layer pattern. Hard to maintain. |
| **AttendanceRecords.tsx is 6,145 lines** | Largest file in the codebase. Contains inline analytics, complex filtering, and multiple rendering modes. Nearly impossible to review or refactor safely. |
| **No offline check-in** | If internet drops, GPS buffer exists but QR/face check-in fails entirely. In areas with spotty connectivity (common in classroom settings), this is a real problem. |
| **Face recognition runs in-browser** | 12MB model download per session. On slow phones, loading face-api.js models takes 10-20 seconds. No server-side fallback. |
| **QR code is time-limited but static** | The QR token doesn't rotate. If a student screenshots the QR, they could share it. No TOTP-style rotating QR. |
| **No batch QR scanning** | Teacher must display QR, each student scans individually. No mode where teacher's phone scans student QR codes in sequence (reverse QR). |
| **GPS spoofing is trivial** | `navigator.geolocation` is easily spoofed on Android with developer tools or mock location apps. No server-side validation. |
| **"Session Not Held" is a manual flag** | No automatic detection (e.g., if no students check in by 30 minutes past start, auto-mark as not held). |
| **No attendance streaks or gamification** | No recognition for students with perfect attendance. No motivation system. |
| **Excused absence requires teacher action** | No student self-service excuse submission with evidence upload. |

### 2.2 Proposed Improvements

#### A. Rotating QR (Anti-Screenshot)

Replace the static QR with a time-rotating token:

```
Current:  QR → /checkin/abc123  (static, valid until teacher closes)
Proposed: QR → /checkin/abc123?t=1713400000&sig=hmac_sha256(...)
```

- QR regenerates every 15-30 seconds with a new TOTP-style signature
- Teacher's screen shows the QR auto-refreshing via `setInterval`
- Student must scan while physically present (screenshot becomes invalid after rotation)
- Backend validates `t` is within ±30 seconds of server time

**Implementation**: Add `qr_rotation_interval` to `session` table. In `QRCodeModal.tsx`, use a `useEffect` interval to regenerate the QR payload. Backend `checkinService` validates the time window.

#### B. Reverse QR (Teacher Scans Students)

New check-in mode where each student has a personal QR code (derived from their `student_id`):

- Student opens "My QR" in their student profile (or it's printed on an ID card)
- Teacher opens "Scan Students" mode → camera scans student QRs one by one
- Each scan instantly marks attendance
- Useful for: classroom entry, lab sessions, large gatherings

**Table change**: Add `student.qr_token` (UUID, unique) for the personal QR. Teacher's scan validates enrollment + session timing.

#### C. Offline Check-In with Sync

Enhance the existing GPS buffer pattern to support full offline check-in:

- When QR is scanned but network is unavailable, store the check-in payload in IndexedDB
- Show "Checked in (pending sync)" to the student
- Background sync when connectivity returns via Service Worker
- Teacher sees "X pending syncs" indicator

#### D. Face Recognition Improvements

- **Pre-cache models**: Use Service Worker to cache face-api.js models after first load
- **Server-side fallback**: Upload photo to Supabase Edge Function for server-side face matching (heavier but more reliable for weak devices)
- **Liveness detection**: Basic blink/head-turn challenge to prevent photo-of-photo attacks
- **Bulk face scan**: Teacher points camera at the room, system identifies all visible faces simultaneously (advanced — requires WebGL + good camera)

#### E. Attendance Analytics Improvements

Current analytics are embedded in the 6,145-line `AttendanceRecords.tsx`. Proposed refactor:

```
src/features/attendance/
  pages/
    Attendance.tsx           -- Daily marking (keep, but extract to service)
    AttendanceRecords.tsx    -- BREAK INTO:
  components/
    analytics/
      AttendanceSummaryTab.tsx    -- Session-level KPIs
      StudentAttendanceTab.tsx    -- Per-student breakdown
      DateAttendanceTab.tsx       -- Per-date breakdown
      TrendCharts.tsx             -- Time-series graphs
      HeatmapCalendar.tsx        -- Calendar view with color-coded attendance
      ExportPanel.tsx            -- Export options
```

**New analytics features:**
- **Attendance heatmap calendar**: Visual calendar where each day is color-coded (green = >90% present, yellow = 70-90%, red = <70%, gray = not held)
- **Student risk alerts**: Auto-flag students with >3 consecutive absences or <60% attendance rate
- **Comparison view**: Compare attendance across sessions/courses
- **GPS heatmap**: Where are students checking in from? Overlay on map.
- **Check-in time distribution**: Histogram showing when students typically arrive (helps optimize grace period)

#### F. Student Self-Service Excuses

```sql
CREATE TABLE excuse_request (
  request_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID REFERENCES student(student_id),
  session_id   UUID REFERENCES session(session_id),
  attendance_date DATE NOT NULL,
  reason       TEXT NOT NULL,
  evidence_url TEXT,   -- uploaded document/photo
  status       TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  reviewed_by  UUID REFERENCES teacher(teacher_id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

Student submits excuse with optional evidence → Teacher gets notification → Approves/rejects → Attendance status updated automatically.

> **Note:** There is already an `excuses` feature module in the codebase. This proposal extends it with evidence upload and an approval workflow.

---

## 3. Session Scheduling Redesign

### 3.1 Current System Critique

The session scheduling system has several design weaknesses that would not scale in an enterprise environment:

| Issue | Details |
|---|---|
| **`session.time` is a VARCHAR string** | Stored as `"09:00-12:00"`. Parsed client-side with regex. No timezone awareness. No validation that end > start. Impossible to query "all sessions starting after 14:00" efficiently. |
| **`session.day` is a free-text field** | Stored as `"Monday, Friday, Tuesday"` (comma-separated text). No normalization. Ordering is arbitrary. Cannot index or query by day efficiently. |
| **One override per date** | `session_time_change` and `session_day_change` have `UNIQUE(session_id, effective_date)`. Cannot represent "session moved from Monday to Wednesday AND time changed" as separate auditable events. |
| **No recurring schedule model** | Sessions have a start_date and end_date with a day-of-week pattern, but no formal recurrence rule (like iCal RRULE). Adding exceptions (holidays, room conflicts) requires manual day/time changes for each date. |
| **No room/resource management** | No concept of rooms, venues, or equipment. Two sessions can be scheduled at the same time in the same host's apartment with no conflict detection. |
| **No teacher availability** | No way for teachers to mark unavailable dates. Scheduling conflicts are invisible. |
| **Client-side time parsing is fragile** | `StudentCheckIn.tsx` parses time strings with regex. Edge cases (midnight crossing, 24h format variations, "TBD") can fail silently. |

### 3.2 Proposed Enterprise Redesign

#### A. Structured Time Columns

```sql
ALTER TABLE session
  ADD COLUMN start_time TIME,      -- e.g., '09:00:00'
  ADD COLUMN end_time   TIME,      -- e.g., '12:00:00'
  ADD COLUMN timezone   TEXT DEFAULT 'Asia/Dubai';

-- Migrate from session.time VARCHAR:
-- UPDATE session SET start_time = split_part(time, '-', 1)::TIME, ...
-- Then DROP session.time after migration
```

**Benefits**: Queryable, indexable, timezone-aware, no regex parsing needed.

#### B. Normalized Day-of-Week

```sql
CREATE TABLE session_schedule_day (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES session(session_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday
  UNIQUE(session_id, day_of_week)
);

-- Migrate from session.day TEXT:
-- INSERT INTO session_schedule_day SELECT ..., unnest(string_to_array(day, ', '))
```

**Benefits**: Queryable ("all Monday sessions"), indexable, no comma-parsing.

#### C. Schedule Exception Model

Replace `session_time_change` + `session_day_change` with a unified exception model:

```sql
CREATE TABLE session_schedule_exception (
  exception_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID REFERENCES session(session_id) ON DELETE CASCADE,
  original_date DATE NOT NULL,
  exception_type TEXT NOT NULL,  -- 'cancelled' | 'rescheduled' | 'time_change' | 'room_change'
  new_date      DATE,            -- NULL for cancellation
  new_start_time TIME,
  new_end_time   TIME,
  new_location   TEXT,
  reason         TEXT,
  changed_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, original_date)  -- one exception per original date
);
```

**Benefits**: Single table for all schedule modifications. Clean audit trail. Supports cancellations, rescheduling, and time changes in one record.

#### D. Holiday/Blackout Dates

```sql
CREATE TABLE calendar_blackout (
  blackout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  scope       TEXT DEFAULT 'global',  -- 'global' | 'course' | 'session'
  scope_id    UUID,  -- course_id or session_id if scoped
  created_by  UUID
);
```

When generating the session calendar, blackout dates are automatically excluded.

#### E. Conflict Detection

With structured data, conflict detection becomes possible:

```sql
-- Find overlapping sessions for a teacher on a given date
SELECT s1.session_id, s2.session_id
FROM session s1
JOIN session s2 ON s1.teacher_id = s2.teacher_id
  AND s1.session_id != s2.session_id
  AND daterange(s1.start_date, s1.end_date, '[]') && daterange(s2.start_date, s2.end_date, '[]')
WHERE (s1.start_time, s1.end_time) OVERLAPS (s2.start_time, s2.end_time)
  AND EXISTS (SELECT 1 FROM session_schedule_day d1 WHERE d1.session_id = s1.session_id
              INTERSECT
              SELECT 1 FROM session_schedule_day d2 WHERE d2.session_id = s2.session_id);
```

### 3.3 Migration Strategy

This is a significant schema change. Recommended approach:
1. Add new columns alongside old ones (non-breaking)
2. Backfill new columns from old data
3. Update all read paths to prefer new columns
4. Update all write paths to write both old and new
5. After verification, drop old columns

---

## 4. Database Architecture: Unified User Table Debate

### 4.1 The Proposal

> "Can we replace `admin`, `teacher`, `student` with a single `user` table with a `user_type` column?"

### 4.2 Current Architecture

```
auth.users (Supabase Auth)
    │
    ├── admin    (admin_id, email, auth_user_id FK)
    ├── teacher  (teacher_id, email, full_name, phone, ...)  -- NO auth FK
    └── student  (student_id, email, full_name, phone, photo_url, ...)  -- NO auth FK
```

Role resolution is **email-based**: `is_teacher()` checks if `auth.jwt() ->> 'email'` exists in `teacher.email`.

### 4.3 Arguments FOR a Unified User Table

| Argument | Details |
|---|---|
| **Simpler joins** | Currently, to get a user's name from an `enrollment`, you must join `enrollment → student → (no auth link)`. A unified table means one join. |
| **Single profile** | A person who is both a teacher and a student (common in peer-teaching scenarios) currently needs two separate records with potentially diverging data (different phone numbers, names). |
| **Easier RLS** | One `user_id` column on all tables instead of `student_id` + `teacher_id` + `admin_id`. RLS policies become `auth.uid() = user_id` instead of email-based function calls. |
| **Auth integration** | `teacher` and `student` have NO `auth_user_id` FK. This means Supabase Auth and the business tables are linked only by email string matching — fragile if emails change. |
| **Industry standard** | Most SaaS apps (Google Classroom, Canvas, Moodle) use a unified user model with role assignments. |

### 4.4 Arguments AGAINST (Challenges)

| Challenge | Details |
|---|---|
| **Different data shapes** | Students have `photo_url`, `face_descriptor`, `qr_token`. Teachers have course ownership. Admins have platform-level permissions. A single table would need many nullable columns or a JSONB `metadata` field — essentially recreating separate tables inside one. |
| **RLS complexity** | Currently, `is_teacher()` scopes a teacher to their own sessions. With a unified table, you'd need a role-assignment table and more complex policy logic: `EXISTS (SELECT 1 FROM user_role WHERE user_id = auth.uid() AND role = 'teacher')`. |
| **Migration risk** | 32 tables reference `student_id` or `teacher_id`. Migrating to a unified `user_id` means updating every FK, every RLS policy (142+), every service query, and every frontend type. This is a multi-week project with high regression risk. |
| **Multi-role ambiguity** | If a user is both teacher and student, which role applies? When they open the app, do they see the teacher dashboard or student check-in? This requires a role-switching UI and session-scoped role context. |
| **Performance** | One large table vs. three small tables. With proper indexing, this is negligible — but the `student` table has `face_descriptor JSONB` (potentially large binary data) that you don't want loaded when querying teachers. |

### 4.5 Recommendation: Hybrid Approach

**Don't merge into one table. Instead, add a proper auth link and a role-resolution layer.**

```sql
-- Add auth_user_id to teacher and student tables
ALTER TABLE teacher ADD COLUMN auth_user_id UUID REFERENCES auth.users(id);
ALTER TABLE student ADD COLUMN auth_user_id UUID REFERENCES auth.users(id);

-- Create a role view for convenience
CREATE VIEW user_roles AS
SELECT auth_user_id, 'admin' as role, admin_id as role_id FROM admin WHERE auth_user_id IS NOT NULL
UNION ALL
SELECT auth_user_id, 'teacher', teacher_id FROM teacher WHERE auth_user_id IS NOT NULL
UNION ALL
SELECT auth_user_id, 'student', student_id FROM student WHERE auth_user_id IS NOT NULL;
```

**Benefits:**
- Keep separate tables (different data shapes remain clean)
- Add proper `auth_user_id` FK (no more email-string matching)
- `user_roles` view gives a unified query surface
- RLS can use `auth.uid() = auth_user_id` instead of email functions
- Migration is incremental: add columns, backfill, update RLS one policy at a time
- Multi-role users are naturally supported (one auth user, rows in both teacher and student)

### 4.6 If You Still Want a Unified Table

If the decision is made to unify, here's the safest schema:

```sql
CREATE TABLE app_user (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID UNIQUE REFERENCES auth.users(id),
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_role (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES app_user(user_id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  UNIQUE(user_id, role)
);

-- Role-specific extension tables (for columns unique to a role)
CREATE TABLE student_profile (
  user_id         UUID PRIMARY KEY REFERENCES app_user(user_id),
  photo_url       TEXT,
  face_descriptor JSONB,
  qr_token        UUID UNIQUE DEFAULT gen_random_uuid()
);

CREATE TABLE teacher_profile (
  user_id    UUID PRIMARY KEY REFERENCES app_user(user_id),
  bio        TEXT,
  specialty  TEXT
);
```

This is essentially the hybrid approach but with the base data merged. The migration cost is enormous (every FK changes), so only pursue this if you're doing a major version bump.

---

## 5. Role & Permission System

### 5.1 Current Limitations

- Roles are binary: you're either admin, teacher, or student. No granularity.
- A teacher has full control over their sessions. No "assistant teacher" or "view-only" role.
- Admin is God — no audit on admin actions, no permission scoping.
- No delegated permissions (e.g., "this student can manage attendance for this session").

### 5.2 Proposed: Permission-Based Access Control

```sql
CREATE TABLE permission (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,  -- 'session.attendance.mark', 'session.feedback.manage', etc.
  description   TEXT
);

CREATE TABLE role_permission (
  role       TEXT NOT NULL,  -- 'admin' | 'teacher' | 'assistant' | 'student'
  permission_id UUID REFERENCES permission(permission_id),
  PRIMARY KEY (role, permission_id)
);

-- Session-scoped role assignment (e.g., assistant teacher for a specific session)
CREATE TABLE session_role (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES session(session_id),
  user_id    UUID,  -- auth user id
  role       TEXT NOT NULL,
  granted_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, user_id, role)
);
```

**Example permissions:**
- `session.attendance.view` — see attendance records
- `session.attendance.mark` — mark/edit attendance
- `session.feedback.manage` — create/edit feedback questions
- `session.assessment.create` — create assessments
- `session.enrollment.manage` — enroll/drop students
- `session.settings.edit` — change session configuration
- `admin.user.manage` — create/edit users
- `admin.system.configure` — platform settings

### 5.3 Teacher Controls to Add

Even without the full RBAC system, these teacher controls would improve the experience:

- **Lock attendance after X hours**: Teacher sets a cutoff; after that, only admin can edit.
- **Delegate attendance marking**: Allow a trusted student to mark attendance (e.g., class representative).
- **Notification preferences**: Teacher chooses which events trigger notifications (low attendance, new excuse, check-in surge).
- **Custom attendance statuses**: Beyond the fixed set, allow teachers to define custom statuses (e.g., "field trip", "medical").

---

## 6. Analytics & Reporting

### 6.1 Attendance Analytics Gaps

Current analytics are powerful but trapped in `AttendanceRecords.tsx` (6,145 lines). Proposed additions:

| Feature | Description |
|---|---|
| **Exportable PDF reports** | Per-student attendance report with charts, suitable for printing/sending to parents |
| **Cross-session comparison** | Compare attendance rates across all sessions for a teacher |
| **Predictive alerts** | "Student X likely to drop — 4 absences in last 5 sessions" |
| **Cohort analysis** | Group students by enrollment date, attendance pattern, or custom tags |
| **Teacher dashboard KPIs** | Sessions held vs. planned, average attendance rate, most/least attended sessions |
| **Admin oversight dashboard** | Platform-wide metrics: total active sessions, check-in method distribution, average session size |

### 6.2 Feedback Analytics Gaps

| Feature | Description |
|---|---|
| **Sentiment analysis** | NLP on text feedback to detect positive/negative trends |
| **Question effectiveness** | For test mode: item analysis (discrimination index, difficulty index) |
| **Response time analytics** | Average time per question, identify questions students struggle with |
| **Cross-session feedback trends** | Is teacher satisfaction improving over time? |
| **Benchmark comparisons** | How does this session's feedback compare to the course average? |

### 6.3 Combined Dashboard Vision

```
┌─────────────────────────────────────────────────────┐
│                  TEACHER DASHBOARD                   │
├────────────┬────────────┬────────────┬──────────────┤
│ Sessions   │ Attendance │ Feedback   │ Assessments  │
│ 12 active  │ 87% avg    │ 4.2/5 avg  │ 3 upcoming   │
│ 2 ending   │ ↑3% trend  │ ↓0.1 trend │ 78% avg pass │
├────────────┴────────────┴────────────┴──────────────┤
│ ALERTS                                               │
│ ⚠ 3 students below 60% attendance in "C#"           │
│ ⚠ Feedback score dropped 15% for "الرحيق المختوم"    │
│ ✅ All assessments graded for this week              │
├─────────────────────────────────────────────────────┤
│ UPCOMING                                             │
│ Today 20:00  الرحيق المختوم  (19 enrolled, Ayham hosting) │
│ Tomorrow 10:00  C#  (19 enrolled, no host assigned)  │
└─────────────────────────────────────────────────────┘
```

---

## Priority Matrix

| Improvement | Impact | Effort | Priority |
|---|---|---|---|
| Fix enrollment_date in merge | Critical | Low | ✅ Done |
| Separate feedback from assessment | High | High | P1 |
| Rotating QR anti-screenshot | Medium | Medium | P1 |
| Structured time/day columns | High | High | P2 |
| Student self-service excuses | Medium | Medium | P2 |
| Auth user_id FK on teacher/student | High | Medium | P2 |
| Reverse QR (teacher scans students) | Medium | Medium | P2 |
| Break up AttendanceRecords.tsx | Medium | High | P2 |
| Question bank for assessments | Medium | Medium | P3 |
| Offline check-in sync | Medium | High | P3 |
| Server-side face recognition | Low | High | P3 |
| Full RBAC permission system | Low | Very High | P4 |
| Unified user table migration | Low | Very High | P4 |
| AI-powered analytics/predictions | Low | Very High | P4 |

---

## Summary

The system has a strong foundation — multi-method check-in, GPS proximity, host rotation, and real-time QR are genuinely impressive features. The main architectural debts are:

1. **Feedback ≠ Assessment**: These must be separated. Test mode is not feedback.
2. **String-based scheduling**: `session.time` and `session.day` as VARCHAR fields don't scale.
3. **Email-based auth linking**: Add `auth_user_id` FK to teacher/student tables.
4. **God components**: `AttendanceRecords.tsx` (6,145 lines) and `Attendance.tsx` need decomposition.
5. **No standalone assessment route**: Tests should be independent of check-in flow.

The hybrid user approach (keep separate tables + add auth FK) is the pragmatic choice over a risky full unification.
