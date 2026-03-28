# Phase 0 + Phase 1 Execution Plan

---

## 1. Folder Creation List

```
database/
database/archive/
docs/
docs/features/
docs/archive/
```

---

## 2. Root Cleanup — File Move Table

### SQL Files → `database/archive/`

| # | File |
|---|------|
| 1 | `ADD-ADMIN-RESTRICT-TEACHER.sql` |
| 2 | `ADD-ADMIN-TABLE.sql` |
| 3 | `ADD-BOOK-REFERENCE-HIERARCHY.sql` |
| 4 | `ADD-CAN-HOST-TO-ENROLLMENT.sql` |
| 5 | `ADD-CERTIFICATE-TABLES.sql` |
| 6 | `ADD-CHECKIN-METADATA.sql` |
| 7 | `ADD-COMMUNICATION-FEATURES.sql` |
| 8 | `ADD-COMMUNICATION-HUB.sql` |
| 9 | `ADD-COORDINATES-TO-STUDENT.sql` |
| 10 | `ADD-EXCUSE-REASON.sql` |
| 11 | `ADD-EXCUSE-REQUEST-TABLE.sql` |
| 12 | `ADD-FEEDBACK-QUESTION-DATE.sql` |
| 13 | `ADD-GPS-TO-SESSION-HOST.sql` |
| 14 | `ADD-GRACE-PERIOD-TO-SESSION.sql` |
| 15 | `ADD-HOST-ADDRESS-TO-ATTENDANCE.sql` |
| 16 | `ADD-HOST-DATE-TO-ENROLLMENT.sql` |
| 17 | `ADD-IMAGE-TO-ANNOUNCEMENT.sql` |
| 18 | `ADD-PHOTO-CHECKIN-SESSIONS-TABLE.sql` |
| 19 | `ADD-PHOTO-URL-TO-STUDENT.sql` |
| 20 | `ADD-PROXIMITY-RADIUS.sql` |
| 21 | `ADD-SCORING-CONFIG-TABLE.sql` |
| 22 | `ADD-SESSION-DATE-HOST-TABLE.sql` |
| 23 | `ADD-SESSION-DAY-CHANGE-LOG.sql` |
| 24 | `ADD-SESSION-DELIVERY-RECORDINGS-AND-SPECIALIZATION.sql` |
| 25 | `ADD-SESSION-FEEDBACK.sql` |
| 26 | `ADD-SESSION-TEACHER-HOST-CONTROL.sql` |
| 27 | `ADD-SIGNER-TO-ISSUED-CERTIFICATE.sql` |
| 28 | `ADD-SPECIALIZATION-TABLE.sql` |
| 29 | `ADD-STATUS-CANHOST-CONSTRAINT.sql` |
| 30 | `ADD-STUDENT-SPECIALIZATION.sql` |
| 31 | `ADD-TEACHER-HOST-SCHEDULE.sql` |
| 32 | `ADD-TIERED-LATE-SCORING.sql` |
| 33 | `BULK-IMPORT-STRUCTURE.sql` |
| 34 | `CHECK-ATTENDANCE-CONSTRAINTS.sql` |
| 35 | `CLEANUP-ATTENDANCE.sql` |
| 36 | `CORRECT-BOOK-TRACKING-MIGRATION.sql` |
| 37 | `CORRECTED-TEACHER-RLS.sql` |
| 38 | `CREATE-AUDIT-LOG-TABLE.sql` |
| 39 | `CREATE-EXCUSE-DOCUMENTS-BUCKET.sql` |
| 40 | `current copy as sql from supabase database.sql` |
| 41 | `database-restructure.sql` |
| 42 | `database-updates.sql` |
| 43 | `DECOUPLE-ADMIN-FROM-TEACHER.sql` |
| 44 | `FINAL-TEACHER-ONLY-RLS.sql` |
| 45 | `FIX-ADMIN-MESSAGE-CONSTRAINTS.sql` |
| 46 | `FIX-ALL-CHECKIN-RLS.sql` |
| 47 | `FIX-ATTENDANCE-FOR-QR-CHECKIN.sql` |
| 48 | `FIX-COMMUNICATION-HUB-POLICIES.sql` |
| 49 | `FIX-CONSTRAINT-MISMATCH.sql` |
| 50 | `FIX-CONSTRAINTS-AFTER-BUGGY-MIGRATIONS.sql` |
| 51 | `FIX-DATA-INTEGRITY.sql` |
| 52 | `FIX-EXCUSE-REQUEST-REVIEWED-BY.sql` |
| 53 | `FIX-EXCUSE-REQUEST-SCHEDULE-VALIDATION.sql` |
| 54 | `FIX-MESSAGE-DELETE.sql` |
| 55 | `FIX-NULL-LATE-MINUTES.sql` |
| 56 | `FIX-OLD-ATTENDANCE.sql` |
| 57 | `FIX-PHOTO-CHECKIN-RLS.sql` |
| 58 | `FIX-SCORING-CONFIG-RLS.sql` |
| 59 | `FIX-SESSION-DAY-CHANGE-RLS.sql` |
| 60 | `FIX-SESSION-FEEDBACK-RLS-AND-CONSTRAINTS.sql` |
| 61 | `FIX-SESSION-IDS.sql` |
| 62 | `FIX-SPECIALIZATION-RLS.sql` |
| 63 | `MIGRATE-TO-CURRENT-SCHEMA.sql` |
| 64 | `PERFORMANCE-INDEXES.sql` |
| 65 | `QUICK-FIX-SCHEMA.sql` |
| 66 | `REMOVE-TEACHER-FROM-STUDENT.sql` |
| 67 | `ROLLBACK-ADD-CAN-HOST-TO-ENROLLMENT.sql` |
| 68 | `ROLLBACK-ADD-EXCUSE-REASON.sql` |
| 69 | `RUN-ALL-ESSENTIAL-MIGRATIONS.sql` |
| 70 | `RUN-THIS-MIGRATION.sql` |
| 71 | `sample-data.sql` |
| 72 | `supabase-schema.sql` |
| 73 | `VERIFY-BOOK-TRACKING.sql` |
| 74 | `VERIFY-CURRENT-SCHEMA.sql` |
| 75 | `VERIFY-GPS-FIELDS.sql` |

**DELETE (not move):**
| File | Reason |
|------|--------|
| `DISABLE_RLS.sql` | Security risk |

### MD Files — Move Destinations

**To `docs/` (keep):**
| File | Destination |
|------|-------------|
| `DATABASE_DOCUMENTATION.md` | `docs/database.md` |
| `ARCHITECTURE-AUDIT.md` | `docs/architecture.md` |
| `DEPLOYMENT-READY.md` | `docs/deployment.md` |
| `SETUP_GUIDE.md` | `docs/setup.md` |

**To `docs/features/`:**
| File | Destination |
|------|-------------|
| `ATTENDANCE-SYSTEM-UPGRADES.md` | `docs/features/attendance-system.md` |
| `CONFIGURABLE-GRACE-PERIOD.md` | `docs/features/grace-period.md` |
| `BOOK-TRACKING-FEATURE-GUIDE.md` | `docs/features/book-tracking.md` |
| `QR_CODE_SYSTEM.md` | `docs/features/qr-code-system.md` |
| `FACE-RECOGNITION-ATTENDANCE.md` | `docs/features/face-recognition.md` |
| `HOST-SYSTEM-GUIDE.md` | `docs/features/host-system.md` |
| `FEATURES.md` | `docs/features/features-overview.md` |
| `AUDIT-LOG-SYSTEM.md` | `docs/features/audit-log.md` |

**To `docs/archive/` (stale/one-off artifacts):**
| File |
|------|
| `AUDIT-LOG-COVERAGE.md` |
| `BOOK-TRACKING-SUMMARY.md` |
| `BOOK-TRACKING-VISUAL-GUIDE.md` |
| `BUGS_AND_FIXES.md` |
| `BULK-IMPORT-DOCUMENTATION.md` |
| `CONSTRAINT-MISMATCH-EXPLANATION.md` |
| `CORRECT-IMPLEMENTATION.md` |
| `FEATURE_IDEAS.md` |
| `FINAL-VERIFICATION-CHECKLIST.md` |
| `FIXES_APPLIED.md` |
| `FRONTEND-FIXES-COMPLETE-SUMMARY.md` |
| `FRONTEND-IMPROVEMENTS.md` |
| `FRONTEND-STATUS-REPORT.md` |
| `FUTURE-FEATURE-IMPROVEMENTS.md` |
| `FUTURE-FEATURES-ROADMAP.md` |
| `IMPLEMENTATION_SUMMARY.md` |
| `MIGRATION-EXECUTION-GUIDE.md` |
| `QUICKSTART.md` |
| `RESTRUCTURING_GUIDE.md` |
| `SCHEMA-COMPARISON.md` |
| `SQL-CONSTRAINT-DOCUMENTATION.md` |
| `SQL-TRAINING-CENTER-GUIDE.md` |
| `SYSTEM-DESIGN-ANALYSIS.md` |
| `SYSTEM-VERIFICATION.md` |
| `TESTING-CHECKLIST.md` |
| `UI_ENHANCEMENT_PLAN.md` |
| `VISUAL-IMPROVEMENTS-GUIDE.md` |
| `WORD-EXPORT-ENHANCEMENTS.md` |
| `WORD-EXPORT-FEATURE.md` |
| `WORD-EXPORT-IMPLEMENTATION.md` |
| `WORD-EXPORT-PREMIUM-ENHANCEMENTS.md` |
| `QUICK-START-BOOK-TRACKING.md` |

### Utility scripts → `database/archive/`
| File |
|------|
| `check-tables.ts` |
| `fix-emails.js` |
| `setup-db.ts` |
| `test-connection.ts` |
| `validate-sql.ts` |

### Files that STAY in root
| File | Reason |
|------|--------|
| `.env` / `.env.example` / `.env.local` | Config |
| `.gitignore` | Git |
| `.github/` | GitHub config |
| `eslint.config.js` | Lint config |
| `index.html` | Vite entry |
| `package.json` / `package-lock.json` | NPM |
| `postcss.config.js` | PostCSS |
| `tailwind.config.js` | Tailwind |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | TS |
| `vite.config.ts` | Vite |
| `vercel.json` | Deployment |
| `README.md` | Project readme |
| `src/` | Source code |
| `public/` | Static assets |
| `supabase/` | Supabase project dir |
| `supabase-invite-function/` | Edge function |

---

## 3. Database Consolidation Checklist

1. [ ] Run in Supabase SQL Editor — export all table DDL:
   ```sql
   SELECT 'CREATE TABLE ' || tablename || ' (...);' 
   FROM pg_tables 
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```
   *(Use Dashboard → Table Editor → each table → "Definition" tab for full DDL, or copy from `current copy as sql from supabase database.sql`)*

2. [ ] Create `database/schema.sql` — paste all `CREATE TABLE` + `ALTER TABLE` + `CREATE INDEX` statements, ordered by dependency (referenced tables first)

3. [ ] Run in Supabase SQL Editor — export all RLS policies:
   ```sql
   SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname;
   ```

4. [ ] Run in Supabase SQL Editor — export helper functions:
   ```sql
   SELECT routine_name, routine_definition
   FROM information_schema.routines
   WHERE routine_schema = 'public'
   AND routine_type = 'FUNCTION'
   ORDER BY routine_name;
   ```

5. [ ] Create `database/policies.sql` — paste `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + all `CREATE POLICY` statements + helper functions (`is_admin()`, `is_teacher()`, `get_my_student_id()`)

6. [ ] Create `database/functions.sql` — paste any stored procedures, triggers, trigger functions

7. [ ] Create `database/seeds.sql` — copy test data from `sample-data.sql`

8. [ ] Verify by diffing: exported DDL vs `current copy as sql from supabase database.sql`

9. [ ] Add header comments to each file:
   ```sql
   -- Training Center Database Schema
   -- Generated from production: YYYY-MM-DD
   -- Source of truth: Supabase Dashboard
   -- DO NOT modify directly for incremental changes.
   -- Create migration files in database/migrations/ instead.
   ```

10. [ ] Create `database/migrations/` folder for future incremental changes

11. [ ] Move `ARCHITECTURE-AUDIT.md` to `docs/architecture.md`

12. [ ] Commit: `chore: organize root — SQL to database/, docs to docs/`

---

## 4. Shared + App Migration Map

### `src/shared/` — What Moves

| Source | Destination |
|--------|-------------|
| `src/components/ui/*` | `src/shared/components/ui/*` |
| `src/components/ui/index.ts` | `src/shared/components/ui/index.ts` |
| `src/components/ErrorBoundary.tsx` | `src/shared/components/ErrorBoundary.tsx` |
| `src/components/PrivateRoute.tsx` | `src/shared/components/PrivateRoute.tsx` |
| `src/components/PhotoAvatar.tsx` | `src/shared/components/PhotoAvatar.tsx` |
| `src/hooks/useConfirm.ts` | `src/shared/hooks/useConfirm.ts` |
| `src/hooks/useDebounce.ts` | `src/shared/hooks/useDebounce.ts` |
| `src/hooks/useIsTeacher.ts` | `src/shared/hooks/useIsTeacher.ts` |
| `src/hooks/useOnlineStatus.ts` | `src/shared/hooks/useOnlineStatus.ts` |
| `src/hooks/useRefreshOnFocus.ts` | `src/shared/hooks/useRefreshOnFocus.ts` |
| `src/hooks/useToast.ts` | `src/shared/hooks/useToast.ts` |
| `src/utils/*` | `src/shared/utils/*` |
| `src/constants/attendance.ts` | `src/shared/constants/attendance.ts` |
| `src/types/database.types.ts` | `src/shared/types/database.types.ts` |
| `src/lib/supabase.ts` | `src/shared/lib/supabase.ts` |
| `src/services/geocodingService.ts` | `src/shared/services/geocodingService.ts` |
| `src/services/auditService.ts` | `src/shared/services/auditService.ts` |

### `src/app/` — What Moves

| Source | Destination |
|--------|-------------|
| `src/App.tsx` | `src/app/App.tsx` |
| `src/App.css` | `src/app/App.css` |
| `src/components/Layout.tsx` | `src/app/Layout.tsx` |

### Files that STAY in `src/` root

| File | Reason |
|------|--------|
| `src/main.tsx` | Vite entry point — must stay |
| `src/index.css` | Global styles — must stay |
| `src/assets/` | Static assets — stays |

### `src/main.tsx` update needed

```tsx
// Before
import App from './App'
import './App.css'

// After
import App from './app/App'
import './app/App.css'
```

### Import Path Updates (patterns)

| Old Import | New Import |
|------------|-----------|
| `from '../components/ui/Button'` | `from '@shared/components/ui/Button'` |
| `from '../components/ui'` | `from '@shared/components/ui'` |
| `from '../hooks/useToast'` | `from '@shared/hooks/useToast'` |
| `from '../hooks/useDebounce'` | `from '@shared/hooks/useDebounce'` |
| `from '../utils/formatDate'` | `from '@shared/utils/formatDate'` |
| `from '../utils/attendanceGenerator'` | `from '@shared/utils/attendanceGenerator'` |
| `from '../constants/attendance'` | `from '@shared/constants/attendance'` |
| `from '../types/database.types'` | `from '@shared/types/database.types'` |
| `from '../lib/supabase'` | `from '@shared/lib/supabase'` |
| `from './auditService'` (in services) | `from '@shared/services/auditService'` |
| `from '../services/geocodingService'` | `from '@shared/services/geocodingService'` |
| `from '../services/auditService'` | `from '@shared/services/auditService'` |
| `from '../components/ErrorBoundary'` | `from '@shared/components/ErrorBoundary'` |
| `from '../components/PrivateRoute'` | `from '@shared/components/PrivateRoute'` |
| `from './components/Layout'` | `from './Layout'` (inside app/) |

---

## 5. Config Snippets

### `tsconfig.app.json` — Add paths

```jsonc
{
  "compilerOptions": {
    // ... existing options ...
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./src/shared/*"],
      "@features/*": ["./src/features/*"],
      "@app/*": ["./src/app/*"]
    }
  },
  "include": ["src"]
}
```

### `vite.config.ts` — Add resolve aliases

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@features': path.resolve(__dirname, './src/features'),
      '@app': path.resolve(__dirname, './src/app'),
    },
  },
  // ... rest of existing config
})
```

### `eslint.config.js` — Add Supabase import restriction

```js
// Add this as a new config object in the array:
{
  files: ['src/**/pages/**/*.{ts,tsx}', 'src/**/components/**/*.{ts,tsx}', 'src/shared/components/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/lib/supabase*', '@shared/lib/supabase*'],
        message: 'Do not import supabase directly. Use a service instead.'
      }]
    }]
  }
}
```

---

## 6. AI Enforcement Rules — Copilot Instructions Snippet

Add to `.github/copilot-instructions.md`:

```markdown
## Strict Rules (NEVER violate)

1. **Max file sizes**: Page ≤300 lines, Component ≤400 lines, Service ≤500 lines, Hook ≤200 lines.
2. **Max useState per component**: 7. Use useReducer or extract a custom hook if more.
3. **NEVER import supabase outside `shared/lib/` and `**/services/`**. Pages/components call services.
4. **NEVER define inline DB types**. Import from `shared/types/database.types.ts` or feature `types.ts`.
5. **Pages are thin orchestrators**: hook (data) + components (UI). No Supabase queries, no data transforms.
6. **One feature = one folder** under `src/features/`. Contains: pages/, components/, hooks/, services/, types.ts, index.ts.
7. **Features never import from other features**. Shared code goes in `src/shared/`.
8. **All exports are named** (no default exports from pages/components).
9. **New DB changes** go in `database/migrations/NNNN-description.sql`, NOT in schema.sql directly.
10. **Nothing in project root** except config files + README.md.

## Folder Structure
- `src/app/` — App shell (App.tsx, Layout.tsx, routes)
- `src/features/<name>/` — Feature modules (pages, components, hooks, services, types)
- `src/shared/` — Cross-feature code (ui components, hooks, utils, types, lib, constants)
- `database/` — schema.sql, policies.sql, functions.sql, seeds.sql, migrations/, archive/
- `docs/` — Documentation files
```

---

*Ready to execute. Confirm to proceed with folder creation + file moves.*
