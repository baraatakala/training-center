# Architecture Audit & Restructuring Plan

**Date**: 2025-07  
**Scope**: Full project audit — Training Center Management System  
**Stack**: React 19 + TypeScript 5.9 + Vite 7 + Supabase + Tailwind CSS  
**Codebase**: ~40,000 lines in `src/`, 78 SQL files, 44 markdown files in root

---

## 1. Executive Summary

This codebase has grown feature-by-feature through AI-assisted development without architectural guardrails. The result is a working application with severe structural debt:

- **14 god-components** over 1,000 lines each (worst: 6,145 lines, 41 `useState` hooks)
- **20 files bypass the service layer** by importing Supabase directly into pages/components
- **78 SQL migration files** scattered in root with no ordering, no status tracking, overlapping fixes
- **44 markdown files** in root, most AI-generated documentation artifacts
- **Zero test files**
- **Duplicate type definitions** (same entity defined differently in 3+ places)
- **Inconsistent export patterns** (named vs default) forcing different lazy-load syntax in App.tsx

The app works. But every new feature or bug fix carries increasing risk because:
1. You can't change a 6,000-line file safely — every edit might break something unrelated
2. You can't trust the service layer because half the app bypasses it
3. You can't reason about the database schema because it's spread across 78 unsorted files
4. You can't onboard anyone (human or AI) because there's no clear structure to follow

---

## 2. Problem Inventory (Specific, Not Generic)

### 2.1 God Components — State Explosion

| File | Lines | `useState` Hooks | Verdict |
|------|-------|-----------------|---------|
| `pages/AttendanceRecords.tsx` | 6,145 | 41 | **Critical** — split into 8+ components |
| `pages/Attendance.tsx` | 2,844 | 41 | **Critical** — split into 6+ components |
| `components/AdvancedExportBuilder.tsx` | 2,028 | — | **Critical** — standalone feature module |
| `services/wordExportService.ts` | 1,991 | — | **High** — split by export section |
| `pages/Dashboard.tsx` | 1,747 | 22 | **High** — extract stat cards, charts, tables |
| `components/BulkScheduleTable.tsx` | 1,739 | 18 | **High** — split table, filters, actions |
| `pages/Announcements.tsx` | 1,513 | 37 | **High** — extract form, list, comment thread |
| `pages/ScoringConfiguration.tsx` | 1,479 | 14 | **High** — extract config sections |
| `pages/Sessions.tsx` | 1,417 | 24 | **High** — extract list, filters, actions |
| `pages/Certificates.tsx` | 1,365 | 40 | **High** — extract template editor, issuer, preview |
| `pages/FeedbackAnalytics.tsx` | 1,292 | 21 | **High** — extract chart panels, filters |
| `pages/ExcuseRequests.tsx` | 1,194 | 26 | **High** — extract list, detail, approval flow |
| `pages/AuditLogs.tsx` | 1,123 | — | **Medium** — extract filters, log table |
| `pages/PhotoCheckIn.tsx` | 1,093 | — | **Medium** — extract camera, verification |

**Root cause**: Each page evolved by adding features inline — filters, modals, forms, export buttons, analytics, sub-tables — without ever extracting sub-components.

### 2.2 Service Layer Bypass

The project claims a service layer architecture (`src/services/`) but **20 out of ~36 pages+components** import `supabase` directly:

**Pages bypassing services (11/16):**
- `AttendanceRecords.tsx` — queries attendance, sessions, enrollments, students directly
- `Attendance.tsx` — queries/mutates attendance, enrollments, sessions directly
- `Dashboard.tsx` — queries multiple tables for stats
- `Sessions.tsx` — queries sessions table directly
- `Announcements.tsx` — queries announcements, comments, reactions
- `Certificates.tsx` — queries certificates, templates
- `FeedbackAnalytics.tsx` — queries feedback data
- `ExcuseRequests.tsx` — queries excuse requests
- `Messages.tsx` — queries messages, reactions, starred
- `PhotoCheckIn.tsx` — queries photo check-in sessions
- `StudentCheckIn.tsx` — handles QR check-in flow

**Components bypassing services (9):**
- `BulkScheduleTable.tsx`, `BulkImport.tsx`, `BookReferencesManager.tsx`
- `SessionForm.tsx`, `CourseForm.tsx`, `EnrollmentForm.tsx`
- `QRCodeModal.tsx`, `PhotoUpload.tsx`, `PhotoCheckInModal.tsx`

**Consequences:**
- Query logic is duplicated (same joins written in multiple pages)
- Error handling is inconsistent (some pages check errors, some don't)
- No single place to add caching, logging, or transform logic
- Testing is impossible without mocking Supabase at the component level

### 2.3 Duplicate Type Definitions

The same data shapes are defined in multiple places with different names:

- `types/database.types.ts` → `Attendance` interface
- `pages/Attendance.tsx` → `AttendanceRecord` type (lines 48-66) — different shape
- `pages/AttendanceRecords.tsx` → `AttendanceRecord` interface (lines 23-50) — yet another shape
- `services/attendanceService.ts` → Inline result types

This means changes to the attendance schema require hunting through 3+ files to update types.

### 2.4 Inline Business Logic in UI

Pages contain raw SQL-level business logic that belongs in services:
- `AttendanceRecords.tsx` — attendance scoring algorithms, analytics calculations, aggregation
- `Attendance.tsx` — enrollment validation, host rotation logic, GPS distance calculations
- `Dashboard.tsx` — stat aggregation queries, chart data transformations
- `Certificates.tsx` — certificate generation, template processing

### 2.5 SQL File Chaos (78 files)

**Categories:**
| Prefix | Count | Purpose |
|--------|-------|---------|
| `ADD-*` | 25 | Adding tables/columns/constraints |
| `FIX-*` | 16 | Fixing broken RLS, constraints, data |
| `VERIFY-*` / `CHECK-*` | 4 | Diagnostic scripts |
| `ROLLBACK-*` | 2 | Undo scripts |
| `MIGRATE-*` / `RUN-*` | 3 | Combined migrations |
| `CLEANUP-*` | 1 | Data cleanup |
| Other | 27 | Schema dumps, samples, one-offs |

**Problems:**
1. **No ordering** — There's no way to know which SQL file to run first
2. **Overlapping changes** — `ADD-EXCUSE-REQUEST-TABLE.sql` and `FIX-EXCUSE-REQUEST-TABLE.sql` may conflict
3. **Already-applied migrations** — Most of these have been run against production but still sit in root as if they're pending
4. **No schema snapshot** — `current copy as sql from supabase database.sql` is a dump, not a source of truth
5. **DISABLE_RLS.sql exists** — A development convenience file that should never exist in a production codebase

### 2.6 Root Directory Pollution

The root directory has **122+ SQL/MD files** that obscure the actual project files (`package.json`, `vite.config.ts`, etc.). The root should contain only project config files.

### 2.7 Inconsistent Export Patterns

```tsx
// Some pages use named exports:
export function Attendance() { ... }
export function Dashboard() { ... }

// Some use default exports:
export default function AttendanceRecords() { ... }
export default ScoringConfiguration;
```

This forces App.tsx to use different lazy-load patterns:
```tsx
// Named export → requires .then() wrapper
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));

// Default export → clean
const AttendanceRecords = lazy(() => import('./pages/AttendanceRecords'));
```

### 2.8 No Tests

Zero test files. No testing framework configured. No test script in `package.json`.

### 2.9 Single Context for Everything

Only `AuthContext` exists. All other state is managed with `useState` at the page level, leading to:
- Prop drilling through deeply nested components
- Duplicate state when multiple components need the same data
- No shared state management for cross-cutting concerns (e.g., "current session" shared between attendance, scheduling, and recordings)

### 2.10 Missing Environment Validation

`supabase.ts` logs errors and shows an `alert()` when env vars are missing — in production. This should fail fast in development and silently degrade or show a proper error page in production.

---

## 3. New Folder Structure

### Current Structure (flat, entity-based)
```
src/
├── components/         ← 20+ files, mixed concerns
│   ├── ui/             ← Good: shared primitives
│   ├── BulkScheduleTable.tsx
│   ├── SessionForm.tsx
│   └── ...
├── pages/              ← 16 god-components
├── services/           ← 22 services (good idea, poorly enforced)
├── hooks/              ← 6 hooks
├── utils/              ← 4 utilities
├── context/            ← 1 context
├── types/              ← 1 file
├── constants/          ← 1 file
├── lib/                ← 1 file
└── assets/
```

### Proposed Structure (feature-based)
```
src/
├── app/                              ← App shell
│   ├── App.tsx
│   ├── routes.tsx                    ← Route definitions only
│   ├── Layout.tsx
│   └── providers.tsx                 ← AuthProvider + any future providers
│
├── features/                         ← Feature modules (the core change)
│   ├── attendance/
│   │   ├── pages/
│   │   │   ├── AttendancePage.tsx         ← Slim orchestrator (~200 lines)
│   │   │   └── AttendanceRecordsPage.tsx  ← Slim orchestrator (~200 lines)
│   │   ├── components/
│   │   │   ├── AttendanceTable.tsx
│   │   │   ├── AttendanceFilters.tsx
│   │   │   ├── AttendanceStatusBadge.tsx
│   │   │   ├── HostSelector.tsx
│   │   │   ├── DateSelector.tsx
│   │   │   ├── BulkActions.tsx
│   │   │   ├── RecordsTable.tsx
│   │   │   ├── RecordsFilters.tsx
│   │   │   ├── StudentAnalyticsPanel.tsx
│   │   │   └── AttendanceCharts.tsx
│   │   ├── hooks/
│   │   │   ├── useAttendanceData.ts       ← Data fetching + state
│   │   │   ├── useAttendanceRecords.ts
│   │   │   └── useHostRotation.ts
│   │   ├── services/
│   │   │   ├── attendanceService.ts
│   │   │   ├── attendanceRecordsService.ts
│   │   │   └── attendanceAnalytics.ts
│   │   ├── types.ts                       ← All attendance types
│   │   └── index.ts                       ← Public API (re-exports)
│   │
│   ├── sessions/
│   │   ├── pages/
│   │   │   └── SessionsPage.tsx
│   │   ├── components/
│   │   │   ├── SessionList.tsx
│   │   │   ├── SessionForm.tsx
│   │   │   ├── SessionFilters.tsx
│   │   │   ├── BulkScheduleTable.tsx
│   │   │   ├── SessionCloneDialog.tsx
│   │   │   ├── SessionRecordingsManager.tsx
│   │   │   └── SessionFeedbackForm.tsx
│   │   ├── hooks/
│   │   │   ├── useSessionData.ts
│   │   │   └── useBulkSchedule.ts
│   │   ├── services/
│   │   │   ├── sessionService.ts
│   │   │   ├── sessionRecordingService.ts
│   │   │   └── smartSchedulingService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── courses/
│   │   ├── pages/
│   │   │   └── CoursesPage.tsx
│   │   ├── components/
│   │   │   ├── CourseForm.tsx
│   │   │   ├── CourseList.tsx
│   │   │   ├── BookReferencesManager.tsx
│   │   │   └── CourseDescriptionEditor.tsx
│   │   ├── services/
│   │   │   └── courseService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── students/
│   │   ├── pages/
│   │   │   └── StudentsPage.tsx
│   │   ├── components/
│   │   │   ├── StudentForm.tsx
│   │   │   └── StudentList.tsx
│   │   ├── services/
│   │   │   └── studentService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── teachers/
│   │   ├── pages/
│   │   │   └── TeachersPage.tsx
│   │   ├── components/
│   │   │   ├── TeacherForm.tsx
│   │   │   └── TeacherList.tsx
│   │   ├── services/
│   │   │   └── teacherService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── enrollments/
│   │   ├── pages/
│   │   │   └── EnrollmentsPage.tsx
│   │   ├── components/
│   │   │   ├── EnrollmentForm.tsx
│   │   │   ├── EnrollmentList.tsx
│   │   │   └── BulkImport.tsx
│   │   ├── services/
│   │   │   ├── enrollmentService.ts
│   │   │   └── masterDataImportService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── checkin/
│   │   ├── pages/
│   │   │   ├── StudentCheckInPage.tsx
│   │   │   └── PhotoCheckInPage.tsx
│   │   ├── components/
│   │   │   ├── QRCodeModal.tsx
│   │   │   ├── PhotoCheckInModal.tsx
│   │   │   ├── PhotoUpload.tsx
│   │   │   └── LocationMap.tsx
│   │   ├── services/
│   │   │   └── gpsService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── communication/
│   │   ├── pages/
│   │   │   ├── AnnouncementsPage.tsx
│   │   │   └── MessagesPage.tsx
│   │   ├── components/
│   │   │   ├── AnnouncementForm.tsx
│   │   │   ├── AnnouncementList.tsx
│   │   │   ├── CommentThread.tsx
│   │   │   ├── MessageThread.tsx
│   │   │   └── MessageComposer.tsx
│   │   ├── services/
│   │   │   └── communicationService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── certificates/
│   │   ├── pages/
│   │   │   └── CertificatesPage.tsx
│   │   ├── components/
│   │   │   ├── TemplateEditor.tsx
│   │   │   ├── CertificatePreview.tsx
│   │   │   └── CertificateIssuer.tsx
│   │   ├── services/
│   │   │   └── certificateService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── excuses/
│   │   ├── pages/
│   │   │   └── ExcuseRequestsPage.tsx
│   │   ├── components/
│   │   │   ├── ExcuseRequestList.tsx
│   │   │   ├── ExcuseRequestDetail.tsx
│   │   │   └── ApprovalControls.tsx
│   │   ├── services/
│   │   │   └── excuseRequestService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── feedback/
│   │   ├── pages/
│   │   │   └── FeedbackAnalyticsPage.tsx
│   │   ├── components/
│   │   │   ├── FeedbackCharts.tsx
│   │   │   ├── FeedbackFilters.tsx
│   │   │   └── ResponseTable.tsx
│   │   ├── services/
│   │   │   └── feedbackService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── scoring/
│   │   ├── pages/
│   │   │   └── ScoringConfigPage.tsx
│   │   ├── components/
│   │   │   ├── ScoringRulesEditor.tsx
│   │   │   └── ScoringPreview.tsx
│   │   ├── services/
│   │   │   └── scoringConfigService.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── dashboard/
│   │   ├── pages/
│   │   │   └── DashboardPage.tsx
│   │   ├── components/
│   │   │   ├── StatCards.tsx
│   │   │   ├── RecentActivity.tsx
│   │   │   ├── QuickActions.tsx
│   │   │   └── OverviewCharts.tsx
│   │   └── index.ts
│   │
│   ├── audit/
│   │   ├── pages/
│   │   │   └── AuditLogsPage.tsx
│   │   ├── components/
│   │   │   ├── AuditLogTable.tsx
│   │   │   └── AuditLogFilters.tsx
│   │   ├── services/
│   │   │   └── auditService.ts
│   │   └── index.ts
│   │
│   ├── export/
│   │   ├── components/
│   │   │   └── AdvancedExportBuilder.tsx
│   │   ├── services/
│   │   │   ├── excelExportService.ts
│   │   │   ├── pdfExportService.ts
│   │   │   └── wordExportService.ts
│   │   └── index.ts
│   │
│   └── specializations/
│       ├── pages/
│       │   └── SpecializationsPage.tsx
│       ├── services/
│       │   └── specializationService.ts
│       └── index.ts
│
├── shared/                           ← Cross-feature shared code
│   ├── components/
│   │   ├── ui/                       ← Keep existing UI primitives
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Pagination.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Toast.tsx
│   │   │   └── index.ts
│   │   ├── ErrorBoundary.tsx
│   │   ├── PrivateRoute.tsx
│   │   ├── PhotoAvatar.tsx
│   │   └── Breadcrumb.tsx
│   ├── hooks/
│   │   ├── useConfirmDialog.ts
│   │   ├── useDebounce.ts
│   │   ├── useIsTeacher.ts
│   │   ├── useOnlineStatus.ts
│   │   ├── useRefreshOnFocus.ts
│   │   └── useToast.ts
│   ├── utils/
│   │   ├── formatDate.ts
│   │   ├── photoUtils.ts
│   │   └── attendanceGenerator.ts
│   ├── services/
│   │   └── geocodingService.ts       ← Used across features
│   ├── types/
│   │   └── database.types.ts         ← Shared Supabase types
│   ├── constants/
│   │   └── attendance.ts
│   └── lib/
│       └── supabase.ts
│
├── main.tsx
├── index.css
└── App.css
```

### Rules for the New Structure:
1. **Features never import from other features.** If two features need the same thing, it goes in `shared/`.
2. **Only `shared/lib/supabase.ts` and feature `services/` files may import Supabase.** Pages and components NEVER import Supabase.
3. **Feature `index.ts` is the public API.** Other features import from the index, not from internal files.
4. **Pages are thin orchestrators** (<300 lines). They wire together hooks and components. No business logic.
5. **Custom hooks own the state.** Data fetching, loading states, error states, and transformations live in hooks.

---

## 4. SQL Consolidation Plan

### Current: 78 files scattered in root
### Target: 4 files in `database/` directory

```
database/
├── schema.sql           ← All CREATE TABLE, ALTER TABLE, indexes
├── policies.sql         ← All RLS policies + helper functions (is_admin, etc.)
├── functions.sql        ← All stored procedures, triggers
└── seeds.sql            ← Sample/test data
```

Additionally, move historical files to an archive:
```
database/
├── archive/             ← All 78 original SQL files (read-only reference)
│   ├── ADD-*.sql
│   ├── FIX-*.sql
│   └── ...
├── schema.sql
├── policies.sql
├── functions.sql
└── seeds.sql
```

### How to Build `schema.sql`:

1. Export your current production schema from Supabase Dashboard → SQL Editor → `pg_dump` or use:
   ```sql
   -- In Supabase SQL Editor:
   SELECT pg_catalog.pg_get_tabledef(c.oid)
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
   ORDER BY c.relname;
   ```
   Or simpler: go to Supabase Dashboard → Database → Schema → export each table's DDL.

2. Alternatively, use `current copy as sql from supabase database.sql` as a starting point and clean it up:
   - Remove data, keep only DDL
   - Reorder tables by dependency (referenced tables first)
   - Add comments for each table's purpose

### How to Build `policies.sql`:

1. Export current RLS policies:
   ```sql
   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname;
   ```

2. Include all helper functions: `is_admin()`, `is_teacher()`, `get_my_student_id()`

3. Group by table with clear headers:
   ```sql
   -- ============================================================
   -- TABLE: attendance
   -- ============================================================
   -- Admin: full CRUD
   CREATE POLICY "admin_all_attendance" ON attendance FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
   -- Teacher: SELECT + INSERT
   CREATE POLICY "teacher_read_attendance" ON attendance FOR SELECT TO authenticated USING (is_teacher());
   -- ...
   ```

### Files to DELETE after consolidation:
- `DISABLE_RLS.sql` — **Delete immediately.** This is a security risk if accidentally run.
- All `VERIFY-*.sql` and `CHECK-*.sql` — Diagnostic scripts, not migrations
- All `ROLLBACK-*.sql` — Keep in archive only

### Files to MOVE to `database/archive/`:
- All 78 SQL files in root → `database/archive/`
- All migration-related MD files → `database/archive/`

---

## 5. Frontend Refactoring Targets

### Priority 1: AttendanceRecords.tsx (6,145 lines → ~8 files)

This file currently does: data fetching, filtering, sorting, pagination, analytics calculations, charting, export building, GPS mapping, student drill-down, and table rendering.

**Split into:**

| New File | Responsibility | Est. Lines |
|----------|---------------|------------|
| `AttendanceRecordsPage.tsx` | Orchestrator — wires hooks to components | ~150 |
| `useAttendanceRecords.ts` (hook) | Data fetching, filtering state, pagination | ~300 |
| `RecordsTable.tsx` | Table rendering + row actions | ~400 |
| `RecordsFilters.tsx` | Filter bar (date, course, session, status) | ~200 |
| `StudentAnalyticsPanel.tsx` | Per-student drill-down analytics | ~500 |
| `AttendanceCharts.tsx` | Chart panels (already partially extracted) | ~400 |
| `attendanceAnalytics.ts` (service) | Scoring, consistency, trends | ~500 |
| `attendanceRecordsService.ts` (service) | All Supabase queries for this page | ~300 |

### Priority 2: Attendance.tsx (2,844 lines → ~6 files)

| New File | Responsibility | Est. Lines |
|----------|---------------|------------|
| `AttendancePage.tsx` | Orchestrator | ~150 |
| `useAttendanceData.ts` (hook) | Session data, student list, date state | ~250 |
| `AttendanceTable.tsx` | Status grid for each student | ~400 |
| `HostSelector.tsx` | Host selection and rotation controls | ~200 |
| `DateSelector.tsx` | Date picker with day-change awareness | ~150 |
| `BulkActions.tsx` | Mark all, export, QR code trigger | ~200 |

### Priority 3: Dashboard.tsx (1,747 lines → ~5 files)

| New File | Responsibility | Est. Lines |
|----------|---------------|------------|
| `DashboardPage.tsx` | Layout orchestrator | ~100 |
| `StatCards.tsx` | Top-level stat cards | ~200 |
| `RecentActivity.tsx` | Recent activity feed | ~200 |
| `QuickActions.tsx` | Action shortcuts | ~100 |
| `OverviewCharts.tsx` | Summary charts | ~300 |

### Priority 4: Remaining Large Pages

Apply the same pattern to each: **Page** (thin orchestrator) + **Hook** (data/state) + **Components** (UI blocks).

Refactoring order (by business impact and file size):
1. `Announcements.tsx` (1,513 lines) → Form + List + CommentThread
2. `Certificates.tsx` (1,365 lines) → TemplateEditor + CertificateIssuer + Preview
3. `Sessions.tsx` (1,417 lines) → SessionList + SessionFilters + SessionActions
4. `ExcuseRequests.tsx` (1,194 lines) → RequestList + RequestDetail + ApprovalControls
5. `ScoringConfiguration.tsx` (1,479 lines) → ScoringRulesEditor + ScoringPreview
6. `FeedbackAnalytics.tsx` (1,292 lines) → FeedbackCharts + FeedbackFilters + ResponseTable
7. `BulkScheduleTable.tsx` (1,739 lines) → table + filters + actions into sub-components

### Refactoring Pattern (apply uniformly):

```tsx
// BEFORE: God component (1000+ lines)
export function SomePage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({});
  // ... 20+ more useState hooks
  // ... 500 lines of data fetching and transformation
  // ... 500 lines of JSX with inline conditions

  return (
    <div>
      {/* 800 lines of mixed UI */}
    </div>
  );
}

// AFTER: Thin page + hook + components
// hooks/useSomeData.ts
export function useSomeData(filters: Filters) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    someService.getFiltered(filters).then(({ data, error }) => {
      if (error) setError(error.message);
      else setData(data ?? []);
      setLoading(false);
    });
  }, [filters]);

  return { data, loading, error };
}

// pages/SomePage.tsx (~150 lines)
export function SomePage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const { data, loading, error } = useSomeData(filters);

  if (error) return <ErrorDisplay message={error} />;

  return (
    <div>
      <SomeFilters value={filters} onChange={setFilters} />
      {loading ? <TableSkeleton /> : <SomeTable data={data} />}
    </div>
  );
}
```

---

## 6. Coding Standards

### File Size Limits
- **Pages**: Max 300 lines. If larger, extract components/hooks.
- **Components**: Max 400 lines. If larger, break into sub-components.
- **Services**: Max 500 lines. If larger, split by sub-domain.
- **Hooks**: Max 200 lines. If larger, compose smaller hooks.
- **`useState` per component**: Max 7. If more, use `useReducer` or extract a custom hook.

### Naming Conventions
| Item | Convention | Example |
|------|-----------|---------|
| Feature folders | `kebab-case` | `features/attendance/` |
| Page components | `PascalCase + Page` suffix | `AttendancePage.tsx` |
| Sub-components | `PascalCase`, descriptive | `HostSelector.tsx` |
| Hooks | `use` prefix + `camelCase` | `useAttendanceData.ts` |
| Services | `camelCase + Service` suffix | `attendanceService.ts` |
| Types files | `types.ts` per feature | `features/attendance/types.ts` |
| Constants | `UPPER_SNAKE_CASE` values, `camelCase` file | `attendance.ts` |

### Export Rules
- **All pages**: Use **named exports only**. No default exports from pages.
  ```tsx
  // ✅ Good
  export function AttendancePage() { ... }
  
  // ❌ Bad  
  export default function AttendancePage() { ... }
  ```
- **Feature `index.ts`**: Re-export only the public API.
- **UI components**: Named exports via barrel `index.ts`.

### Data Access Rules
1. **ONLY service files may import `supabase`.** Zero exceptions.
2. Services return `{ data, error }` — always.
3. Pages/components call services → never raw Supabase queries.
4. Shared types come from `shared/types/database.types.ts` — never define inline.

### Error Handling
- Services: Return `{ data: null, error }` on failure. Never throw.
- Hooks: Expose `error` state. Let the page decide how to display it.
- Pages: Use `<ErrorBoundary>` for unexpected crashes. Use inline error UI for expected failures.

### State Management
- Feature-local state: `useState` + custom hooks.
- Cross-feature state: React Context (create new contexts as needed — don't cram into AuthContext).
- Server state: Consider adopting React Query / TanStack Query when complexity justifies it.

### Import Ordering
```tsx
// 1. React/library imports
import { useState, useEffect } from 'react';
import { format } from 'date-fns';

// 2. Shared imports
import { Button, Card } from '@/shared/components/ui';
import { useToast } from '@/shared/hooks/useToast';

// 3. Feature-local imports
import { useAttendanceData } from '../hooks/useAttendanceData';
import { AttendanceTable } from '../components/AttendanceTable';

// 4. Types
import type { AttendanceRecord } from '../types';
```

---

## 7. AI-Safe Development Rules

These rules prevent AI coding assistants from introducing the structural problems found in this audit.

### Rule 1: File Size Gate
> **Before writing any new code into a file, check its line count. If it exceeds the limit (Page: 300, Component: 400, Service: 500, Hook: 200), STOP and extract before adding.**

### Rule 2: No Direct Supabase
> **Never import `supabase` in any file outside of `shared/lib/` or `features/*/services/`. If a component needs data, create or extend a service function.**

### Rule 3: One Feature, One Folder
> **Every new feature gets a folder under `features/`. It contains its own pages, components, hooks, services, and types. No scattering files across unrelated folders.**

### Rule 4: Types in One Place
> **Never define inline interfaces for data from the database. Import from `shared/types/database.types.ts` or the feature's `types.ts`. If a type doesn't exist, add it in the right place first.**

### Rule 5: Thin Pages
> **A page component wires together a hook (data) and components (UI). It does NOT contain: Supabase queries, data transformations, complex conditional rendering logic (>10 lines), or inline form definitions.**

### Rule 6: New SQL = New Migration File
> **Never modify `schema.sql`, `policies.sql`, or `functions.sql` directly for incremental changes. Create a numbered migration file: `database/migrations/NNNN-description.sql`. Update the consolidated files periodically.**

### Rule 7: No Root File Dumping
> **Nothing goes in the project root except configuration files (`package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.env`, `.gitignore`, `README.md`). Everything else has a designated folder.**

### Rule 8: Extract Before Extending
> **When adding a feature to an existing page, first extract the current functionality into sub-components. Then add the new feature as a new sub-component. Never grow a god component.**

### Rule 9: Consistent Patterns
> **Every feature follows the same structure: `pages/` + `components/` + `hooks/` + `services/` + `types.ts` + `index.ts`. No exceptions, even for small features.**

### Rule 10: Copilot Instructions File
> **Keep `.github/copilot-instructions.md` updated. When the structure changes, update the instructions. This file is the AI's ground truth for the project.**

---

## 8. Documentation Consolidation

### Current: 44 MD files in root

### Action Plan:

**Keep in root (3 files):**
- `README.md` — Project overview, setup, dev commands
- `CHANGELOG.md` — Consolidate all change history into one file (create new)
- `CONTRIBUTING.md` — Coding standards summary (create new, content from Section 6 above)

**Move to `docs/` (keep ~6 files):**
```
docs/
├── architecture.md          ← This audit document (cleaned up)
├── database.md              ← Consolidate DATABASE_DOCUMENTATION.md + schema explanations
├── features/
│   ├── attendance-system.md ← Consolidate ATTENDANCE-SYSTEM-UPGRADES.md + CONFIGURABLE-GRACE-PERIOD.md
│   ├── book-tracking.md     ← Consolidate 3 book tracking MD files
│   └── certificates.md      ← From existing certificate docs
└── deployment.md            ← From DEPLOYMENT-READY.md
```

**Archive (move to `docs/archive/`):**
All other MD files — `BUGS_AND_FIXES.md`, `FEATURE_IDEAS.md`, `FUTURE-FEATURES-ROADMAP.md`, `VISUAL-IMPROVEMENTS-GUIDE.md`, `WORD-EXPORT-*.md`, etc.

**Delete:**
- `CORRECT-IMPLEMENTATION.md`, `CONSTRAINT-MISMATCH-EXPLANATION.md`, `FINAL-VERIFICATION-CHECKLIST.md` — One-time debugging artifacts with no ongoing value.

---

## 9. Step-by-Step Migration Plan

### Phase 0: Preparation (do first, before any refactoring)

- [ ] **0.1** Create a new branch: `refactor/architecture-v2`
- [ ] **0.2** Create `database/` directory. Move all 78 SQL files to `database/archive/`
- [ ] **0.3** Create `docs/` directory. Move all 44 MD files per Section 8 plan
- [ ] **0.4** Create `database/schema.sql` by exporting current production DDL
- [ ] **0.5** Create `database/policies.sql` by exporting current RLS policies
- [ ] **0.6** Create `database/functions.sql` by exporting current functions
- [ ] **0.7** Delete `DISABLE_RLS.sql`
- [ ] **0.8** Commit: "chore: organize root — move SQL to database/, docs to docs/"

### Phase 1: Shared Infrastructure (low risk, high value)

- [ ] **1.1** Create `src/shared/` and move: `components/ui/`, `hooks/`, `utils/`, `constants/`, `types/`, `lib/`, `components/ErrorBoundary.tsx`, `components/PrivateRoute.tsx`, `components/PhotoAvatar.tsx`
- [ ] **1.2** Update all import paths (use find-and-replace — old paths will cause build errors, so nothing is missed)
- [ ] **1.3** Create `src/app/` and move: `App.tsx`, `Layout.tsx`. Extract route definitions to `routes.tsx`.
- [ ] **1.4** Set up path aliases in `tsconfig.json` and `vite.config.ts`:
  ```json
  // tsconfig.json
  {
    "compilerOptions": {
      "paths": {
        "@/*": ["./src/*"],
        "@shared/*": ["./src/shared/*"],
        "@features/*": ["./src/features/*"]
      }
    }
  }
  ```
- [ ] **1.5** Run `npm run build` — fix any broken imports
- [ ] **1.6** Commit: "refactor: create shared/ and app/ structure with path aliases"

### Phase 2: Standardize Exports (10 minutes, prevents future pain)

- [ ] **2.1** Convert all default-export pages to named exports
- [ ] **2.2** Simplify App.tsx lazy imports (all use the same pattern now)
- [ ] **2.3** Commit: "refactor: standardize all page exports to named exports"

### Phase 3: Extract Features (one at a time — do NOT try to do all at once)

For each feature (start with the smallest to build confidence, then tackle the large ones):

**Order: specializations → teachers → students → courses → audit → enrollments → scoring → excuses → feedback → communication → checkin → certificates → sessions → dashboard → attendance**

For each feature:
- [ ] **3.N.1** Create `src/features/<name>/` with `pages/`, `components/`, `services/`, `types.ts`, `index.ts`
- [ ] **3.N.2** Move the existing page file into `features/<name>/pages/`
- [ ] **3.N.3** Move the existing service file into `features/<name>/services/`
- [ ] **3.N.4** Move relevant components into `features/<name>/components/`
- [ ] **3.N.5** Extract any inline types into `features/<name>/types.ts`
- [ ] **3.N.6** Update imports in the moved files
- [ ] **3.N.7** Update `routes.tsx` to point to new page locations
- [ ] **3.N.8** Run `npm run build` — fix any broken imports
- [ ] **3.N.9** Commit: "refactor: extract <name> feature module"

### Phase 4: Kill the God Components (one per PR — do NOT batch)

For each god component (AttendanceRecords first, then Attendance, then Dashboard, etc.):
- [ ] **4.N.1** Create the custom hook: extract all `useState`, `useEffect`, data fetching, and transformations into `use<Feature>Data.ts`
- [ ] **4.N.2** Create sub-components: extract logical UI sections into their own `.tsx` files
- [ ] **4.N.3** Rewrite the page as a thin orchestrator that wires hook → components
- [ ] **4.N.4** Remove all direct `supabase` imports from the page — move any remaining queries to the service
- [ ] **4.N.5** Run `npm run build` — verify no regressions
- [ ] **4.N.6** Commit: "refactor: split <PageName> into hook + components"

### Phase 5: Enforce the Service Layer

- [ ] **5.1** For each of the 20 files that import `supabase` directly: move the query into the appropriate feature service
- [ ] **5.2** Add an ESLint rule to ban importing from `lib/supabase` outside of `services/`:
  ```js
  // eslint.config.js
  {
    files: ['src/features/*/pages/**', 'src/features/*/components/**', 'src/shared/components/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['**/lib/supabase*']
      }]
    }
  }
  ```
- [ ] **5.3** Commit: "refactor: enforce service layer — no direct Supabase in UI"

### Phase 6: Update Documentation

- [ ] **6.1** Rewrite `.github/copilot-instructions.md` to reflect the new structure
- [ ] **6.2** Update `README.md` with new folder structure and dev instructions
- [ ] **6.3** Create `CONTRIBUTING.md` from Section 6 of this document
- [ ] **6.4** Commit: "docs: update all documentation for new architecture"

### Timeline Expectations
- Phase 0: Quick. File moves only, no logic changes.
- Phase 1-2: Quick. Infrastructure changes, import path updates.
- Phase 3: Moderate per feature. Start with small features (specializations, teachers, students) to build the pattern, then tackle larger ones.
- Phase 4: **This is the hard part.** Each god component split takes careful work. Do one at a time, test thoroughly, commit, then move to the next.
- Phase 5: Moderate. Mechanical extraction of queries into services.
- Phase 6: Quick. Documentation updates.

---

## 10. What NOT to Do

1. **Don't refactor everything at once.** Move files first, then split components. One phase at a time.
2. **Don't add React Query / Zustand / Redux yet.** The custom hook pattern is sufficient. Add state management libraries only when you have a concrete problem they solve.
3. **Don't rewrite services from scratch.** The existing services work. Move them into features as-is, then improve iteratively.
4. **Don't add tests during the refactoring.** Refactor first, stabilize, then add tests. Mixing both will double the work.
5. **Don't optimize performance during the refactoring.** That's a separate concern. Get the structure right first.
6. **Don't create a monorepo, microfrontend, or multi-package structure.** This is a single app. Keep it simple.

---

*This document is the blueprint. Execute it phase by phase. Every commit should leave the app in a buildable, deployable state.*
